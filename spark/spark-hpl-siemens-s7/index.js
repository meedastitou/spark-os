/* jshint esversion: 6 */

const _ = require('lodash');
const async = require('async');
let nodeS7Ethernet = require('nodes7');
let nodeS7Serial = require('node-s7-serial');


const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplSiemensS7 = function hplSiemensS7(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;
  let sendingActive = false;
  let timer = null;
  let client = null;
  let interfaceType = null;
  let reconnectTimer = null;
  let disconnectedTimer = null;
  let connectionReported = false;
  let variableReadArray = [];
  const S7_SERIAL_DEFAULT_LOCAL_ADDRESS = 0;
  const S7_SERIAL_DEFAULT_PLC_ADDRESS = 2;

  // Alert Objects
  alert.preLoad({
    'connection-error': {
      msg: `${machine.info.name}: Connection Error`,
      description: 'Not able to open connection. Please verify the configuration',
    },
    'data-null-error': {
      msg: `${machine.info.name}: Data Error`,
      description: x => `Error in reading the values of the variable. Please verify the variable configuration for the variable ${x.variableName}`,
    },
    'dataset-empty-error': {
      msg: `${machine.info.name}: variable Error`,
      description: 'Error in reading list of variables. Please make sure variable configuration is correct',
    },
    'variable-configuration-error': {
      msg: `${machine.info.name}: Configuration Error`,
      description: 'Failed to list some variables. Please make sure all the variables are configured with proper format.',
    },
  });

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line global-require
    nodeS7Serial = require('./test/node-s7-serial');
    // eslint-disable-next-line global-require
    nodeS7Ethernet = require('./test/s7EthernetTestServer');

    if (that.machine.settings.model.interface === 'ethernet') {
      this.tester = nodeS7Ethernet;
    } else {
      this.tester = nodeS7Serial;
    }
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

  // private methods
  function disconnectDetected() {
    updateConnectionStatus(false);

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

  // function disconnectReconnect() {
  //   sendingActive = false;
  //   disconnectDetected();
  //   updateConnectionStatus(false);
  //   if (timer) {
  //     clearInterval(timer);
  //     timer = null;
  //   }
  //   // eslint-disable-next-line no-use-before-define
  //   close(() => {
  //     // eslint-disable-next-line no-use-before-define
  //     open(() => {
  //       log.info(' trying to reconnect ...');
  //     });
  //   });
  // }

  function connectionDetected() {
    updateConnectionStatus(true);

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

  function readTimer() {
    // check we are not still processing last request
    if (sendingActive === false) {
      sendingActive = true;
      // read the latest data from each of the variables we requested to get

      client.readAllItems((err, resultObject) => {
        // console.log(`readAllItems err = ${err}`);
        // console.log(`readAllItems resultObject = ${JSON.stringify(resultObject)}`);

        // eslint-disable-next-line max-len
        if ((resultObject === undefined || _.isEmpty(resultObject)) && (!_.isEmpty(variableReadArray))) {
          // raise the alert if variable configurations are invalid or improper format
          alert.raise({ key: 'variable-configuration-error' });
          sendingActive = false;
          disconnectDetected();
          //          disconnectReconnect();
          return;
        }
        alert.clear('variable-configuration-error');
        connectionDetected();
        if (err) {
          const badVariable = _.includes(resultObject, 'BAD 255');
          let numOfErrorVariable = 0;
          let totalOfVariable = 0;
          if (badVariable) {
            async.forEachOfSeries(resultObject, (value, key, callback) => {
              if (value === 'BAD 255') {
                numOfErrorVariable += 1;
              }
              totalOfVariable += 1;
              callback();
            });
            if (totalOfVariable === numOfErrorVariable) {
              alert.clear('data-null-error');
              alert.raise({ key: 'dataset-empty-error' });
              log.error(err);
              sendingActive = false;
              disconnectDetected();
              //              disconnectReconnect();
              return;
            }
          }
        }

        alert.clear('dataset-empty-error');
        alert.clear('data-null-error');
        // To report connection while reconnection was handled internally
        if (connectionReported === false && client.isoConnectionState === 4) {
          connectionDetected();
        }

        // process the array of results asynchronously so we can write each to the database in turn
        async.forEachOfSeries(variableReadArray, (variable, index, callback) => {
          // get the result from the returned result object using the variables address as the key
          const varResult = resultObject[variable.address];
          if ((varResult !== undefined) && (varResult !== null) && (varResult !== 'BAD 255')) {
            // update the database
            that.dataCb(that.machine, variable, varResult, (error, res) => {
              if (error) {
                log.error(error);
              }
              if (res) log.debug(res);
              // move onto next item once stored in db
              callback();
            });
          } else {
            if (varResult === 'BAD 255') {
              alert.raise({ key: 'data-null-error', variableName: variable.name });
              log.error(err);
            }
            // if there's an issue with the data returned, just move onto the next variable
            callback();
          }
        }, () => {
          // done, so set active flag back to false
          sendingActive = false;
        });
      });
    }
  }

  function calculateFormat(sparkformat) {
    if (sparkformat.indexOf('uint') !== -1) {
      return nodeS7Serial.constants.FORMAT_UNSIGNED;
    } if (sparkformat === 'float') {
      return nodeS7Serial.constants.FORMAT_FLOAT;
    } if (sparkformat === 'bool') {
      return nodeS7Serial.constants.FORMAT_BOOL;
    }
    return nodeS7Serial.constants.FORMAT_SIGNED;
  }

  function open(callback) {
    sendingActive = false;
    const requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    interfaceType = that.machine.settings.model.interface;
    if (interfaceType === 'ethernet') {
      // eslint-disable-next-line new-cap
      client = new nodeS7Ethernet({ silent: true });

      const { host } = that.machine.settings.model;
      const { port } = that.machine.settings.model;

      if (that.machine.settings.model.customS7_200_Via_CP_243_1 === false) {
        const { rack } = that.machine.settings.model;
        const { slot } = that.machine.settings.model;

        client.initiateConnection({
          port, host, rack, slot,
        }, (err) => {
          if (err) {
            alert.raise({ key: 'connection-error' });
            log.error(err);
            disconnectDetected();
            client = null;
            callback(null);
            if (reconnectTimer) {
              clearTimeout(reconnectTimer);
            }
            reconnectTimer = setTimeout(() => {
              if (that.machine.settings.model.enable) {
                open(() => {
                  // trying to reconnect
                });
              }
            }, 2 * requestFrequencyMs);
            return;
          }

          alert.clear('connection-error');

          // update the connection status variable
          connectionDetected();
          // eslint-disable-next-line max-len
          // if successful, create a reading list for each variable in the machine passing in their address
          async.forEachSeries(variableReadArray, (item, cb) => {
            client.addItems(item.address);
            cb();
          });
          // also start a timer task that will trigger the read requests
          timer = setInterval(readTimer, requestFrequencyMs);
          log.info('Connected - timer started');

          callback(null);
        });
      } else {
        const { localTSAP } = that.machine.settings.model;
        const { remoteTSAP } = that.machine.settings.model;

        client.initiateConnection({
          port, host, localTSAP, remoteTSAP,
        }, (err) => {
          if (err) {
            alert.raise({ key: 'connection-error' });
            log.error(err);
            disconnectDetected();
            client = null;
            callback(null);
            if (reconnectTimer) {
              clearTimeout(reconnectTimer);
            }
            reconnectTimer = setTimeout(() => {
              if (that.machine.settings.model.enable) {
                open(() => {
                  log.info(' trying to connect ...');
                });
              }
            }, 2 * requestFrequencyMs);
            return;
          }

          // update the connection status variable
          connectionDetected();
          alert.clear('connection-error');
          // eslint-disable-next-line max-len
          // if successful, create a reading list for each variable in the machine passing in their address
          async.forEachSeries(variableReadArray, (item, cb) => {
            client.addItems(item.address);
            cb();
          });

          // also start a timer task that will trigger the read requests
          timer = setInterval(readTimer, requestFrequencyMs);
          log.info('Connected - timer started');

          callback(null);
        });
      }
    } else {
      const { protocolMode } = that.machine.settings.model;
      const { device } = that.machine.settings.model;
      const { baudRate } = that.machine.settings.model;
      const { parity } = that.machine.settings.model;
      const { mpiMode } = that.machine.settings.model;
      const { mpiSpeed } = that.machine.settings.model;

      let localAddress = S7_SERIAL_DEFAULT_LOCAL_ADDRESS;
      let plcAddress = S7_SERIAL_DEFAULT_PLC_ADDRESS;

      if (that.machine.settings.model.customAddressing === true) {
        ({ localAddress } = that.machine.settings.model);
        ({ plcAddress } = that.machine.settings.model);
      }

      // eslint-disable-next-line max-len
      client = new nodeS7Serial.constructor(protocolMode, device, baudRate, parity, mpiMode, mpiSpeed, localAddress, plcAddress);
      client.initiateConnection((err) => {
        if (err) {
          alert.raise({ key: 'connection-error' });
          log.error(err);
          callback(null);
          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
          }
          reconnectTimer = setTimeout(() => {
            if (that.machine.settings.model.enable) {
              open(() => {
                log.info(' trying to connect ...');
              });
            }
          }, 2 * requestFrequencyMs);
          return;
        }
        // update the connection status variable
        connectionDetected();

        alert.clear('connection-error');
        // if successful, create a reading list for each variable
        // in the machine passing in their address and format
        for (let i = 0; i < variableReadArray.length; i += 1) {
          const variable = variableReadArray[i];
          const format = calculateFormat(variable.format);
          if (client.addItems(variable.address, format) === -1) {
            alert.raise({
              key: `invalid-address-${variable.name}`,
              msg: `${machine.info.name}: Invalid Address String`,
              description: `Address string for variable '${variable.name}' is invalid.`,
            });
          } else {
            alert.clear(`invalid-address-${variable.name}`);
          }
        }

        // also start a timer task that will trigger the read requests
        timer = setInterval(readTimer, requestFrequencyMs);
        log.info('Connected - timer started');
        // eslint-disable-next-line consistent-return
        callback(null);
      });
    }
  }

  function close(callback) {
    // close the client if connected
    if ((client === null)) {
      return callback(new Error('No open connection to close'));
    }

    updateConnectionStatus(false);

    // if we are currently in a request/response cycle
    if (sendingActive === true) {
      sendingActive = false;
      // hold off on closing using an interval timer
      let waitCounter = 0;
      // eslint-disable-next-line prefer-const
      let activeWait = setInterval(() => {
        // until safe to do so
        if ((sendingActive === false) || (waitCounter > 20)) {
          clearInterval(activeWait);
          client.dropConnection(callback);
        }
        waitCounter += 1;
      }, 100); // interval set at 100 milliseconds
    } else {
      // otherwise close immeditalely
      client.dropConnection(callback);
    }
    return undefined;
  }

  this.writeData = function writeData(value, done) {
    const variableName = value.variable;

    const data = _.get(that.variablesObj, variableName, null);
    if (data == null) {
      return done();
    }

    if (interfaceType === 'ethernet') {
      client.writeItems(data.address, value[variableName], (error) => {
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
      client.writeItems(data, value[variableName], (error) => {
        if (error) {
          log.error({
            err: error,
          }, `writeback: Error in writing ${data.name} to ${value.machine}`);
          return done(error);
        }
        log.debug(`${data.name} has been written to the machine ${value.machine}`);
        return done(null);
      });
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
    }

    alert.clearAll((error) => {
      if (error) {
        log.error(error);
      }
      // close s7 device if its open
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
  };

  this.updateModel = function updateModel(newModel, done) {
    log.debug('Updating');
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

module.exports = {
  hpl: hplSiemensS7,
  defaults,
  schema,
};
