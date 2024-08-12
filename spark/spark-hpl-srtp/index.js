/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const net = require('net');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplSrtp = function hplSrtp(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'host-connect-error': {
      msg: 'SRTP: Could not Connect to the Host',
      description: x => `An error occurred while trying to connect to the host. ${x.errorMsg}`,
    },
    'too-much-data': {
      msg: 'SRTP: Too Much Data in Response',
      description: 'Response contains too much data.',
    },
    'database-error': {
      msg: 'SRTP: Error Writing to Database',
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
  });

  // Private variables
  const that = this;
  let bSendingActive = false;
  let client = null;
  let requestTimer = null;
  let resultsArray = [];
  let requestIndex = 0;
  let requestBlockedCounter = 0;
  // eslint-disable-next-line max-len
  const strpBufferInit = [2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xC0, 0, 0, 0, 0, 0x10, 0x0E, 0, 0, 1, 1, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  // eslint-disable-next-line max-len
  //                      0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30    31 32 33 34 35    36    37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55
  // eslint-disable-next-line max-len
  const strpBufferWrite = [2, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 0x80, 0, 0, 0, 0, 0x10, 0x0E, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 7, 0x4c, 0, 0, 0, 0, 0];
  let msgSequenceNum = 0;
  let receiveBuffer = null;
  let nReceivedDataBytes = 0;
  let bOpeningConnection = false;
  let bReceiveError = false;
  let reconnectTimer = null;
  let bMachineShutdown = false;
  let variableReadArray = [];
  let variablesWriteObj;

  const CONTROLLER_PORT = 18245;
  const TYPE_INDEX = 0;
  const SEQ_NUM_1_INDEX = 2;
  const SEQ_NUM_2_INDEX = 30;
  const SERVICE_REQ_CODE_INDEX = 42;
  const SEG_SEL_INDEX = 43;
  const MEM_OFFSET_INDEX = 44;
  const DATA_LEN_INDEX = 46;
  const ERROR_CODE_INDEX = 42;
  const MSG_TYPE_INDEX = 31;
  const RECEIVED_DATA_INDEX = 44;
  const CONNECT_TYPE = 8;
  const CONNECT_SERVICE_REQ_CODE = 0x4F;
  const CONNECT_SERVICE_WRITE_CODE = 7;
  const CONNECT_SEG_SEL = 1;
  const MSG_TYPE_OK = 0xD4;
  // const VALUE_INDEX = 44;
  const DATA_BYTES_PER_PACKET = 6;
  const CONNECT_RETRY_TIME = 10000; // will try to reconnect after 10 seconds
  const MAX_BLOCKED_REQUESTS = 3;
  const DATA_INDEX = 48;
  const WRITE_BOOL_DATA = 56;
  const WRITE_BOOL_BYTELENGTH_INDEX1 = 4;
  const WRITE_BOOL_BYTELENGTH_INDEX2 = 42;
  const WRITE_BOOL_OFFSET = 52;
  const WRITE_BOOL_SERVICE_INDEX = 50;
  const WRITE_BOOL_DATALENTH_INDEX = 54;

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

  updateConnectionStatus(false);

  // helper function to calculate the values required for forming packets
  function calculateRequestParameters(variable) {
    // get the segment selector based on the memory area and
    // whether variable is a boolean (bit read) - also get data size (1 for bytes, 2 for words)
    let segSel; let
      dataSize = 1;
    switch (variable.memoryArea) {
      case '%R':
        segSel = 0x08;
        dataSize = 2;
        break;
      case '%AI':
        segSel = 0x0A;
        dataSize = 2;
        break;
      case '%AQ':
        segSel = 0x0C;
        dataSize = 2;
        break;
      case '%I':
        segSel = 0x10;
        break;
      case '%Q':
        segSel = 0x12;
        break;
      case '%T':
        segSel = 0x14;
        break;
      case '%M':
        segSel = 0x16;
        break;
      case '%SA':
        segSel = 0x18;
        break;
      case '%SB':
        segSel = 0x1A;
        break;
      case '%SC':
        segSel = 0x1C;
        break;
      case '%S':
        segSel = 0x1E;
        break;
      case '%G':
        segSel = 0x38;
        break;
      default:
        segSel = 0x08;
    }

    // determine whether array and, if so, length (length is 1 if not array)
    let arrayLength = 1;
    if (((_.has(variable, 'array') && variable.array) || (variable.format === 'char')) && _.has(variable, 'length')) {
      arrayLength = variable.length;
    }

    // calculate the number of bytes that must be read
    const offsetVal = Number(variable.address) - 1;
    let bytes = arrayLength;
    switch (variable.format) {
      case 'uint16':
      case 'int16':
        bytes = 2 * arrayLength;
        break;
      case 'uint32':
      case 'int32':
      case 'float':
        bytes = 4 * arrayLength;
        break;
      case 'uint64':
      case 'int64':
      case 'double':
        bytes = 8 * arrayLength;
        break;
      case 'bool':
        bytes = Math.floor(((offsetVal % 8) + (arrayLength - 1)) / 8) + 1;
        break;
      default:
    }
    const dataPackets = {
      segSel,
      dataSize,
      offsetVal,
      bytes,
    };

    return dataPackets;
  }
  // helper function to request the value for a variable
  function requestVariableValue(variable) {
    // calculate values for serial read message
    const {
      segSel, dataSize, offsetVal, bytes,
    } = calculateRequestParameters(variable);
    let bytesToRead = bytes;
    let offset = offsetVal;
    // convert bit offset to byte or word offset for booleans only
    if (variable.format === 'bool') {
      offset = Math.floor(offset / (dataSize * 8));
    }

    // create a buffer with the basic STRP message format
    const reqBuf = Buffer.from(strpBufferInit);

    // write requests in blocks of 6 bytes (maximum allowed)
    let packetsExpected = 0;
    while (bytesToRead > 0) {
      // increment the message sequence number, wrapping around to keep it a byte
      msgSequenceNum += 1;
      if (msgSequenceNum > 255) {
        msgSequenceNum = 0;
      }

      // fill in the message-specific data
      reqBuf[SEQ_NUM_1_INDEX] = msgSequenceNum;
      reqBuf[SEQ_NUM_2_INDEX] = msgSequenceNum;
      reqBuf[SEG_SEL_INDEX] = segSel;
      reqBuf.writeInt16LE(offset, MEM_OFFSET_INDEX);
      const dataLength = bytesToRead > DATA_BYTES_PER_PACKET ? DATA_BYTES_PER_PACKET : bytesToRead;
      reqBuf.writeInt16LE(Math.ceil(dataLength / dataSize), DATA_LEN_INDEX);

      // send the message to get the variable's value
      client.write(reqBuf);

      // move on to next request, if any
      offset += DATA_BYTES_PER_PACKET / dataSize;
      bytesToRead -= DATA_BYTES_PER_PACKET;

      (packetsExpected += 1);
    }

    // create a receive buffer to store the number of expected 6-byte packets of data
    receiveBuffer = Buffer.alloc(DATA_BYTES_PER_PACKET * packetsExpected);
    nReceivedDataBytes = 0;
    bReceiveError = false;
  }

  function requestTimerFunction() {
    // only start a new request if previous set has finished
    // (although allow for failed response by adding a counter )
    requestBlockedCounter += 1;
    if (bSendingActive === false) {
      // reset storage and index for starting a new request set
      requestBlockedCounter = 0;
      requestIndex = 0;
      resultsArray = [];
      // make a tcp request for first var in list
      if (variableReadArray.length > 0) {
        bSendingActive = true;
        requestVariableValue(variableReadArray[0]);
      }
    } else if (requestBlockedCounter > MAX_BLOCKED_REQUESTS) {
      // if too many blocked requests, disconnect and try to reconnect
      updateConnectionStatus(false);
      // eslint-disable-next-line no-use-before-define
      disconnectReconnect();
    }
  }

  // helper function to convert a value stored in a buffer into its correct 'format'
  function convertBufferResult(buffer, offset, format) {
    let result = null;

    try {
      switch (format) {
        case 'char':
          result = buffer.toString('utf8', offset, offset + 1);
          break;
        case 'uint8':
          result = buffer.readUInt8(offset);
          break;
        case 'uint16':
          result = buffer.readUInt16LE(offset);
          break;
        case 'uint32':
          result = buffer.readUInt32LE(offset);
          break;
        case 'uint64':
          result = (buffer.readUInt32LE(offset + 4) * 4294967296.0) + buffer.readUInt32LE(offset);
          break;
        case 'int8':
          result = buffer.readInt8(offset);
          break;
        case 'int16':
          result = buffer.readInt16LE(offset);
          break;
        case 'int32':
          result = buffer.readInt32LE(offset);
          break;
        case 'int64': {
          const low = buffer.readInt32LE(offset);
          result = (buffer.readInt32LE(offset + 4) * 4294967296.0) + low;
          if (low < 0) result += 4294967296;
          break;
        }
        case 'float':
          result = buffer.readFloatLE(offset);
          break;
        case 'double':
          result = buffer.readDoubleLE(offset);
          break;
        case 'bool': // for bool only, the offset is the bit offset
        // eslint-disable-next-line no-bitwise
          result = ((buffer.readUInt8(Math.floor(offset / 8)) >>> (offset % 8)) & 1) !== 0;
          break;
        default:
      }
    } catch (err) {
      log.error(err);
    }
    return result;
  }

  // helper function to convert an array of values stored in a buffer into its correct 'format'
  function convertBufferArrayResult(buffer, offset, format, arrayLength) {
    if (format === 'char') {
      if ((offset + arrayLength) <= buffer.length) {
        return buffer.toString('utf8', offset, offset + arrayLength);
      }

      return null;
    }

    let offsetInc = 1;
    switch (format) {
      case 'uint16':
      case 'int16':
        offsetInc = 2;
        break;
      case 'uint32':
      case 'int32':
      case 'float':
        offsetInc = 4;
        break;
      case 'uint64':
      case 'int64':
      case 'double':
        offsetInc = 8;
        break;
      default:
    }

    const results = [];
    let iArray; let
      currOffset = offset;
    for (iArray = 0; iArray < arrayLength; (iArray += 1)) {
      const result = convertBufferResult(buffer, currOffset, format);
      if (result === null) return null;
      results.push(result);
      currOffset += offsetInc;
    }

    return results;
  }

  // helper function to save array of collected results to the database
  function saveResultsToDb() {
    // process the array of results
    async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
      const variable = variableReadArray[index];
      // if there wasn't a result
      if (dataItem === null) {
        // alert that there was an error getting this variables data
        alert.raise({
          key: `read-fail-${variable.name}`,
          msg: 'SRTP: Read Failed for Variable',
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

  function processResponseData(data) {
    // determine whether array and, if so, length
    const variable = variableReadArray[requestIndex];
    let bArray = false; let
      arrayLength = 1;
    if (((_.has(variable, 'array') && variable.array) || (variable.format === 'char')) && _.has(variable, 'length')) {
      bArray = true;
      arrayLength = variable.length;
    }

    // offset is bit offset for boolean only, otherwise it is 0
    const offset = variable.format === 'bool' ? (Number(variable.address) - 1) % 8 : 0;

    // store the data in the results array based on TYPE
    if (bArray) {
      resultsArray.push(convertBufferArrayResult(data, offset, variable.format, arrayLength));
    } else {
      resultsArray.push(convertBufferResult(data, offset, variable.format));
    }

    // send request for next var (if any left, else process whole array result)
    (requestIndex += 1);
    if (requestIndex === variableReadArray.length) {
      bSendingActive = false;

      // save all results to the database
      saveResultsToDb();
    // if more variables, send the next requested for data
    } else {
      requestVariableValue(variableReadArray[requestIndex]);
    }
  }

  function processResponseError() {
    // store a null results
    resultsArray.push(null);

    // send request for next var (if any left, else process whole array result)
    (requestIndex += 1);
    if (requestIndex === variableReadArray.length) {
      bSendingActive = false;


      // save all results to the database
      saveResultsToDb();
    // if more variables, send the next requested for data
    } else {
      requestVariableValue(variableReadArray[requestIndex]);
    }
  }

  function disconnectReconnect() {
    if (client) {
      client.destroy();
      client = null;
    }
    bSendingActive = false;
    if (requestTimer) {
      clearInterval(requestTimer);
      requestTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // eslint-disable-next-line no-use-before-define
      open((err) => {
        log.error({
          err: `connection failed! retrying ...${err}`,
        });
        bOpeningConnection = false;
      });
    }, CONNECT_RETRY_TIME);
  }

  function open(callback) {
    bOpeningConnection = true;

    const requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    const host = that.machine.settings.model.hostName;
    // try and connect to server
    client = net.createConnection(CONTROLLER_PORT, host, () => {
      // succesfully connected to server
      updateConnectionStatus(true);
      alert.clear('host-connect-error');
      requestTimer = setInterval(requestTimerFunction, requestFrequencyMs);
      // send 2 required connection messages to the PLC, the first all zeros
      let connBuf = Buffer.alloc(strpBufferInit.length, 0);
      client.write(connBuf);
      connBuf = Buffer.from(strpBufferInit);
      msgSequenceNum = 1;
      connBuf[TYPE_INDEX] = CONNECT_TYPE;
      connBuf[SEQ_NUM_1_INDEX] = msgSequenceNum;
      connBuf[SEQ_NUM_2_INDEX] = msgSequenceNum;
      connBuf[SERVICE_REQ_CODE_INDEX] = CONNECT_SERVICE_REQ_CODE;
      connBuf[SEG_SEL_INDEX] = CONNECT_SEG_SEL;
      client.write(connBuf);
      // trigger callback on succesful connection to server
      callback(null);
    });

    client.on('error', (error) => {
      updateConnectionStatus(false);
      // if not shutting down, set up to retry connections
      if (!bMachineShutdown) {
        // failed to connect to server, trigger a connection alert
        alert.raise({ key: 'host-connect-error', errorMsg: error.message });

        // disconnect and try to reconnnect
        disconnectReconnect();
      }

      // call callback only if opening connection so not called twice
      if (bOpeningConnection) callback(error);
    });

    // subscribe to on 'data' events
    client.on('data', (data) => {
      // if sent a request packet
      if (bSendingActive) {
        // check whether any receive error
        if ((data[ERROR_CODE_INDEX] !== 0) || (data[MSG_TYPE_INDEX] !== MSG_TYPE_OK)) {
          bReceiveError = true;
        }

        // copy the result bytes to the receive buffer if there is room
        if ((nReceivedDataBytes + DATA_BYTES_PER_PACKET) <= receiveBuffer.length) {
          data.copy(
            receiveBuffer,
            nReceivedDataBytes,
            RECEIVED_DATA_INDEX,
            RECEIVED_DATA_INDEX + DATA_BYTES_PER_PACKET,
          );

          // if all expected bytes recieved, process them
          nReceivedDataBytes += DATA_BYTES_PER_PACKET;
          if (nReceivedDataBytes >= receiveBuffer.length) {
            if (bReceiveError) {
              processResponseError();
            } else {
              processResponseData(receiveBuffer);
            }
          }
          alert.clear('too-much-data');
        } else {
          alert.raise({ key: 'too-much-data' });
          processResponseError();
        }
      }
    });

    // subscribe to on 'end' events
    client.on('end', () => {
      updateConnectionStatus(false);

      // if not shutting down, set up to retry connections
      if (!bMachineShutdown) {
        // failed to connect to server, trigger a connection alert
        alert.raise({ key: 'host-connect-error', errorMsg: '' });

        // disconnect and try to reconnnect
        disconnectReconnect();
      }
    });
  }

  function stopAlerts(callback) {
    // clear existing alerts for spark-machine-wasabi
    alert.clearAll(() => {
      callback(null);
    });
  }

  this.writeData = function writeData(value, done) {
    const variableName = value.variable;

    if (!(_.has(variablesWriteObj, variableName))) {
      return done();
    }

    const data = variablesWriteObj[variableName];
    const reqBuf = Buffer.from(strpBufferInit);

    const {
      segSel, dataSize, offsetVal, bytes,
    } = calculateRequestParameters(data);

    let bytesToWrite = bytes;
    const offset = offsetVal;
    let msgSequenceNumWrite = 1;

    switch (data.format) {
      case 'uint8':
      case 'int8':
        reqBuf.writeUInt8(value[value.variable], DATA_INDEX);
        break;
      case 'uint16':
      case 'int16':
        reqBuf.writeInt16LE(value[value.variable], DATA_INDEX);
        break;
      case 'uint32':
      case 'int32':
        reqBuf.writeInt32LE(value[value.variable], DATA_INDEX);
        break;
      case 'float':
        reqBuf.writeFloatLE(value[value.variable], DATA_INDEX);
        break;
      case 'double':
        reqBuf.writeDoubleLE(value[value.variable], DATA_INDEX);
        break;
      default:
        break;
    }

    if (data.format === 'bool') {
      const reqWrite = Buffer.from(strpBufferWrite);
      msgSequenceNumWrite += 1;
      if (msgSequenceNumWrite > 255) {
        msgSequenceNumWrite = 0;
      }
      reqWrite[SEQ_NUM_1_INDEX] = msgSequenceNum;
      const val = (value[value.variable] === true) ? 8 : 0;
      reqWrite.writeUInt8(val, WRITE_BOOL_DATA);
      reqWrite.writeInt16LE(bytesToWrite, WRITE_BOOL_BYTELENGTH_INDEX1);
      reqWrite.writeInt16LE(bytesToWrite, WRITE_BOOL_BYTELENGTH_INDEX2);
      reqWrite[WRITE_BOOL_SERVICE_INDEX] = CONNECT_SERVICE_WRITE_CODE;
      reqWrite.writeInt16LE(offset, WRITE_BOOL_OFFSET);
      // eslint-disable-next-line max-len
      const dataLength = bytesToWrite > DATA_BYTES_PER_PACKET ? DATA_BYTES_PER_PACKET : bytesToWrite;
      reqWrite.writeInt16LE(Math.ceil(dataLength / dataSize), WRITE_BOOL_DATALENTH_INDEX);
      client.write(reqWrite);
      bytesToWrite -= 1;
    }

    while (bytesToWrite > 0) {
      // increment the message sequence number, wrapping around to keep it a byte
      msgSequenceNumWrite += 1;
      if (msgSequenceNumWrite > 255) {
        msgSequenceNumWrite = 0;
      }
      reqBuf[SEQ_NUM_1_INDEX] = msgSequenceNum;
      reqBuf[SEQ_NUM_2_INDEX] = msgSequenceNum;
      reqBuf[SEG_SEL_INDEX] = segSel;
      reqBuf.writeInt16LE(offset, MEM_OFFSET_INDEX);
      reqBuf[SERVICE_REQ_CODE_INDEX] = CONNECT_SERVICE_WRITE_CODE;
      // eslint-disable-next-line max-len
      const dataLength = bytesToWrite > DATA_BYTES_PER_PACKET ? DATA_BYTES_PER_PACKET : bytesToWrite;
      reqBuf.writeInt16LE(Math.ceil(dataLength / dataSize), DATA_LEN_INDEX);
      client.write(reqBuf);
      bytesToWrite -= DATA_BYTES_PER_PACKET;
    }
    return done();
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

    variableReadArray = [];

    // add the access property if it is not defined explicitly
    async.forEachOfSeries(that.machine.variables, (item, index, callback) => {
      // skip machine connected variables
      if (!_.has(item, 'machineConnected') || !item.machineConnected) {
        if (!(item.access === 'write' || item.access === 'read')) {
          // eslint-disable-next-line no-param-reassign
          item.access = 'read';
          variableReadArray.push(item);
        } else if (item.access === 'read') {
          variableReadArray.push(item);
        }
      }
      return callback();
    });

    // convert the variables array to an object for easy searching
    variablesWriteObj = _.keyBy(_.filter(that.machine.variables,
      variable => ((variable.access === 'write') && _.has(variable, 'address')
       && (!_.has(variable, 'array') || !variable.array)
       && (!_.has(variable, 'machineConnected') || !variable.machineConnected))), 'name');

    bMachineShutdown = false;

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
      return stopAlerts(done);
    }

    // stop the request timer task and reconnect timer task (if being used)
    if (requestTimer) {
      clearInterval(requestTimer);
      requestTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    bMachineShutdown = true;

    // destroy the client
    if (client) {
      client.destroy();
      client = null;
    }

    log.info('Stopped');
    return stopAlerts(done);
  };

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop((error) => {
      if (error) return done(error);
      that.start(that.dataCb, that.configUpdateCb, err => done(err));
      return undefined;
    });
  };

  this.updateModel = function updateModel(newModel, done) {
    that.machine.settings.model = _.cloneDeep(newModel);
    that.restart(err => done(err));
  };

  return true;
};


module.exports = {
  hpl: hplSrtp,
  defaults,
  schema,
};
