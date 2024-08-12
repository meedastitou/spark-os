/* jshint esversion: 6 */
/* eslint-disable new-cap */
/* eslint max-len: ["error", { "code": 100, "ignoreComments": true, "ignoreStrings": true, "ignoreTemplateLiterals": true}] */
let SerialPort = require('serialport');

if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line global-require
  SerialPort = require('virtual-serialport');
}

// transport states
const IDLE = 0;
const AWAIT_INITIAL_DLE = 1;
const AWAIT_DLE_TO_REQUEST_MESSAGE = 2;
const AWAIT_STX_FOR_REACTION_TELEGRAM = 3;
const AWAIT_REACTION_TELEGRAM = 4;
const AWAIT_STX_FOR_RESPONSE_MESSAGE = 5; // jumps back to this state if more data to receive
const AWAIT_RESPONSE_MESSAGE = 6;
const AWAIT_DLE_BEFORE_SENDING_REACTION_TELEGRAM = 7;
const AWAIT_DLE_AFTER_SENDING_REACTION_TELEGRAM = 8;

// transport control codes
const STX = 0x02;
const ETX = 0x03;
const DLE = 0x10;

const MAX_APP_PAYLOAD_BYTES = 256;

const TRANSPORT_HEADER_SIZE_STANDARD = 10;
const TRANSPORT_FOOTER_SIZE = 3;
const APP_MESSAGE_LENGTH_FIELD_OFFSET = 6;
const TRANSPORT_HEADER_SIZE_FOLLOW_ON = 4;

// eslint-disable-next-line max-len
const TELEGRAM_CODE_STANDARD = new Buffer.from([0x00, 0x00, 0x41, 0x44, 0x64, 0x01, 0x00, 0x00, 0xff, 0xff]);
const REACTION_TELEGRAM_CODE = new Buffer.from([0x00, 0x00, 0x00, 0x00, 0x10, 0x03, 0x13]);
// eslint-disable-next-line max-len
const FOLLOW_ON_REACTION_TELEGRAM_CODE = new Buffer.from([0xff, 0x00, 0x00, 0x00, 0x10, 0x03, 0xec]);

const DLE_RESPONSE_TIMEOUT_MS = 550;
const WHOLE_MESSAGE_TIMEOUT_MS = 5000;

let deviceName;
let baudRate;
let transportState = IDLE;
let transportDleTimeout = null;
let wholeMessageTimeout = null;
let transportSendBuffer = null;
let receivedMessageCallback = null;
const reactionRxBuffer = new Buffer.allocUnsafe(REACTION_TELEGRAM_CODE.length);
let reactionRxBufferCurrentLength = 0;
// eslint-disable-next-line max-len
const telegramRxBuffer = new Buffer.allocUnsafe((MAX_APP_PAYLOAD_BYTES * 2) + TRANSPORT_HEADER_SIZE_STANDARD + TRANSPORT_FOOTER_SIZE);
let telegramRxBufferCurrentLength = 0;
let applicationRxBuffer = null;
let applicationRxBufferCurrentLength = 0;
let expectedApplicationWordSize = 0;
let responseComplete = false;
let followOn = false;

function transport(serialDeviceName, serialBaudRate) {
  deviceName = serialDeviceName;
  baudRate = serialBaudRate;
  this.serialPort = null;
  this.isOpen = false;
}

function serialCloseHelper(serialPort, callback) {
  // stop any timers
  clearTimeout(transportDleTimeout);
  clearTimeout(wholeMessageTimeout);

  if (serialPort.isOpen) {
    serialPort.close(callback);
  } else {
    callback();
  }
}

function callbackForRequest(error, response) {
  // prevent any chance of multiple callbacks for a single request
  if (receivedMessageCallback !== null) {
    receivedMessageCallback(error, response);
    receivedMessageCallback = null;
  }
}

