/* jshint esversion: 6 */

const _ = require('lodash');
const async = require('async');
let finsEthenet = require('node-omron-fins');
let hostLink = require('node-omron-hostlink');

const defaults = require('./defaults.json');
const schema = require('./schema.json');


// constructor
const hplOmronFins = function hplOmronFins(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'cycle-skipped': {
      msg: 'Omron: Read Cycle Skipped',
      description: 'Read cycle skipped due to previous cycle still to complete. May need to reduce number of variables, or set a slower update rate.',
    },
    'client-timeout': {
      msg: 'Omron: Timeout on Read request',
      description: 'No response from client. Check cable to Omron and connection settings are ok.',
    },
    'client-error': {
      msg: 'Omron: Error From Client',
      description: x => `An error was received from the client. Error: ${x.errorMsg}`,
    },
  });

  // Private variables
  const that = this;
  let timer = null;
  let interfaceType = null;
  let client = null;
  let nextVariableIndex = 0;
  let readCycleActive = false;
  let disconnectedTimer = null;
  let connectionReported = false;
  let variableReadArray = [];
  let reconnectTimer = null;
  let immediateReconnectAttemptFlag = false;

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine, {
    settings: {
      model,
    },
  });

  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line global-require
    finsEthenet = require('./test/node-omron-fins.js');
    // eslint-disable-next-line global-require
    hostLink = require('./test/node-omron-hostlink.js');
    if (this.machine.settings.model.interface === 'ethernet') {
      this.tester = finsEthenet.TestServerOmronFins;
    } else {
      this.tester = hostLink.tester;
    }
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

  // Private methods
  function readNext() {
    // prevent reads after client closed
    if (client === null) return;

    const variable = variableReadArray[nextVariableIndex];

    let length = 1;
    if ('length' in variable) { // length should only be set for either arrays or for a char format
      ({ length } = variable);
    }

    // eslint-disable-next-line max-len
    // support 32 bit integer data formats by doubling the data length (each actual read is a 16bit word)
    if (variable.format === 'int32' || variable.format === 'uint32' || variable.format === 'float') {
      length *= 2;
    } else if (variable.format === 'double') { // and quadrouple for doubles
      length *= 4;
    } else if (variable.format === 'char') { // and half for char (strings)
      length = Math.round(length / 2);
    }
    log.debug('Read address', variable.address);

    // add try/catch as invalid address can cause an exception
    try {
      client.read(variable.address, length, (err) => {
        if (err) {
          throw err;
        } else {
          alert.clear(`read-fail-${variable.name}`);
        }
      });
    } catch (e) {
      alert.raise({
        key: `read-fail-${variable.name}`,
        msg: 'Omron: Read Failed for Variable',
        description: `Read failed for variable '${variable.name}'. Check the address of this variable is set correctly.`,
      });

      // move onto trying next variable
      nextVariableIndex += 1;
      if (nextVariableIndex < variableReadArray.length) {
        process.nextTick(readNext);
      } else {
        readCycleActive = false;
      }
    }
  }

  function readTimer() {
    // check previous read cycle isn't still active
    if (!readCycleActive) {
      alert.clear('cycle-skipped');
      nextVariableIndex = 0;
      readCycleActive = true;
      readNext();
    } else {
      alert.raise({ key: 'cycle-skipped' });
    }
  }

  function clientErrorHandler(err) {
    alert.raise({ key: 'client-error', errorMsg: err.message });
    // eslint-disable-next-line no-use-before-define
    clientReplyHandler(null);
  }

  function clientTimeoutHandler() {
    alert.raise({ key: 'client-timeout' });
    console.log('-----------clientTimeout');
    readCycleActive = false;
    // eslint-disable-next-line no-use-before-define
    disconnectionDetected();
    updateConnectionStatus(false);
    // eslint-disable-next-line no-use-before-define
    reconnect();
  }

  function clientReplyHandler(msg) {
    // if we get data, clear possible previous timeout alert
    alert.clear('client-timeout');

    // if we timeout, try one immediate reconnect
    immediateReconnectAttemptFlag = true;

    // if we get data, make machine connected is true
    // eslint-disable-next-line no-use-before-define
    connectionDetected();
    updateConnectionStatus(true);

    // ignore recieved data if not expecting it
    if (!readCycleActive) {
      return;
    }
    log.debug(msg);

    if ((msg !== null) && ('values' in msg)) {
      let data = null;

      const variable = variableReadArray[nextVariableIndex];

      // decide if we need to deal with decimal encoded data
      let decEncoding = false;

      if (_.has(variable, 'decEncoding')) {
        ({ decEncoding } = variable);
      }

      // decide if we need to write 1 value or an array to the db
      let isArray = false;
      if ('array' in variable) {
        isArray = variable.array;
      }

      if (isArray) {
        // if we need to make 32 bit values from every 2 16bit words
        if (variable.format === 'int32' || variable.format === 'uint32' || variable.format === 'float') {
          // redo array. half its length with each pair of entries combined
          data = [];
          const tmp32bitBuf = Buffer.allocUnsafe(4);
          for (let i = 0; i < msg.values.length; i += 2) {
            // place 2 words into Buffer object as unsigned
            tmp32bitBuf.writeUInt16LE(msg.values[i], 0);
            tmp32bitBuf.writeUInt16LE(msg.values[i + 1], 2);
            // and extract it in the correct way based on fomat
            if (variable.format === 'int32') {
              data.push(tmp32bitBuf.readInt32LE());
            } else if (variable.format === 'uint32') {
              data.push(tmp32bitBuf.readUInt32LE());
            } else {
              data.push(tmp32bitBuf.readFloatLE());
            }
          }
        } else if (variable.format === 'double') {
          // redo array. quarter its length with each four entries combined
          data = [];
          const tmp64bitBuf = Buffer.allocUnsafe(8);
          for (let i = 0; i < msg.values.length; i += 4) {
            // place 4 words into Buffer object as unsigned
            tmp64bitBuf.writeUInt16LE(msg.values[i], 0);
            tmp64bitBuf.writeUInt16LE(msg.values[i + 1], 2);
            tmp64bitBuf.writeUInt16LE(msg.values[i + 2], 4);
            tmp64bitBuf.writeUInt16LE(msg.values[i + 3], 6);
            // and extract it in the correct way
            data.push(tmp64bitBuf.readDoubleLE());
          }
          // if we need to turn each result into a boolean
        } else if (variable.format === 'bool') {
          data = [];
          msg.values.forEach((value) => {
            data.push(value !== 0);
          });
        } else {
          data = [];
          const tmp16bitBuf = Buffer.allocUnsafe(2);
          for (let i = 0; i < msg.values.length; i += 1) {
            // place word into Buffer object as unsigned
            tmp16bitBuf.writeUInt16LE(msg.values[i], 0);
            // and extract it in the correct way based on format
            if (variable.format === 'int16') {
              data.push(tmp16bitBuf.readInt16LE());
            } else if (variable.format === 'uint16') {
              data.push(tmp16bitBuf.readUInt16LE());
            } else if (variable.format === 'int8') {
              data.push(tmp16bitBuf.readInt8());
            } else if (variable.format === 'uint8') {
              data.push(tmp16bitBuf.readUInt8());
            } else {
              data = null;
            }
          }
        }

        // with omron fins serial version, data can be decimal encoded
        if (decEncoding) {
          if (data.length > 0) {
            // convert each element back to string and parse as a decimal
            for (let index = 0; index < data.length; index += 1) {
              data[index] = parseInt(data[index].toString(16), 10);
            }
          } else {
            data = null;
          }
        }
      } else {
        // if we need to make a 32 bit value from 2 16bit words
        if (variable.format === 'int32' || variable.format === 'uint32' || variable.format === 'float') {
          if (msg.values.length >= 2) {
            // place 2 words into Buffer object as unsigned
            const tmp32bitBuf = Buffer.allocUnsafe(4);
            tmp32bitBuf.writeUInt16LE(msg.values[0], 0);
            tmp32bitBuf.writeUInt16LE(msg.values[1], 2);
            // and extract it in the correct way based on format
            if (variable.format === 'int32') {
              data = tmp32bitBuf.readInt32LE();
            } else if (variable.format === 'uint32') {
              data = tmp32bitBuf.readUInt32LE();
            } else {
              data = tmp32bitBuf.readFloatLE();
            }
          }
        } else if (variable.format === 'double') {
          // place 4 words into Buffer object as unsigned
          const tmp64bitBuf = Buffer.allocUnsafe(8);
          tmp64bitBuf.writeUInt16LE(msg.values[0], 0);
          tmp64bitBuf.writeUInt16LE(msg.values[1], 2);
          tmp64bitBuf.writeUInt16LE(msg.values[2], 4);
          tmp64bitBuf.writeUInt16LE(msg.values[3], 6);
          // and extract it in the correct way
          data = tmp64bitBuf.readDoubleLE();
          // if we need to turn it into a boolean
        } else if (variable.format === 'bool') {
          if (msg.values.length >= 1) {
            data = msg.values[0] !== 0;
          }
        } else if (variable.format === 'char') {
          // creata a buffer large enough to contain the whole string
          const tmpStringBuf = Buffer.allocUnsafe(msg.values.length * 2);
          // extract each word16 into the buffer
          for (let i = 0; i < msg.values.length; i += 1) {
            tmpStringBuf.writeUInt16BE(msg.values[i], i * 2);
          }
          // extract out of the buffer the string of the correct length
          data = tmpStringBuf.toString('ascii', 0, variable.length);
        } else if (msg.values.length >= 1) {
          // place word into Buffer object as unsigned
          const tmp16bitBuf = Buffer.allocUnsafe(2);
          tmp16bitBuf.writeUInt16LE(msg.values[0], 0);
          // and extract it in the correct way based on format
          if (variable.format === 'int16') {
            data = tmp16bitBuf.readInt16LE();
          } else if (variable.format === 'uint16') {
            data = tmp16bitBuf.readUInt16LE();
          } else if (variable.format === 'int8') {
            data = tmp16bitBuf.readInt8();
          } else if (variable.format === 'uint8') {
            data = tmp16bitBuf.readUInt8();
          }
        }

        // with omron fins serial version, data can be decimal encoded
        if (decEncoding) {
          // convert back to string and parse as a decimal
          if (data !== null) {
            data = parseInt(data.toString(16), 10);
          }
        }
      }

      if (data !== null) {
        // if data looks ok, clear possible previous data alerts
        alert.clear(`not-enough-data-${variableReadArray[nextVariableIndex].name}`);
        alert.clear(`no-data-${variableReadArray[nextVariableIndex].name}`);
        that.dataCb(that.machine, variable, data, (err) => {
          if (err) {
            log.error(err);
          }
          nextVariableIndex += 1;
          if (nextVariableIndex < variableReadArray.length) {
            readNext();
          } else {
            readCycleActive = false;
          }
        });
      } else {
        // not enough data returned for requested format
        alert.raise({
          key: `not-enough-data-${variableReadArray[nextVariableIndex].name}`,
          msg: 'Omron: Not Enough Data for Variable',
          description: `Not enough data returned for variable '${variableReadArray[nextVariableIndex].name}'. Check the format for this variable is set correctly.`,
        });

        nextVariableIndex += 1;
        if (nextVariableIndex < variableReadArray.length) {
          readNext();
        } else {
          readCycleActive = false;
        }
      }
    } else {
      // may not be any data, move onto next variable
      alert.raise({
        key: `no-data-${variableReadArray[nextVariableIndex].name}`,
        msg: 'Omron: No Data for Variable',
        description: `No data returned for variable '${variableReadArray[nextVariableIndex].name}'. Check the machine defininition is correct.`,
      });

      nextVariableIndex += 1;
      if (nextVariableIndex < variableReadArray.length) {
        readNext();
      } else {
        readCycleActive = false;
      }
    }
  }

  function disconnectionDetected() {
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

  function open(done) {
    if (client) {
      connectionDetected();
      updateConnectionStatus(true);
      return done(new Error('Already open'));
    }

    interfaceType = that.machine.settings.model.interface;
    if (interfaceType === 'ethernet') {
      // open the ethernet version of the fins client
      const address = that.machine.settings.model.ipAddress;
      const { port } = that.machine.settings.model;
      const { destinationNode } = that.machine.settings.model;
      // eslint-disable-next-line max-len
      client = finsEthenet.FinsClient(port, address, { timeout: 750, destinationNode }); // add a 750ms timeout for transactions
    } else {
      // open the hostlink version of the fins client
      const { device } = that.machine.settings.model;
      let payloadMode;
      switch (that.machine.settings.model.payload) {
        case 'FINS (CV-Extended)':
          payloadMode = hostLink.OmronFINSExtendedPayloadMode;
          break;
        case 'Hostlink (C-mode)':
          payloadMode = hostLink.OmronHostlinkPayloadMode;
          break;
        default:
          payloadMode = hostLink.OmronFINSPayloadMode;
          break;
      }
      const serialOptions = {};
      serialOptions.baudRate = parseInt(that.machine.settings.model.baudRate, 10);
      serialOptions.dataBits = that.machine.settings.model.dataBits;
      serialOptions.stopBits = that.machine.settings.model.stopBits;
      serialOptions.parity = that.machine.settings.model.parity;
      serialOptions.timeout = 1000; // add a 1000ms timeout for transactions
      // eslint-disable-next-line new-cap
      client = new hostLink.client(device, payloadMode, serialOptions);
    }

    client.on('error', clientErrorHandler);
    client.on('reply', clientReplyHandler);
    client.on('timeout', clientTimeoutHandler);
    return done(null);
  }

  function reconnect() {
    if (timer) {
      clearInterval(timer);
    }
    alert.clearAll(() => {
      // eslint-disable-next-line no-use-before-define
      close(() => {
        // after immediate reconnect attempt, wait 2x interval
        let reconnectTimerValue = that.machine.settings.model.updateRate * 2 * 1000;
        if (immediateReconnectAttemptFlag) {
          immediateReconnectAttemptFlag = false;
          reconnectTimerValue = 100; // for immediate reconnect atempt, wait 100 msec.
          console.log('-----------attempting immediate reconnect');
        }
        reconnectTimer = setTimeout(() => {
          open((err) => {
            if (err) {
              return undefined;
            }
            log.info('re-connected');
            console.log('-----------reconnected');
            clearTimeout(reconnectTimer);
            reconnectTimer = null;

            // start the read timer
            timer = setInterval(readTimer,
              that.machine.settings.model.updateRate * 1000);

            return undefined;
          });
        // eslint-disable-next-line max-len
        }, reconnectTimerValue);
      });
    });
  }

  function close(done) {
    updateConnectionStatus(false);

    if (!client) {
      disconnectionDetected();
      return done(new Error('No open connection to close'));
    }

    client.removeListener('error', clientErrorHandler);
    client.removeListener('reply', clientReplyHandler);
    client.removeListener('timeout', clientTimeoutHandler);
    client.close();
    disconnectionDetected();
    client = null;
    nextVariableIndex = 0;
    readCycleActive = false;
    return done(null);
  }

  // Handling the write-back to the variable
  this.writeData = function writeData(value, done) {
    const variableName = value.variable;

    const data = _.get(that.variablesObj, variableName, null);

    if (data == null) {
      return done();
    }

    if (interfaceType === 'ethernet') {
      try {
        client.write(data.address, value[variableName], (err) => {
          if (err) {
            log.error({
              err,
            }, `writeback: Error in writing ${data.name} to ${value.machine}`);
            return done(err);
          }

          log.debug(`${data.name} has been written to the machine ${value.machine}`);
          return done(null);
        });
      } catch (error) {
        log.error({
          error,
        }, `writeback: Error in writing ${data.name} to ${value.machine}`);
        return done(error);
      }
    } else {
      try {
        client.write(data.address, value[variableName], (err) => {
          if (err) {
            log.error({
              err,
            }, `writeback: Error in writing ${data.name} to ${value.machine}`);
            return done(err);
          }

          log.debug(`${data.name} has been written to the machine ${value.machine}`);
          return done(null);
        });
      } catch (error) {
        log.error({
          error,
        }, `writeback: Error in writing ${data.name} to ${value.machine}`);
        return done(error);
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
      log.debug(`${machine.info.name} Disabled`);
      return done(null);
    }

    // convert the variables array to an object for easy searching
    that.variablesObj = _.keyBy(that.machine.variables, 'name');

    variableReadArray = [];
    async.forEachSeries(that.machine.variables, (item, callback) => {
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

    open((err) => {
      if (err) {
        return done(err);
      }

      // start the read timer
      timer = setInterval(readTimer,
        that.machine.settings.model.updateRate * 1000);

      log.info('Started');
      return done(null);
    });
    return undefined;
  };

  this.stop = function stop(done) {
    if (!that.machine) {
      return done('machine undefined');
    }

    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // clear existing alerts
    alert.clearAll(() => {
      // close the connection
      if (client) {
        close((err) => {
          if (err) {
            log.error(err);
          }
          client = null;
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
      that.start(that.dataCb, that.configUpdateCb, error => done(error));
      return undefined;
    });
    return undefined;
  };

  this.updateModel = function updateModel(newModel, done) {
    log.debug('Updating');
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

module.exports = {
  hpl: hplOmronFins,
  defaults,
  schema,
};
