/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const net = require('net');
let { Controller, Tag } = require('ethernet-ip');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

const registerCmd = [
  0x65, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00];

const connectCmd = [
  0x6f, 0x00, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3f, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00,
  0x00, 0x00, 0x00, 0x00, 0xb2, 0x00, 0x34, 0x00, 0x5b, 0x02, 0x20, 0x06, 0x24, 0x01, 0x06, 0x9c,
  0x02, 0x00, 0x00, 0x80, 0x01, 0x00, 0xfe, 0x80, 0x02, 0x00, 0x1b, 0x05, 0xd0, 0xbe, 0xfe, 0x03,
  0x02, 0x00, 0x00, 0x00, 0x80, 0x84, 0x1e, 0x00, 0xcc, 0x07, 0x00, 0x42, 0x80, 0x84, 0x1e, 0x00,
  0xcc, 0x07, 0x00, 0x42, 0xa3, 0x03, 0x20, 0x02, 0x24, 0x01, 0x2c, 0x01];

const readVarCmd = [
  0x70, 0x00, 0x22, 0x00, 0x49, 0x01, 0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00,
  0xa1, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0xb1, 0x00, 0x0e, 0x00, 0x4c, 0x00, 0x4c, 0x04,
  0x91, 0x05, 0x43, 0x4f, 0x4e, 0x54, 0x33, 0x00, 0x01, 0x00];

const readAttrCmd = [
  0x70, 0x00, 0x1e, 0x00, 0x49, 0x01, 0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00,
  0xa1, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0xb1, 0x00, 0x0a, 0x00, 0x71, 0x00, 0x0e, 0x03,
  0x20, 0x01, 0x24, 0x01, 0x30, 0x07];