function onTransportDleTimeout() {
  // if a timeout occurs during exchange
  if (transportState !== IDLE) {
    transportState = IDLE;
    callbackForRequest(new Error('Transport timeout when communicating with machine.. Did not receive DTX in a timely manner'));
  }
}

function onWholeMessageTimeout() {
  // if a timeout occurs between telegrams
  if (transportState !== IDLE) {
    transportState = IDLE;
    callbackForRequest(new Error('Transport timeout when communicating with machine. Did not receive response message in a timely manner'));
  }
}

function calculateBcc(inputBuffer, length) {
  let bcc = 0;
  // bounds check the length argument
  if (length > inputBuffer.length) {
    // eslint-disable-next-line no-param-reassign
    ({ length } = inputBuffer);
  }

  for (let i = 0; i < length; i += 1) {
    // eslint-disable-next-line no-bitwise
    bcc ^= inputBuffer[i];
  }
  return bcc;
}

function revertByteStuffDLEs(message) {
  let startIndex = 0;
  let index;
  const results = [];
  const doubleDle = new Buffer.from([DLE, DLE]);

  // create an array of indexes where double DLE's appear
  index = message.indexOf(doubleDle, startIndex);
  while (index !== -1) {
    startIndex = index + 2;
    results.push(index);
    index = message.indexOf(doubleDle, startIndex);
  }

  // if there were double DLE's in the buffer
  if (results.length > 0) {
    // new buffer size needs to be smaller as we are removing each occurance of a double DLE's
    const processedBuffer = Buffer.allocUnsafe(message.length - results.length);

    let copyFromIndex = 0;

    // for each occurance of a double DLE
    for (let i = 0; i < results.length; i += 1) {
      // copy original buffer up to the point of this double DLE
      message.copy(processedBuffer, copyFromIndex - i, copyFromIndex, results[i] + 1);

      // update the index used for the start of the buffer
      copyFromIndex = results[i] + 1;
    }
    // fill in remaining buffer after last double DLE occurance
    message.copy(processedBuffer, copyFromIndex - results.length, copyFromIndex);

    return (processedBuffer);
  }
  // if no occurance, just return the original buffer back
  return (message);
}

