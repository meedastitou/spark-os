/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const net = require('net');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplMarsilli = function hplMarsilli(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;

  const COMM_TIMEOUT = 10000;
  const RECEIVED_DATA_SIZE = 4600;
  const TRANSMIT_DATA_SIZE = 200;
  const BYTES_PER_UNIT = 300;
  const ERROR_MSG_OFFSET = 110;
  const ERROR_MSG_LEN = 258;
  const MAX_TIME_BETWEEN_REQUESTS = 4; // request at least every 4 sec (5 sec is actual max)

  let server = null;
  let serverError = false;
  let variableReadArray = [];
  let receiveBuffer = Buffer.allocUnsafe(0);
  const transmitBuffer = Buffer.alloc(TRANSMIT_DATA_SIZE);
  let receivedByteCount = 0;
  let commTimeoutTimer = null;
  let disconnectedTimer = null;
  let sampleTimer = null;
  let connectionReported = false;
  let disconnectionReported = false;
  let sampleTime = 1000;
  let downSampleSkipCount = 1;
  let downSampleCounter = 0;
  let port;

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  // preload alert messages that have known keys
  alert.preLoad({
    'connectivity-error': {
      msg: `${machine.info.name}: Connection Error`,
      description: 'No data was receieved from the machine. please verify the connection configuration',
    },
    'server-error': {
      msg: `${machine.info.name}: Server Error`,
      description: x => `An error occurred with the Spark Marsilli server. Error: ${x.errorMsg}`,
    },
    'byte-offset-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: x => `Variable ${x.variableName} is a raw data variable but does not have a byte offset`,
    },
    'unit-number-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: x => `Variable ${x.variableName} is an alarm code variable but does not have a unit number`,
    },
    'database-error': {
      msg: `${machine.info.name}: Error Writing to Database`,
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
  });

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

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

  function resetCommTimeout() {
    connectionDetected();
    alert.clear('connectivity-error');
    if (commTimeoutTimer) {
      clearTimeout(commTimeoutTimer);
    }
    commTimeoutTimer = setTimeout(() => {
      if (!serverError) {
        alert.raise({ key: 'connectivity-error' });
      }
      commTimeoutTimer = null;
      updateConnectionStatus(false);
      disconnectionDetected();
    }, COMM_TIMEOUT);
  }

  function updateDatabase(variable, value) {
    that.dataCb(that.machine, variable, value, (err, res) => {
      if (err) {
        alert.raise({ key: 'database-error', errorMsg: err.message });
      } else {
        alert.clear('database-error');
      }
      if (res) log.debug(res);
    });
  }

  function getAlarmCode(variable, done) {
    // build the error message
    try {
      const errorMsgStart = ERROR_MSG_OFFSET + ((variable.unitNumber - 1) * BYTES_PER_UNIT);
      let firstZeroByte = receiveBuffer.indexOf(0, errorMsgStart);
      if (firstZeroByte === errorMsgStart) return done(null);
      if (firstZeroByte > (errorMsgStart + ERROR_MSG_LEN)) {
        firstZeroByte = (errorMsgStart + ERROR_MSG_LEN);
      }
      let errorMsg = receiveBuffer.toString('ascii', errorMsgStart, firstZeroByte).trim();
      if (errorMsg.length === 0) return done(null);
      errorMsg = `EM ${variable.unitNumber} ${errorMsg}`;

      // if the error is in the configuration, return its assigned code
      conf.get(`machines:${that.machine.info.name}:data:errors:messages:${errorMsg}`, (err1, alarmCode) => {
        if (alarmCode !== undefined) {
          done(alarmCode);
        } else {
          // if error is not in the configuration, get currrent error message count for this unit
          conf.get(`machines:${that.machine.info.name}:data:errors:counts:unit${variable.unitNumber}`, (err2, errorMsgCount) => {
            let nextErrorMsgCount = errorMsgCount;
            if (nextErrorMsgCount === undefined) {
              nextErrorMsgCount = 1;
            } else {
              nextErrorMsgCount += 1;
            }

            // store the next error message count and the message's alarm code
            conf.set(`machines:${that.machine.info.name}:data:errors:counts:unit${variable.unitNumber}`, nextErrorMsgCount, () => {
              conf.set(`machines:${that.machine.info.name}:data:errors:messages:${errorMsg}`, nextErrorMsgCount, () => {
                done(nextErrorMsgCount);
              });
            });
          });
        }
      });
    } catch (error) {
      log.error('Error getting alarm code value:', error);
      done(null);
    }

    return undefined;
  }

  function getResultForVariable(variable, done) {
    // if this an alarm code variable, return its value
    if (variable.type === 'Alarm Code') {
      getAlarmCode(variable, done);
    } else {
      let result = null;
      try {
        switch (variable.format) {
          case 'char':
            result = receiveBuffer.toString('ascii', variable.byteOffset,
              variable.byteOffset + _.get(variable, 'length', 1));
            break;
          case 'bool':
            result = receiveBuffer.readUInt8(variable.byteOffset) !== 0;
            break;
          case 'uint8':
            result = receiveBuffer.readUInt8(variable.byteOffset);
            break;
          case 'uint16':
            result = receiveBuffer.readUInt16LE(variable.byteOffset);
            break;
          case 'uint32':
            result = receiveBuffer.readUInt32LE(variable.byteOffset);
            break;
          case 'uint64':
            result = receiveBuffer.readUInt32LE(variable.byteOffset)
             + (receiveBuffer.readUInt32LE(variable.byteOffset + 4) * 4294967296.0);
            break;
          case 'int8':
            result = receiveBuffer.readInt8(variable.byteOffset);
            break;
          case 'int16':
            result = receiveBuffer.readInt16LE(variable.byteOffset);
            break;
          case 'int32':
            result = receiveBuffer.readInt32LE(variable.byteOffset);
            break;
          case 'int64': {
            const low = receiveBuffer.readInt32LE(variable.byteOffset);
            result = (receiveBuffer.readInt32LE(variable.byteOffset + 4) * 4294967296.0) + low;
            if (low < 0) result += 4294967296;
            break;
          }
          case 'float':
            result = receiveBuffer.readFloatLE(variable.byteOffset);
            break;
          case 'double':
            result = receiveBuffer.readDoubleLE(variable.byteOffset);
            break;
          default:
        }
      } catch (error) {
        log.error('Error getting variable value:', error);
      }

      done(result);
    }
  }

  function processData(data, socket) {
    // buffer the data, which may arrive in pieces
    const newByteCount = receivedByteCount + data.length;
    if (newByteCount <= receiveBuffer.length) {
      data.copy(receiveBuffer, receivedByteCount);
      receivedByteCount = newByteCount;
      if (receivedByteCount === receiveBuffer.length) {
        // if all data received and not skipping, set the values of the variables
        downSampleCounter += 1;
        if (downSampleCounter >= downSampleSkipCount) {
          downSampleCounter = 0;
          variableReadArray.forEach((variable) => {
            getResultForVariable(variable, (value) => {
              if (value !== null) updateDatabase(variable, value);
            });
          });
        }

        // request more data
        sampleTimer = setTimeout(() => {
          sampleTimer = null;
          // set the TE running bit
          transmitBuffer[0] = 1;
          // copy the watchdog byte
          transmitBuffer[1] = receiveBuffer.readUInt8(1);
          // copy the part number
          receiveBuffer.copy(transmitBuffer, 10, 10, 21);
          // send response to Marsilli
          socket.write(transmitBuffer);
        }, sampleTime);

        receivedByteCount = 0;
      }
    } else {
      receivedByteCount = 0;
    }
  }

  function open(callback) {
    ({ port } = that.machine.settings.model);

    // set the sample time and down sample skip count based on request frequency
    const requestFrequency = _.get(that.machine.settings.model, 'requestFrequency', 2);
    if (requestFrequency <= MAX_TIME_BETWEEN_REQUESTS) {
      downSampleSkipCount = 1;
      sampleTime = requestFrequency * 1000;
    } else {
      downSampleSkipCount = Math.ceil(requestFrequency / MAX_TIME_BETWEEN_REQUESTS);
      sampleTime = Math.floor((requestFrequency * 1000) / downSampleSkipCount);
    }
    downSampleCounter = 0;

    for (let iVar = 0; iVar < variableReadArray.length; iVar += 1) {
      const variable = variableReadArray[iVar];
      if ((variable.type === 'Raw Data') && (variable.byteOffset === undefined)) {
        // return with an error if this is not the case
        alert.raise({ key: 'byte-offset-error', variableName: variable.name });
        return callback(new Error('All raw data variables require a byte offset'));
      }
      if ((variable.type === 'Alarm Code') && (variable.unitNumber === undefined)) {
        // return with an error if this is not the case
        alert.raise({ key: 'unit-number-error', variableName: variable.name });
        return callback(new Error('All alarm code variables require a unit number'));
      }
    }

    receivedByteCount = 0;
    receiveBuffer = Buffer.allocUnsafe(RECEIVED_DATA_SIZE);

    resetCommTimeout();
    alert.clear('server-error');
    serverError = false;

    server = net.createServer((socket) => {
      updateConnectionStatus(true);
      log.info(`Connected to client on port: ${socket.remotePort}`);
      socket.on('data', (data) => {
        processData(data, socket);

        resetCommTimeout();

        if (serverError) {
          serverError = false;
          alert.clear('server-error');
        }
      });
      socket.on('error', (err) => {
        serverError = true;
        updateConnectionStatus(false);
        alert.raise({ key: 'server-error', errorMsg: err.message });
        disconnectionDetected();
      });
    });
    server.on('error', (err) => {
      serverError = true;
      updateConnectionStatus(false);
      alert.raise({ key: 'server-error', errorMsg: err.message });
      disconnectionDetected();
    });
    server.listen(port);

    return callback(null);
  }

  function close(callback) {
    updateConnectionStatus(false);

    // close the server if open
    if (server === null) {
      return callback(new Error('No Server To Close'));
    }

    server.close();
    server = null;
    serverError = false;

    receiveBuffer = Buffer.allocUnsafe(0);

    return callback();
  }

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

    // build an array of variables to be read
    variableReadArray = [];
    async.forEachSeries(that.machine.variables, (item, callback) => {
      // skip machine connected variables
      if (!_.get(item, 'machineConnected', false)) {
        const itemWithAccess = item;
        if (!(item.access === 'write' || item.access === 'read')) {
          itemWithAccess.access = 'read';
        }
        if (itemWithAccess.access === 'read') {
          variableReadArray.push(itemWithAccess);
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
      return done('machine undefined');
    }

    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }

    if (commTimeoutTimer) {
      clearTimeout(commTimeoutTimer);
      commTimeoutTimer = null;
    }

    if (sampleTimer) {
      clearTimeout(sampleTimer);
      sampleTimer = null;
    }

    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }

      // close server if open
      if (server) {
        close((closeErr) => {
          if (closeErr) {
            log.error(closeErr);
          }
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
  hpl: hplMarsilli,
  defaults,
  schema,
};
