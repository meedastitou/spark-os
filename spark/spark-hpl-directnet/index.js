/* jshint esversion: 6 */
/* eslint no-bitwise: ["error", { "allow": ["&", "^="] }] */
const _ = require('lodash');
const async = require('async');
let SerialPort = require('serialport');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line global-require
  SerialPort = require('virtual-serialport');
}

// constructor
const hplDirectNET = function hplDirectNET(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'device-open-error': {
      msg: `${machine.info.name}: Device Open Error`,
      description: x => `Error opening chosen serial device. Error: ${x.errorMsg}`,
    },
    'read-timeout-error': {
      msg: `${machine.info.name}: Variable Read Timeout Error`,
      description: 'A timeout occurred while attempting to read a variable. Check the serial connection to the controller.',
    },
    'write-timeout-error': {
      msg: `${machine.info.name}: Variable Write Timeout Error`,
      description: 'A timeout occurred while attempting to write a value to a variable. Check the serial connection to the controller.',
    },
    'enq-ack-not-received-error': {
      msg: `${machine.info.name}: Enquiry ACK Not Received Error`,
      description: 'An acknowledgement to an equiry was not received from the controller. Verify that the slave station address is correct.',
    },
    'stx-not-received-error': {
      msg: `${machine.info.name}: STX Not Received Error`,
      description: 'A start of text was not received from the controller. Check the serial connection to the controller.',
    },
    'eot-not-received-error': {
      msg: `${machine.info.name}: EOT Not Received Error`,
      description: 'An end of transmission was not received from the controller. Check the serial connection to the controller.',
    },
    'checksum-error': {
      msg: `${machine.info.name}: Checksum Error`,
      description: 'A checksum error occurred while attempting to read a variable. Check the serial connection to the controller.',
    },
    'db-add-error': {
      msg: `${machine.info.name}: Database Add Error`,
      description: x => `Error adding to the database. Error: ${x.errorMsg}`,
    },
  });

  // Private variables
  const that = this;

  const ACK = 0x06;
  const ENQ_START = 0x4E;
  const ENQ = 0x05;
  const EOT = 0x04;
  const ETB = 0x17;
  const SOH = 0x01;
  const STX = 0x02;
  const ETX = 0x03;
  const READ_CODE = 0x30;
  const WRITE_CODE = 0x38;
  const MEMORY_DATA_TYPE = 0x31;
  const INPUT_DATA_TYPE = 0x32;
  const OUTPUT_DATA_TYPE = 0x33;

  const FULL_BLOCK_LENGTH = 256;

  const MAX_READ_DATA_LEN = 4096;
  const MAX_WRITE_DATA_LEN = 4;

  const IDLE = 0;
  const WAIT_READ_ENQ_ACK = 1;
  const WAIT_READ_DATA_BLOCK = 2;
  const WAIT_READ_EOT = 3;
  const WAIT_WRITE_ENQ_ACK = 4;
  const WAIT_WRITE_DATA_BLOCK_ACK = 5;
  const WAIT_WRITE_EOT = 6;

  const ENQ_ACK_TIMEOUT = 800;
  const RECV_BLOCK_TIMEOUT = 2000;
  const RECV_EOT_TIMEOUT = 800;
  const XMIT_BLOCK_TIMEOUT = 2000;

  const EOTpacket = Buffer.from([EOT]);
  const ACKpacket = Buffer.from([ACK]);

  const BIT_MASK_FOR_POS = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];

  let readRequestTimer = null;
  let variableReadArray = [];
  let variablesWriteObj = {};
  let isASCIIMode = false;
  let isReadRequest = true;
  let readRequestIndex = 0;
  let responseTimer = null;
  let expectedResponseLength = 0;
  let requiredNumBlocks = 0;
  let lastBlockNumDataBytes = 0;
  let numBlocksReceived = 0;
  let numBlocksTransmitted = 0;
  let numDataBytesTransmitted = 0;
  let receiveState = IDLE;
  let receivedByteCount = 0;
  let receivedDataByteCount = 0;
  let resultsArray = [];
  let readRequestPending = false;
  let writeRequestPending = false;
  let writeRequestPendingVariable = null;
  let requestVariableName = '';
  let disconnectedTimer = null;
  let connectionReported = false;

  const enquiryBuffer = Buffer.allocUnsafe(3);
  let headerBuffer = null;
  const receiveBuffer = Buffer.allocUnsafe(FULL_BLOCK_LENGTH + 16);
  const transmitBuffer = Buffer.allocUnsafe(FULL_BLOCK_LENGTH + 16);
  const dataReadBuffer = Buffer.allocUnsafe(MAX_READ_DATA_LEN);
  const dataWriteBuffer = Buffer.allocUnsafe(MAX_WRITE_DATA_LEN);

  // public variables
  that.serialPort = null;
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

  function bufferHexASCIIHeaderByte(bufferOffset, byte) {
    headerBuffer[bufferOffset] = 0x30 + Math.floor(byte / 16);
    headerBuffer[bufferOffset + 1] = 0x30 + (byte % 16);
  }

  function bufferHexASCIITransmitByte(bufferOffset, byte) {
    transmitBuffer[bufferOffset] = 0x30 + Math.floor(byte / 16);
    transmitBuffer[bufferOffset + 1] = 0x30 + (byte % 16);
  }

  function getHexByteFromBuffer(buffer, bufferOffset) {
    // if ASCII data, convert it, otherwise just return the stored hex value
    if (isASCIIMode) {
      return (16 * (buffer[bufferOffset] - 0x30)) + (buffer[bufferOffset + 1] - 0x30);
    }
    return buffer[bufferOffset];
  }

  function computeChecksum(buffer, iStart, iEnd) {
    let xorByte = buffer[iStart];
    for (let iBuf = iStart + 1; iBuf < iEnd; iBuf += 1) {
      xorByte ^= buffer[iBuf];
    }
    return xorByte;
  }

  function bufferReceivedData(iStart, iEnd) {
    // make sure not to exceed data buffer length
    let nNewBytes = isASCIIMode ? Math.floor((iEnd - iStart) / 2) : iEnd - iStart;
    if (nNewBytes > (MAX_READ_DATA_LEN - receivedDataByteCount)) {
      nNewBytes = MAX_READ_DATA_LEN - receivedDataByteCount;
      if (nNewBytes <= 0) return;
    }

    // if ASCII data, convert it and buffer it, otherwise just copy it
    if (isASCIIMode) {
      const iEndClipped = iStart + (2 * nNewBytes);
      let iDataBuf = receivedDataByteCount;
      for (let iRecvBuf = iStart; iRecvBuf < iEndClipped; iRecvBuf += 2) {
        dataReadBuffer[iDataBuf] = getHexByteFromBuffer(receiveBuffer, iRecvBuf);
        iDataBuf += 1;
      }
    } else {
      const iEndClipped = iStart + nNewBytes;
      receiveBuffer.copy(dataReadBuffer, receivedDataByteCount, iStart, iEndClipped);
    }

    receivedDataByteCount += nNewBytes;
  }

  function bufferTransmitData(iStart, iEnd, isLastBlock) {
    // store the STX
    transmitBuffer[0] = STX;

    // if ASCII data, convert it ad buffer it, otherwise just copy it
    if (isASCIIMode) {
      let iOutBuf = 1;
      for (let iInBuf = iStart; iInBuf < iEnd; iInBuf += 1) {
        bufferHexASCIITransmitByte(iOutBuf, dataWriteBuffer[iInBuf]);
        iOutBuf += 2;
      }

      // store the ETB/ETX
      transmitBuffer[iOutBuf] = isLastBlock ? ETX : ETB;

      // compute and store the checksum
      bufferHexASCIITransmitByte(iOutBuf + 1, computeChecksum(transmitBuffer, 1, iOutBuf));
    } else {
      dataWriteBuffer.copy(transmitBuffer, 1, iStart, iEnd);

      // store the ETB/ETX
      transmitBuffer[iEnd + 1] = isLastBlock ? ETX : ETB;

      // compute and store the checksum
      transmitBuffer[iEnd + 2] = computeChecksum(transmitBuffer, 1, iEnd + 1);
    }
  }

  function disconnectionDetected() {
    // ingore disconectiong if already know disconnected
    if (disconnectedTimer) return;

    // start a timer to set any machine connected variables to false
    disconnectedTimer = setTimeout(() => {
      disconnectedTimer = null;
      connectionReported = false;
      async.forEachSeries(that.machine.variables, (variable, callback) => {
        // set only machine connected variables to false
        if (_.has(variable, 'machineConnected') && variable.machineConnected) {
          that.dataCb(that.machine, variable, false, (err, res) => {
            if (err) log.error(err);
            if (res) log.debug(res);
          });
        }

        callback();
      });
    }, _.has(that.machine.settings.model, 'disconnectReportTime') ? 1000 * that.machine.settings.model.disconnectReportTime : 0);
  }

  function connectionDetected() {
    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = false;
    }

    // if connection alreay reported, don't report it again
    if (connectionReported) return;
    connectionReported = true;

    async.forEachSeries(that.machine.variables, (variable, callback) => {
      // set only machine connected variables to true
      if (_.has(variable, 'machineConnected') && variable.machineConnected) {
        that.dataCb(that.machine, variable, true, (err, res) => {
          if (err) log.error(err);
          if (res) log.debug(res);
        });
      }

      callback();
    });
  }

  // helper function to save array of collected results to the database
  function saveResultsToDb() {
    // process the array of results
    async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
      // if there wasn't a result
      if (dataItem === null) {
        // just move onto next item, alert/error has already been flagged for this
        return callback();
      }
      // otherwise update the database
      return that.dataCb(that.machine, that.machine.variables[index], dataItem, (err, res) => {
        if (err) {
          alert.raise({ key: 'db-add-error', errorMsg: err.message });
        } else {
          alert.clear('db-add-error');
        }
        if (res) log.debug(res);
        // move onto next item once stored in db
        return callback();
      });
    });

    // if pending write request, issue it
    if (writeRequestPending) {
      writeRequestPending = false;
      // eslint-disable-next-line no-use-before-define
      sendReadWriteRequest(writeRequestPendingVariable, false);
    }
  }

  function stopResponseTimer() {
    if (responseTimer) {
      clearTimeout(responseTimer);
      responseTimer = null;
    }
  }

  function abortReadRequest() {
    // stop timer if running
    stopResponseTimer();

    // save a null result values
    resultsArray.push(null);

    // send the EOT packet
    that.serialPort.write(EOTpacket, () => {
      // if more read requests, do the next one
      readRequestIndex += 1;
      if (readRequestIndex < variableReadArray.length) {
        // eslint-disable-next-line no-use-before-define
        sendReadWriteRequest(variableReadArray[readRequestIndex], true);
      } else { // if no more read requests, save the results
        receiveState = IDLE;
        saveResultsToDb();
      }
    });
  }

  function abortWriteRequest() {
    // stop timer if running
    stopResponseTimer();

    // send the EOT packet
    that.serialPort.write(EOTpacket, () => {
      receiveState = IDLE;
    });
  }

  function skipReadRequest() {
    // save a null result values
    resultsArray.push(null);

    // if more read requests, do the next one
    readRequestIndex += 1;
    if (readRequestIndex < variableReadArray.length) {
      // eslint-disable-next-line no-use-before-define
      sendReadWriteRequest(variableReadArray[readRequestIndex], true);
    } else { // if no more read requests, save the results
      receiveState = IDLE;
      saveResultsToDb();
    }
  }

  function sendRequest(requestBuf, newRecieveState, newExpectedResponseLength, timeout) {
    // set the receieve state and the expected response length of this request
    receiveState = newRecieveState;
    receivedByteCount = 0;
    expectedResponseLength = newExpectedResponseLength;

    // write the request
    that.serialPort.write(requestBuf, () => {
      // wait for a the response
      responseTimer = setTimeout(() => {
        responseTimer = null;
        // this was a read request, abort it
        if (isReadRequest) {
          abortReadRequest();
          disconnectionDetected();
          updateConnectionStatus(false);
          alert.raise({ key: 'read-timeout-error' });
        } else { // if this a write request abort it
          abortWriteRequest();
          disconnectionDetected();
          updateConnectionStatus(false);
          alert.raise({ key: 'write-timeout-error' });
        }
      }, timeout);
    });
  }


  function sendReadWriteRequest(variable, isRead) {
    // save variable name for possible alert message
    requestVariableName = variable.name;

    // get the V-memory address (removing any ".n" bit specifier) and convert from octal to decimal
    let address = parseInt(variable.address.split('.')[0], 8);

    // get LSB/MSB selection, if any
    let useMSB = false;
    if (_.has(variable, 'bytePos') && (variable.bytePos === 'MSB')) {
      useMSB = true;
    }

    // build the read header
    headerBuffer[3] = isRead ? READ_CODE : WRITE_CODE;
    let numBytesPerLoc = 1;
    switch (variable.type) {
      case 'Input':
        headerBuffer[4] = INPUT_DATA_TYPE;

        // if V-memory address 40000 to 40077 octal DirectNET address is 1 to 80 hex,
        // alternating between LSB and MSB
        if ((address >= 0o40000) && (address <= 0o40077)) {
          address = (2 * (address - 0o40000)) + 1;
          if (useMSB) address += 1;
        } else if ((address >= 0o40400) && (address <= 0o40423)) {
          // if V-memory address 40400 to 40423 octal DirectNET address is 101 to 128 hex,
          // alternating between LSB and MSB
          address = (2 * (address - 0o40400)) + 0x101;
          if (useMSB) address += 1;
        } else if ((address >= 0o41200) && (address <= 0o41234)) {
          // if V-memory address 41200 to 41234 octal DirectNET address is 181 to 128 hex,
          // alternating between LSB and MSB
          address = (2 * (address - 0o41200)) + 0x181;
          if (useMSB) address += 1;
        } else { // if invalid V-memory address, skip this read
          if (isRead) skipReadRequest();
          alert.raise({
            key: `invalid-input-address-error-${requestVariableName}`,
            msg: `${machine.info.name}: Invalid Input Address`,
            description: `The V-Memory address for the input variable ${requestVariableName} is invalid. Correct the address of the variable.`,
          });
          return;
        }

        alert.clear(`invalid-input-address-error-${requestVariableName}`);

        break;
      case 'Output':
        headerBuffer[4] = OUTPUT_DATA_TYPE;
        // if V-memory address 40500 to 41177 octal DirectNET address is 101 to 320 hex,
        // alternating between LSB and MSB
        if ((address >= 0o40500) && (address <= 0o41117)) {
          address = (2 * (address - 0o40500)) + 0x101;
          if (useMSB) address += 1;
        } else if ((address >= 0o41140) && (address <= 0o41147)) {
          // if V-memory address 41140 to 41147 octal DirectNET address is 321 to 330 hex,
          // alternating between LSB and MSB
          address = (2 * (address - 0o41140)) + 0x321;
          if (useMSB) address += 1;
        } else { // if invalid V-memory address, skip this read
          if (isRead) skipReadRequest();
          alert.raise({
            key: `invalid-output-address-error-${requestVariableName}`,
            msg: `${machine.info.name}: Invalid Output Address`,
            description: `The V-Memory address for the output variable ${requestVariableName} is invalid. Correct the address of the variable.`,
          });
          return;
        }

        alert.clear(`invalid-output-address-error-${requestVariableName}`);

        break;
      default:
        headerBuffer[4] = MEMORY_DATA_TYPE;
        numBytesPerLoc = 2;
        // add 1 to get the DirectNET reference address
        address += 1;
        break;
    }

    // store the DirectNET reference address as 2 hex bytes
    bufferHexASCIIHeaderByte(5, Math.floor(address / 256));
    bufferHexASCIIHeaderByte(7, address % 256);

    // get the number of bytes required, and store it as the number of complete,
    // 256 byte blocks and the number of bytes in the last block
    let numBytes = isASCIIMode ? 2 * numBytesPerLoc : numBytesPerLoc;
    if (_.has(variable, 'array') && variable.array && _.has(variable, 'length')) {
      numBytes *= variable.length;
    }
    requiredNumBlocks = Math.floor(numBytes / 256);
    bufferHexASCIIHeaderByte(9, requiredNumBlocks);
    lastBlockNumDataBytes = numBytes % 256;
    bufferHexASCIIHeaderByte(11, lastBlockNumDataBytes);

    // save the total number of blocks and the expected length of the last block
    if (lastBlockNumDataBytes === 0) {
      lastBlockNumDataBytes = FULL_BLOCK_LENGTH;
    } else {
      requiredNumBlocks += 1;
    }

    // add the checksum (LRC), one byte for HEX and 2 bytes for ASCII
    const checksum = computeChecksum(headerBuffer, 1, 15);
    if (isASCIIMode) {
      bufferHexASCIIHeaderByte(16, checksum);
    } else {
      headerBuffer[16] = checksum;
    }

    numBlocksReceived = 0;
    numBlocksTransmitted = 0;
    receivedDataByteCount = 0;
    numDataBytesTransmitted = 0;
    isReadRequest = isRead;

    // send the enquiry and wait for the ACK
    sendRequest(enquiryBuffer, isRead ? WAIT_READ_ENQ_ACK : WAIT_WRITE_ENQ_ACK, 3, ENQ_ACK_TIMEOUT);
  }

  function readRequestTimerFunc() {
    // only start a new request if there is no read or write request currently being performed
    if (receiveState === IDLE) {
      // reset variable value storage and index for starting a new request set
      readRequestIndex = 0;
      resultsArray = [];

      // start a new set of read requests
      sendReadWriteRequest(variableReadArray[readRequestIndex], true);
    } else if (!isReadRequest) {
      // if currently processing a write request, remember that a read request is pending
      readRequestPending = true;
    }
  }

  function saveVariableReadValue(variable) {
    let variableValue = null;

    // determine whether this is an array, and if so, its length
    let isArray = false;
    let arrayLength = 1;
    if (_.has(variable, 'array') && variable.array && _.has(variable, 'length')) {
      isArray = true;
      arrayLength = variable.length;
      variableValue = [];
    }

    // determine whether 1 byte (input, output), or 2 byte data value
    let numBytesPerLoc = 1;
    if (variable.type === 'Memory') {
      numBytesPerLoc = 2;
    }

    // get LSB/MSB selection, if any
    const useMSB = variable.bytePos === 'MSB';

    // get the bit postion, if any, from the ".n" bit suffix as the second elememt of split address
    let bitPos = -1;
    const address = variable.address.split('.');
    if (address.length === 2) {
      bitPos = parseInt(address[1], 8);
      if (bitPos > 7) bitPos = 0;
    }

    // add each value (more than one only if an array)
    let iData = 0;
    for (let iVal = 0; iVal < arrayLength; iVal += 1) {
      // if this variable has a bit position suffix
      if (bitPos >= 0) {
        // determine whether the bit is set
        let bitValue = false;
        if ((numBytesPerLoc === 2) && useMSB) {
          bitValue = (dataReadBuffer[iData + 1] & BIT_MASK_FOR_POS[bitPos]) !== 0;
        } else {
          bitValue = (dataReadBuffer[iData] & BIT_MASK_FOR_POS[bitPos]) !== 0;
        }

        // if any numeric format, convert to 0 or 1, char format, convert to '0' or '1'
        if (variable.format !== 'bool') {
          if (variable.format === 'char') {
            bitValue = bitValue ? '1' : '0';
          } else {
            bitValue = bitValue ? 1 : 0;
          }
        }

        // save the bit value as single value or array element
        if (isArray) {
          variableValue.push(bitValue);
        } else {
          variableValue = bitValue;
        }
      } else { // if this variable does not have a bit postion suffix
        let value = null;
        switch (variable.format) {
          // if char format, get 8-bit latin1 character or 16-bit unicode character
          case 'char':
            if (numBytesPerLoc === 2) {
              value = dataReadBuffer.toString('utf8', iData, iData + 2);
            } else {
              value = dataReadBuffer.toString('latin1', iData, iData + 1);
            }
            break;
          // if boolean format, convert to true or false
          case 'bool':
            if (numBytesPerLoc === 2) {
              value = dataReadBuffer.readUInt16LE(iData, true) !== 0;
            } else {
              value = dataReadBuffer.readUInt8(iData, true) !== 0;
            }
            break;
          // if 1 byte format, ignore MSB if 2 byte data
          case 'uint8':
            value = dataReadBuffer.readUInt8(iData, true);
            break;
          case 'int8':
            value = dataReadBuffer.readInt8(iData, true);
            break;
          // if unsigned format of 2 or more bytes, read 1 or 2 bytes
          // depending on the number of bytes in the data
          case 'uint16':
          case 'uint32':
          case 'uint64':
            if (numBytesPerLoc === 2) {
              value = dataReadBuffer.readUInt16LE(iData, true);
            } else {
              value = dataReadBuffer.readUInt8(iData, true);
            }
            break;
          // if signed format of 2 or more bytes, read 1 or 2 bytes
          // depending on the number of bytes in the data
          default:
            if (numBytesPerLoc === 2) {
              value = dataReadBuffer.readInt16LE(iData, true);
            } else {
              value = dataReadBuffer.readInt8(iData, true);
            }
            break;
        }

        // save the value as single value or array element
        if (isArray) {
          variableValue.push(value);
        } else {
          variableValue = value;
        }
      }

      iData += numBytesPerLoc;
    }

    // save the variable value or array of values
    resultsArray.push(variableValue);
  }

  function raiseAckAlert(reading) {
    const op = reading ? 'reading' : 'writing to';
    alert.raise({
      key: `ack-not-received-error-${requestVariableName}`,
      msg: `${machine.info.name}: ACK Not Received Error`,
      description: `An acknowledgement was not received from the controller while ${op} the variable ${requestVariableName}. Verify that the varible is defined correctly.`,
    });
  }

  function processResponseData(data) {
    // make sure buffer not full
    if ((receivedByteCount + data.length) > receiveBuffer.length) {
      return;
    }

    data.copy(receiveBuffer, receivedByteCount);
    receivedByteCount += data.length;


    // process the data based on the receiving state
    switch (receiveState) {
      // waiting for the ACK to a read enquiry: if received, send the header
      // (expecting both ACK and data block)
      case WAIT_READ_ENQ_ACK:
        if (receivedByteCount >= 3) {
          stopResponseTimer();
          connectionDetected();
          updateConnectionStatus(true);
          alert.clear('read-timeout-error');

          if (receiveBuffer[2] === ACK) {
            alert.clear('enq-ack-not-received-error');
            let expectedNumBytes = lastBlockNumDataBytes + 4;
            if (requiredNumBlocks > 1) {
              expectedNumBytes = FULL_BLOCK_LENGTH + 4;
            }
            if (isASCIIMode) expectedNumBytes += 1;
            sendRequest(headerBuffer, WAIT_READ_DATA_BLOCK, expectedNumBytes, RECV_BLOCK_TIMEOUT);
          } else {
            abortReadRequest();
            alert.raise({ key: 'enq-ack-not-received-error' });
          }
        }

        break;
      // waiting for data block
      case WAIT_READ_DATA_BLOCK:
        if (receivedByteCount >= expectedResponseLength) {
          stopResponseTimer();
          connectionDetected();
          updateConnectionStatus(true);
          alert.clear('read-timeout-error');

          // if this is the first block, also expect the ACK
          numBlocksReceived += 1;
          if ((numBlocksReceived > 1) || (receiveBuffer[0] === ACK)) {
            alert.clear(`ack-not-received-error-${requestVariableName}`);
            const iSTX = numBlocksReceived === 1 ? 1 : 0;
            if (receiveBuffer[iSTX] === STX) {
              alert.clear('stx-not-received-error');
              // verify the checksum, and buffer the data if correct
              const endOfData = isASCIIMode
                ? expectedResponseLength - 3 : expectedResponseLength - 2;
              if (computeChecksum(receiveBuffer, iSTX + 1, endOfData)
               === getHexByteFromBuffer(receiveBuffer, endOfData + 1)) {
                alert.clear('checksum-error');
                bufferReceivedData(iSTX + 1, endOfData);

                if (numBlocksReceived >= requiredNumBlocks) {
                  sendRequest(ACKpacket, WAIT_READ_EOT, 1, RECV_EOT_TIMEOUT);
                } else {
                  let expectedNumBytes = lastBlockNumDataBytes + 3;
                  if ((numBlocksReceived + 1) < requiredNumBlocks) {
                    expectedNumBytes = FULL_BLOCK_LENGTH + 3;
                  }
                  if (isASCIIMode) expectedNumBytes += 1;
                  sendRequest(ACKpacket, WAIT_READ_DATA_BLOCK,
                    expectedNumBytes, RECV_BLOCK_TIMEOUT);
                }
              } else {
                abortReadRequest();
                alert.raise({ key: 'checksum-error' });
              }
            } else {
              abortReadRequest();
              alert.raise({ key: 'stx-not-received-error' });
            }
          } else {
            abortReadRequest();
            raiseAckAlert(true);
          }
        } else if ((receivedByteCount > 0) && (receiveBuffer[0] !== ACK)) {
          abortReadRequest();
          raiseAckAlert(true);
        }

        break;
      // waiting for EOT
      case WAIT_READ_EOT:
        if (receivedByteCount >= 1) {
          stopResponseTimer();
          connectionDetected();
          updateConnectionStatus(true);
          alert.clear('read-timeout-error');

          if (receiveBuffer[0] === EOT) {
            alert.clear('eot-not-received-error');
            // send the EOT packet
            that.serialPort.write(EOTpacket, () => {
              // save value(s) received in the data
              saveVariableReadValue(variableReadArray[readRequestIndex]);

              // if more read requests, do the next one
              readRequestIndex += 1;
              if (readRequestIndex < variableReadArray.length) {
                sendReadWriteRequest(variableReadArray[readRequestIndex], true);
              } else { // if no more read requests, save the results
                receiveState = IDLE;
                saveResultsToDb();
              }
            });
          } else {
            abortReadRequest();
            alert.raise({ key: 'eot-not-received-error' });
          }
        }
        break;
        // waiting for the ACK to a write enquiry: if received,
        // send the header (expecting both ACK and data block)
      case WAIT_WRITE_ENQ_ACK:
        if (receivedByteCount >= 3) {
          stopResponseTimer();
          connectionDetected();
          updateConnectionStatus(true);
          alert.clear('write-timeout-error');

          if (receiveBuffer[2] === ACK) {
            alert.clear('enq-ack-not-received-error');
            sendRequest(headerBuffer, WAIT_WRITE_DATA_BLOCK_ACK, 1, XMIT_BLOCK_TIMEOUT);
          } else {
            abortWriteRequest();
            alert.raise({ key: 'enq-ack-not-received-error' });
          }
        }
        break;
        // waiting to write a block of data
      case WAIT_WRITE_DATA_BLOCK_ACK:
        if (receivedByteCount >= 1) {
          stopResponseTimer();
          connectionDetected();
          updateConnectionStatus(true);
          alert.clear('write-timeout-error');

          if (receiveBuffer[0] === ACK) {
            alert.clear(`ack-not-received-error-${requestVariableName}`);
            numBlocksTransmitted += 1;

            // if this is the last block, buffer only the remaining data
            if (numBlocksTransmitted >= requiredNumBlocks) {
              if (isASCIIMode) {
                bufferTransmitData(numDataBytesTransmitted,
                  numDataBytesTransmitted + Math.floor(lastBlockNumDataBytes / 2), true);
                sendRequest(transmitBuffer.slice(0, lastBlockNumDataBytes + 4),
                  WAIT_WRITE_EOT, 1, XMIT_BLOCK_TIMEOUT);
              } else {
                bufferTransmitData(numDataBytesTransmitted,
                  numDataBytesTransmitted + lastBlockNumDataBytes, true);
                sendRequest(transmitBuffer.slice(0, lastBlockNumDataBytes + 3),
                  WAIT_WRITE_EOT, 1, XMIT_BLOCK_TIMEOUT);
              }
            } else if (isASCIIMode) {
              // if this is not the last block, it is a full block, so transmit a full block
              bufferTransmitData(numDataBytesTransmitted,
                numDataBytesTransmitted + (FULL_BLOCK_LENGTH / 2), false);
              sendRequest(transmitBuffer.slice(0, FULL_BLOCK_LENGTH + 4),
                WAIT_WRITE_DATA_BLOCK_ACK, 1, XMIT_BLOCK_TIMEOUT);
            } else {
              bufferTransmitData(numDataBytesTransmitted,
                numDataBytesTransmitted + FULL_BLOCK_LENGTH, false);
              sendRequest(transmitBuffer.slice(0, FULL_BLOCK_LENGTH + 3),
                WAIT_WRITE_DATA_BLOCK_ACK, 1, XMIT_BLOCK_TIMEOUT);
            }
          } else {
            abortWriteRequest();
            raiseAckAlert(false);
          }
        }
        break;
      // waiting to write the EOT
      case WAIT_WRITE_EOT:
        if (receivedByteCount >= 1) {
          stopResponseTimer();
          connectionDetected();
          updateConnectionStatus(true);
          alert.clear('write-timeout-error');

          if (receiveBuffer[0] === ACK) {
            alert.clear(`ack-not-received-error-${requestVariableName}`);
            // send the EOT packet
            that.serialPort.write(EOTpacket, () => {
              receiveState = IDLE;

              // if read request is pending, do it
              if (readRequestPending) {
                readRequestPending = false;
                readRequestTimerFunc();
              }
            });
          } else {
            abortWriteRequest();
            raiseAckAlert(false);
          }
        }
        break;
      default:
        break;
    }
  }

  function open(callback) {
    const requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    const { device } = that.machine.settings.model;
    const baudRate = parseInt(that.machine.settings.model.baudRate, 10);
    const { parity } = that.machine.settings.model;
    isASCIIMode = that.machine.settings.model.mode === 'ASCII';
    connectionReported = false;

    // from the variable array, form a new array of 'read' specific variables
    // i.e. filter out 'write' only variables and alarm code variables
    variableReadArray = [];
    that.machine.variables.forEach((variable) => {
      if (!_.has(variable, 'machineConnected') || !variable.machineConnected) {
        // if read or write not set, assume read
        if (!(variable.access === 'write' || variable.access === 'read')) {
          const variableWithAccess = variable;
          variableWithAccess.access = 'read';
          variableReadArray.push(variableWithAccess);
        } else if (variable.access === 'read') {
          variableReadArray.push(variable);
        }
      }
    });

    // convert the variables array to an object for easy searching when writing variables and
    // filter it down to just 'write' variables - also exclude variable with ".n" bit specifier
    // . arrays and machine connected variables
    variablesWriteObj = _.keyBy(_.filter(that.machine.variables, variable => ((variable.access === 'write')
       && (variable.address.indexOf('.') === -1)
       && (!_.has(variable, 'array') || !variable.array)
       && (!_.has(variable, 'machineConnected') || !variable.machineConnected))), 'name');

    // initialize the enquiry buffer based on the offset slave address
    enquiryBuffer[0] = ENQ_START;
    enquiryBuffer[1] = 0x20 + that.machine.settings.model.slaveAddress;
    enquiryBuffer[2] = ENQ;

    // initialize the constant portion of the header buffer based on the slave address
    headerBuffer = Buffer.allocUnsafe(isASCIIMode ? 18 : 17);
    headerBuffer[0] = SOH;
    bufferHexASCIIHeaderByte(1, that.machine.settings.model.slaveAddress);
    bufferHexASCIIHeaderByte(13, 1); // Master ID = 1
    headerBuffer[15] = ETB;

    // create a serial port with the correct configuration
    that.serialPort = new SerialPort(device, {
      baudRate,
      parity,
      autoOpen: false,
    });

    // attempt to open the serial port
    return that.serialPort.open((err) => {
      if (err) {
        alert.raise({ key: 'device-open-error', errorMsg: err });
        return callback(err);
      }

      alert.clear('device-open-error');

      // read data that is available but keep the stream from entering "flowing mode"
      that.serialPort.on('readable', () => {
        const data = that.serialPort.read();
        processResponseData(data);
      });

      // subscribe to on 'close' events
      that.serialPort.on('close', () => {
        log.debug('Serial port closed');

        // stop the request timer task if applicable (i.e. if not closed by our request)
        if (readRequestTimer) {
          clearInterval(readRequestTimer);
          readRequestTimer = null;
          receiveState = IDLE;
        }
      });

      // set up a repeat task to trigger the requests
      readRequestTimer = setInterval(readRequestTimerFunc, requestFrequencyMs);

      // trigger callback on succesful open
      return callback(null);
    });
  }

  function close(callback) {
    // if we are currently in a request/response cycle
    if ((receiveState !== IDLE)) {
      // hold off on closing using an interval timer
      let waitCounter = 0;
      const activeWait = setInterval(() => {
        // until safe to do so
        if ((receiveState === IDLE) || (waitCounter > 20)) {
          receiveState = IDLE;
          clearInterval(activeWait);
          that.serialPort.close(callback);
        }
        waitCounter += 1;
      }, 100); // interval set at 100 milliseconds
    } else {
      // otherwise close immeditalely
      that.serialPort.close(callback);
    }
  }

  // Privileged methods
  this.writeData = function writeData(value, done) {
    // get the variable name and make sure it exists and is writable
    const variableName = value.variable;
    if (!Object.prototype.hasOwnProperty.call(variablesWriteObj, variableName)) {
      // create 'write' specific variable alert
      alert.raise({
        key: `var-write-error-${variableName}`,
        msg: `${machine.info.name}: Error Writing Variable`,
        description: `Error in writing ${variableName}. Variable does not exist or is not writable`,
      });
      done();
      return;
    }

    // get the variable definition
    const variable = variablesWriteObj[variableName];

    // determine whether 1 byte (input, output), or 2 byte data value
    let numBytesPerLoc = 1;
    if (variable.type === 'Memory') {
      numBytesPerLoc = 2;
    }

    // currently arrays may not be written, so only on value needs to be buffered -
    // this code is intended to make the addition of array writing easier.
    // Please note that MAX_WRITE_DATA_LEN must be increased
    const iDataBuf = 0;

    switch (variable.format) {
      // if char format, write 8-bit latin1 character or 16-bit unicode character
      case 'char':
        if (numBytesPerLoc === 2) {
          dataWriteBuffer.write(value[value.variable], iDataBuf, 2, 'utf8');
        } else {
          dataWriteBuffer.write(value[value.variable], iDataBuf, 1, 'latin1');
        }
        break;
        // if boolean format, write a 1 or a 0
      case 'bool':
        if (numBytesPerLoc === 2) {
          dataWriteBuffer.writeUInt16LE(value[value.variable] ? 1 : 0, iDataBuf, true);
        } else {
          dataWriteBuffer.writeUInt8(value[value.variable] ? 1 : 0, iDataBuf, true);
        }
        break;
        // if 1 byte format, ignore MSB if 2 byte data
      case 'uint8':
        if (numBytesPerLoc === 2) {
          dataWriteBuffer.writeUInt16LE(value[value.variable] & 0xFF, iDataBuf, true);
        } else {
          dataWriteBuffer.writeUInt8(value[value.variable] & 0xFF, iDataBuf, true);
        }
        break;
      case 'int8':
        if (numBytesPerLoc === 2) {
          dataWriteBuffer.writeInt16LE(value[value.variable] & 0xFF, iDataBuf, true);
        } else {
          dataWriteBuffer.writeInt8(value[value.variable] & 0xFF, iDataBuf, true);
        }
        break;
        // if unsigned format of 2 or more bytes, write 1 or 2 bytes
        // depending on the number of bytes in the data
      case 'uint16':
      case 'uint32':
      case 'uint64':
        if (numBytesPerLoc === 2) {
          dataWriteBuffer.writeUInt16LE(value[value.variable] & 0xFFFF, iDataBuf, true);
        } else {
          dataWriteBuffer.writeUInt8(value[value.variable] & 0xFF, iDataBuf, true);
        }
        break;
        // if signed format of 2 or more bytes, write 1 or 2 bytes
        // depending on the number of bytes in the data
      default:
        if (numBytesPerLoc === 2) {
          dataWriteBuffer.writeInt16LE(value[value.variable] & 0xFFFF, iDataBuf, true);
        } else {
          dataWriteBuffer.writeInt8(value[value.variable] & 0xFF, iDataBuf, true);
        }
        break;
    }

    // clear variable write alert
    alert.clear(`var-write-error-${variable.name}`);

    // only start a new write request if there is no read or write request currently being performed
    if (receiveState === IDLE) {
      // start a new set of read requests
      sendReadWriteRequest(variable, false);
    } else if (isReadRequest) {
      // if currently processing a read request, remember that a write request is pending
      writeRequestPending = true;
      writeRequestPendingVariable = variable;
    }

    done();
  };

  this.start = function start(dataCb, configUpdateCb, done) {
    updateConnectionStatus(false);

    if (typeof dataCb !== 'function') {
      return done('dataCb not a function');
    }
    that.dataCb = dataCb;

    if (typeof configUpdateCb !== 'function') {
      return done('configUpdateCb not a function');
    }
    that.configUpdateCb = configUpdateCb;

    // check if the machine is enabled
    if (!that.machine.settings.model.enable) {
      log.debug(`${that.machine.info.name} Disabled`);
      return done(null);
    }

    return open((err) => {
      if (err) {
        return done(err);
      }

      log.info('Started');
      return done(null);
    });
  };

  this.stop = function stop(done) {
    updateConnectionStatus(false);

    // clear existing alerts
    alert.clearAll(() => {
      // stop the request timer task (if being used)
      if (readRequestTimer) {
        clearInterval(readRequestTimer);
        readRequestTimer = null;
      }

      // stop the response time also
      stopResponseTimer();

      // if any pending disconnection detection, stop its timer
      if (disconnectedTimer) {
        clearTimeout(disconnectedTimer);
        disconnectedTimer = null;
      }

      // close serial port if open
      if (that.serialPort) {
        if (that.serialPort.isOpen) {
          return close((err) => {
            if (err) {
              log.error(err);
            }
            that.serialPort = null;
            log.info('Stopped');
            return done(null);
          });
        }
      }
      log.info('Stopped');
      return done(null);
    });
  };

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop(() => {
      that.start(that.dataCb, that.configUpdateCb, err => done(err));
    });
  };

  this.updateModel = function updateModel(newModel, done) {
    log.debug('Updating');
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

module.exports = {
  hpl: hplDirectNET,
  defaults,
  schema,
};