function processTransportData(serialPort, data) {
  switch (transportState) {
    case IDLE:
    {
      // ignore any messages when idle state
      break;
    }

    case AWAIT_INITIAL_DLE:
    {
      if (data[0] === DLE) {
        // clear dle timeout as we have dle
        clearTimeout(transportDleTimeout);
        // move to next state
        transportState = AWAIT_DLE_TO_REQUEST_MESSAGE;
        // send telegram message
        serialPort.write(transportSendBuffer);
        // and start new transport timeout
        transportDleTimeout = setTimeout(onTransportDleTimeout, DLE_RESPONSE_TIMEOUT_MS);
        // and the whole message timeout
        wholeMessageTimeout = setTimeout(onWholeMessageTimeout, WHOLE_MESSAGE_TIMEOUT_MS);
      } else {
        // move back to idle state, as arburg not ready to process
        transportState = IDLE;
        // callback with an error
        callbackForRequest(new Error('Unexpected response to initial STX'));
      }
      break;
    }

    case AWAIT_DLE_TO_REQUEST_MESSAGE:
    {
      if (data[0] === DLE) {
        // clear dle timeout as we have dle
        clearTimeout(transportDleTimeout);
        if (data.length > 1) {
          // may also already have the STX from the machine wanting to send us the reaction telegram
          if (data[1] === STX) {
            // if so jump to correct next state
            transportState = AWAIT_REACTION_TELEGRAM;
            // and send DLE response
            serialPort.write(new Buffer.from([DLE]));
          } else {
            // move back to idle state, as arburg gave unxepected data
            transportState = IDLE;
            // callback with an error
            callbackForRequest(new Error('Unexpected data received from machine'));
          }
        } else {
          // move to next state
          transportState = AWAIT_STX_FOR_REACTION_TELEGRAM;
        }
      } else {
        // move back to idle state, as arburg not ready to process
        transportState = IDLE;
        // callback with an error
        callbackForRequest(new Error('Unexpected response to request message'));
      }
      break;
    }

    case AWAIT_STX_FOR_REACTION_TELEGRAM:
    {
      if (data[0] === STX) {
        // if so jump to correct next state
        transportState = AWAIT_REACTION_TELEGRAM;
        // and send DLE response
        serialPort.write(new Buffer.from([DLE]));
      } else {
        // move back to idle state, as arburg gave unxepected data
        transportState = IDLE;
        // callback with an error
        callbackForRequest(new Error('Unexpected data received from machine'));
      }
      break;
    }

    case AWAIT_REACTION_TELEGRAM:
    {
      // append response, may not get all at once
      data.copy(reactionRxBuffer, reactionRxBufferCurrentLength);
      reactionRxBufferCurrentLength += data.length;

      // should have been sent a reaction telegram, but may not have all the data yet
      if (reactionRxBufferCurrentLength === REACTION_TELEGRAM_CODE.length) {
        // data contents should match a reaction telegram
        if (reactionRxBuffer.equals(REACTION_TELEGRAM_CODE) === true) {
          // if so jump to correct next state
          transportState = AWAIT_STX_FOR_RESPONSE_MESSAGE;
          // and send DLE response to reaction telegram
          serialPort.write(new Buffer.from([DLE]));
        } else {
          // TODO could be a reaction telegram with an error code (byte 4 is an error code), so could parse out the error code
          // move back to idle state, as arburg gave unxepected data
          transportState = IDLE;
          // callback with an error
          callbackForRequest(new Error('Unexpected data received from machine'));
        }
      }
      break;
    }

    case AWAIT_STX_FOR_RESPONSE_MESSAGE:
    {
      if (data[0] === STX) {
        // if so jump to correct next state
        transportState = AWAIT_RESPONSE_MESSAGE;
        responseComplete = false;
        // and send DLE response to STX
        serialPort.write(new Buffer.from([DLE]));
      } else {
        // move back to idle state, as arburg gave unxepected data
        transportState = IDLE;
        // callback with an error
        callbackForRequest(new Error('Unexpected data received from machine'));
      }
      break;
    }

    case AWAIT_RESPONSE_MESSAGE:
    {
      // first bounds check amount of data received
      if (data.length + telegramRxBufferCurrentLength > telegramRxBuffer.length) {
        // move back to idle state, as arburg gave too much data
        transportState = IDLE;
        // callback with an error
        return callbackForRequest(new Error('Too much data received from machine'));
      }

      // append data into telegram rx buffer, as we may not have the whole telegram yet
      data.copy(telegramRxBuffer, telegramRxBufferCurrentLength);
      telegramRxBufferCurrentLength += data.length;

      // look for transport footer at end of the data
      // eslint-disable-next-line max-len
      if ((telegramRxBuffer[telegramRxBufferCurrentLength - 4] !== DLE) && (telegramRxBuffer[telegramRxBufferCurrentLength - 3] === DLE) && (telegramRxBuffer[telegramRxBufferCurrentLength - 2] === ETX)) {
        // if its there, also check the bcc is correct
        const sentBcc = telegramRxBuffer[telegramRxBufferCurrentLength - 1];
        const caluclatedBcc = calculateBcc(telegramRxBuffer, telegramRxBufferCurrentLength - 1);
        if (sentBcc !== caluclatedBcc) {
          // move back to idle state, as arburg gave corrupt data
          transportState = IDLE;
          // callback with an error
          return callbackForRequest(new Error('BCC checksum mismatch'));
        }

        let thisTransportHeadeSize;

        // we have a full telegram (but may not have the full application message as app messages can be split over standard telegram and then follow on telegrams)

        // if this is a standard mesage
        if ((telegramRxBuffer[0] === 0x00) && (telegramRxBuffer[1] === 0x00)) {
          // extract the expected word size of the application message and create a buffer that size
          // eslint-disable-next-line max-len
          expectedApplicationWordSize = telegramRxBuffer.readInt16BE(APP_MESSAGE_LENGTH_FIELD_OFFSET);
          applicationRxBuffer = new Buffer.allocUnsafe(expectedApplicationWordSize * 2);
          applicationRxBufferCurrentLength = 0;
          // also note the expected header size
          thisTransportHeadeSize = TRANSPORT_HEADER_SIZE_STANDARD;
          followOn = false;
        } else if ((telegramRxBuffer[0] === 0xff) && (telegramRxBuffer[1] === 0x00)) {
          // otherwise if a follow-on telegram
          followOn = true;
          // should already have some app data, so check it is not zero
          if (applicationRxBufferCurrentLength === 0) {
            transportState = IDLE;
            // callback with an error
            return callbackForRequest(new Error('Unexpected Follow on Telegram received'));
          }
          // otherwise note the expected header size
          thisTransportHeadeSize = TRANSPORT_HEADER_SIZE_FOLLOW_ON;
        } else {
          // move back to idle state, as arburg gave corrupt data
          transportState = IDLE;
          // callback with an error
          return callbackForRequest(new Error('Telegram header invalid'));
        }

        // extract the (possible partial) app message from the telegram
        // eslint-disable-next-line max-len
        const partialAppUnprocessedMessage = new Buffer.allocUnsafe(telegramRxBufferCurrentLength - (thisTransportHeadeSize + TRANSPORT_FOOTER_SIZE));
        // eslint-disable-next-line max-len
        telegramRxBuffer.copy(partialAppUnprocessedMessage, 0, thisTransportHeadeSize, telegramRxBufferCurrentLength - TRANSPORT_FOOTER_SIZE);

        // remove any byte stuffing of DLE's
        const partialAppProcessedMessage = revertByteStuffDLEs(partialAppUnprocessedMessage);

        // test there is enough room to add new data to application message buffer
        // eslint-disable-next-line max-len
        if (applicationRxBuffer.length < (applicationRxBufferCurrentLength + partialAppProcessedMessage.length)) {
          transportState = IDLE;
          // callback with an error if not
          return callbackForRequest(new Error('More applciation data recieved than expecting'));
        }

        // otherwise add to applicationRxBuffer, and increment count
        partialAppProcessedMessage.copy(applicationRxBuffer, applicationRxBufferCurrentLength);
        applicationRxBufferCurrentLength += partialAppProcessedMessage.length;

        // check if all the data has arrived
        if ((applicationRxBufferCurrentLength / 2) === expectedApplicationWordSize) {
          // we wait to send the callback with the complete message until the last transport messaging completes, but set a flag to say we have the complete message
          responseComplete = true;
          applicationRxBufferCurrentLength = 0;
        }

        // clear up now finished with transport buffer
        telegramRxBufferCurrentLength = 0;

        // jump to correct next state
        transportState = AWAIT_DLE_BEFORE_SENDING_REACTION_TELEGRAM;
        // and send DLE and STX response to telegram
        serialPort.write(new Buffer.from([DLE, STX]));
        // and start new transport timeout
        transportDleTimeout = setTimeout(onTransportDleTimeout, DLE_RESPONSE_TIMEOUT_MS);
      } else {
        // otherwise wait for more data from serial interface (no need to change state)
      }

      break;
    }

    case AWAIT_DLE_BEFORE_SENDING_REACTION_TELEGRAM:
    {
      // if DLE
      if (data[0] === DLE) {
        // clear dle timeout as we have dle
        clearTimeout(transportDleTimeout);
        // move to next state
        transportState = AWAIT_DLE_AFTER_SENDING_REACTION_TELEGRAM;
        // send reaction telegram message
        if (followOn === false) {
          serialPort.write(REACTION_TELEGRAM_CODE);
        } else {
          serialPort.write(FOLLOW_ON_REACTION_TELEGRAM_CODE);
        }
        // and start new transport timeout
        transportDleTimeout = setTimeout(onTransportDleTimeout, DLE_RESPONSE_TIMEOUT_MS);
      } else {
        // move back to idle state, as arburg not ready to process
        transportState = IDLE;
        // callback with an error
        callbackForRequest(new Error('Unexpected response to STX'));
      }
      break;
    }

    case AWAIT_DLE_AFTER_SENDING_REACTION_TELEGRAM:
    {
      if (data[0] === DLE) {
        // clear dle timeout as we have dle
        clearTimeout(transportDleTimeout);

        // have we already got all the required message
        if (responseComplete === true) {
          // move back to idle state, as messaging is complete
          transportState = IDLE;
          // clear whole message timeout
          clearTimeout(wholeMessageTimeout);
          // we can now send back the complete message using the callback here
          callbackForRequest(null, applicationRxBuffer);
        } else if (data.length > 1) {
          // may also already have the STX from the machine wanting to send us a follow on telegram
          if (data[1] === STX) {
            // if so jump to correct next state
            transportState = AWAIT_RESPONSE_MESSAGE;
            // and send DLE response
            serialPort.write(new Buffer.from([DLE]));
          } else {
            // move back to idle state, as arburg gave unxepected data
            transportState = IDLE;
            // callback with an error
            callbackForRequest(new Error('Unexpected data received from machine'));
          }
        } else {
          // move to next state
          transportState = AWAIT_STX_FOR_RESPONSE_MESSAGE;
        }
      } else {
        // move back to idle state, as arburg not ready to process
        transportState = IDLE;
        // callback with an error
        callbackForRequest(new Error('Unexpected response to reaction telegram'));
      }
      break;
    }

    default: break;
  }
  return undefined;
}

