/* jshint esversion: 6 */

const _ = require('lodash');
const async = require('async');
const net = require('net');
const dgram = require('dgram');
let SerialPort = require('serialport');

if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line global-require
  SerialPort = require('virtual-serialport');
}

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplYokogawa = function hplYokogawa(log, machine, model, conf, db, alert) {
  const CONNECTION_RETRY_FREQUENCY = 5000; // will try to reconnect  every 5 seconds
  const MAX_MISSED_RESPONSES = 3;
  const STX = '\u0002';
  const ETX = '\u0003';
  const CR = '\u000D';
  const LF = '\u000A';
  const RESPONSE_CODE_OK = 'OK';
  const ENET_PORT_A = 12289;
  const ENET_PORT_B = 12291;
  const WRITE_RESPONSE_OK = 0;
  const WRITE_RESPONSE_ERROR = 1;
  const WRITE_RESPONSE_POLL_TIME = 10;
  const WRITE_RESPONSE_TIMEOUT_COUNT = 2000 / WRITE_RESPONSE_POLL_TIME; // 2 second write timeout

  const COMMAND = '0';
  const BIT_READ_COMMAND = 0x01;
  const BIT_WRITE_COMMAND = 0x02;
  const WORD_READ_COMMAND = 0x11;
  const WORD_WRITE_COMMAND = 0x12;
  const DEVICE_TYPE_X_ATTRIBUTE = 0x0018;
  const DEVICE_TYPE_Y_ATTRIBUTE = 0x0019;
  const DEVICE_TYPE_I_ATTRIBUTE = 0x0009;
  const DEVICE_TYPE_E_ATTRIBUTE = 0x0005;
  const DEVICE_TYPE_M_ATTRIBUTE = 0x000D;
  const DEVICE_TYPE_T_ATTRIBUTE = 0x0014;
  const DEVICE_TYPE_C_ATTRIBUTE = 0x0003;
  const DEVICE_TYPE_L_ATTRIBUTE = 0x000C;
  const DEVICE_TYPE_D_ATTRIBUTE = 0x0004;
  const DEVICE_TYPE_B_ATTRIBUTE = 0x0002;
  const DEVICE_TYPE_R_ATTRIBUTE = 0x0012;
  const DEVICE_TYPE_V_ATTRIBUTE = 0x0016;
  const DEVICE_TYPE_Z_ATTRIBUTE = 0x001A;
  const DEVICE_TYPE_W_ATTRIBUTE = 0x0017;

  // Private variables
  const that = this;
  let opening = false;
  let sendingActive = false;
  let readingData = false;
  let readTimer = null;
  let writeTimer = null;
  let interfaceType;
  let messageFormat = '';
  let client = null;
  let port = ENET_PORT_A;
  let host = '';
  let variableReadArray = [];
  let variablesWriteObj = {};
  let resultsArray = [];
  let requestIndex = 0;
  let responseBufferString = '';
  let responseBuffer;
  let responseBufferByteCount;
  let missedResponseCount = 0;
  let writeResponse = WRITE_RESPONSE_OK;
  let usingChecksum = false;
  let usingCR = false;
  let variableRequests = [];
  let responseTerminator;
  let responseCodeLocation;
  let stationNumber; // serial only
  let cpuNumber;
  let nullDataIndex = null;
  let requestFrequencyMs = null;
  let connectTimer = null;
  let disconnectedTimer = null;
  let connectionReported = false;
  let disconnectionReported = false;
  let shuttingDown = false;
  let udpClientOpened = false;

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

  // if old "ethernet" interace selected, update to "Ethernet (TCP)" and save it in the config
  if (that.machine.settings.model.interface === 'ethernet') {
    that.machine.settings.model.interface = 'Ethernet (TCP)';

    conf.set(`machines:${that.machine.info.name}`, that.machine, () => {
    });
  }

  // Alert Objects
  alert.preLoad({
    'connection-error': {
      msg: `${machine.info.name}: Connection Error`,
      description: 'Not able to open connection. Please verify the configuration',
    },
    'request-key-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: x => `Variable ${x.variableName} does not have a request key`,
    },
    'invalid-command-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: x => `The request key for variable ${x.variableName} contains an unsupported command`,
    },
    'invalid-device-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: x => `The request key for variable ${x.variableName} contains an invalid device type`,
    },
    'invalid-address-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: x => `The request key for variable ${x.variableName} contains an invalid address`,
    },
    'invalid-count-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: x => `The request key for variable ${x.variableName} contains an invalid count`,
    },
    'data-null-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: x => `Failed to get the data for the variable ${x.variableName}`,
    },
    'write-data-error': {
      msg: `${machine.info.name}: Write Error`,
      description: x => `Failed to write data to the variable ${x.variableName}`,
    },
  });

  // private methods
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

  function stopConnectionErrorTimer() {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
      alert.clear('connection-error');
    }
  }

  function startConnectionErrorTimer() {
    // stop any existing timer first before we start a new one
    stopConnectionErrorTimer();

    // wait for 2 missed requests before we error
    connectTimer = setTimeout(() => {
      alert.raise({ key: 'connection-error' });
      connectTimer = null;
      disconnectionDetected();
      updateConnectionStatus(false);
    }, requestFrequencyMs * 2);
  }

  function disconnectReconnect() {
    if (!shuttingDown) {
      sendingActive = false;
      if (interfaceType === 'Ethernet (TCP)') {
        if (client) client.destroy();
      } else if (interfaceType === 'Ethernet (UDP)') {
        if (client) client.close();
      } else if (that.serialPort.isOpen) {
        that.serialPort.close();
      }
      disconnectionDetected();
      updateConnectionStatus(false);
      if (readTimer) {
        clearInterval(readTimer);
        readTimer = null;
      }
      setTimeout(() => {
        if (!shuttingDown) {
          // eslint-disable-next-line no-use-before-define
          open(() => {
            log.error({
              err: 'connection failed! retrying ...',
            });
          });
        }
      }, CONNECTION_RETRY_FREQUENCY);
    }
  }

  function requestTimer() {
    // only start a new request if previous set has finished (although allow for failed
    // response by adding a counter )
    if (sendingActive === false) {
      // reset storage and index for starting a new request set
      missedResponseCount = 0;
      requestIndex = 0;
      resultsArray = [];
      responseBufferString = '';
      responseBufferByteCount = 0;
      readingData = true;

      if ((interfaceType === 'Ethernet (TCP)') && (client !== null)) {
        // make a tcp request for first var in list
        sendingActive = true;
        client.write(variableRequests[0]);

        // now wait for processResponseData method to be called by 'on data'
      } else if ((interfaceType === 'Ethernet (UDP)') && (client !== null)) {
        // make a tcp request for first var in list
        sendingActive = true;
        client.send(variableRequests[0], port, host);

        // now wait for processResponseData method to be called by 'on message'
      } else if ((interfaceType === 'serial') && (that.serialPort.isOpen)) {
        // make a serial request for first var in list
        sendingActive = true;
        that.serialPort.write(variableRequests[0], (err) => {
          if (err) {
            log.error(`Error sending request: ${err}`);
            sendingActive = false;
          }
        });

        // now wait for processResponseData method to be called by 'on data'
      }
    } else if (readingData) {
      // if too many missed responses, try to disconnect and reconnect
      missedResponseCount += 1;
      if (missedResponseCount >= MAX_MISSED_RESPONSES) {
        alert.raise({ key: 'connection-error' });
        disconnectReconnect();
      }
    }
  }
  // helper function to convert a string formatted result into its correct 'format'
  function convertStringResult(format, array, resultString) {
    let result = null;
    if (resultString !== null) {
      // if this is an array (but not string), recursively build it
      if (array && (format !== 'char')) {
        let bytesPerElem;
        switch (format) {
          case 'bool':
            bytesPerElem = 1;
            break;
          case 'int8':
          case 'uint8':
          case 'int16':
          case 'uint16':
            bytesPerElem = 4;
            break;
          case 'int32':
          case 'uint32':
            bytesPerElem = 8;
            break;
          case 'int64':
          case 'uint64':
            bytesPerElem = 16;
            break;
          default:
            bytesPerElem = resultString.length;
        }

        const resultArray = [];
        for (let iChar = 0; iChar < resultString.length; iChar += bytesPerElem) {
          resultArray.push(convertStringResult(format, false,
            resultString.substr(iChar, bytesPerElem)));
        }

        result = resultArray;
      } else {
        switch (format) {
          case 'char':
            result = resultString;
            break;

          case 'int8':
          case 'uint8':
          case 'int16':
          case 'uint16':
            // convert from the hex string
            result = parseInt(resultString, 16);
            break;

          case 'int32':
          case 'uint32': {
            // correct the word order
            const string32 = `${resultString.substr(4, 4)}${resultString.substr(0, 4)}`;
            // then convert from the hex string
            result = parseInt(string32, 16);
            break;
          }

          case 'int64':
          case 'uint64': {
            // correct the word order
            const string64 = `${resultString.substr(12, 4)}${resultString.substr(8, 4)}${resultString.substr(4, 4)}${resultString.substr(0, 4)}`;
            // convert from the hex string
            result = parseInt(string64, 16);
            break;
          }
          case 'float':
          case 'double':
            // interface cannot return floating point numbers
            result = null;
            break;

          case 'bool':
            result = (resultString === '1');
            break;
          default:
        }
      }
    }
    return result;
  }

  function convertBinaryResult(format, array, resultBuffer) {
    let result = null;
    // if this is an array (but not string), recursively build it
    if (array && (format !== 'char')) {
      let bytesPerElem;
      switch (format) {
        case 'bool':
          bytesPerElem = 1;
          break;
        case 'int8':
        case 'uint8':
        case 'int16':
        case 'uint16':
          bytesPerElem = 2;
          break;
        case 'int32':
        case 'uint32':
          bytesPerElem = 4;
          break;
        case 'int64':
        case 'uint64':
          bytesPerElem = 8;
          break;
        default:
          bytesPerElem = resultBuffer.length;
      }

      const resultArray = [];
      for (let iByte = 0; (iByte + bytesPerElem) <= resultBuffer.length; iByte += bytesPerElem) {
        resultArray.push(convertBinaryResult(format, false,
          resultBuffer.slice(iByte, iByte + bytesPerElem)));
      }

      result = resultArray;
    } else {
      try {
        switch (format) {
          case 'char':
            result = resultBuffer.toString('ascii');
            break;
          case 'int8':
            result = resultBuffer.readInt8(1);
            break;
          case 'uint8':
            result = resultBuffer.readUInt8(1);
            break;
          case 'int16':
            result = resultBuffer.readInt16BE(0);
            break;
          case 'uint16':
            result = resultBuffer.readUInt16BE(0);
            break;
          case 'int32':
          {
            // correct the word order
            const correctBuffer = Buffer.allocUnsafe(4);
            correctBuffer.writeUInt16BE(resultBuffer.readUInt16BE(2), 0);
            correctBuffer.writeUInt16BE(resultBuffer.readUInt16BE(0), 2);
            result = correctBuffer.readInt32BE(0);
            break;
          }
          case 'uint32':
          {
            // correct the word order
            const correctBuffer = Buffer.allocUnsafe(4);
            correctBuffer.writeUInt16BE(resultBuffer.readUInt16BE(2), 0);
            correctBuffer.writeUInt16BE(resultBuffer.readUInt16BE(0), 2);
            result = correctBuffer.readUInt32BE(0);
            break;
          }
          case 'int64':
          {
            // correct the word order
            const correctBuffer = Buffer.allocUnsafe(8);
            correctBuffer.writeUInt16BE(resultBuffer.readUInt16BE(6), 0);
            correctBuffer.writeUInt16BE(resultBuffer.readUInt16BE(4), 2);
            correctBuffer.writeUInt16BE(resultBuffer.readUInt16BE(2), 4);
            correctBuffer.writeUInt16BE(resultBuffer.readUInt16BE(0), 6);
            const low = correctBuffer.readInt32BE(4);
            result = (correctBuffer.readInt32BE(0) * 4294967296.0) + low;
            if (low < 0) result += 4294967296;
            break;
          }
          case 'uint64':
          {
            // correct the word order
            const correctBuffer = Buffer.allocUnsafe(8);
            correctBuffer.writeUInt16BE(resultBuffer.readUInt16BE(6), 0);
            correctBuffer.writeUInt16BE(resultBuffer.readUInt16BE(4), 2);
            correctBuffer.writeUInt16BE(resultBuffer.readUInt16BE(2), 4);
            correctBuffer.writeUInt16BE(resultBuffer.readUInt16BE(0), 6);
            result = (correctBuffer.readUInt32BE(0) * 4294967296.0)
                   + correctBuffer.readUInt32BE(4);
            break;
          }
          case 'float':
          case 'double':
            // interface cannot return floating point numbers
            result = null;
            break;
          case 'bool':
            result = (resultBuffer.readUInt8(0) === 1);
            break;
          default:
        }
      } catch (e) {
        result = null;
      }
    }
    return result;
  }

  // helper function used to extract the response value from the Yokogawa ASCII response
  function getValueFromResponse(format, array, respBufferString) {
    // Ethernet Response formats
    // OK Response Format is:    RES (1 byte) + CPU Num (1 Byte) + "OK" (2 Bytes) +
    //    Response Data + CR + LF
    // Error Response Format is: RES (1 byte) + CPU Num (1 Byte) + "ER" + Error Code 1 (2 bytes) +
    // Error Code 2 (2 Bytes) + Command (3 bytes) + CR + LF

    // Serial Response formats
    // OK Response Format is:     STX + Station Num (2 Bytes) + CPU Num (2 Bytes) +
    //   "   OK" (2 Bytes) + Response Data + Checksum (2 Bytes) + ETX + CR
    // Error Response Format is:  STX + Station Num (2 Bytes) + CPU Num (2 Bytes) + "ER" +
    //   Error Code 1 (2 bytes) + Error Code 2 (2 Bytes) + Command (3 bytes) + Checksum + ETX + CR
    // checksum and CR are optional based on PLC configuration

    // first test for error codes
    const responseCode = respBufferString.substr(responseCodeLocation, 2);
    if (responseCode !== RESPONSE_CODE_OK) {
      const errorCode1 = respBufferString.substr(responseCodeLocation + 2, 2);
      // certain type so of error have a 2nd more detailed error code
      if (errorCode1 === '03' || errorCode1 === '04' || errorCode1 === '05' || errorCode1 === '08' || errorCode1 === '41' || errorCode1 === '52') {
        log.error(`Error from PLC: ${responseCode}${errorCode1} Detailed Error Code: ${respBufferString.substr(responseCodeLocation + 4, 2)}`);
      } else {
        log.error(`Error from PLC: ${responseCode}${errorCode1}`);
      }
      return null;
    }

    let responseCPUNumber;
    let responseStationNumber;
    let lengthOfDataBlock;
    let dataBufferString;

    if (interfaceType === 'serial') {
      // for serial devices, check the station number and cpu number are correct
      responseStationNumber = respBufferString.substr(1, 2);
      responseCPUNumber = respBufferString.substr(3, 2);

      if ((responseStationNumber !== stationNumber) && (responseCPUNumber !== cpuNumber)) {
        log.error(`Station number (${responseStationNumber}) and CPU number (${responseCPUNumber}) do not match configured station number (${stationNumber}) and CPU Number (${cpuNumber}) `);
        return null;
      }

      // TODO should check the serial Checksum is valid here.

      // work out length of data response
      // front of header is 7 bytes (STX+Station Number + CPU Number + "OK")
      // footer is between 1 and 4 bytes (ETX+ Checksum + CR)
      lengthOfDataBlock = respBufferString.length - 7 - 1;
      lengthOfDataBlock = usingCR ? lengthOfDataBlock - 1 : lengthOfDataBlock;
      lengthOfDataBlock = usingChecksum ? lengthOfDataBlock - 2 : lengthOfDataBlock;

      // get the response data
      dataBufferString = respBufferString.substr(7, lengthOfDataBlock);
    } else {
      // for ethernet we only need to check the cpu number
      responseCPUNumber = respBufferString.substr(1, 1);

      if ((responseCPUNumber !== cpuNumber)) {
        log.error(`CPU number (${responseCPUNumber}) does not match configured CPU number (${cpuNumber})`);
        return null;
      }

      // work out length of data response
      lengthOfDataBlock = respBufferString.length - 4 - 2;
      // get the response data
      dataBufferString = respBufferString.substr(4, lengthOfDataBlock);
    }

    // convert payload string to result
    return convertStringResult(format, array, dataBufferString);
  }

  // helper function used to extract the response value from the Yokogawa binary response
  function getValueFromBinaryResponse(format, array, respBuffer) {
    // Ethernet Response formats
    // OK Response Format: Command (1 Byte) + CPU Num (1 Byte) + Length (2 Bytes) +
    //   Device Attribute (2 Bytes) + Device Number (4 Bytes) + Count (2 Bytes)
    // Error Response Format: Command with hight bit set (1 Byte) +
    //   Error Code (1 Byte) + Length (2 Bytes) + ...

    // first test for error codes
    const responseCode = respBuffer.readUInt8(1);
    if (responseCode !== 0) {
      log.error(`Error from PLC: ${responseCode}`);
      return null;
    }

    // convert payload buffer to result
    return convertBinaryResult(format, array, respBuffer.slice(4));
  }
  // helper function to save array of collected results to the database
  function saveResultsToDb() {
    // process the array of results
    async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
      // if there wasn't a result
      if (dataItem === null) {
        // highlight that there was an error getting this variables data
        alert.raise({ key: 'data-null-error', variableName: variableReadArray[index].name });
        nullDataIndex = index;
        // and just move onto next item
        return callback();
      }
      // To clear the alert if the data is received properly for the same variable
      // else alert wont stay in place (It will clear alert for the next proper variable)
      if ((nullDataIndex !== null) && (index === nullDataIndex)) {
        alert.clear('data-null-error');
        nullDataIndex = null;
      }

      // othewise update the database
      that.dataCb(that.machine, variableReadArray[index], dataItem, (err, res) => {
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

  function processResponseData(data) {
    // will be triggered for each repsonse to a request, assumes response is for last sent request

    // only attempt processing if we are expecting it
    if (sendingActive === true) {
      if (messageFormat === 'ASCII') {
        // append current buffer with new data (don't trim in case of non-printable
        // escape characters are used)
        responseBufferString += data.toString();

        // extract the last part of the buffer to match against expected terminator character/s
        const responseBufferEnd = responseBufferString.substring(responseBufferString.length
                                                                 - responseTerminator.length);

        // if they match, we have all the data
        if (responseBufferEnd === responseTerminator) {
          connectionDetected();
          updateConnectionStatus(true);

          // if reading data, process the response
          if (readingData) {
            // extract the value from the response
            const valueToStore = getValueFromResponse(variableReadArray[requestIndex].format,
              _.get(variableReadArray[requestIndex], 'array', false), responseBufferString);

            // store the variable in the results array
            resultsArray.push(valueToStore);

            // clear the buffer now it has been used
            responseBufferString = '';

            // send request for next var (if any left, else process whole array result)
            requestIndex += 1;
            if (requestIndex !== variableReadArray.length) {
              if (interfaceType === 'Ethernet (TCP)') {
                client.write(variableRequests[requestIndex]);
              } else if (interfaceType === 'Ethernet (UDP)') {
                client.send(variableRequests[requestIndex], port, host);
              } else {
                that.serialPort.write(variableRequests[requestIndex], (err) => {
                  if (err) {
                    log.error(`Error sending request: ${err}`);
                    sendingActive = false;
                  }
                });
              }
            } else {
              sendingActive = false;
              // save all results to the database
              saveResultsToDb();
            }
          } else {
            // if writing data, check the response code
            if (responseBufferString.substr(responseCodeLocation, 2) === RESPONSE_CODE_OK) {
              writeResponse = WRITE_RESPONSE_OK;
            } else {
              writeResponse = WRITE_RESPONSE_ERROR;
            }
            sendingActive = false;
            responseBufferString = '';
          }
        }
      } else { // binary message format
        if ((responseBufferByteCount + data.length) <= responseBuffer.length) {
          data.copy(responseBuffer, responseBufferByteCount);
          responseBufferByteCount += data.length;
        }

        // if the expected number of bytes received
        if (responseBufferByteCount === (responseBuffer.readUInt16BE(2) + 4)) {
          connectionDetected();
          updateConnectionStatus(true);

          // if reading data, process the responseBytes
          if (readingData) {
            // extract the value from the response
            const valueToStore = getValueFromBinaryResponse(variableReadArray[requestIndex].format,
              _.get(variableReadArray[requestIndex], 'array', false), responseBuffer.slice(0, responseBufferByteCount));

            // store the variable in the results array
            resultsArray.push(valueToStore);

            // clear the buffer now it has been used
            responseBufferByteCount = 0;

            // send request for next var (if any left, else process whole array result)
            requestIndex += 1;
            if (requestIndex !== variableReadArray.length) {
              if (interfaceType === 'Ethernet (TCP)') {
                client.write(variableRequests[requestIndex]);
              } else {
                client.send(variableRequests[requestIndex], port, host);
              }
            } else {
              sendingActive = false;
              // save all results to the database
              saveResultsToDb();
            }
          } else {
            // ir writing data, check the response (zero length = OK)
            if (responseBuffer.readUInt16BE(2) === 0) {
              writeResponse = WRITE_RESPONSE_OK;
            } else {
              writeResponse = WRITE_RESPONSE_ERROR;
            }
            sendingActive = false;
            responseBufferByteCount = 0;
          }
        }
      }
    }
  }

  // helper function for Yokogawa serial mode to calculate the request checksum
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

  function parseRequestKey(requestKey) {
    const retObj = {
      command: null, deviceAttribute: null, address: null, count: null, bytesPerCount: 0,
    };

    // get the binary command, returning null if invalid
    switch (requestKey.substring(0, 3).toUpperCase()) {
      case 'BRD':
        retObj.command = BIT_READ_COMMAND;
        retObj.bytesPerCount = 1;
        break;
      case 'BWR':
        retObj.command = BIT_WRITE_COMMAND;
        retObj.bytesPerCount = 1;
        break;
      case 'WRD':
        retObj.command = WORD_READ_COMMAND;
        retObj.bytesPerCount = 2;
        break;
      case 'WWR':
        retObj.command = WORD_WRITE_COMMAND;
        retObj.bytesPerCount = 2;
        break;
      default:
        return retObj;
    }

    // get the binary device, returing null if invalid
    switch (requestKey.substring(3, 4).toUpperCase()) {
      case 'X':
        retObj.deviceAttribute = DEVICE_TYPE_X_ATTRIBUTE;
        break;
      case 'Y':
        retObj.deviceAttribute = DEVICE_TYPE_Y_ATTRIBUTE;
        break;
      case 'I':
        retObj.deviceAttribute = DEVICE_TYPE_I_ATTRIBUTE;
        break;
      case 'E':
        retObj.deviceAttribute = DEVICE_TYPE_E_ATTRIBUTE;
        break;
      case 'M':
        retObj.deviceAttribute = DEVICE_TYPE_M_ATTRIBUTE;
        break;
      case 'T':
        retObj.deviceAttribute = DEVICE_TYPE_T_ATTRIBUTE;
        break;
      case 'C':
        retObj.deviceAttribute = DEVICE_TYPE_C_ATTRIBUTE;
        break;
      case 'L':
        retObj.deviceAttribute = DEVICE_TYPE_L_ATTRIBUTE;
        break;
      case 'D':
        retObj.deviceAttribute = DEVICE_TYPE_D_ATTRIBUTE;
        break;
      case 'B':
        retObj.deviceAttribute = DEVICE_TYPE_B_ATTRIBUTE;
        break;
      case 'R':
        retObj.deviceAttribute = DEVICE_TYPE_R_ATTRIBUTE;
        break;
      case 'V':
        retObj.deviceAttribute = DEVICE_TYPE_V_ATTRIBUTE;
        break;
      case 'Z':
        retObj.deviceAttribute = DEVICE_TYPE_Z_ATTRIBUTE;
        break;
      case 'W':
        retObj.deviceAttribute = DEVICE_TYPE_W_ATTRIBUTE;
        break;
      default:
        return retObj;
    }

    // find the end of the address (either a comma or space)
    let iSep = requestKey.indexOf(',', 4);
    if (iSep === -1) {
      iSep = requestKey.indexOf(' ', 4);
      if (iSep === -1) return retObj;
    }

    // get the address
    const address = parseInt(requestKey.substring(4, iSep), 10);
    if (Number.isNaN(address)) return retObj;
    retObj.address = address;

    // get the count
    const count = parseInt(requestKey.substring(iSep + 1), 10);
    if (Number.isNaN(count)) return retObj;
    retObj.count = count;

    return retObj;
  }

  function open(callback) {
    opening = true;
    interfaceType = that.machine.settings.model.interface;
    requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    connectionReported = false;
    disconnectionReported = false;

    // from the variable array, form a new array of 'read' specific variables
    // i.e. filter out alarm code variables (and possibly 'write' only variables in the future)
    variableReadArray = [];
    that.machine.variables.forEach((variable) => {
      // skip machine connected variables
      if (!_.get(variable, 'machineConnected', false)) {
        if (!(variable.access === 'write' || variable.access === 'read')) {
          const variableWithAccess = variable;
          variableWithAccess.access = 'read';
          variableReadArray.push(variableWithAccess);
        } else if (variable.access === 'read') {
          variableReadArray.push(variable);
        }
      }
    });

    // convert the variables array to an object for easy searching when writing variables
    // and filter it down to just 'write' variables
    variablesWriteObj = _.keyBy(_.filter(that.machine.variables,
      variable => (variable.access === 'write')), 'name');

    // validate the write variables
    let writeVarErr = '';
    _.forOwn(variablesWriteObj, (variable) => {
      if (variable.requestKey === undefined) {
        alert.raise({ key: 'request-key-error', variableName: variable.name });
        writeVarErr = 'All variables require a request key';
        return false;
      }
      const parsedRequestKey = parseRequestKey(variable.requestKey.trim());
      if (parsedRequestKey.command === null) {
        alert.raise({ key: 'invalid-command-error', variableName: variable.name });
        writeVarErr = 'A variable request key contains an unsupported command';
        return false;
      }
      if (parsedRequestKey.deviceAttribute === null) {
        alert.raise({ key: 'invalid-device-error', variableName: variable.name });
        writeVarErr = 'A variable request key contains an invalid device type';
        return false;
      }
      if (parsedRequestKey.address === null) {
        alert.raise({ key: 'invalid-address-error', variableName: variable.name });
        writeVarErr = 'A variable request key contains an invalid address';
        return false;
      }
      if (parsedRequestKey.count === null) {
        alert.raise({ key: 'invalid-count-error', variableName: variable.name });
        writeVarErr = 'A variable request key contains an invalid count';
        return false;
      }
      return undefined;
    });
    if (writeVarErr.length !== 0) {
      return callback(new Error(writeVarErr));
    }

    // check whether configured for ethernet or serial
    if ((interfaceType === 'Ethernet (TCP)') || (interfaceType === 'Ethernet (UDP)')) {
      // get the ip address to use and convert the chosen port number from string to number
      host = that.machine.settings.model.ipAddress;
      port = that.machine.settings.model.port === 'Port A' ? ENET_PORT_A : ENET_PORT_B;
      messageFormat = _.get(that.machine.settings.model, 'messageFormat', 'ASCII');

      // set the response termintator, this is used so we know we have a complete response message
      responseTerminator = CR + LF;
      responseCodeLocation = 2;

      // convert CPU number to a single digit string
      cpuNumber = that.machine.settings.model.yokogawaCPUNumber.toString();

      // form the array of requests to be sent
      let maxResponseBytes = 0;
      for (let i = 0; i < variableReadArray.length; i += 1) {
        // whilst doing this also do a check that all variables have a request key
        if (variableReadArray[i].requestKey === undefined) {
          alert.raise({ key: 'request-key-error', variableName: variableReadArray[i].name });
          return callback(new Error('All variables require a request key'));
        }

        // form the message
        let yokogawaVariableRequestNet;
        if (messageFormat === 'ASCII') {
          // ASCII format: Command + CPU Number + Request Key + CR + LF
          yokogawaVariableRequestNet = COMMAND + cpuNumber
           + variableReadArray[i].requestKey + CR + LF;
        } else {
          // binary format: Command, CPU Number, length, device, address, count
          const parsedRequestKey = parseRequestKey(variableReadArray[i].requestKey.trim());
          if (parsedRequestKey.command === null) {
            alert.raise({ key: 'invalid-command-error', variableName: variableReadArray[i].name });
            return callback(new Error('A variable request key contains an unsupported command'));
          }
          if (parsedRequestKey.deviceAttribute === null) {
            alert.raise({ key: 'invalid-device-error', variableName: variableReadArray[i].name });
            return callback(new Error('A variable request key contains an invalid device type'));
          }
          if (parsedRequestKey.address === null) {
            alert.raise({ key: 'invalid-address-error', variableName: variableReadArray[i].name });
            return callback(new Error('A variable request key contains an invalid address'));
          }
          if (parsedRequestKey.count === null) {
            alert.raise({ key: 'invalid-count-error', variableName: variableReadArray[i].name });
            return callback(new Error('A variable request key contains an invalid count'));
          }
          const responseBytes = parsedRequestKey.count * parsedRequestKey.bytesPerCount;
          if (responseBytes > maxResponseBytes) maxResponseBytes = responseBytes;

          yokogawaVariableRequestNet = Buffer.allocUnsafe(12);
          yokogawaVariableRequestNet.writeUInt8(parsedRequestKey.command, 0);
          yokogawaVariableRequestNet.writeUInt8(that.machine.settings.model.yokogawaCPUNumber, 1);
          yokogawaVariableRequestNet.writeUInt16BE(8, 2);
          yokogawaVariableRequestNet.writeUInt16BE(parsedRequestKey.deviceAttribute, 4);
          yokogawaVariableRequestNet.writeUInt32BE(parsedRequestKey.address, 6);
          yokogawaVariableRequestNet.writeUInt16BE(parsedRequestKey.count, 10);
        }

        // store each request in the array
        variableRequests.push(yokogawaVariableRequestNet);
      }

      // make the response buffer large enought the the largest response
      if (messageFormat === 'Binary') {
        responseBuffer = Buffer.allocUnsafe(maxResponseBytes + 4);
      }

      if (interfaceType === 'Ethernet (TCP)') {
        // try and connect to server
        client = net.createConnection(port, host, () => {
          alert.clear('connection-error');
          connectionDetected();
          updateConnectionStatus(true);
          // succesfully connected to server
          log.info(`Connected to server: ${host}:${port}`);

          // set up a repeat task to trigger the requests
          readTimer = setInterval(requestTimer, requestFrequencyMs);
          // trigger callback on succesful connection to server
          callback(null);
        });

        client.on('error', (error) => {
          alert.raise({ key: 'connection-error' });
          // failed to connect to server,, try to reconnect
          disconnectReconnect();

          if (opening) callback(error);
        });

        // subscribe to on 'data' events
        client.on('data', (data) => {
          // got data from server
          processResponseData(data);
        });

        // subscribe to on 'end' events
        client.on('end', () => {
          alert.raise({ key: 'connection-error' });
          // failed to connect to server,, try to reconnect
          disconnectReconnect();

          if (opening) callback(new Error('Disconnected from machine'));
        });
      } else {
        client = dgram.createSocket('udp4');

        client.on('error', (error) => {
          alert.raise({ key: 'connection-error' });
          // failed to connect to server,, try to reconnect
          disconnectReconnect();

          if (opening) callback(error);
        });

        client.on('message', (message) => {
          // got message from server
          processResponseData(message);
        });

        client.bind(() => {
          udpClientOpened = true;
          alert.clear('connection-error');
          connectionDetected();
          updateConnectionStatus(true);
          // succesfully connected to server
          const address = client.address();
          log.info(`Connected to server: ${address.address}:${address.port}`);

          // set up a repeat task to trigger the requests
          readTimer = setInterval(requestTimer, requestFrequencyMs);
          // trigger callback on succesful connection to server
          callback(null);
        });
      }
    } else {
      const { device } = that.machine.settings.model;
      const baudRate = parseInt(that.machine.settings.model.baudRate, 10);
      const parity = _.get(that.machine.settings.model, 'parity', 'none');
      messageFormat = 'ASCII';

      ({ usingChecksum } = that.machine.settings.model);
      ({ usingCR } = that.machine.settings.model);
      // set the response termintator, this is used so we know we have a complete response message
      responseTerminator = usingCR ? CR : ETX;
      responseCodeLocation = 5;

      // convert the station number to a string and add leading zero
      stationNumber = `0${that.machine.settings.model.yokogawaStationNumber.toString()}`;

      // convert CPU number to a string and add a leading zero
      cpuNumber = `0${that.machine.settings.model.yokogawaCPUNumber.toString()}`;

      // set the wait time to always be 10ms. See table Appx.1-5 in
      // FA-M3 "Personal Computer Link Command Document"
      const waitTime = '1';

      // form the array of requests to be sent
      for (let i = 0; i < variableReadArray.length; i += 1) {
        // whilst doing this also do a check that all variables have a request key
        if (variableReadArray[i].requestKey === undefined) {
          alert.raise({ key: 'request-key-error', variableName: variableReadArray[i].name });
          return callback(new Error('All variables require a request key'));
        }

        // format: STX + Station Number + CPU Number (2 bytes) + Wait Time (1 Byte) + Command +
        //   Checksum + ETX + CR (Checksum and CR are optional)

        // form message that will be checksumed
        let yokogawaVariableRequestSerial = stationNumber + cpuNumber + waitTime
         + variableReadArray[i].requestKey;

        // add checksum if required.
        yokogawaVariableRequestSerial = usingChecksum ? yokogawaVariableRequestSerial
         + calculateYokogawaChecksum(yokogawaVariableRequestSerial) : yokogawaVariableRequestSerial;

        // add STX to the front of the request and ETX at the end
        yokogawaVariableRequestSerial = STX + yokogawaVariableRequestSerial + ETX;

        // add CR if required
        yokogawaVariableRequestSerial = usingCR
          ? yokogawaVariableRequestSerial + CR : yokogawaVariableRequestSerial;

        // store each request in the array
        variableRequests.push(yokogawaVariableRequestSerial);
      }

      // create a serial port with the correct configuration
      that.serialPort = new SerialPort(device, {
        baudRate,
        parity,
        autoOpen: false,
      });

      // attempt to open the serial port
      that.serialPort.open((err) => {
        if (err) {
          alert.raise({ key: 'connection-error' });
          disconnectionDetected();
          updateConnectionStatus(false);
          return callback(err);
        }

        // start the connect error timer
        startConnectionErrorTimer();

        // read data that is available but keep the stream from entering "flowing mode"
        that.serialPort.on('readable', () => {
          //        that.serialPort.on('data', (data) => {
          // we successfully got data so restart the connect error timer
          // if we fail to get data again then the connection error will be raised
          startConnectionErrorTimer();

          const data = that.serialPort.read();
          processResponseData(data);
        });

        // subscribe to on 'close' events
        that.serialPort.on('close', () => {
          log.debug('Serial port closed');

          // stop the connect error timer
          stopConnectionErrorTimer();

          // stop the request timer task
          if (readTimer) {
            clearInterval(readTimer);
            readTimer = null;
          }
          // reset flags
          sendingActive = false;
        });

        // set up a repeat task to trigger the requests
        readTimer = setInterval(requestTimer, requestFrequencyMs);

        // trigger callback on succesful connection
        return callback(null);
      });
    }

    return undefined;
  }

  function serialCloseHelper(callback) {
    if (that.serialPort.isOpen) {
      that.serialPort.close(callback);
    } else {
      callback();
    }
  }

  function ethernetCloseHelper(callback) {
    if (interfaceType === 'Ethernet (TCP)') {
      client.destroy();
      callback();
    } else if (udpClientOpened) {
      udpClientOpened = false;
      client.close(callback());
    } else {
      callback();
    }
  }

  function close(callback) {
    // if we are currently in a request/response cycle
    if ((sendingActive === true)) {
      let waitCounter = 0;
      const activeWait = setInterval(() => {
        if ((sendingActive === false) || (waitCounter > 20)) {
          clearInterval(activeWait);
          sendingActive = false;
          if ((interfaceType === 'Ethernet (TCP)') || (interfaceType === 'Ethernet (UDP)')) {
            ethernetCloseHelper(callback);
          } else {
            serialCloseHelper(callback);
          }
        }
        waitCounter += 1;
      }, 100); // interval set at 100 milliseconds
    // otherwise close immeditalely
    } else if ((interfaceType === 'Ethernet (TCP)') || (interfaceType === 'Ethernet (UDP)')) {
      ethernetCloseHelper(callback);
    } else {
      serialCloseHelper(callback);
    }
  }

  function getAsciiWriteWords(value, format, numWords) {
    let valueString;
    let padChar = '0';
    switch (format) {
      case 'char': {
        valueString = '';
        for (let iChar = 0; iChar < value.length; iChar += 1) {
          valueString += Number(value.charCodeAt(iChar)).toString(16);
        }
        // if more hex charaCters that we have space for (or correct number), truncate hex string
        if (value.length >= (2 * numWords)) {
          return valueString.substr(0, 4 * numWords);
        }
        // if too few hex characters, pad with zeros on the right

        for (let iPad = value.length; iPad < (2 * numWords); iPad += 1) {
          valueString = `${valueString}00`;
        }
        return valueString;
      }
      case 'bool':
        valueString = value ? '1' : '0';
        break;
      case 'float':
      case 'double':
        if (value < 0) {
          valueString = (0x10000000000000 + Math.round(value)).toString(16).toUpperCase();
          padChar = 'F';
        } else {
          valueString = Math.round(value).toString(16).toUpperCase();
        }
        break;
      default:
        if (value < 0) {
          valueString = (0x10000000000000 + value).toString(16).toUpperCase();
          padChar = 'F';
        } else {
          valueString = value.toString(16).toUpperCase();
        }
    }

    // pad on the left with zeros or F if negative
    for (let iPad = valueString.length; iPad < (4 * numWords); iPad += 1) {
      valueString = padChar + valueString;
    }

    return valueString.substr(valueString.length - (4 * numWords));
  }

  function getAsciiWriteBits(value, format, numBits) {
    let bits;
    switch (format) {
      case 'char': {
        bits = 0;
        for (let iChar = 0; iChar < value.length; iChar += 1) {
          bits = value.charCodeAt(iChar) + (256 * bits);
        }
        break;
      }
      case 'bool': {
        let bitString = '';
        for (let iBit = 0; iBit < numBits; iBit += 1) {
          bitString += (value ? '1' : '0');
        }
        return bitString;
      }
      case 'float':
      case 'double':
        bits = Math.round(value);
        break;
      default:
        bits = value;
    }

    let bitString = '';
    for (let iBit = 0; iBit < numBits; iBit += 1) {
      bitString = ((bits % 2) === 0) ? `0${bitString}` : `1${bitString}`;
      bits = Math.floor(bits / 2);
    }
    return bitString;
  }

  // Privileged methods
  this.writeData = function writeData(value, done) {
    // Iterating through the variables to find the address and Type of the variable
    const variableName = value.variable;

    if (!_.has(variablesWriteObj, variableName)) {
      return done();
    }

    const variable = variablesWriteObj[variableName];

    // ignore machibne connectivity status variable - read-only
    if (_.has(variable, 'machineConnected') && variable.machineConnected) {
      return done();
    }

    let writeCommand;

    // parse the request key to get whether bit or word write and the bit/word count
    const parsedRequestKey = parseRequestKey(variable.requestKey.trim());

    // if serial interface
    if (interfaceType === 'serial') {
      // format: STX + Station Number + CPU Number (2 bytes) + Wait Time (1 Byte) + requestKey +
      //   ',' + write data + Checksum + ETX + CR (Checksum and CR are optional)
      writeCommand = `${`0${that.machine.settings.model.yokogawaStationNumber.toString()}`
      + `0${that.machine.settings.model.yokogawaCPUNumber.toString()}1`}${
        variable.requestKey},`;

      if (parsedRequestKey.command === BIT_WRITE_COMMAND) {
        writeCommand += getAsciiWriteBits(value[variableName],
          variable.format, parsedRequestKey.count);
      } else {
        writeCommand += getAsciiWriteWords(value[variableName],
          variable.format, parsedRequestKey.count);
      }

      if (usingChecksum) {
        writeCommand += calculateYokogawaChecksum(writeCommand);
      }

      writeCommand = STX + writeCommand + ETX;
      if (usingCR) {
        writeCommand += CR;
      }
    } else if (messageFormat === 'ASCII') { // if ethernet interface and  ascii message format
      // ASCII format: Command + CPU Number + Request Key + hex values + CR + LF
      writeCommand = `${COMMAND + that.machine.settings.model.yokogawaCPUNumber.toString()
      + variable.requestKey},`;
      if (parsedRequestKey.command === BIT_WRITE_COMMAND) {
        writeCommand += getAsciiWriteBits(value[variableName],
          variable.format, parsedRequestKey.count);
      } else {
        writeCommand += getAsciiWriteWords(value[variableName],
          variable.format, parsedRequestKey.count);
      }
      writeCommand += CR + LF;
    } else { // if ethernet interface and binary message format
      // binary format: Command, CPU Number, length, device, address, count, values
      const cmdLen = 8 + (parsedRequestKey.command === BIT_WRITE_COMMAND
        ? parsedRequestKey.count : 2 * parsedRequestKey.count);
      writeCommand = Buffer.alloc(cmdLen + 4);
      writeCommand.writeUInt8(parsedRequestKey.command, 0);
      writeCommand.writeUInt8(that.machine.settings.model.yokogawaCPUNumber, 1);
      writeCommand.writeUInt16BE(cmdLen, 2);
      writeCommand.writeUInt16BE(parsedRequestKey.deviceAttribute, 4);
      writeCommand.writeUInt32BE(parsedRequestKey.address, 6);
      writeCommand.writeUInt16BE(parsedRequestKey.count, 10);
      if (parsedRequestKey.command === BIT_WRITE_COMMAND) {
        const asciiWriteBits = getAsciiWriteBits(value[variableName],
          variable.format, parsedRequestKey.count);
        for (let iBit = 0; iBit < asciiWriteBits.length; iBit += 1) {
          writeCommand.writeUInt8(asciiWriteBits.charAt(iBit) === '1' ? 1 : 0, 12 + iBit);
        }
      } else {
        const asciiWriteWords = getAsciiWriteWords(value[variableName],
          variable.format, parsedRequestKey.count);
        for (let iWord = 0; iWord < asciiWriteWords.length; iWord += 4) {
          writeCommand.writeUInt16BE(parseInt(asciiWriteWords.substr(iWord, 4), 16),
            12 + (iWord / 2));
        }
      }
    }

    // wait until not sending a read request
    writeTimer = setInterval(() => {
      if (!sendingActive) {
        clearInterval(writeTimer);
        readingData = false;

        if ((interfaceType === 'Ethernet (TCP)') && (client !== null)) {
          // make a tcp request for first var in list
          sendingActive = true;
          client.write(writeCommand);

          // now wait for processResponseData method to be called by 'on data'
        } else if ((interfaceType === 'Ethernet (UDP)') && (client !== null)) {
          // make a tcp request for first var in list
          sendingActive = true;
          client.send(writeCommand, port, host);

          // now wait for processResponseData method to be called by 'on message'
        } else if ((interfaceType === 'serial') && (that.serialPort.isOpen)) {
          // make a serial request for first var in list
          sendingActive = true;
          that.serialPort.write(writeCommand, (err) => {
            if (err) {
              log.error(`Error sending write request: ${err}`);
              sendingActive = false;
            }
          });
        }

        // now wait for write response code to be set in processResponseData
        if (sendingActive) {
          let writeResponsePollCount = 0;
          writeTimer = setInterval(() => {
            if (!sendingActive || (writeResponsePollCount > WRITE_RESPONSE_TIMEOUT_COUNT)) {
              clearInterval(writeTimer);
              if (sendingActive || (writeResponse === WRITE_RESPONSE_ERROR)) {
                sendingActive = false;
                alert.raise({ key: 'write-data-error', variableName });
                return done(new Error('Failed to write data to variable'));
              }
              sendingActive = false;
              alert.clear('write-data-error');
              return done(null);
            }

            writeResponsePollCount += 1;
            return undefined;
          }, WRITE_RESPONSE_POLL_TIME);
        }
      }
    }, WRITE_RESPONSE_POLL_TIME);

    return undefined;
  };

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

    shuttingDown = false;

    open((err) => {
      if (err) {
        return done(err);
      }

      log.info('Started');
      opening = false;
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
    if (readTimer) {
      clearInterval(readTimer);
      readTimer = null;
    }

    // stop the write timer (if being used)
    if (writeTimer) {
      clearInterval(writeTimer);
      writeTimer = null;
    }

    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }

    // make sure don't get any connection timeouts after stopping
    stopConnectionErrorTimer();

    shuttingDown = true;

    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }

      // close interface if open
      if (client || that.serialPort) {
        close((closeErr) => {
          if (err) {
            log.error(closeErr);
          }
          client = null;
          that.serialPort = null;
          // reset flags
          sendingActive = false;
          // clear list of variables
          variableRequests = [];

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
  hpl: hplYokogawa,
  defaults,
  schema,
};
