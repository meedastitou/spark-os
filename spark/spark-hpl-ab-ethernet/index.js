const _ = require('lodash');
const async = require('async');
let nodepccc = require('nodepccc');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplAbEthernet = function hplAbEthernet(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;
  let sendingActive = false;
  let timer = null;
  let client = null;
  let itemsRead = false;
  let disconnectedTimer = null;
  let connectionReported = false;
  let variableReadArray = [];
  let disconnectReconnectTimer = null;

  const RECONNECT_INTERVAL = 5000;

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
    nodepccc = require('./test/testServer');
    this.tester = nodepccc;
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

  // Alert Object
  alert.preLoad({
    'connection-error': {
      msg: `Connection Error: ${machine.info.name}`,
      description: x => `Not able to open connection. Please verify the configuration setting. Error: ${x.errorMsg}`,
    },
    'connection-lost-error': {
      msg: `Connection Lost Error: ${machine.info.name}`,
      description: 'The connection to the PLC was lost. Please verify the connection.',
    },
    'data-null-error': {
      msg: `Data Error : ${machine.info.name}`,
      description: 'Error in reading the values of a variable. Please verify the variable configurations',
    },
  });

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

  function disconnectReconnect() {
    // prevent read timer event from occurring until reconnected
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    // first close the connectionStrategy
    // eslint-disable-next-line no-use-before-define
    close((closeError) => {
      if (closeError) {
        log.error(closeError);
      }
      disconnectReconnectTimer = setTimeout(() => {
        // now reopen the connection
        // eslint-disable-next-line no-use-before-define
        open((openError) => {
          if (openError) {
            log.error(openError);
          }
        });
      }, RECONNECT_INTERVAL);
    });
  }

  // private methods
  function readTimer() {
    // check we are not still processing last request
    if (sendingActive === false) {
      sendingActive = true;
      // read the latest data from each of the variables we requested to get
      client.readAllItems((err, resultObject) => {
        if (err) {
          // if items have been read successfully, assume that the connection was lost
          if (itemsRead) {
            disconnectionDetected();
            updateConnectionStatus(false);
            alert.raise({ key: 'connection-lost-error' });
          } else {
            alert.raise({ key: 'data-null-error' });
          }
          log.error(err);
          sendingActive = false;
          disconnectReconnect();
          return;
        }
        itemsRead = true;
        connectionDetected();
        updateConnectionStatus(true);
        alert.clear('connection-lost-error');
        alert.clear('data-null-error');

        // process the array of results asynchronously so we can write each to the database in turn
        async.forEachOfSeries(variableReadArray, (variable, index, callback) => {
          // get the result from the returned result object using the variables address as the key
          const varResult = resultObject[variable.address];

          if (varResult !== undefined) {
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

  function open(callback) {
    // eslint-disable-next-line new-cap
    client = new nodepccc();

    const requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    const { host } = that.machine.settings.model;
    const { port } = that.machine.settings.model;
    const { doRouting } = that.machine.settings.model;
    const { backPlanePort } = that.machine.settings.model;
    const { backPlaneSlot } = that.machine.settings.model;

    const routingArray = doRouting === true ? [0x01, 0x00, backPlanePort, backPlaneSlot] : [];

    itemsRead = false;
    connectionReported = false;

    client.initiateConnection({ port, host, routing: routingArray }, (err) => {
      if (err) {
        alert.raise({ key: 'connection-error', errorMsg: err.message });
        client = null;
        disconnectionDetected();
        updateConnectionStatus(false);
        disconnectReconnect();
        return callback(null);
      }
      connectionDetected();
      updateConnectionStatus(true);
      alert.clear('connection-error');
      // if successful, create a variable reading list in the machine passing in their address
      variableReadArray.forEach((variable) => {
        client.addItems(variable.address);
      });

      // also start a timer task that will trigger the read requests
      timer = setInterval(readTimer, requestFrequencyMs);
      return callback(null);
    });
  }

  function close(callback) {
    // close the client if connected
    if ((client === null)) {
      return callback(new Error('No open connection to close'));
    }

    updateConnectionStatus(false);

    // if we are currently in a request/response cycle
    if (sendingActive === true) {
      // hold off on closing using an interval timer
      let waitCounter = 0;
      const activeWait = setInterval(() => {
        // until safe to do so
        if ((sendingActive === false) || (waitCounter > 20)) {
          clearInterval(activeWait);
          client.dropConnection();
          client = null;
          return callback();
        }
        waitCounter += 1;
        return undefined;
      }, 100); // interval set at 100 milliseconds
    } else {
      // otherwise close immeditalely
      client.dropConnection();
      client = null;
      return callback();
    }
    return undefined;
  }


  this.writeData = (value, done) => {
    const variableName = value.variable;

    const data = _.get(that.variablesObj, variableName, null);
    if (data == null) {
      return done();
    }

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
    if (disconnectReconnectTimer) {
      clearTimeout(disconnectReconnectTimer);
      disconnectReconnectTimer = null;
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
      // close ab-ethernet device if its open
      if (client) {
        close((error) => {
          if (error) {
            log.error(error);
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
  hpl: hplAbEthernet,
  defaults,
  schema,
};