// constructor
const hplEthernetIP = function hplEthernetIP(log, machine, model, conf, db, alert) {
  // if running test harness, get Modbus tester and set the variables
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line global-require
    ({ EthernetStdControllerTester: Controller, EthernetStdTagTester: Tag } = require('./test/ethernetip-std-tester'));
    this.tester = Controller;
  }

  // preload alert messages that have known keys
  alert.preLoad({
    'host-connect-error': {
      msg: 'Ethernet/IP: Failed to Connect to Host',
      description: x => `Error connecting to the controller at the specified host name or IP address. Error: ${x.errorMsg}. Check the connection to the controller and its settings.`,
    },
    'plc-connect-error': {
      msg: 'Ethernet/IP: Failed to Connect to Controller',
      description: 'Failed to connect to the controller. Check the controller settings.',
    },
    'plc-register-error': {
      msg: 'Ethernet/IP: Failed to Register Session',
      description: 'Failed to register a session with the controller. Check the controller settings.',
    },
    'database-error': {
      msg: 'Ethernet/IP: Error Writing to Database',
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
  });

  const SESSION_HANDLE_INDEX = 4;
  const RESPONSE_ERROR_CODE_INDEX = 8;
  const CONNECTION_ERROR_CODE_INDEX = 42;
  const CONNECTION_ID_RESP_INDEX = 44;
  const CONNECTION_ID_CMD_INDEX = 36;
  const CONNECTION_RETRY_TIME = 5000;
  const CONNECTION_MAX_RETRYS = 25;
  const ATTRIBUTE_ID_INDEX = 53;
  const ATTRIBUTE_DATA_INDEX = 50;
  const VARIABLE_CMD_HEADER_LEN_INDEX = 2;
  const VARIABLE_CMD_DATA_LEN_INDEX = 42;
  const VARIABLE_PATH_LEN_INDEX = 47;
  const VARIABLE_DATA_TYPE_INDEX = 50;
  const VARIABLE_DATA_INDEX = 52;
  const SEQUENCE_COUNT_INDEX = 44;
  const ENCAPSULATION_HEADER_SIZE = 24;
  const MAX_CMD_LEN = 1024;

  const VARIABLE_SECTION_START_CHAR = 0x91;
  const ONE_BYTE_INDEX_CODE = 0x28;
  const TWO_BYTE_INDEX_CODE = 0x29;

  // Private variables
  const that = this;
  let bSendingActive = false;
  let client = null;
  let readRequestTimer = null;
  let reconnectTimer = null;
  const connectionRetryFrequency = 5000; // set reconnect timer to 5 seconds
  let resultsArray = [];
  let requestIndex = 0;
  let requestBlockedCounter = 0;
  let bRegistering = false;
  let bConnecting = false;
  let bOpeningConnection = false;
  let protocolMode = 'Omron';
  let connectionRetryCount = 0;
  let tagArray = [];

  // initialize global buffers
  const sessionHandleBuf = Buffer.allocUnsafe(4);
  const connectionIDBuf = Buffer.allocUnsafe(4);
  const readVarCmdBuf = Buffer.allocUnsafe(MAX_CMD_LEN);
  const readVarCmdInitBuf = Buffer.from(readVarCmd);
  readVarCmdInitBuf.copy(readVarCmdBuf);
  const readAttrCmdBuf = Buffer.from(readAttrCmd);
  let sequenceCount = 6;

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  function setupReconnect() {
    // first, disable the read timer
    if (readRequestTimer) {
      clearInterval(readRequestTimer);
      readRequestTimer = null;
      bSendingActive = false;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }

    // destroy the client
    if (client) {
      if (protocolMode === 'Omron') {
        client.destroy();
      }
      client = null;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // eslint-disable-next-line no-use-before-define
      open((err) => {
        log.info(`reconnect callback - open callback Err = ${err}`);
      });
    }, connectionRetryFrequency);
  }

  updateConnectionStatus(false);

  // debug function for dumping the contents of a a buffer in easy-to-read format, 16 bytes per line
  // function dumpBuffer(buffer) {
  //   let str = '';
  //   for (let i = 0; i < buffer.length; ++i) {
  //     if (buffer[i] < 16) {
  //       str += '0' + buffer[i].toString(16) + ' ';
  //     }
  //     else {
  //       str += buffer[i].toString(16) + ' ';
  //     }
  //     if ((((i + 1) % 16) === 0) || ((i + 1) == buffer.length)) {
  //       console.log(str);
  //       str = '';
  //     }
  //   }
  // }

  // helper function to save array of collected results to the database
  function saveResultsToDb() {
    // process the array of results
    async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
      const variable = that.machine.variables[index];
      // if there wasn't a result
      if (dataItem === null) {
        // alert that there was an error getting this variables data
        alert.raise({
          key: `read-fail-${variable.name}`,
          msg: 'Ethernet/IP: Read Failed for Variable',
          description: `Read failed for variable '${variable.name}'. Check that this variable is defined correctly in the machine.`,
        });

        // and just move onto next item
        return callback();
      }
      // othewise update the database
      that.dataCb(that.machine, variable, dataItem, (err, res) => {
        alert.clear(`read-fail-${variable.name}`);

        if (err) {
          alert.raise({ key: 'database-error', errorMsg: err.message });
        } else {
          alert.clear('database-error');
        }
        if (res) log.debug(res);
        // move onto next item once stored in db
        return callback();
      });

      return undefined;
    });
  }


  function readVariablesStandard() {
    resultsArray = [];

    async.forEachOfSeries(that.machine.variables, (variable, iVar, cb) => {
      if (tagArray[iVar]) {
        client.readTag(tagArray[iVar]).then(() => {
          resultsArray.push(tagArray[iVar].value);
          cb();
        }).catch(() => {
          resultsArray.push(null);
          cb();
        });
      } else {
        switch (_.get(variable, 'requestType', 'variable')) {
          case 'revision':
            resultsArray.push(client.properties.version);
            break;
          case 'status':
            resultsArray.push(client.properties.status);
            break;
          case 'serial number':
            resultsArray.push(client.properties.serial_number);
            break;
          case 'product name':
            resultsArray.push(client.properties.name);
            break;
          default:
            resultsArray.push(null);
        }
        cb();
      }
    }, () => {
      // save all results to the database
      saveResultsToDb();
    });
  }

  // helper function to write the sequence count to a buffer and increment it
  function writeSequenceCount(buffer) {
    buffer.writeUInt16LE(sequenceCount, SEQUENCE_COUNT_INDEX);
    if (sequenceCount < 0xFFFF) {
      sequenceCount += 1;
    } else {
      sequenceCount = 0;
    }
  }

  // helper function to parse a controller variable path into the required command format:
  // return size of bufered command
  function parseVariablePath(plcVariable, cmdBuf) {
    // remove any whitepace from the name, and split the name into sections separated by dots
    const varSplit = plcVariable.replace(/\s+/g, '').split('.');

    // point to first buffer location after path length in words field to start
    let iBuf = VARIABLE_PATH_LEN_INDEX + 1;

    // process each section separated by dots
    try {
      for (let iSplit = 0; iSplit < varSplit.length; iSplit += 1) {
        // start with a start character
        cmdBuf.writeUInt8(VARIABLE_SECTION_START_CHAR, iBuf);
        iBuf += 1;

        // save the location of the section length in bytes
        const iSectionLen = iBuf;
        iBuf += 1;

        // process each character of this section of the variable path
        let iChar = 0; const
          index = [null, null];
        const varPathSection = varSplit[iSplit];
        while (iChar < varPathSection.length) {
          const varPathChar = varPathSection.charAt(iChar);

          // if this is the beginning of 1 or 2 indexes, get them and check them for validity
          if (varPathChar === '[') {
            if (varPathSection.charAt(varPathSection.length - 1) === ']') {
              const indexSplit = varPathSection.substring(iChar + 1, varPathSection.length - 1).split(',');
              if (indexSplit.length > 2) return 0;
              index[0] = Number(indexSplit[0]);
              if (Number.isNaN(index[0])) return 0;
              if (indexSplit.length > 1) {
                index[1] = Number(indexSplit[1]);
                if (Number.isNaN(index[1])) return 0;
              }
              break;
            } else {
              return 0;
            }
          } else {
            // if not the beginning of 1 or 2 indexes, store the character in the buffer
            cmdBuf.write(varPathChar, iBuf, 1);
            iBuf += 1;
            iChar += 1;
          }
        }

        // if odd number of characters, pad with a zeros
        if ((iChar % 2) !== 0) {
          cmdBuf.writeUInt8(0, iBuf);
          iBuf += 1;
        }

        // store the length of the section in bytesToRead
        cmdBuf.writeUInt8(iChar, iSectionLen);

        // if there are any indexes, add them to the buffer, using 2 byte index only if index > 255
        for (let iIndex = 0; iIndex < 2; iIndex += 1) {
          if (index[iIndex] !== null) {
            if (index[iIndex] <= 0xFF) {
              cmdBuf.writeUInt8(ONE_BYTE_INDEX_CODE, iBuf);
              iBuf += 1;
              cmdBuf.writeUInt8(index[iIndex], iBuf);
              iBuf += 1;
            } else {
              cmdBuf.writeUInt16LE(TWO_BYTE_INDEX_CODE, iBuf);
              iBuf += 2;
              cmdBuf.writeUInt16LE(index[iIndex], iBuf);
              iBuf += 2;
            }
          }
        }
      }

      // always write 1 for number of elements
      cmdBuf.writeUInt16LE(1, iBuf);
    } catch (err) {
      return 0;
    }

    // store the path length in words
    cmdBuf.writeUInt8(Math.floor((iBuf - (VARIABLE_PATH_LEN_INDEX + 1)) / 2),
      VARIABLE_PATH_LEN_INDEX);

    // return actual size of buffered command in bytes
    return iBuf + 2;
  }

  // helper function to request the value for a variable
  function requestVariableValue(variable) {
    // if this variable is requests an attribute
    if (_.get(variable, 'requestType', 'variable') !== 'variable') {
      // build the basic request command
      sessionHandleBuf.copy(readAttrCmdBuf, SESSION_HANDLE_INDEX);
      connectionIDBuf.copy(readAttrCmdBuf, CONNECTION_ID_CMD_INDEX);
      writeSequenceCount(readAttrCmdBuf);

      // set the attribute ID
      switch (variable.requestType) {
        case 'vendor ID':
          readAttrCmdBuf[ATTRIBUTE_ID_INDEX] = 0x01;
          break;
        case 'device type':
          readAttrCmdBuf[ATTRIBUTE_ID_INDEX] = 0x02;
          break;
        case 'product code':
          readAttrCmdBuf[ATTRIBUTE_ID_INDEX] = 0x03;
          break;
        case 'revision':
          readAttrCmdBuf[ATTRIBUTE_ID_INDEX] = 0x04;
          break;
        case 'status':
          readAttrCmdBuf[ATTRIBUTE_ID_INDEX] = 0x05;
          break;
        case 'serial number':
          readAttrCmdBuf[ATTRIBUTE_ID_INDEX] = 0x06;
          break;
        case 'product name':
          readAttrCmdBuf[ATTRIBUTE_ID_INDEX] = 0x07;
          break;
        default:
          return false;
      }

      // write the completed attribute read command
      client.write(readAttrCmdBuf);
    } else {
      // if variable requests a controller variable value
      // build the basic request command
      sessionHandleBuf.copy(readVarCmdBuf, SESSION_HANDLE_INDEX);
      connectionIDBuf.copy(readVarCmdBuf, CONNECTION_ID_CMD_INDEX);
      writeSequenceCount(readVarCmdBuf);

      // try to parse the controller variable path into the command buffer
      const varCmdSize = parseVariablePath(variable.controllerVariable, readVarCmdBuf);
      if (varCmdSize === 0) return false;

      // create a local command buffer with the actual length
      const varCmdBuf = Buffer.allocUnsafe(varCmdSize);
      readVarCmdBuf.copy(varCmdBuf, 0, 0, varCmdSize);

      // set the encapulation header command length in the command
      // (total length - 24 bytes for encapulation header)
      varCmdBuf.writeUInt16LE(varCmdSize - ENCAPSULATION_HEADER_SIZE,
        VARIABLE_CMD_HEADER_LEN_INDEX);

      // set the data command length in the command
      // (total length - (42  + 2)_ bytes for command length)
      varCmdBuf.writeUInt16LE(varCmdSize - (VARIABLE_CMD_DATA_LEN_INDEX + 2),
        VARIABLE_CMD_DATA_LEN_INDEX);

      // write the completed variable read command
      // console.log('***** varCmdBuf:');
      // dumpBuffer(varCmdBuf);
      client.write(varCmdBuf);
    }

    return true;
  }

  function requestTimer() {
    // if standard mode, read all variables
    if (protocolMode === 'Standard') {
      readVariablesStandard();
    } else if ((bSendingActive === false) || (requestBlockedCounter > 3)) {
      // if Omron mode only start a new request if previous set has finished
      // (although allow for failed response by adding a counter )
      // reset storage and index for starting a new request set
      requestBlockedCounter = 0;
      requestIndex = 0;
      resultsArray = [];

      // make a tcp request for first valid variable in list
      while (requestIndex < that.machine.variables.length) {
        if (requestVariableValue(that.machine.variables[requestIndex])) {
          bSendingActive = true;
          break;
        }

        resultsArray.push(null);
        requestIndex += 1;
      }
    } else {
      updateConnectionStatus(false);
      requestBlockedCounter += 1;
    }
  }

  function processResponseData(data) {
    let resultValue = null;
    try {
      // check whether attribute rquest response or variable request response
      const variable = that.machine.variables[requestIndex];
      if (_.get(variable, 'requestType', 'variable') !== 'variable') {
        // get the attribute value
        switch (variable.requestType) {
          case 'vendor ID':
          case 'device type':
          case 'product code':
          case 'serial number':
          case 'status':
            resultValue = data.readUInt16LE(ATTRIBUTE_DATA_INDEX);
            break;
          case 'revision':
            resultValue = [data[ATTRIBUTE_DATA_INDEX], data[ATTRIBUTE_DATA_INDEX + 1]];
            break;
          case 'product name':
            resultValue = data.toString('utf8', ATTRIBUTE_DATA_INDEX);
            break;
          default:
        }
      } else {
        // get the variable value or values for an array
        // get the type of result data
        const dataType = data[VARIABLE_DATA_TYPE_INDEX];
        // read the values or values based on the type
        let iVal; let nVals; let low; let
          temp;
        switch (dataType) {
          case 0xC1: // boolean
            nVals = Math.floor((data.length - VARIABLE_DATA_INDEX) / 2);
            if (nVals === 1) {
              // eslint-disable-next-line no-bitwise
              resultValue = (data[VARIABLE_DATA_INDEX] & 1) === 1;
            } else {
              resultValue = [];
              for (iVal = 0; iVal < nVals; iVal += 1) {
                resultValue.push(data[VARIABLE_DATA_INDEX + (2 * iVal)] === 1);
              }
            }
            break;
          case 0xC2: // 1 byte signed
            nVals = Math.floor((data.length - VARIABLE_DATA_INDEX) / 2);
            if (nVals === 1) {
              resultValue = data.readInt8(VARIABLE_DATA_INDEX);
            } else {
              resultValue = [];
              for (iVal = 0; iVal < nVals; iVal += 1) {
                resultValue.push(data.readInt8(VARIABLE_DATA_INDEX + (2 * iVal)));
              }
            }
            break;
          case 0xC3: // 1 word signed
            nVals = Math.floor((data.length - VARIABLE_DATA_INDEX) / 2);
            if (nVals === 1) {
              resultValue = data.readInt16LE(VARIABLE_DATA_INDEX);
            } else {
              resultValue = [];
              for (iVal = 0; iVal < nVals; iVal += 1) {
                resultValue.push(data.readInt16LE(VARIABLE_DATA_INDEX + (2 * iVal)));
              }
            }
            break;
          case 0xC4: // 2 word signed
            nVals = Math.floor((data.length - VARIABLE_DATA_INDEX) / 4);
            if (nVals === 1) {
              resultValue = data.readInt32LE(VARIABLE_DATA_INDEX);
            } else {
              resultValue = [];
              for (iVal = 0; iVal < nVals; iVal += 1) {
                resultValue.push(data.readInt32LE(VARIABLE_DATA_INDEX + (4 * iVal)));
              }
            }
            break;
          case 0xC5: // 4 word signed
            nVals = Math.floor((data.length - VARIABLE_DATA_INDEX) / 8);
            if (nVals === 1) {
              low = data.readInt32LE(VARIABLE_DATA_INDEX);
              resultValue = (data.readInt32LE(VARIABLE_DATA_INDEX + 4) * 4294967296.0) + low;
              if (low < 0) resultValue += 4294967296;
            } else {
              resultValue = [];
              for (iVal = 0; iVal < nVals; iVal += 1) {
                low = data.readInt32LE(VARIABLE_DATA_INDEX + (8 * iVal));
                temp = (data.readInt32LE(VARIABLE_DATA_INDEX + 4 + (8 * iVal)) * 4294967296.0)
                 + low;
                if (low < 0) temp += 4294967296;
                resultValue.push(temp);
              }
            }
            break;
          case 0xC6: // 1 byte unsigned
          case 0xD1: // 1 byte hexadecimal
            nVals = Math.floor((data.length - VARIABLE_DATA_INDEX) / 2);
            if (nVals === 1) {
              resultValue = data[VARIABLE_DATA_INDEX];
            } else {
              resultValue = [];
              for (iVal = 0; iVal < nVals; iVal += 1) {
                resultValue.push(data[VARIABLE_DATA_INDEX + (2 * iVal)]);
              }
            }
            break;
          case 0xC7: // 1 word unsigned
          case 0xD2: // 1 word hexadecimal
            nVals = Math.floor((data.length - VARIABLE_DATA_INDEX) / 2);
            if (nVals === 1) {
              resultValue = data.readUInt16LE(VARIABLE_DATA_INDEX);
            } else {
              resultValue = [];
              for (iVal = 0; iVal < nVals; iVal += 1) {
                resultValue.push(data.readUInt16LE(VARIABLE_DATA_INDEX + (2 * iVal)));
              }
            }
            break;
          case 0xC8: // 2 word unsigned
          case 0xD3: // 2 word hexadecimal
            nVals = Math.floor((data.length - VARIABLE_DATA_INDEX) / 4);
            if (nVals === 1) {
              resultValue = data.readUInt32LE(VARIABLE_DATA_INDEX);
            } else {
              resultValue = [];
              for (iVal = 0; iVal < nVals; iVal += 1) {
                resultValue.push(data.readUInt32LE(VARIABLE_DATA_INDEX + (4 * iVal)));
              }
            }
            break;
          case 0xC9: // 4 word unsigned
          case 0xD4: // 4 word hexadecimal
            nVals = Math.floor((data.length - VARIABLE_DATA_INDEX) / 8);
            if (nVals === 1) {
              resultValue = (data.readUInt32LE(VARIABLE_DATA_INDEX + 4) * 4294967296.0)
               + data.readUInt32LE(VARIABLE_DATA_INDEX);
            } else {
              resultValue = [];
              for (iVal = 0; iVal < nVals; iVal += 1) {
                resultValue.push((data.readUInt32LE(VARIABLE_DATA_INDEX + 4 + (8 * iVal))
                 * 4294967296.0) + data.readUInt32LE(VARIABLE_DATA_INDEX + (8 * iVal)));
              }
            }
            break;
          case 0xCA: // 2 word float
            nVals = Math.floor((data.length - VARIABLE_DATA_INDEX) / 4);
            if (nVals === 1) {
              resultValue = data.readFloatLE(VARIABLE_DATA_INDEX);
            } else {
              resultValue = [];
              for (iVal = 0; iVal < nVals; iVal += 1) {
                resultValue.push(data.readFloatLE(VARIABLE_DATA_INDEX + (4 * iVal)));
              }
            }
            break;
          case 0xCB: // 4 word float
            nVals = Math.floor((data.length - VARIABLE_DATA_INDEX) / 8);
            if (nVals === 1) {
              resultValue = data.readDoubleLE(VARIABLE_DATA_INDEX);
            } else {
              resultValue = [];
              for (iVal = 0; iVal < nVals; iVal += 1) {
                resultValue.push(data.readDoubleLE(VARIABLE_DATA_INDEX + (8 * iVal)));
              }
            }
            break;
          case 0xD0: // string - arrays of strings not currently supported
            resultValue = data.toString('utf8', VARIABLE_DATA_INDEX);
            break;
          default:
        }
      }
    } catch (err) {
      log.error('Error processing response data:', err.message);
    }

    // add the result to the results array
    resultsArray.push(resultValue);

    // send request for next let (if any left, else process whole array of results)
    requestIndex += 1;
    if (requestIndex === that.machine.variables.length) {
      updateConnectionStatus(true);
      bSendingActive = false;

      // save all results to the database
      saveResultsToDb();
    // if more variables, send the next requested for data
    } else {
      requestVariableValue(that.machine.variables[requestIndex]);
    }
  }

  function processResponseError() {
    // store a null result
    resultsArray.push(null);

    // send the next valid request, if any
    requestIndex += 1;
    while (requestIndex < that.machine.variables.length) {
      if (requestVariableValue(that.machine.variables[requestIndex])) {
        return;
      }

      // if an invalid request, store a null result
      resultsArray.push(null);
      requestIndex += 1;
    }

    // if not more valid requests, save the results to the database
    bSendingActive = false;
    updateConnectionStatus(true);
    saveResultsToDb();
  }

  function open(callback) {
    bOpeningConnection = true;

    const requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    const { port } = that.machine.settings.model;
    const host = that.machine.settings.model.hostName;
    protocolMode = _.get(that.machine.settings.model, 'mode', 'Omron');

    // if standard mode, create a controller and connect
    if (protocolMode === 'Standard') {
      client = new Controller();

      client.connect(`${host}:${port}`, 0).then(() => {
        updateConnectionStatus(true);
        alert.clear('plc-connect-error');

        // create the tags to read
        tagArray = [];
        for (let iVar = 0; iVar < that.machine.variables.length; iVar += 1) {
          const variable = that.machine.variables[iVar];
          // if this requesting a variable value, create a tag
          if (_.get(variable, 'requestType', 'variable') === 'variable') {
            // if variable has prograom scope, include the program name
            if (_.get(variable, 'programScope', false)) {
              tagArray.push(new Tag(variable.controllerVariable, variable.programName));
            } else {
              tagArray.push(new Tag(variable.controllerVariable));
            }
          } else {
            tagArray.push(null);
          }
        }

        // start the read timer
        readRequestTimer = setInterval(requestTimer, requestFrequencyMs);

        // trigger callback on succesful connection to server
        callback(null);
      })
        .catch((err) => {
          updateConnectionStatus(false);
          alert.raise({ key: 'plc-connect-error' });
          setupReconnect();
          callback(err);
        });
    } else {
      // if Omron mode, create a TCP client
      // try and connect to server
      client = net.createConnection(port, host, () => {
        // succesfully connected to server
        alert.clear('host-connect-error');
        bRegistering = true;

        // send register command to PLC
        const regBuf = Buffer.from(registerCmd);
        client.write(regBuf);

        // trigger callback on succesful connection to server
        callback(null);
      });

      client.on('error', (error) => {
        updateConnectionStatus(false);
        alert.raise({ key: 'host-connect-error', errorMsg: error.message });

        // call callback only if opening connection so not called twice
        if (bOpeningConnection) callback(error);
      });

      // subscribe to on 'data' events
      client.on('data', (data) => {
        // console.log('***** Buffer: ');
        // dumpBuffer(data);
        // if sent a request packet
        if (bSendingActive) {
          // if no error, process response
          if (data.readUInt32LE(RESPONSE_ERROR_CODE_INDEX) === 0) {
            processResponseData(data);
          } else {
            processResponseError();
          }
        } else if (bRegistering) {
          // if sent register session command, save session handle
          // and send connection command if no error
          bRegistering = false;
          if (data.readUInt32LE(RESPONSE_ERROR_CODE_INDEX) === 0) {
            // console.log('##### Registered');
            data.copy(sessionHandleBuf, 0, SESSION_HANDLE_INDEX, SESSION_HANDLE_INDEX + 4);

            bConnecting = true;
            connectionRetryCount = 0;
            const connBuf = Buffer.from(connectCmd);
            sessionHandleBuf.copy(connBuf, SESSION_HANDLE_INDEX);
            client.write(connBuf);

            alert.clear('plc-register-error');
          } else {
            alert.raise({ key: 'plc-register-error' });
          }
        } else if (bConnecting) {
          // if sent connection command, save connection ID and start timer if no error
          if ((data.readUInt32LE(RESPONSE_ERROR_CODE_INDEX) === 0)
           && (data.readUInt16LE(CONNECTION_ERROR_CODE_INDEX) === 0)) {
            bConnecting = false;
            // console.log('>>>>> Connected');

            data.copy(connectionIDBuf, 0, CONNECTION_ID_RESP_INDEX, CONNECTION_ID_RESP_INDEX + 4);

            readRequestTimer = setInterval(requestTimer, requestFrequencyMs);

            updateConnectionStatus(true);
            alert.clear('plc-connect-error');
          } else if (connectionRetryCount < CONNECTION_MAX_RETRYS) {
            // if error but not too many retrys, retry the connection
            connectionRetryCount += 1;
            setTimeout(() => {
              const connBuf = Buffer.from(connectCmd);
              sessionHandleBuf.copy(connBuf, SESSION_HANDLE_INDEX);
              if (client !== null) client.write(connBuf);
            }, CONNECTION_RETRY_TIME);
          } else {
            alert.raise({ key: 'plc-connect-error' });
            setupReconnect();
          }
        }
      });

      // subscribe to on 'end' events
      client.on('end', () => {
        updateConnectionStatus(false);
        // this is this getting called, when we stop the machine, but also when we kill the server
        log.info('Disconnected from machine.  Automatic reconnect scheduled');

        setupReconnect();
      });
    }
  }

  // Privileged methods
  this.start = function start(dataCb, configUpdateCb, done) {
    updateConnectionStatus(false);

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

    bSendingActive = false;
    requestBlockedCounter = 0;

    open((err) => {
      if (err) {
        return done(err);
      }

      log.info('Started');
      bOpeningConnection = false;
      return done(null);
    });

    return undefined;
  };

  this.stop = function stop(done) {
    updateConnectionStatus(false);

    if (!that.machine) {
      alert.clearAll(() => done(null));
    }

    // stop the request timer task (if being used)
    if (readRequestTimer) {
      clearInterval(readRequestTimer);
      readRequestTimer = null;
    }

    // stop the reconnect timer (if being used)
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // destroy the client
    if (client) {
      if (protocolMode === 'Omron') {
        client.destroy();
      }
      client = null;
    }

    log.info('Stopped');
    alert.clearAll(() => done(null));
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
  hpl: hplEthernetIP,
  defaults,
  schema,
};
