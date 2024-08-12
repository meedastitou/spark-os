/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
let SerialPort = require('serialport');

let testing = false;
if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line global-require
  SerialPort = require('virtual-serialport');
  testing = true;
}
const { Readline } = SerialPort.parsers;

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplSerial = function hplSerial(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;
  let sendingActive = false;
  let timer = null;
  let timerExpired = false;
  let requestIndex = 0;
  let variableReadArray = [];
  let resultsArray = [];
  let responseBufferString = '';
  let requestBlockedCounter = 0;
  let machineId = '';
  let stationNumber;
  let cpuNumber;
  let usingChecksum = false;
  let usingCrLf = false;
  let usingCR = false;
  let variableRequests = [];
  let responseTerminator = '';
  let numBytesAfterResponseTerminator = 0;
  let mode = null;
  let disconnectedTimer = null;
  let connectionReported = false;
  let disconnectionReported = false;

  const STX = '\u0002';
  const ETX = '\u0003';
  const EOT = '\u0004';
  const ENQ = '\u0005';
  const LF = '\u000A';
  const CR = '\u000D';
  const VLINK_READ_CODE = '20';
  const VLINK_ACK_CODE = '00';
  const SEDUZ_RESPONSE_REGEX = ' (.*?)\\x03';
  const YOKOGAWA_RESPONSE_CODE = 'OK';
  const TEST_EQUIP_START_BYTE = 0xFF;
  const TEST_EQUIP_SKIP_BYTE = 0xEE;
  const TEST_EQUIP_BUF_LEN = 1000;

  const VLINK_NAK_CODES = {
    '02': 'Overrun/Framing error: An overrun or framing error is detected in the received data',
    '03': 'Parity error: A parity error is detected in the received data',
    '04': 'Sum check error: A sum error occurs with the received data',
    '06': 'Count error: The memory read/write count is 0.',
    '0F': 'ETX error: No ETX code is found',
    11: 'Character error: A character not used in the received data is found (other than 0 to F)',
    12: 'Command error: An invalid command is given',
    13: 'Memory setting error: The address or device number is invalid',
  };

  let pubSubMode = 'Test Equipment';
  let nTestEquipBytesReqd = 0;
  const testEquipBuffer = Buffer.allocUnsafe(TEST_EQUIP_BUF_LEN);
  let iTestEquipBuffer = 0;
  let waitingForStartByte = true;

  // Alert Object
  alert.preLoad({
    'connection-error': {
      msg: `${machine.info.name} : Connection Error`,
      description: 'Not able to open connection. Please verify the configuration',
    },
    'request-key-error': {
      msg: `${machine.info.name} : Variable Error`,
      description: 'All variables require a request key in req/res mode',
    },
    'request-key-error-WF818': {
      msg: `${machine.info.name} : Variable Error`,
      description: 'Request key for WF818 must be in the format ##xx, with ## = address, CC = two character mnemonic',
    },
    'request-key-error-Keyence-KV': {
      msg: `${machine.info.name} : Variable Error`,
      description: 'Request key for Keyence KV must be start with RD',
    },
    'character-offset-error': {
      msg: `${machine.info.name} : Variable Error`,
      description: 'All variables require a character offset in testing equipment pub/sub mode',
    },
    'character-length-error': {
      msg: `${machine.info.name} : Variable Error`,
      description: 'All variables require a character length in testing equipment pub/sub mode',
    },
    'published-data-too-long-error': {
      msg: `${machine.info.name} : Published Data Too Long`,
      description: 'The data published in testing equipment pub/sub mode is too long',
    },
    'missing-data-error': {
      msg: `${machine.info.name} : Missing Data`,
      description: 'The data published in testing equipment pub/sub mode is missing data for one or more variables',
    },
    'no-response-error': {
      msg: `${machine.info.name} : No Response`,
      description: 'No response was received in req/res mode',
    },
  });

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

  // for old machines: make sure that they operate as before -
  // as big endian unless Yokogawa, which has low word fist
  if (!_.has(that.machine.settings.model, 'highByteFirst')) {
    that.machine.settings.model.highByteFirst = true;
  }
  if (!_.has(that.machine.settings.model, 'highWordFirst')) {
    if (that.machine.settings.model.protocol === 'YOKOGAWA') {
      that.machine.settings.model.highWordFirst = false;
    } else {
      that.machine.settings.model.highWordFirst = true;
    }
  }

  // debug function for dumping the contents of a a buffer in easy-to-read format, 16 bytes/line
  // function dumpBuffer(buffer) {
  //   let str = '';
  //   for (let i = 0; i < buffer.length; i += 1) {
  //     if (buffer[i] < 16) {
  //       str += `0${buffer[i].toString(16)} `;
  //     } else {
  //       str += `${buffer[i].toString(16)} `;
  //     }
  //     if ((((i + 1) % 16) === 0) || ((i + 1) === buffer.length)) {
  //       console.log(str);
  //       str = '';
  //     }
  //   }
  // }

  // private methods
  // helper function to convert a string formatted result into its correct 'format'
  function convertStringResult(format, resultString) {
    let result = null;
    if (resultString !== null) {
      switch (format) {
        case 'char':
          result = resultString;
          break;

        case 'int8':
        case 'int16':
        case 'int32':
        case 'int64':
        case 'uint8':
        case 'uint16':
        case 'uint32':
        case 'uint64':
          result = parseInt(resultString, 10);
          break;

        case 'float':
        case 'double':
          result = parseFloat(resultString);
          break;

        case 'bool':

          result = ((resultString === 'true') || (resultString === '1'));
          break;
        default:
      }
    }
    return result;
  }

  // helper function to convert a string formatted result into its correct 'format'
  function convertStringResultYokogawa(format, resultString) {
    let result = null;
    if (resultString !== null) {
      switch (format) {
        case 'char':
          result = resultString;
          break;

        case 'int8':
        case 'uint8':
          result = parseInt(resultString, 16);
          break;

        case 'int16':
        case 'uint16': {
          // if not high byte first, reverse the byte ordering
          let resOrdered = resultString;
          if (!that.machine.settings.model.highByteFirst) {
            resOrdered = resOrdered[2] + resOrdered[3] + resOrdered[0] + resOrdered[1];
          }

          result = parseInt(resOrdered, 16);
          break;
        }
        case 'int32':
        case 'uint32': {
          // Correct the byte and word order, if not high byte first and high word first
          let resOrdered = resultString;
          if (that.machine.settings.model.highByteFirst) {
            if (!that.machine.settings.model.highWordFirst) {
              resOrdered = resOrdered[4] + resOrdered[5] + resOrdered[6] + resOrdered[7]
               + resOrdered[0] + resOrdered[1] + resOrdered[2] + resOrdered[3];
            }
          } else if (that.machine.settings.model.highWordFirst) {
            resOrdered = resOrdered[2] + resOrdered[3] + resOrdered[0] + resOrdered[1]
             + resOrdered[6] + resOrdered[7] + resOrdered[4] + resOrdered[5];
          } else {
            resOrdered = resOrdered[6] + resOrdered[7] + resOrdered[4] + resOrdered[5]
             + resOrdered[2] + resOrdered[3] + resOrdered[0] + resOrdered[1];
          }

          result = parseInt(resOrdered, 16);
          break;
        }
        case 'int64':
        case 'uint64':
          // Todo
          result = parseInt(resultString, 16);
          break;

        case 'float':
        case 'double':
          result = parseFloat(resultString);
          break;

        case 'bool':

          result = ((resultString === 'true') || (resultString === '1'));
          break;
        default:
      }
    }
    return result;
  }

  // helper function to convert a string formatted result into its correct 'format'
  function convertStringResultWF818(format, resultString) {
    let result = null;
    if (resultString !== null) {
      switch (format) {
        case 'char':
          result = resultString;
          break;

        case 'int8':
        case 'uint8':
        case 'int16':
        case 'uint16':
        case 'int32':
        case 'uint32':
        case 'int64':
        case 'uint64':
          result = parseInt(resultString, 10);
          break;

        case 'float':
        case 'double':
          result = parseFloat(resultString);
          break;

        case 'bool':
          result = ((resultString === 'true') || (resultString === '1'));
          break;
        default:
      }
    }
    return result;
  }

  // helper function to convert a string formatted result into its correct 'format'
  function convertStringResultKeyenceKV(format, resultString) {
    let result = null;
    if (resultString !== null) {
      switch (format) {
        case 'char':
          result = resultString;
          break;

        case 'int8':
        case 'uint8':
        case 'int16':
        case 'uint16':
        case 'int32':
        case 'uint32':
        case 'int64':
        case 'uint64':
          result = parseInt(resultString, 10);
          break;

        case 'float':
        case 'double':
          result = parseFloat(resultString);
          break;

        case 'bool':
          if (resultString === '0') {
            result = false;
          } else {
            result = true;
          }
          break;
        default:
      }
    }
    return result;
  }

  // helper function to save array of collected results to the database
  function saveResultsToDb() {
    // process the array of results
    async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
      let variableValue = dataItem;
      // if there wasn't a result
      if (variableValue === null) {
        // if no data, and we have been asked to convert this lack of data to a zero, then do so
        if (_.get(variableReadArray[index], 'convertNullToZero', false)) {
          variableValue = 0;
        } else {
          // highlight that there was an error getting this variables data
          log.error(`Failed to get data for variable ${variableReadArray[index].name}`);
          // and just move onto next item
          return callback();
        }
      }
      // othewise update the database
      that.dataCb(that.machine, variableReadArray[index], variableValue, (err, res) => {
        if (err) {
          log.error(err);
        }
        if (res) log.debug(res);
        // move onto next item once stored in db
        callback();
      });

      return undefined;
    });
  }

  function processPublishedData(data) {
    // reset results array
    resultsArray = [];

    // if Normal protocol (or no pub/sub protocol set)
    if (pubSubMode === 'Normal') {
      // convert the buffer object to a string
      let dataString = data.toString().trim();

      // remove any non-word or non-space characters e.g. STX and ETX's
      // TODO could optimize to just check start and end of string
      dataString = dataString.replace(/[^ -~]/g, '');

      // create an array of seperated data, incase any variables rely on csv style rather than regex
      const csvList = dataString.split(that.machine.settings.model.separator);

      // loop through the stored variable list
      for (let i = 0; i < variableReadArray.length; i += 1) {
        // start with a null value in case we do not have valid data for this variable,
        // or a way of extracting it
        let varStringValue = null;

        // if we are extracting this variable from the published data using a regex
        if (variableReadArray[i].regex !== undefined) {
          // use the regex to get a match from the returned data
          const matchArray = dataString.match(variableReadArray[i].regex);
          // if a match is found store it (converting later as nesessary)
          if (matchArray) {
            varStringValue = matchArray[matchArray.length - 1];
          }
        } else if (variableReadArray[i].csvPos !== undefined) {
          // if extracting this variable from the published data using comma seperation position
          // check if we have the required position in our preprocessed list
          if (csvList.length > variableReadArray[i].csvPos) {
            // if so store it (converting later as nesessary)
            varStringValue = csvList[variableReadArray[i].csvPos].trim();
          }
        }

        // if we had data for this variable, store it in the results array based on type
        resultsArray.push(convertStringResult(variableReadArray[i].format, varStringValue));
      }

      // save all results to the database
      saveResultsToDb();
    } else if (pubSubMode === 'HEIDENHAIN') {
      // convert the buffer object to a string
      let dataString = data.toString().trim();

      // remove any non-word or non-space characters e.g. STX and ETX's
      // TODO could optimize to just check start and end of string
      dataString = dataString.replace(/[^ -~]/g, '');

      // first, check if this is the 'blank' line of data.
      // This contains just a leading '+' and a value
      if (dataString.charAt(0) === '+') {
        for (let i = 0; i < variableReadArray.length; i += 1) {
          // start with a null value in case we do not have valid data for this variable,
          // or a way of extracting it
          let varStringValue = null;

          if (_.get(variableReadArray[i], 'heidenhainKeywordMissingVariableFlag', false)) {
            const lastSpaceIndex = dataString.lastIndexOf(' ');
            if (lastSpaceIndex !== -1) {
              // we've found the last space in this received string.
              // now, we try to convert what follows to the appropriate data type
              varStringValue = dataString.substring(lastSpaceIndex + 1);
              varStringValue = convertStringResult(variableReadArray[i].format, varStringValue);
              if (varStringValue === null) {
                if (_.get(variableReadArray[i], 'convertNullToZero', false)) {
                  varStringValue = 0;
                }
              }
              if (varStringValue) {
                that.dataCb(that.machine, variableReadArray[i], varStringValue, (err, res) => {
                  if (err) {
                    log.error(err);
                  }
                  if (res) log.debug(res);
                });
              }
            }
          }
        }
      } else {
        // loop through the stored variable list
        for (let i = 0; i < variableReadArray.length; i += 1) {
          // start with a null value in case we do not have valid data for this variable,
          // or a way of extracting it
          let varStringValue = null;

          // check the received line of data to see if we have a match
          if (variableReadArray[i].regex !== undefined) {
            // use the regex to get a match from the returned data
            const matchString = dataString.match(variableReadArray[i].regex);
            // if a match is found store it (converting later as nesessary)
            if (matchString) {
              const lastSpaceIndex = dataString.lastIndexOf(' ');
              if (lastSpaceIndex !== -1) {
                // we've found the last space in this received string.
                // now, we try to convert what follows to the appropriate data type
                varStringValue = dataString.substring(lastSpaceIndex + 1);
                varStringValue = convertStringResult(variableReadArray[i].format, varStringValue);
                if (varStringValue === null) {
                  if (_.get(variableReadArray[i], 'convertNullToZero', false)) {
                    varStringValue = 0;
                  }
                }
                if (varStringValue) {
                  that.dataCb(that.machine, variableReadArray[i], varStringValue, (err, res) => {
                    if (err) {
                      log.error(err);
                    }
                    if (res) log.debug(res);
                  });
                }
              }
            }
          }
        }
      }
    } else { // if Test Equipment protocol
      for (let iData = 0; iData < data.length; iData += 1) {
        // if waiting for start byte discard bytes until found, the point to the buffer start
        if (waitingForStartByte) {
          if (data[iData] === TEST_EQUIP_START_BYTE) {
            waitingForStartByte = false;
            iTestEquipBuffer = 0;
          }
        } else if (iTestEquipBuffer >= (TEST_EQUIP_BUF_LEN - 1)) {
          // if receiving data, check for buffer overrun
          waitingForStartByte = true;
          alert.raise({ key: 'published-data-too-long-error' });
        } else if ((iTestEquipBuffer + 1) <= nTestEquipBytesReqd) {
          // buffer bytes until the required number buffered
          // check for a premature start bytes
          if (data[iData] === TEST_EQUIP_START_BYTE) {
            alert.raise({ key: 'missing-data-error' });
            iTestEquipBuffer = 0;
          } else {
            testEquipBuffer[iTestEquipBuffer] = data[iData];
            iTestEquipBuffer += 1;
            // required number of bytes received, process them
            if (iTestEquipBuffer >= nTestEquipBytesReqd) {
              // loop through the stored variable list
              for (let iVar = 0; iVar < variableReadArray.length; iVar += 1) {
                // loop through each decimal digit in the value, building the total value
                let value = 0;
                const nDigits = variableReadArray[iVar].charLength; const
                  offset = variableReadArray[iVar].charOffset;
                for (let iDigit = 0; iDigit < nDigits; iDigit += 1) {
                  const digit = testEquipBuffer[iDigit + offset];
                  // skip this variable if any digits have 'skip' value
                  if (digit === TEST_EQUIP_SKIP_BYTE) {
                    value = null;
                    break;
                  }
                  value = (10 * value) + digit;
                }
                resultsArray.push(value);
              }

              // save all results to the database
              saveResultsToDb();

              waitingForStartByte = true;
              alert.clear('published-data-too-long-error');
              alert.clear('missing-data-error');
            }
          }
        }
      }
    }
  }

  function disconnectionDetected() {
    // ingore disconectiong if already know disconnected
    if (disconnectedTimer || disconnectionReported) return;

    // start a timer to set any machine connected variables to false
    disconnectedTimer = setTimeout(() => {
      disconnectedTimer = null;
      connectionReported = false;
      disconnectionReported = true;
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
    disconnectionReported = false;

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

  function requestTimer() {
    timerExpired = true;
    // only start a new request if previous set has finished (although allow for failed
    // response by adding a counter )
    if ((sendingActive === false) || (requestBlockedCounter > 3)) {
      // reset storage and index for starting a new request set
      requestBlockedCounter = 0;
      requestIndex = 0;
      resultsArray = [];
      responseBufferString = '';

      // make a tcp request for first var in list (but only if request key exists)
      sendingActive = true;
      // console.log(`------SENDING REQUEST[0]: ${variableRequests[0]}`);
      that.serialPort.write(variableRequests[0], (err) => {
        if (err) {
          log.error(`Error sending request: ${err}`);
        }
      });

      // now wait for processResponseData method to be called by 'on data'
    } else {
      disconnectionDetected();
      updateConnectionStatus(false);
      alert.raise({ key: 'no-response-error' });
      requestBlockedCounter += 1;
    }
  }

  // helper function used to extract the response value from seduz response
  function getValueFromSeDuzResponse(format, respBufString) {
    // extract the variable value from the response buffer using the response regex
    const matchArray = respBufString.match(SEDUZ_RESPONSE_REGEX);
    // if a match is found extract value appropriately
    const varStringValue = matchArray ? matchArray[matchArray.length - 1] : null;
    // change variable from a string if necessary
    return convertStringResult(format, varStringValue);
  }

  // Helper function used to extract the response value from the Yokogawa Response
  function getValueFromYokogawaResponse(format, respBufString) {
    const returnValue = null;

    // OK Response Format is:      STX + Station Number (2 Bytes) + CPU Number (2 Bytes) +
    //                             "OK" (2 Bytes) + Response Data + Checksum (2 Bytes) + ETX + CR
    // Error Response Format is:   STX + Station Number (2 Bytes) + CPU Number (2 Bytes) + "ER" +
    //                             Error Code 1 (2 bytes) + Error Code 2 (2 Bytes) + Command +
    //                             Checksum + ETX + CR
    // Checksum and CR are optional based on PLC configuration

    // first test for NAK error codes
    const responseCode = respBufString.substr(5, 2);
    if (responseCode !== YOKOGAWA_RESPONSE_CODE) {
      log.error(`Error from PLC: ${responseCode} EC1:${respBufString.substr(7, 2)} EC2:${respBufString.substr(9, 2)}`);
      return returnValue;
    }

    // then check message is for us
    const responseStationNumber = respBufString.substr(1, 2);
    const responseCPUNumber = respBufString.substr(3, 2);

    if ((responseStationNumber !== stationNumber) && (responseCPUNumber !== cpuNumber)) {
      log.error(`Station number (${responseStationNumber}) and CPU number (${responseCPUNumber}) do not match configured station number (${stationNumber}) and CPU Number (${cpuNumber}) `);
      return returnValue;
    }

    // Should check the Checksum is valid here.

    // Work out length of data block.
    // Front of header is 7 bytes (STX+Station Number + CPU Number + "OK")
    // Footer is between 1 and 4 bytes (ETX+ Checksum + CR)
    let lengthOfDataBlock = respBufString.length - 7 - 1;
    lengthOfDataBlock = usingCR ? lengthOfDataBlock - 1 : lengthOfDataBlock;
    lengthOfDataBlock = usingChecksum ? lengthOfDataBlock - 2 : lengthOfDataBlock;

    const dataBufferString = respBufString.substr(7, lengthOfDataBlock);

    // Convert payload string to result
    return convertStringResultYokogawa(format, dataBufferString);
  }

  // helper function used to extract the response value from the ascii encoded vlink response
  function getValueFromVLinkResponse(format, bitRead, respBufString) {
    let returnValue = null;
    // first test for NAK error codes
    const ackCode = respBufString.substr(3, 2);
    if (ackCode !== VLINK_ACK_CODE) {
      log.error(VLINK_NAK_CODES[ackCode]);
      return returnValue;
    }

    // then check message is for us
    const v7Id = respBufString.substr(1, 2);
    if (v7Id !== machineId) {
      log.error(`V-LINK Id of response (${v7Id}) does not match configured id(${machineId})`);
      return returnValue;
    }

    // extract the data portion of the response
    let lastIndex = usingChecksum
      ? respBufString.length - 3 : respBufString.length - 1;
    lastIndex = usingCrLf ? lastIndex - 2 : lastIndex;
    const dataBufferString = respBufString.substring(5, lastIndex);

    // place in a buffer so we can decode the ascii encoding
    const dataBuffer = Buffer.from(dataBufferString, 'hex');
    // now extract the data based on the variables format
    switch (format) {
      case 'int8': {
        returnValue = that.machine.settings.model.highByteFirst
          ? dataBuffer.readInt16BE(0) : dataBuffer.readInt16LE(0);
        break;
      }
      case 'uint8': {
        returnValue = that.machine.settings.model.highByteFirst
          ? dataBuffer.readUInt16BE(0) : dataBuffer.readUInt16LE(0);
        break;
      }
      case 'bool': {
        // if bitRead not defined for this variable set to lsb
        let bitToRead = bitRead;
        if (bitToRead === undefined || bitToRead === null) {
          bitToRead = 0;
        }
        const tmp16bitWord = that.machine.settings.model.highByteFirst
          ? dataBuffer.readUInt16BE(0) : dataBuffer.readUInt16LE(0);

        // create mask and mask the required bit, and if result more than zero
        // then set to return value to true
        // eslint-disable-next-line no-bitwise
        returnValue = ((2 ** bitToRead) & tmp16bitWord) > 0;
        break;
      }
      case 'int16': {
        returnValue = that.machine.settings.model.highByteFirst
          ? dataBuffer.readInt16BE(0) : dataBuffer.readInt16LE(0);
        break;
      }
      case 'uint16': {
        returnValue = that.machine.settings.model.highByteFirst
          ? dataBuffer.readUInt16BE(0) : dataBuffer.readUInt16LE(0);
        break;
      }
      case 'int32': {
        if (that.machine.settings.model.highByteFirst) {
          if (that.machine.settings.model.highWordFirst) {
            returnValue = dataBuffer.readInt32BE(0);
          } else {
            // eslint-disable-next-line no-bitwise
            returnValue = (dataBuffer.readInt16BE(2) << 16) + dataBuffer.readUInt16BE(0);
          }
        } else if (that.machine.settings.model.highWordFirst) {
          // eslint-disable-next-line no-bitwise
          returnValue = (dataBuffer.readUInt16LE(0) << 16) + dataBuffer.readUInt16LE(2);
        } else {
          returnValue = dataBuffer.readInt32LE(0);
        }
        break;
      }
      case 'uint32': {
        if (that.machine.settings.model.highByteFirst) {
          if (that.machine.settings.model.highWordFirst) {
            returnValue = dataBuffer.readUInt32BE(0);
          } else {
            // eslint-disable-next-line no-bitwise
            returnValue = (dataBuffer.readUInt16BE(2) << 16) + dataBuffer.readUInt16BE(0);
          }
        } else if (that.machine.settings.model.highWordFirst) {
          // eslint-disable-next-line no-bitwise
          returnValue = (dataBuffer.readUInt16LE(0) << 16) + dataBuffer.readUInt16LE(2);
        } else {
          returnValue = dataBuffer.readUInt32LE(0);
        }
        break;
      }
      case 'float': {
        if (that.machine.settings.model.highByteFirst) {
          if (that.machine.settings.model.highWordFirst) {
            returnValue = dataBuffer.readFloatBE(0);
          } else {
            const buffer = new ArrayBuffer(4);
            (new Uint16Array(buffer))[0] = dataBuffer.readUInt16BE(0);
            (new Uint16Array(buffer))[1] = dataBuffer.readUInt16BE(2);
            [returnValue] = new Float32Array(buffer);
          }
        } else if (that.machine.settings.model.highWordFirst) {
          const buffer = new ArrayBuffer(4);
          (new Uint16Array(buffer))[0] = dataBuffer.readUInt16LE(2);
          (new Uint16Array(buffer))[1] = dataBuffer.readUInt16LE(0);
          [returnValue] = new Float32Array(buffer);
        } else {
          returnValue = dataBuffer.readFloatLE(0);
        }
        break;
      }
      case 'double': {
        if (that.machine.settings.model.highByteFirst) {
          if (that.machine.settings.model.highWordFirst) {
            returnValue = dataBuffer.readDoubleBE(0);
          } else {
            const buffer = new ArrayBuffer(8);
            (new Uint16Array(buffer))[0] = dataBuffer.readUInt16BE(0);
            (new Uint16Array(buffer))[1] = dataBuffer.readUInt16BE(2);
            (new Uint16Array(buffer))[2] = dataBuffer.readUInt16BE(4);
            (new Uint16Array(buffer))[3] = dataBuffer.readUInt16BE(6);
            [returnValue] = new Float64Array(buffer);
          }
        } else if (that.machine.settings.model.highWordFirst) {
          const buffer = new ArrayBuffer(8);
          (new Uint16Array(buffer))[0] = dataBuffer.readUInt16LE(6);
          (new Uint16Array(buffer))[1] = dataBuffer.readUInt16LE(4);
          (new Uint16Array(buffer))[2] = dataBuffer.readUInt16LE(2);
          (new Uint16Array(buffer))[3] = dataBuffer.readUInt16LE(0);
          [returnValue] = new Float64Array(buffer);
        } else {
          returnValue = dataBuffer.readDoubleLE(0);
        }
        break;
      }
      case 'char':
        // TODO may neeed to tidy ends of odd length strings (as data always
        // sent in multiples of 16bit)
        returnValue = dataBuffer.swap16().toString(); // strings need byte swapping
        break;
      case 'int64':
      case 'uint64':
        log.error('No support for reading int64 or uint64');
        break;
      default:
        log.error(`Unrecognized format: ${format}`);
        break;
    }
    return returnValue;
  }

  function getValueFromWF818Response(respBufString) {
    const returnValue = null;

    // OK Response Format is:      STX + C1 + C2 + DATA + ETX + BCC
    //                             C1, C2: Echo of the mnemonic from the poll message
    //                             DATA: The value of the parameter in a given display format
    //                                   e.g. 99.9, 1.2, -999, >1234 etc.
    //                             BCC: This is a block checksum that is generate for database
    //                                  validation.  It is computed by XORing (exclusing or)
    //                                  all the characters after and excluding the STX, and
    //                                  including the ETX.

    // first test for STX
    if (respBufString.charAt(0) !== STX) {
      log.error('Error from PLC: No <STX> at start of response');
      return returnValue;
    }

    // next test for C1 C2 match
    if ((respBufString.charAt(1) !== variableReadArray[requestIndex].requestKey.charAt(2))
        || (respBufString.charAt(2) !== variableReadArray[requestIndex].requestKey.charAt(3))) {
      log.error(`Error from PLC: <STX> ${respBufString.substr(1, respBufString.length - 3)}`);
      return returnValue;
    }

    // Should check the Checksum is valid here.

    // Work out length of data block.
    // Front of header is 3 bytes (STX + C1 + C2)
    // Footer is between 2 bytes (ETX + BCC)
    const lengthOfDataBlock = respBufString.length - 3 - 2;

    const dataBufferString = respBufString.substr(3, lengthOfDataBlock);

    // Convert payload string to result
    return convertStringResultWF818(variableReadArray[requestIndex].format, dataBufferString);
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function getValueFromKeyenceKVResponse(respBufString) {
    // console.log(`PROCESSING RESPONSE[${requestIndex}]: respBufString = ${respBufString}`);

    // Convert payload string to result
    return convertStringResultKeyenceKV(variableReadArray[requestIndex - 1].format, respBufString);
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function processResponseData(data) {
    // will be triggered for each repsonse to a request, assumes response is for last sent request

    // only attempt processing if we are expecting it
    if (sendingActive === true) {
      // append current buffer with new data
      // (don't trim in case of non-printable escape characters are used)
      responseBufferString += data.toString();

      // find out where response terminator should be
      const terminatorPosition = (responseBufferString.length - 1)
       - numBytesAfterResponseTerminator;

      // if character in the terminator position is the response terminator, we have all the data
      if ((terminatorPosition > 0)
       && (responseBufferString[terminatorPosition] === responseTerminator)) {
        connectionDetected();
        updateConnectionStatus(true);
        alert.clear('no-response-error');

        // extract the value from the response, based on the protocol in use
        let valueToStore = null;
        if (that.machine.settings.model.protocol === 'SE-DUZ') {
          // extract the variable value from the response buffer
          valueToStore = getValueFromSeDuzResponse(variableReadArray[requestIndex].format,
            responseBufferString);
        } else if (that.machine.settings.model.protocol === 'V-LINK') {
          // extract the variable value from the response buffer
          valueToStore = getValueFromVLinkResponse(variableReadArray[requestIndex].format,
            variableReadArray[requestIndex].bitRead, responseBufferString);
        } else if (that.machine.settings.model.protocol === 'YOKOGAWA') {
          // extract the variable value from the response buffer
          valueToStore = getValueFromYokogawaResponse(variableReadArray[requestIndex].format,
            responseBufferString);
        } else if (that.machine.settings.model.protocol === 'WF818 Tension Controller') {
          valueToStore = getValueFromWF818Response(responseBufferString);
        }


        // special processing for Keyence KV's START-COMMS and STOP-COMMS commands
        if (that.machine.settings.model.protocol === 'Keyence KV') {
          if (requestIndex > 0) { // 0 = start comms - don't need to process response
            if (requestIndex < (variableRequests.length - 1)) {
              // last command = end comms - don't need to process response
              // eslint-disable-next-line max-len
              valueToStore = getValueFromKeyenceKVResponse(responseBufferString.substr(0, terminatorPosition));

              // store the variable in the results array
              resultsArray.push(valueToStore);

              // clear the buffer now it has been used
              responseBufferString = '';

              // send request for next var (if any left, else process whole array result)
              requestIndex += 1;
              // eslint-disable-next-line max-len
              // console.log(`------SENDING REQUEST[${requestIndex}]: ${variableRequests[requestIndex]}`);
              that.serialPort.write(variableRequests[requestIndex], (err) => {
                if (err) {
                  log.error(`Error sending request: ${err}`);
                }
              });
            } else {
              // receiving response for last command: end comms

              // clear the buffer now it has been used
              responseBufferString = '';

              sendingActive = false;
              // save all results to the database
              saveResultsToDb();
            }
          } else {
            // receiving response for first command: start comms

            // clear the buffer now it has been used
            responseBufferString = '';

            // send request for next var (if any left, else process whole array result)
            requestIndex += 1;
            // eslint-disable-next-line max-len
            // console.log(`------SENDING REQUEST[${requestIndex}]: ${variableRequests[requestIndex]}`);
            that.serialPort.write(variableRequests[requestIndex], (err) => {
              if (err) {
                log.error(`Error sending request: ${err}`);
              }
            });
          }
        } else {
          // store the variable in the results array
          resultsArray.push(valueToStore);

          // clear the buffer now it has been used
          responseBufferString = '';

          // send request for next var (if any left, else process whole array result)
          requestIndex += 1;
          if (requestIndex !== variableReadArray.length) {
            that.serialPort.write(variableRequests[requestIndex], (err) => {
              if (err) {
                log.error(`Error sending request: ${err}`);
              }
            });
          } else {
            sendingActive = false;
            // save all results to the database
            saveResultsToDb();
          }
        }
      } else {
        // else just wait for more data from another 'on data'
      }
    }
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  // helper function for v-link protocol mode to convert the format into number of words to read
  function calculateVLinkWordsToReadField(format, length) {
    let dataLengthString;

    switch (format) {
      default:
      case 'int8':
      case 'int16':
      case 'uint8':
      case 'uint16':
      case 'bool':
        dataLengthString = '01';
        break;

      case 'int32':
      case 'uint32':
      case 'float':
        dataLengthString = '02';
        break;

      case 'int64':
      case 'uint64':
      case 'double':
        dataLengthString = '04';
        break;

      case 'char': {
        // divide by two to get number of words required
        let wordLength = Math.ceil(length / 2);

        // bounds check word length
        wordLength = wordLength > 255 ? 255 : wordLength;
        wordLength = wordLength <= 0 ? 1 : wordLength;

        // convert integer word length to a hex string and pad with leading '0' if necessary
        dataLengthString = wordLength.toString(16).toUpperCase();
        dataLengthString = dataLengthString.length === 1 ? `0${dataLengthString}` : dataLengthString;
        break;
      }
    }

    return dataLengthString;
  }

  // helper function for Yokogawa protocol mode to calculate the request checksum
  // See Appx.1-6
  function calculateYokogawaChecksum(requestString) {
    const requestBuffer = Buffer.from(requestString);

    let checksumTotal = 0;
    for (let i = 0; i < requestBuffer.length; i += 1) {
      checksumTotal += requestBuffer[i];
    }
    const checksumTotalHex = checksumTotal.toString(16).toUpperCase();
    const checksumTotalHexLastTwoBytes = checksumTotalHex.substr(checksumTotalHex.length - 2);

    return checksumTotalHexLastTwoBytes;
  }

  // helper function for v-link protocol mode to calculate the request checksum
  function calculateVLinkChecksum(requestString) {
    const requestBuffer = Buffer.from(requestString);

    let checksumTotal = 0;
    for (let i = 0; i < requestBuffer.length; i += 1) {
      checksumTotal += requestBuffer[i];
    }
    const checksumTotalHex = checksumTotal.toString(16).toUpperCase();
    const checksumTotalHexLastTwoBytes = checksumTotalHex.substr(checksumTotalHex.length - 2);

    return checksumTotalHexLastTwoBytes;
  }

  function open(callback) {
    const requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    ({ mode } = that.machine.settings.model);
    const { device } = that.machine.settings.model;
    const baudRate = parseInt(that.machine.settings.model.baudRate, 10);
    const { parity } = that.machine.settings.model;
    connectionReported = false;
    disconnectionReported = false;
    timerExpired = false;
    let parser;
    let i;

    // from the variable array, form a new array of 'read' specific variables
    // i.e. filter out alarm code variables (and possibly 'write' only variables in the future)
    variableReadArray = [];
    variableRequests = [];
    that.machine.variables.forEach((variable) => {
      if (!_.has(variable, 'machineConnected') || !variable.machineConnected) {
        variableReadArray.push(variable);
      }
    });

    // if running in 'req/res' mode,
    if (mode === 'req/res') {
      // configure protocol specific request payload information
      if (that.machine.settings.model.protocol === 'SE-DUZ') {
        usingChecksum = false;
        usingCrLf = false;

        // form the array of requests to be sent
        for (i = 0; i < variableReadArray.length; i += 1) {
          // whilst doing this also do a check that all variables have a request key
          if (variableReadArray[i].requestKey === undefined) {
            alert.raise({ key: 'request-key-error' });
            return callback(new Error('All variables require a request key in req/res mode'));
          }
          // request is formed from the request key sandwiched between an 'EOT' and an 'ENQ'
          variableRequests.push(EOT + variableReadArray[i].requestKey + ENQ);
        }
        alert.clear('request-key-error');
        responseTerminator = ETX;
        numBytesAfterResponseTerminator = 1;
      } else if (that.machine.settings.model.protocol === 'YOKOGAWA') {
        // YOKOGAWA has an optional checksum and terminating CR
        ({ usingChecksum } = that.machine.settings.model);
        usingCR = that.machine.settings.model.usingCr;

        // Convert the station number to a string and add leading zero if required
        stationNumber = that.machine.settings.model.yokogawaStationNumber
          .toString(16).toUpperCase();
        stationNumber = stationNumber.length === 1 ? `0${stationNumber}` : stationNumber;

        // Convert CPU number to a string and add a leading zero if required
        cpuNumber = that.machine.settings.model.yokogawaCPUNumber.toString(16).toUpperCase();
        cpuNumber = cpuNumber.length === 1 ? `0${cpuNumber}` : cpuNumber;

        // Set the wait time to always be 10ms.
        // See table Appx.1-5 in FA-M3 "Personal Computer Link Command Document"
        const waitTime = '1';

        // form the array of requests to be sent
        for (i = 0; i < variableReadArray.length; i += 1) {
          // whilst doing this also do a check that all variables have a request key
          if (variableReadArray[i].requestKey === undefined) {
            alert.raise({ key: 'request-key-error' });
            return callback(new Error('All variables require a request key in req/res mode'));
          }
          alert.clear('request-key-error');
          // var variableRequest = STX + machineId + VLINK_READ_CODE + numWords +
          //                       variables[i].requestKey + ETX;
          // Format: STX + Station Number + CPU Number (2 bytes) + Wait Time (1 Byte) +
          //                       Command + Checksum + ETX + CR
          //  Checksum and CR are optional
          //  Documentation

          // Form message that will be checksumed
          let yokogawaVariableRequest = stationNumber + cpuNumber + waitTime
           + variableReadArray[i].requestKey;

          // Add checksum if required.
          yokogawaVariableRequest = usingChecksum ? yokogawaVariableRequest
           + calculateYokogawaChecksum(yokogawaVariableRequest) : yokogawaVariableRequest;

          // Add STX to the front of the request
          yokogawaVariableRequest = STX + yokogawaVariableRequest + ETX;

          // Add CR if required
          yokogawaVariableRequest = usingCR
            ? yokogawaVariableRequest + CR : yokogawaVariableRequest;

          // request is formed from the request key sandwiched between an 'STX' and an 'ETX'
          variableRequests.push(yokogawaVariableRequest);
        }

        // Let the parser know how to test the end of the message
        responseTerminator = ETX;
        // The CR is after the ETX so parser needs to check byte before if CR is enabled
        numBytesAfterResponseTerminator = usingCR ? 1 : 0;
      } else if (that.machine.settings.model.protocol === 'V-LINK') {
        // create a 2 byte hex string from the v7 port number 1-31 (01 to 1F)
        machineId = that.machine.settings.model.v7port.toString(16).toUpperCase();
        machineId = machineId.length === 1 ? `0${machineId}` : machineId;

        // set some comnfiguration flags required for both request creation and repsonse parsing
        ({ usingChecksum } = that.machine.settings.model);
        ({ usingCrLf } = that.machine.settings.model);

        // form the array of requests to be sent
        for (i = 0; i < variableReadArray.length; i += 1) {
          // whilst doing this also do a check that all variables have a request key
          if (variableReadArray[i].requestKey === undefined) {
            alert.raise({ key: 'request-key-error' });
            return callback(new Error('All variables require a request key in req/res mode'));
          }
          alert.clear('request-key-error');
          // calculate words to read as a hex string 1-255 (01 to FF)
          const numWords = calculateVLinkWordsToReadField(variableReadArray[i].format,
            variableReadArray[i].length);

          // start forming the request string
          let variableRequest = STX + machineId + VLINK_READ_CODE + numWords
           + variableReadArray[i].requestKey + ETX;
          // add on a calculated checksum if required
          variableRequest = usingChecksum ? variableRequest
           + calculateVLinkChecksum(variableRequest) : variableRequest;
          // add crlf if required
          variableRequest = usingCrLf ? variableRequest + CR + LF : variableRequest;
          variableRequests.push(variableRequest);
        }

        responseTerminator = ETX;
        numBytesAfterResponseTerminator = usingChecksum ? 2 : 0;
        numBytesAfterResponseTerminator = usingCrLf
          ? numBytesAfterResponseTerminator + 2 : numBytesAfterResponseTerminator;
      } else if (that.machine.settings.model.protocol === 'WF818 Tension Controller') {
        usingChecksum = false;
        usingCrLf = false;
        // form the array of requests to be sent
        for (i = 0; i < variableReadArray.length; i += 1) {
          // whilst doing this also do a check that all variables have a request key
          if (variableReadArray[i].requestKey === undefined) {
            alert.raise({ key: 'request-key-error' });
            return callback(new Error('All variables require a request key in req/res mode'));
          }
          const matchRegex = /\d{2}[a-zA-Z]{2}/g;
          if (!variableReadArray[i].requestKey.match(matchRegex)) {
            alert.raise({ key: 'request-key-error-WF818' });
            return callback(new Error('Request key for WF818 must be in the format ##CC, with ## = address, CC = two character mnemonic'));
          }


          const variableRequest = EOT + variableReadArray[i].requestKey.charAt(0)
                                      + variableReadArray[i].requestKey.charAt(0)
                                      + variableReadArray[i].requestKey.charAt(1)
                                      + variableReadArray[i].requestKey.charAt(1)
                                      + variableReadArray[i].requestKey.charAt(2)
                                      + variableReadArray[i].requestKey.charAt(3) + ENQ;
          variableRequests.push(variableRequest);
        }

        alert.clear('request-key-error');
        alert.clear('request-key-error-WF818');

        responseTerminator = ETX;
        numBytesAfterResponseTerminator = 1;
      } else if (that.machine.settings.model.protocol === 'Keyence KV') {
        usingChecksum = false;
        usingCrLf = false;
        // first command is START COMMS ('CR\r')
        variableRequests.push(`CR${CR}`);
        // form the array of requests to be sent
        for (i = 0; i < variableReadArray.length; i += 1) {
          // whilst doing this also do a check that all variables have a request key
          if (variableReadArray[i].requestKey === undefined) {
            alert.raise({ key: 'request-key-error' });
            return callback(new Error('All variables require a request key in req/res mode'));
          }
          if (!variableReadArray[i].requestKey.startsWith('RD ')) {
            alert.raise({ key: 'request-key-error-Keyence-KV' });
            return callback(new Error('Request key for Keyence KV must start with RD'));
          }

          const variableRequest = variableReadArray[i].requestKey + CR;
          variableRequests.push(variableRequest);
        }
        // last command is END COMMS ('CQ\r')
        variableRequests.push(`CQ${CR}`);

        alert.clear('request-key-error');
        alert.clear('request-key-error-Keyence-KV');

        responseTerminator = CR;
        numBytesAfterResponseTerminator = 1;
      }
    } else { // if pub/sub mode
      // set whether normal or testing equipment protocol
      pubSubMode = _.get(that.machine.settings, 'model.pubSubProtocol', 'Normal');

      // if testing equipment protocol, find number of required data bytes
      if (pubSubMode === 'Test Equipment') {
        nTestEquipBytesReqd = 0;
        let missingCharOffset = false; const
          missingCharLength = false;
        for (i = 0; i < variableReadArray.length; i += 1) {
          // make sure variables have character offset and character length
          if (variableReadArray[i].charOffset === undefined) {
            missingCharOffset = true;
          } else if (variableReadArray[i].charLength === undefined) {
            missingCharOffset = true;
          } else {
            const nReqdForVar = variableReadArray[i].charOffset + variableReadArray[i].charLength;
            if (nReqdForVar > nTestEquipBytesReqd) nTestEquipBytesReqd = nReqdForVar;
          }
        }

        if (missingCharOffset) {
          alert.raise({ key: 'character-offset-error' });
        } else {
          alert.clear('character-offset-error');
        }
        if (missingCharOffset) {
          alert.raise({ key: 'character-length-error' });
        } else {
          alert.clear('character-length-error');
        }
        if (missingCharOffset || missingCharLength) {
          return callback(new Error('All variables require a charaCter offset and length key in testing equipment pub/sub mode'));
        }

        waitingForStartByte = true;
      }
    }

    // create a serial port with the correct configuration
    that.serialPort = new SerialPort(device, {
      baudRate,
      parity,
      autoOpen: false,
    });

    if (mode === 'pub/sub') {
      // for pub/sub mode in normal mode, set parser to return only whole lines ending in a CR
      if (((pubSubMode === 'Normal') || (pubSubMode === 'HEIDENHAIN')) && (!testing)) {
        parser = that.serialPort.pipe(new Readline({ delimiter: '\r' }));
      }
    }

    // attempt to open the serial port
    that.serialPort.open((err) => {
      if (err) {
        alert.raise({ key: 'connection-error' });
        return callback(err);
      }

      alert.clear('connection-error');

      // subscribe to on 'data' events based on whether reading raw or by line
      if (mode === 'pub/sub') {
        // for pub/sub mode in normal mode, use parser to process one line at a time
        if (((pubSubMode === 'Normal') || (pubSubMode === 'HEIDENHAIN')) && (!testing)) {
          parser.on('data', (data) => {
            processPublishedData(data);
          });
        } else { // for pub/sub mode in test equipment mode process data aS it comes in
          that.serialPort.on('data', (data) => {
            processPublishedData(data);
          });
        }
      } else if (mode === 'req/res') {
        that.serialPort.on('readable', () => {
          const data = that.serialPort.read();
          // console.log('------RECEIVED RESPONSE:');
          // dumpBuffer(data);
          processResponseData(data);
        });
      }

      // subscribe to on 'close' events
      that.serialPort.on('close', () => {
        log.debug('Serial port closed');

        // stop the request timer task if applicable (i.e. if not closed by our request)
        if ((mode === 'req/res') && timer && timerExpired) {
          // clearInterval(timer);
          timer = null;
          sendingActive = false;
        }
      });

      // if using req/res mode then set up a repeat task to trigger the requests
      if (mode === 'req/res') {
        timer = setInterval(requestTimer, requestFrequencyMs);
      }

      // trigger callback on succesful connection
      return callback(null);
    });

    return undefined;
  }

  function close(callback) {
    // close the serial port if open
    if (that.serialPort === null) {
      return callback(new Error('No Serial Device To Close'));
    }

    updateConnectionStatus(false);

    // if we are currently in a request/response cycle (for req/res type)
    if ((sendingActive === true)) {
      // hold off on closing using an interval timer
      let waitCounter = 0;
      const activeWait = setInterval(() => {
        // until safe to do so
        if ((sendingActive === false) || (waitCounter > 20)) {
          sendingActive = false;
          clearInterval(activeWait);
          that.serialPort.close(callback);
        }
        waitCounter += 1;
      }, 100); // interval set at 100 milliseconds
    } else {
      // otherwise close immeditalely
      that.serialPort.close(callback);
    }

    return undefined;
  }


  // Privileged methods
  this.start = function start(dataCb, configUpdateCb, done) {
    if (!that.machine) {
      return done('machine undefined');
    }

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

    open((err) => {
      if (err) {
        return done(err);
      }
      log.info('Started');
      return done(null);
    });

    return undefined;
  };

  this.stop = function stop(done) {
    updateConnectionStatus(false);

    if (!that.machine) {
      return done('machine undefined');
    }

    // stop the request timer task (if being used)
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }

    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }
      // close serial port if open
      if (that.serialPort) {
        close((closeErr) => {
          if (closeErr) {
            log.error(closeErr);
          }
          that.serialPort = null;
          log.info('Stopped');
          return done(null);
        });
      } else {
        log.info('Stopped');
        return done(null);
      }
      return undefined;
    });

    return undefined;
  };

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop((err) => {
      if (err) return done(err);
      that.start(that.dataCb, that.configUpdateCb, startErr => done(startErr));
      return undefined;
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
  hpl: hplSerial,
  defaults,
  schema,
};