function byteStuffDLEs(message) {
  let startIndex = 0;
  let index;
  const results = [];

  // create an array of indexes where DLE's appear
  index = message.indexOf(DLE, startIndex);
  while (index !== -1) {
    startIndex = index + 1;
    results.push(index);
    index = message.indexOf(DLE, startIndex);
  }

  // if there were DLE's in the buffer
  if (results.length > 0) {
    // new buffer size needs to have space for doubling each occurance of a DLE
    const processedBuffer = Buffer.allocUnsafe(message.length + results.length);

    let copyFromIndex = 0;
    let i = 0;
    // for each occurance of a DLE
    for (i = 0; i < results.length; i += 1) {
      // copy original buffer up to the point of this DLE
      message.copy(processedBuffer, copyFromIndex + i, copyFromIndex, results[i] + 1);

      // then add the extra DLE
      processedBuffer[results[i] + 1 + i] = DLE;

      // update the index used for the start of the buffer
      copyFromIndex = results[i] + 1;
    }
    // fill in remaining buffer after last DLE occurance
    message.copy(processedBuffer, copyFromIndex + i, copyFromIndex);

    return (processedBuffer);
  }
  // if no occurance, just return the original buffer back
  return (message);
}

transport.prototype.openTransport = function openTransport(callback) {
  // create a serial port with the correct configuration
  this.serialPort = new SerialPort(deviceName, {
    baudRate,
    parity: 'even',
    autoOpen: false,
  });

  // attempt to open the serial port
  this.serialPort.open((err) => {
    if (err) {
      return callback(err);
    }

    // set state to idle and reset other context items
    transportState = IDLE;
    reactionRxBufferCurrentLength = 0;
    telegramRxBufferCurrentLength = 0;
    applicationRxBuffer = null;
    applicationRxBufferCurrentLength = 0;
    expectedApplicationWordSize = 0;
    responseComplete = false;
    this.isOpen = true;

    // read data that is available but keep the stream from entering "flowing mode"
    this.serialPort.on('readable', () => {
      const data = this.serialPort.read();
      processTransportData(this.serialPort, data);
    });

    // subscribe to on 'close' events
    this.serialPort.on('close', () => {
      this.isOpen = false;
      // TODO may need to do something here, if we are unexpectedly closed
    });

    // subscribe to on 'error' events
    this.serialPort.on('error', () => {
      // error - event is triggered when trying to write data on closed port
    });

    // trigger callback on succesful connection
    return callback(null);
  });
  return undefined;
};

