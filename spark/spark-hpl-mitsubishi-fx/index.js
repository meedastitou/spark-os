/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
let SerialPort = require('serialport');
let mcprotocol1E = require('mcprotocol');
let mcprotocol3E = require('./mcprotocol/mcprotocol-3e');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplMitsubishiFx = function hplMitsubishiFx(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'connect-error': {
      msg: 'Mitsubishi FX: Could not Connect to the Host',
      description: x => `An error occurred while trying to connect to the host. Error: ${x.errorMsg}`,
    },
    'request-ignored': {
      msg: 'Mitsubishi FX: New Request Ignored',
      description: 'New request ignored as still processing last request. Check the serial port configuration and connection.',
    },
    'error-response': {
      msg: 'Mitsubishi FX: Error Response to Request',
      description: x => `Got error response: ${x.errorMsg} for request.`,
    },
    'incorrect-station-number': {
      msg: 'Mitsubishi FX: Incorrect Station Number in Response',
      description: x => `Got incorrect station number: ${x.stationNum} in response.`,
    },
    'incorrect-plc-number': {
      msg: 'Mitsubishi FX: Incorrect PLC Number in Response',
      description: x => `Got incorrect PLC number: ${x.plcNum} in response.`,
    },
    'incorrect-checksum': {
      msg: 'Mitsubishi FX: Incorrect Checksum in Response',
      description: x => `Corrupt response checksum mismatch. Received: ${x.respChecksum}, but calculated: ${x.calcChecksum}.`,
    },
    'missing-stx': {
      msg: 'Mitsubishi FX: Response Does Not Start with STX',
      description: 'Response does not start with STX.',
    },
    'too-much-data': {
      msg: 'Mitsubishi FX: Too Much Data in Response',
      description: 'Response contains too much data.',
    },
    'database-error': {
      msg: 'Mitsubishi FX: Error Writing to Database',
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
    'close-error': {
      msg: 'Mitsubishi FX: Error Closing Connection',
      description: x => `An error occurred while trying to close the connection to the PLC. Error: ${x.errorMsg}`,
    },
  });

  // Private variables
  let bEthernetInterface = false;
  let sendingActive = false;
  const that = this;
  let timer = null;
  let requestFrequencyMs;
  let resultsArray = [];
  let requestIndex = 0;
  let requestBlockedCounter = 0;
  let variableRequests = [];
  let ackMessage;
  let nakMessage;
  let addChecksum = false;
  let addCrLf = false;
  let stationNum;
  let responseBuffer = '';
  let expectedErrorLength;
  const conversionBuf = Buffer.alloc(4);

  let MCConnection = null;
  let bMCConnected = false;
  let MCItemsToAdd = [];
  let variableReadArray = [];
  let variableWriteRequests = [];
  let disconnectedTimer = null;
  let connectionReported = false;

  const STX = '\u0002';
  const ENQ = '\u0005';
  const ACK = '\u0006';
  const LF = '\u000A';
  const CR = '\u000D';
  const NAK = '\u0015';

  const HEAD_DEVICE_LENGTH = 5;

  const BIT_PAYLOAD_LENGTH = 1;
  const WORD_PAYLOAD_LENGTH = 4;
  const BASE_PAYLOAD_OVERHEAD = 6;
  const PAYLOAD_OVERHEAD_CHECKSUM = 2;
  const PAYLOAD_OVERHEAD_CRLF = 2;

  const ERROR_RESPONSE_LENGTH_NO_CRLF = 7;
  const ERROR_RESPONSE_LENGTH_WITH_CRLF = 9;

  const BATCH_READ_BIT = 'BR';
  const BATCH_READ_WORD = 'WR';
  const BATCH_WRITE_BIT = 'BW';
  const BATCH_WRITE_WORD = 'WW';
  const PLC_NUM = 'FF';
  const MSG_WAIT_TIME = '1'; // 10 ms
  const READ_LENGTH = '01';
  const READ_LENGTH_WORD_32 = '02';

  const ACK_DELAY_MS = 20;
  const NEXT_REQ_DELAY_MS = 20;

  const RES_ERROR_CODE_OFFSET = 5;
  const RES_ERROR_CODE_LENGTH = 2;
  const RES_STATION_NUMBER_OFFSET = 1;
  const RES_STATION_NUMBER_LENGTH = 2;
  const RES_PLC_NUMBER_OFFSET = 3;
  const RES_PLC_NUMBER_LENGTH = 2;
  const RES_PAYLOAD_DATA_OFFSET = 5;
  const RES_CHECKSUM_AREA_START_OFFSET = 1;
  const ETX_LEN = 1;

  const RADIX_HEX = 16;
  const PAYLOAD_WRITE_DATA_STRING = '$DATA$';

  // public variables
  that.serialPort = null;
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line global-require
    SerialPort = require('virtual-serialport');
    // eslint-disable-next-line global-require
    mcprotocol1E = require('./test/msprotocol-tester');
    mcprotocol3E = mcprotocol1E;
    this.tester = mcprotocol1E;
  }

  // for old machines: make sure that they operate as before - as big endian
  if (!_.has(that.machine.settings.model, 'highByteFirst')) {
    that.machine.settings.model.highByteFirst = true;
  }
  if (!_.has(that.machine.settings.model, 'highWordFirst')) {
    that.machine.settings.model.highWordFirst = true;
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

  // private methods

  // helper function to generate a checksum over a string input
  function calulateChecksumString(stringInput) {
    // place string into a buffer object
    const inputBuf = Buffer.from(stringInput);
    // calculate the checksum over each element in the buffer
    let checksum = 0;
    for (let iBuf = 0; iBuf < inputBuf.length; iBuf += 1) {
      checksum += inputBuf[iBuf];
    }
    // extract the lower byte from the result
    // eslint-disable-next-line no-bitwise
    checksum &= 0xff;

    let checksumString = checksum.toString(16).toUpperCase();
    if (checksumString.length === 1) {
      checksumString = `0${checksumString}`;
      console.log('--------------------------- PREPENDED 0 TO CHECKSUM STRING');
    }
    // convert to a hex string
    return checksumString;
  }

  // helper function to save array of collected results to the database
  function saveResultsToDb() {
    if (bEthernetInterface) {
      // read the values of the added items
      MCConnection.readAllItems((err, values) => {
        async.forEachOfSeries(MCItemsToAdd, (item, index, callback) => {
          let itemValue = values[item];
          const variable = variableReadArray[index];

          // if there wasn't a result
          if (itemValue === null) {
            // highlight that there was an error getting this variables data
            alert.raise({
              key: `read-fail-${variable.name}`,
              msg: 'Mitsubishi FX: Read Failed for Variable',
              description: `Read failed for variable '${variable.name}'. Check that this variable is defined correctly in the machine.`,
            });
            // and just move onto next item
            return callback();
          }

          alert.clear(`read-fail-${variable.name}`);

          // do some conversions not supported by mcprotocol
          switch (variable.format) {
            // convert int16 to int8
            case 'int8':
              conversionBuf.writeInt16LE(itemValue, 0);
              itemValue = conversionBuf.readInt8(0);
              break;
              // convert int16 to uint8
            case 'uint8':
              conversionBuf.writeInt16LE(itemValue, 0);
              itemValue = conversionBuf.readUInt8(0);
              break;
              // convert int16 to uint16
            case 'uint16':
              conversionBuf.writeInt16LE(itemValue, 0);
              itemValue = conversionBuf.readUInt16LE(0);
              break;
              // convert int32 to uinit32 or int64 or uint64 (upper word 0 for 64-bit)
            case 'uint32':
            case 'uint64':
            case 'int64':
              conversionBuf.writeInt32LE(itemValue, 0);
              itemValue = conversionBuf.readUInt32LE(0);
              break;
              // if number being returned as bool convert to true/false based on least sig bit
            case 'bool':
              if ((itemValue !== true) && (itemValue !== false)) {
                // eslint-disable-next-line no-bitwise
                itemValue = (itemValue & 1) !== 0;
              }
              break;
              // otherwise, no conversion required
            default:
          }

          // othewise update the database
          that.dataCb(that.machine, variable, itemValue, (dbErr, res) => {
            if (dbErr) {
              alert.raise({ key: 'database-error', errorMsg: err.message });
            } else {
              alert.clear('database-error');
            }
            if (res) log.debug(res);
            // move onto next item once stored in db
            callback();
          });

          return undefined;
        });
      });
    } else {
      // process the array of results
      async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
        // if there wasn't a result
        const variable = variableReadArray[index];
        if (dataItem === null) {
          // highlight that there was an error getting this variables data
          alert.raise({
            key: `read-fail-${variable.name}`,
            msg: 'Mitsubishi FX: Read Failed for Variable',
            description: `Read failed for variable '${variable.name}'. Check that this variable is defined correctly in the machine.`,
          });
          // and just move onto next item
          return callback();
        }

        alert.clear(`read-fail-${variable.name}`);

        // othewise update the database
        that.dataCb(that.machine, variable, dataItem, (err, res) => {
          if (err) {
            alert.raise({ key: 'database-error', errorMsg: err.message });
          } else {
            alert.clear('database-error');
          }
          if (res) log.debug(res);
          // move onto next item once stored in db
          callback();
        });

        return undefined;
      });
    }
  }

  function disconnectDetected() {
    // ignore disconectiong if already know disconnected
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

  function requestTimer() {
    if (bEthernetInterface) {
      // save the values of the added items to the database
      saveResultsToDb();
    } else if ((sendingActive === false) || (requestBlockedCounter > 3)) {
      // only start a new request if previous set has finished
      // (although allow for failed response by adding a counter )
      alert.clear('request-ignored');
      connectionDetected();
      updateConnectionStatus(true);

      // reset storage and index for starting a new request set
      requestBlockedCounter = 0;
      requestIndex = 0;
      resultsArray = [];
      responseBuffer = '';

      if (that.serialPort.isOpen) {
        // make a serial request for first var in list
        sendingActive = true;

        that.serialPort.write(variableRequests[0].variableRequestPayload);

        // now wait for processResponseData method to be called by 'on data'
      }
    } else {
      requestBlockedCounter += 1;
      alert.raise({ key: 'request-ignored' });
      disconnectDetected();
      updateConnectionStatus(false);
    }
  }

  // helper function to send request message for next variable in the list
  function sendRequestForNextVariable() {
    // first check if there are any more variables to request data for
    requestIndex += 1;
    if (requestIndex !== variableRequests.length) {
      // if there is, send the next request (after a short delay)
      setTimeout(() => {
        that.serialPort.write(variableRequests[requestIndex].variableRequestPayload);
      }, NEXT_REQ_DELAY_MS);
    } else {
      // otherwise, update the flag
      sendingActive = false;
      // and save all variabel value results to the database
      saveResultsToDb();
    }
  }

  function processResponseData(data) {
    // only attempt processing if we are expecting it
    if (sendingActive === true) {
      let valueToStore = null;
      let continueProcessing = false;
      let gotNak = false;

      // append new data to response buffer (may not get all the data we need at once)
      responseBuffer += data.toString();

      // check for an error response (nitial byte should be a NAK)
      if ((responseBuffer.length === expectedErrorLength) && (responseBuffer[0] === NAK)) {
        // extract the error code and log the error
        const errorCode = responseBuffer.slice(RES_ERROR_CODE_OFFSET,
          RES_ERROR_CODE_OFFSET + RES_ERROR_CODE_LENGTH);
        alert.raise({ key: 'error-response', errorMsg: errorCode });
        gotNak = true;
      } else if (responseBuffer.length === variableRequests[requestIndex].expectedResponseLength) {
        // check initial byte is correct
        if (responseBuffer[0] === STX) {
          alert.clear('missing-stx');

          // check station number
          const responseStationNumber = responseBuffer.slice(RES_STATION_NUMBER_OFFSET,
            RES_STATION_NUMBER_OFFSET + RES_STATION_NUMBER_LENGTH);
          if (responseStationNumber !== stationNum) {
            alert.raise({ key: 'incorrect-station-number', stationNum: responseStationNumber });
          } else {
            alert.clear('incorrect-station-number');
            // check plc number
            const responsePlcNumber = responseBuffer.slice(RES_PLC_NUMBER_OFFSET,
              RES_PLC_NUMBER_OFFSET + RES_PLC_NUMBER_LENGTH);
            if (responsePlcNumber !== PLC_NUM) {
              alert.raise({ key: 'incorrect-plc-number', plcNum: responsePlcNumber });
            } else {
              alert.clear('incorrect-plc-number');
              // if we need to check the checksum
              if (addChecksum === true) {
                // retrieve the checksum sent with the response
                const responseChecksumOffset = addCrLf ? responseBuffer.length
                 - (PAYLOAD_OVERHEAD_CHECKSUM + PAYLOAD_OVERHEAD_CRLF)
                  : responseBuffer.length - PAYLOAD_OVERHEAD_CHECKSUM;
                const responseChecksum = responseBuffer.slice(responseChecksumOffset,
                  responseChecksumOffset + PAYLOAD_OVERHEAD_CHECKSUM);

                // calculate the checksum over the correct area of the response
                const responseChecksumInput = responseBuffer.slice(RES_CHECKSUM_AREA_START_OFFSET,
                  responseChecksumOffset);
                const calculatedChecksum = calulateChecksumString(responseChecksumInput);

                // compare the sent checksum with the calculated one
                if (responseChecksum !== calculatedChecksum) {
                  alert.raise({ key: 'incorrect-checksum', respChecksum: responseChecksum, calcChecksum: calculatedChecksum });
                } else {
                  alert.clear('incorrect-checksum');
                  continueProcessing = true;
                }
              } else {
                // all test passed, we should have valid data
                continueProcessing = true;
              }
            }
          }
        } else {
          // log an error
          alert.raise({ key: 'missing-stx' });
        }
      } else if (responseBuffer.length > variableRequests[requestIndex].expectedResponseLength) {
        // log an error
        alert.raise({ key: 'too-much-data' });
      } else {
        // just wait for more data to arrive
        alert.clear('too-much-data');
        return;
      }

      // if we have a valid payload in the response, extract it
      if (continueProcessing === true) {
        // calulate an index to the end of the payload, depends on whether
        // checksum and crlf are added in the response
        let responsePayloadDataEndOffset = responseBuffer.length - ETX_LEN;
        responsePayloadDataEndOffset = addChecksum
          ? responsePayloadDataEndOffset - PAYLOAD_OVERHEAD_CHECKSUM : responsePayloadDataEndOffset;
        responsePayloadDataEndOffset = addCrLf
          ? responsePayloadDataEndOffset - PAYLOAD_OVERHEAD_CRLF : responsePayloadDataEndOffset;
        // extract the payload
        let responsePayload = responseBuffer.slice(RES_PAYLOAD_DATA_OFFSET,
          responsePayloadDataEndOffset);

        // if 1 or 2 word response correct the byte and word order,
        // if not high byte first and high word first
        if (responsePayload.length === 4) {
          if (!that.machine.settings.model.highByteFirst) {
            responsePayload = responsePayload[2] + responsePayload[3]
             + responsePayload[0] + responsePayload[1];
          }
        } else if (responsePayload.length === 8) {
          if (that.machine.settings.model.highByteFirst) {
            if (!that.machine.settings.model.highWordFirst) {
              responsePayload = responsePayload[4] + responsePayload[5]
               + responsePayload[6] + responsePayload[7]
               + responsePayload[0] + responsePayload[1]
               + responsePayload[2] + responsePayload[3];
            }
          } else if (that.machine.settings.model.highWordFirst) {
            responsePayload = responsePayload[2] + responsePayload[3]
             + responsePayload[0] + responsePayload[1]
             + responsePayload[6] + responsePayload[7]
             + responsePayload[4] + responsePayload[5];
          } else {
            responsePayload = responsePayload[6] + responsePayload[7]
            + responsePayload[4] + responsePayload[5]
            + responsePayload[2] + responsePayload[3]
            + responsePayload[0] + responsePayload[1];
          }
        }

        // response is encoded as a hex string, need to parse it to an int
        valueToStore = parseInt(responsePayload, RADIX_HEX);

        // convert value to a bool if variable format is a bool
        if (that.machine.variables[requestIndex].format === 'bool') {
          valueToStore = valueToStore !== 0;
        }
      }

      // store the variable in the results array (may be a null result)
      resultsArray.push(valueToStore);

      // clear the response buffer ready for the next response
      responseBuffer = '';

      // if we did not recieve a NAK from the machine, then respond
      if (gotNak === false) {
        // after a short delay
        setTimeout(() => {
          // send an ACK or NAK message depending on whether we processed the data without errror
          const ackorNakMsg = continueProcessing === true ? ackMessage : nakMessage;
          that.serialPort.write(ackorNakMsg, () => {
            // then, if neccesary send request for next variable in list
            sendRequestForNextVariable();
          });
        }, ACK_DELAY_MS);

        alert.clear('error-response');
      } else {
        // if we received a NAK, just attempt to send request for next variable in list
        sendRequestForNextVariable();
      }
    }
  }

  function open(callback) {
    requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    bEthernetInterface = that.machine.settings.model.interface === 'ethernet';
    const { variables } = that.machine;
    let memoryArea; let
      address;
    let access;

    if (bEthernetInterface) {
      // form the array of requests to be sent
      MCItemsToAdd = [];
      variableWriteRequests = [];
      for (let i = 0; i < variables.length; i += 1) {
        // add 32-bit modifiers, if required (unsigned handled when results obtained,
        // since not handled by mcprotocol, also 64-bit treated as 32-bit)
        const variable = variables[i];
        ({ memoryArea } = variable);
        ({ address } = variable);
        ({ access } = variable);
        if ((variable.format === 'int32') || (variable.format === 'uint32') || (variable.format === 'int64') || (variable.format === 'uint64')) {
          memoryArea += 'DINT';
        } else if ((variable.format === 'float') || (variable.format === 'double')) {
          memoryArea += 'FLOAT';
        }

        if (!_.has(variable, 'machineConnected') || !variable.machineConnected) {
          if (access === 'read') {
            MCItemsToAdd.push(memoryArea + address);
          } else {
            const varWriteArgs = {
              name: variable.name,
              memory: (memoryArea + address),
            };
            variableWriteRequests.push(varWriteArgs);
          }
        }
      }

      // convert the write variable memory access  data to an object for easy searching
      that.variableWriteRequests = _.keyBy(variableWriteRequests, 'name');

      // create the arguments for the ConnectionPool
      const bAscii = that.machine.settings.model.mode === 'ASCII';
      const connectionArgs = {
        port: that.machine.settings.model.port,
        host: that.machine.settings.model.hostName,
        ascii: bAscii,
      };

      // create a connection to th e PLC, using the 1E or 3E frame type MC protocol,
      // as selected by the user
      if (MCConnection === null) {
        if (that.machine.settings.model.frame === '1E') {
          // eslint-disable-next-line new-cap
          MCConnection = new mcprotocol1E();
        } else {
          // eslint-disable-next-line new-cap
          MCConnection = new mcprotocol3E();
        }
      }
      try {
        MCConnection.initiateConnection(connectionArgs, (err) => {
          if (typeof (err) !== 'undefined') {
            alert.raise({ key: 'connect-error', errorMsg: err.message });
            disconnectDetected();
            updateConnectionStatus(false);
            return callback(err);
          }
          alert.clear('connect-error');
          connectionDetected();
          updateConnectionStatus(true);
          bMCConnected = true;

          // add the items to the mcprotocol internal polling list
          MCConnection.addItems(MCItemsToAdd);

          timer = setInterval(requestTimer, requestFrequencyMs);

          return callback(null);
        });
      } catch (err) {
        alert.raise({ key: 'connect-error', errorMsg: err.message });
        disconnectDetected();
        updateConnectionStatus(false);
        return callback(err);
      }
    } else {
      addCrLf = that.machine.settings.model.format === 'Format 4';
      addChecksum = that.machine.settings.model.checksum;
      stationNum = (`0${that.machine.settings.model.stationNumber.toString(16)}`).slice(-2);

      // form the ACK and NAK mesages we will need to send back in response to responses
      ackMessage = addCrLf ? ACK + stationNum + PLC_NUM + CR + LF : ACK + stationNum + PLC_NUM;
      nakMessage = addCrLf ? NAK + stationNum + PLC_NUM + CR + LF : NAK + stationNum + PLC_NUM;

      // form the array of requests to be sent
      variableWriteRequests = [];
      for (let i = 0; i < variables.length; i += 1) {
        // check if we need to pad or shorten address to get the combined length of 5 bytes
        ({ memoryArea } = variables[i]);
        ({ address } = variables[i]);
        ({ access } = variables[i]);

        // do not allow new memry areas 'R' and 'SD', or bit-mapped requests (1234.1) since we
        // have not investigated the creation of the query string for these.  Likewise with
        // addresses longer than 4 characters.  These are currently only implemented for ethernet.
        if ((memoryArea !== 'R') && (memoryArea !== 'SD') && (address.length <= 4) && (address.indexOf('.') === -1)) {
          if (memoryArea.length + address.length < HEAD_DEVICE_LENGTH) {
            address = (`0000${address}`).slice(-(HEAD_DEVICE_LENGTH - memoryArea.length));
          } else if (memoryArea.length + address.length > HEAD_DEVICE_LENGTH) {
            address = address.slice((memoryArea.length + address.length - 5));
          }
          const headDevice = memoryArea + address;

          // set the message length (will be 1 for all types except word reads that are for
          // 32bit format variables )
          let readLength = READ_LENGTH;

          // calculate the expected response length based on the request type and whether
          // addChecksum and crlf is used, and set the command string
          let expectedResponseLength;
          let commandString;
          switch (memoryArea) {
            case 'X':
            case 'Y':
            case 'M':
            case 'S':
            case 'TS':
            case 'CS':
            {
              // set the expected response length for a bit request
              expectedResponseLength = BIT_PAYLOAD_LENGTH + BASE_PAYLOAD_OVERHEAD;
              expectedResponseLength = addChecksum
                ? expectedResponseLength + PAYLOAD_OVERHEAD_CHECKSUM : expectedResponseLength;
              expectedResponseLength = addCrLf
                ? expectedResponseLength + PAYLOAD_OVERHEAD_CRLF : expectedResponseLength;
              // set the command string
              if (variables[i].access === 'read') {
                commandString = BATCH_READ_BIT;
              } else {
                commandString = BATCH_WRITE_BIT;
              }
              break;
            }
            case 'D':
            case 'TN':
            case 'CN':
            {
              // set the expected response length for a word request
              expectedResponseLength = WORD_PAYLOAD_LENGTH + BASE_PAYLOAD_OVERHEAD;
              expectedResponseLength = addChecksum
                ? expectedResponseLength + PAYLOAD_OVERHEAD_CHECKSUM : expectedResponseLength;
              expectedResponseLength = addCrLf
                ? expectedResponseLength + PAYLOAD_OVERHEAD_CRLF : expectedResponseLength;

              // certain areas of the counter regs return 32 bit values, take this into account
              const addressNum = parseInt(address, 10);
              if (memoryArea === 'CN' && ((addressNum >= 200) && (addressNum <= 255))) {
                expectedResponseLength += WORD_PAYLOAD_LENGTH;
              } else if (variables[i].format === 'uint32' || variables[i].format === 'int32') {
                // also if 32bit value requested we will set the read length to 2 and
                // therefore the payload will be for a 32bit return value too
                readLength = READ_LENGTH_WORD_32;
                expectedResponseLength += WORD_PAYLOAD_LENGTH;
              }

              // set the command string
              if (access === 'read') {
                commandString = BATCH_READ_WORD;
              } else {
                commandString = BATCH_WRITE_WORD;
              }
              break;
            }
            default:
              break;
          }

          // if an error occurs we will get a NAK repsonse of a certain length
          expectedErrorLength = addCrLf
            ? ERROR_RESPONSE_LENGTH_WITH_CRLF : ERROR_RESPONSE_LENGTH_NO_CRLF;

          // form the message payload (initially just area that will be checksumed)
          let variableRequestPayload = stationNum + PLC_NUM
           + commandString + MSG_WAIT_TIME + headDevice + readLength;

          // including '$DATA$' in the write-back enabled payload in order
          // to replace it with actual data in write function
          if (access === 'write') {
            variableRequestPayload += PAYLOAD_WRITE_DATA_STRING;
          }

          // calculate and add checksum if required
          if (addChecksum) {
            variableRequestPayload += calulateChecksumString(variableRequestPayload);
          }
          // add initial ENQ
          variableRequestPayload = ENQ + variableRequestPayload;
          //  add CR LF if required
          if (addCrLf) {
            variableRequestPayload = variableRequestPayload + CR + LF;
          }

          // form the request object from the gathered information
          const variableRequestInfo = { variableRequestPayload, expectedResponseLength };
          // store each request in the array
          if (!_.has(variables[i], 'machineConnected') || !variables[i].machineConnected) {
            if (access === 'read') {
              variableRequests.push(variableRequestInfo);
            } else {
              //                            variableWriteRequests.push(variableRequestInfo);
              variableWriteRequests.push({
                name: variables[i].name,
                variableRequestPayload,
              });
            }
          }
        }
      }

      // convert the write variable memory access  data to an object for easy searching
      that.variableWriteRequests = _.keyBy(variableWriteRequests, 'name');

      // get the serial specific configuration
      const { device } = that.machine.settings.model;
      const baudRate = parseInt(that.machine.settings.model.baudRate, 10);
      const dataBits = that.machine.settings.model.dataBits === '7 bit' ? 7 : 8;
      const stopBits = that.machine.settings.model.stopBits === '1 bit' ? 1 : 2;
      const { parity } = that.machine.settings.model;

      // create a serial port with the correct configuration
      that.serialPort = new SerialPort(device, {
        baudRate,
        dataBits,
        stopBits,
        parity,
        autoOpen: false,
      });

      // attempt to open the serial port
      that.serialPort.open((err) => {
        if (err) {
          alert.raise({ key: 'connect-error', errorMsg: err.message });
          disconnectDetected();
          updateConnectionStatus(false);
          return callback(err);
        }

        alert.clear('connect-error');
        connectionDetected();
        updateConnectionStatus(true);
        // read data that is available but keep the stream from entering "flowing mode"
        that.serialPort.on('readable', () => {
          const data = that.serialPort.read();
          processResponseData(data);
        });

        // subscribe to on 'close' events
        that.serialPort.on('close', () => {
          log.debug('Serial port closed');

          // stop the request timer task
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          // reset flags
          sendingActive = false;
        });

        // start the request timer
        timer = setInterval(requestTimer, requestFrequencyMs);

        return callback(null);
      });
    }

    return undefined;
  }


  function close(callback) {
    if (bEthernetInterface) {
      disconnectDetected();
      updateConnectionStatus(false);
      if (bMCConnected) {
        MCConnection.dropConnection();
        callback();
      } else {
        callback();
      }
    } else if (that.serialPort.isOpen) {
      // if we are currently in a request/response cycle
      if ((sendingActive === true)) {
        // hold off on closing using an interval timer
        let waitCounter = 0;
        const activeWait = setInterval(() => {
          // until safe to do so
          if ((sendingActive === false) || (waitCounter > 20)) {
            clearInterval(activeWait);
            sendingActive = false;
            that.serialPort.close(callback);
          }
          waitCounter += 1;
        }, 100); // interval set at 100 milliseconds
      } else {
        // otherwise close immeditalely
        that.serialPort.close(callback);
      }
      disconnectDetected();
      updateConnectionStatus(false);
    } else {
      disconnectDetected();
      updateConnectionStatus(false);
      callback();
    }
  }

  this.writeData = function writeData(value, done) {
    const variableName = value.variable;

    const data = _.get(that.variablesObj, variableName, null);

    const MCItemToWrite = _.get(that.variableWriteRequests, variableName, null);
    if (data == null && MCItemToWrite == null) {
      return done();
    }

    if (bEthernetInterface) {
      MCConnection.writeItems(MCItemToWrite.memory, value[variableName], (error) => {
        if (error) {
          log.error({
            err: error,
          }, `writeback: Error in writing ${data.name} to ${value.machine}`);
          return done(error);
        }
        log.debug(`${data.name} has been written to the machine ${value.machine}`);
        return done(null);
      });
    } else {
      let payload = MCItemToWrite.variableRequestPayload;
      payload = _.replace(payload, PAYLOAD_WRITE_DATA_STRING,
        value[variableName].toString(16).toUpperCase());

      if (that.serialPort.isOpen) {
        that.serialPort.write(payload, (error) => {
          if (error) {
            log.error({
              err: error,
            }, `writeback: Error in writing ${data.name} to ${value.machine}`);
            return done(error);
          }
          log.debug(`${data.name} has been written to the machine ${value.machine}`);
          return done(null);
        });
      } else {
        return done(null);
      }
    }

    return undefined;
  };

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

    // convert the variables array to an object for easy searching
    that.variablesObj = _.keyBy(that.machine.variables, 'name');

    variableReadArray = [];
    async.forEachSeries(that.machine.variables, (item, callback) => {
      // skip machine connected variables
      if (!_.has(item, 'machineConnected') || !item.machineConnected) {
        if (!(item.access === 'write' || item.access === 'read')) {
          const variableWithAccess = item;
          variableWithAccess.access = 'read';
          variableReadArray.push(variableWithAccess);
        } else if (item.access === 'read') {
          variableReadArray.push(item);
        }
      }
      return callback();
    });

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
    if (!that.machine) {
      alert.clearAll(() => done('machine undefined'));
    }

    // stop the request timer task (if being used)
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    if (bEthernetInterface) {
      // close interface if open
      if (MCConnection) {
        close((err) => {
          if (err) {
            alert.raise({ key: 'close-error', errorMsg: err.message });
          } else {
            alert.clear('close-error');
          }
          MCConnection = null;
          bMCConnected = false;
          log.info('Stopped');
          alert.clearAll(() => done(null));
        });
      } else {
        log.info('Stopped');
        alert.clearAll(() => done(null));
      }
    } else if (that.serialPort) {
      // close interface if open
      close((err) => {
        if (err) {
          alert.raise({ key: 'close-error', errorMsg: err.message });
        } else {
          alert.clear('close-error');
        }
        that.serialPort = null;
        // reset flags
        sendingActive = false;
        // clear list of variables
        variableRequests = [];

        log.info('Stopped');
        alert.clearAll(() => done(null));
      });
    } else {
      // reset flags
      sendingActive = false;
      // clear list of variables
      variableRequests = [];

      log.info('Stopped');
      alert.clearAll(() => done(null));
    }
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
  hpl: hplMitsubishiFx,
  defaults,
  schema,
};