transport.prototype.sendMessageForResponse = function sendMessageForResponse(message, callback) {
  // check flag to make sure we are no already processing a message (this flag will need resetting upon timeout/error)
  if (transportState !== IDLE) {
    return callback(new Error('Busy, cannot send new response'));
  }

  // check we have been given a buffer object
  if (Buffer.isBuffer(message) === false) {
    return callback(new Error('Message to send is not a Buffer object'));
  }

  // check message is not too large to send (TODO should handle case of if more than 64 words e.g. use of follow-on telegram)
  if (message.length > MAX_APP_PAYLOAD_BYTES) {
    return callback(new Error('Message too large to send. Do not support follow-on telegrams for Tx messages'));
  }

  // store callback so we can call back when we have the response
  receivedMessageCallback = callback;

  // check for 0x10 in payload which are used for DLE, so each one needs to be doubled (byte stuffing)
  const processedMessage = byteStuffDLEs(message);

  // create new buffer that will contain the processed application payload with transport header and footer
  // eslint-disable-next-line max-len
  transportSendBuffer = Buffer.allocUnsafe(TRANSPORT_HEADER_SIZE_STANDARD + processedMessage.length + TRANSPORT_FOOTER_SIZE);

  // add header to the start of the buffer
  TELEGRAM_CODE_STANDARD.copy(transportSendBuffer);
  // then add in app message length field (in words)
  transportSendBuffer.writeInt16BE(message.length / 2, APP_MESSAGE_LENGTH_FIELD_OFFSET);
  // and then add the app message after the header
  processedMessage.copy(transportSendBuffer, TRANSPORT_HEADER_SIZE_STANDARD);

  // create the transport footer (minus bcc)
  transportSendBuffer[transportSendBuffer.length - 3] = DLE;
  transportSendBuffer[transportSendBuffer.length - 2] = ETX;
  // calculate bcc and add it to the end of message
  // eslint-disable-next-line max-len
  transportSendBuffer[transportSendBuffer.length - 1] = calculateBcc(transportSendBuffer, transportSendBuffer.length - 1);

  // move state from idle, to expecting intial DLE response
  transportState = AWAIT_INITIAL_DLE;

  // also reset message context elements
  responseComplete = false;
  reactionRxBufferCurrentLength = 0;
  telegramRxBufferCurrentLength = 0;
  applicationRxBuffer = null;
  applicationRxBufferCurrentLength = 0;
  expectedApplicationWordSize = 0;

  // send initial STX
  this.serialPort.write(new Buffer.from([STX]));

  // start transport timeout
  transportDleTimeout = setTimeout(onTransportDleTimeout, DLE_RESPONSE_TIMEOUT_MS);
  return undefined;
};

transport.prototype.closeTransport = function closeTransport(callback) {
  // if we are currently in a request/response cycle
  if ((transportState !== IDLE)) {
    let waitCounter = 0;
    const activeWait = setInterval(() => {
      if ((transportState === IDLE) || (waitCounter > 20)) {
        clearInterval(activeWait);
        transportState = IDLE;
        this.isOpen = false;
        serialCloseHelper(this.serialPort, callback);
      }
      waitCounter += 1;
    }, 100); // interval set at 100 milliseconds
  } else {
    this.isOpen = false;
    // otherwise close immeditalely
    serialCloseHelper(this.serialPort, callback);
  }
};

module.exports = transport;
