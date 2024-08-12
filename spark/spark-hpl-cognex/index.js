/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const net = require('net');

const parseXMLString = require('xml2js').parseString;

const defaults = require('./defaults.json');
const schema = require('./schema.json');


const combinedResultVariable = {
  name: 'CombinedResult',
  description: 'CombinedResult',
  format: 'char',
  array: false,
};

const systemVariable = {
  name: 'System',
  description: 'System',
  format: 'char',
  array: false,
};

const dateVariable = {
  name: 'Date',
  description: 'Date',
  format: 'char',
  array: false,
};

const timeVariable = {
  name: 'Time',
  description: 'Time',
  format: 'char',
  array: false,
};

const userVariable = {
  name: 'User',
  description: 'User',
  format: 'char',
  array: false,
};

const idVariable = {
  name: 'id',
  description: 'id',
  format: 'char',
  array: false,
};

const actionTypeVariable = {
  name: 'Action-Type',
  description: 'Action-Type',
  format: 'char',
  array: false,
};

const typeVariable = {
  name: 'Type',
  description: 'Type',
  format: 'char',
  array: false,
};

const tagNameVariable = {
  name: 'Tag-Name',
  description: 'Tag-Name',
  format: 'char',
  array: false,
};

const newValueVariable = {
  name: 'New-Value',
  description: 'New-Value',
  format: 'char',
  array: false,
};

const oldValueVariable = {
  name: 'Old-Value',
  description: 'Old-Value',
  format: 'char',
  array: false,
};


// constructor

const hplCognex = function hplCognex(log, machine, model, conf, db, alert) {
  const SERVER_CONNECTION_TIMEOUT = 10;

  // Private variables
  const that = this;
  let server = null;
  let serverSocket = null;
  let variableReadArray = [];
  let port = 0;
  let netMachineShutdown = false;
  let netConnectionAlertFlag = false;
  let disconnectedTimer = null;
  let connectionReported = false;
  let serverConnectionTimer = null;

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  // Alert Object
  const CLIENT_DISCONNECT_ALERT = {
    key: `${machine.info.name}connectivity-alert`,
    msg: machine.info.name,
    description: 'Client disconnected from the server',
  };
  const WAITING_FOR_CLIENT_ALERT = {
    key: `${machine.info.name}connectivity-alert`,
    msg: machine.info.name,
    description: 'waiting for the client to connect ...',
  };
  const DATABASE_ERROR_ALERT = {
    key: `${machine.info.name}connectivity-alert`,
    msg: machine.info.name,
    description: 'An error occurred writing a variable value to the database',
  };

  // private methods

  //    debug function for dumping the contents of a a buffer in easy-to-read format, 16 bytes/line
  // function dumpBuffer(buffer) {
  //   var str = '';
  //   for (var i = 0; i < buffer.length; ++i) {
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

  // function convertType(format, resultAsString) {
  //   if (resultAsString !== null) {
  //     let result;
  //     switch (format) {
  //       case 'char':
  //         result = resultAsString;
  //         break;
  //
  //       case 'int8':
  //       case 'int16':
  //       case 'int32':
  //       case 'int64':
  //       case 'uint8':
  //       case 'uint16':
  //       case 'uint32':
  //       case 'uint64':
  //         result = parseInt(resultAsString, 10);
  //         break;
  //
  //       case 'float':
  //       case 'double':
  //         result = parseFloat(resultAsString);
  //         break;
  //
  //       case 'bool':
  //         result = ((resultAsString === 'true') || (resultAsString === '1'));
  //         break;
  //
  //       default:
  //         result = null;
  //         break;
  //     }
  //
  //     return result;
  //   }
  //   return null;
  // }

  function raiseAlert(ALERT_OBJECT, varName) {
    if (!netMachineShutdown) {
      let customizedDesc = ALERT_OBJECT.description;
      if (varName) {
        customizedDesc = `${ALERT_OBJECT.description} for the variable: ${varName}`;
      }
      // raise alert
      alert.raise({
        key: ALERT_OBJECT.key,
        msg: ALERT_OBJECT.msg,
        description: customizedDesc,
      });
      netConnectionAlertFlag = true;
    }
    return true;
  }

  function clearAlert(ALERT_OBJECT) {
    if (netConnectionAlertFlag) {
      alert.clear(ALERT_OBJECT.key);
      netConnectionAlertFlag = false;
    }
    return true;
  }

  function updateDatabase(variable, value) {
    that.dataCb(that.machine, variable, value, (err, res) => {
      if (err) {
        raiseAlert(DATABASE_ERROR_ALERT, variable.name);
      } else {
        clearAlert(DATABASE_ERROR_ALERT);
      }
      if (res) log.debug(res);
    });
  }

  function updateCombinedResultVariable(result) {
    let combinedResult = null;

    // console.log('----updateCombinedResultVariable');
    if (_.has(result.AuditMessage, 'event')) {
      // console.log('----event');
      combinedResult = {};
      combinedResult.system = _.get(result.AuditMessage.$, 'system', '');
      combinedResult.date = _.get(result.AuditMessage.$, 'date', '');
      combinedResult.time = _.get(result.AuditMessage.$, 'time', '');
      combinedResult.user = _.get(result.AuditMessage.$, 'user', '');
      combinedResult.id = _.get(result.AuditMessage.$, 'id', '');
      combinedResult.actionType = 'event';
      combinedResult.type = _.get(result.AuditMessage.event[0].$, 'type', '');
    } else if (_.has(result.AuditMessage, 'change')) {
      // console.log('----change');
      combinedResult = {};
      combinedResult.system = _.get(result.AuditMessage.$, 'system', '');
      combinedResult.date = _.get(result.AuditMessage.$, 'date', '');
      combinedResult.time = _.get(result.AuditMessage.$, 'time', '');
      combinedResult.user = _.get(result.AuditMessage.$, 'user', '');
      combinedResult.id = _.get(result.AuditMessage.$, 'id', '');
      combinedResult.actionType = 'change';
      combinedResult.type = _.get(result.AuditMessage.change[0].$, 'type', '');
      combinedResult.tagName = _.get(result.AuditMessage.change[0].$, 'name', '');
      if (_.has(result.AuditMessage.change[0], 'newValue')) {
        combinedResult.newValue = JSON.stringify(result.AuditMessage.change[0].newValue[0]);
      }
      if (_.has(result.AuditMessage.change[0], 'oldValue')) {
        combinedResult.oldValue = JSON.stringify(result.AuditMessage.change[0].oldValue[0]);
      }
    }

    if (combinedResult !== null) {
      // console.log(`----combinedResultVariable = ${JSON.stringify(combinedResult)}`);
      updateDatabase(combinedResultVariable, JSON.stringify(combinedResult));
    }
  }

  function parseResultForFilteredVariables(result) {
    // console.log('----parseResultForFilteredVariables');
    if (_.has(result.AuditMessage, 'event')) {
      // console.log('----event');
      async.series([

        (cb) => {
          // console.log(`----systemVariable = ${_.get(result.AuditMessage.$, 'system', '')}`);
          that.dataCb(that.machine, systemVariable, _.get(result.AuditMessage.$, 'system', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // console.log(`----dateVariable = ${_.get(result.AuditMessage.$, 'date', '')}`);
          that.dataCb(that.machine, dateVariable, _.get(result.AuditMessage.$, 'date', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // console.log(`----timeVariable = ${_.get(result.AuditMessage.$, 'time', '')}`);
          that.dataCb(that.machine, timeVariable, _.get(result.AuditMessage.$, 'time', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // console.log(`----userVariable = ${_.get(result.AuditMessage.$, 'user', '')}`);
          that.dataCb(that.machine, userVariable, _.get(result.AuditMessage.$, 'user', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // console.log(`----idVariable = ${_.get(result.AuditMessage.$, 'id', '')}`);
          that.dataCb(that.machine, idVariable, _.get(result.AuditMessage.$, 'id', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // console.log('----actionTypeVariable = event');
          that.dataCb(that.machine, actionTypeVariable, 'event',
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // console.log(`----typeVariable = ${_.get(result.AuditMessage.event[0].$, 'type', '')}`);
          that.dataCb(that.machine, typeVariable, _.get(result.AuditMessage.event[0].$, 'type', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },
      ], (err) => {
        if (err) {
          log.error(err);
        }
      });
    } else if (_.has(result.AuditMessage, 'change')) {
      // console.log('----change');
      async.series([

        (cb) => {
          // console.log(`----systemVariable = ${_.get(result.AuditMessage.$, 'system', '')}`);
          that.dataCb(that.machine, systemVariable, _.get(result.AuditMessage.$, 'system', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // console.log(`----dateVariable = ${_.get(result.AuditMessage.$, 'date', '')}`);
          that.dataCb(that.machine, dateVariable, _.get(result.AuditMessage.$, 'date', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // console.log(`----timeVariable = ${_.get(result.AuditMessage.$, 'time', '')}`);
          that.dataCb(that.machine, timeVariable, _.get(result.AuditMessage.$, 'time', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // console.log(`----userVariable = ${_.get(result.AuditMessage.$, 'user', '')}`);
          that.dataCb(that.machine, userVariable, _.get(result.AuditMessage.$, 'user', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // console.log(`----idVariable = ${_.get(result.AuditMessage.$, 'id', '')}`);
          that.dataCb(that.machine, idVariable, _.get(result.AuditMessage.$, 'id', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // console.log('----actionTypeVariable = change');
          that.dataCb(that.machine, actionTypeVariable, 'change',
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // eslint-disable-next-line max-len
          // console.log(`----typeVariable = ${_.get(result.AuditMessage.change[0].$, 'type', '')}`);
          that.dataCb(that.machine, typeVariable, _.get(result.AuditMessage.change[0].$, 'type', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          // eslint-disable-next-line max-len
          // console.log(`----tagNameVariable = ${_.get(result.AuditMessage.change[0].$, 'name', '')}`);
          that.dataCb(that.machine, tagNameVariable, _.get(result.AuditMessage.change[0].$, 'name', ''),
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          let newValue = '';
          if (_.has(result.AuditMessage.change[0], 'newValue')) {
            newValue = JSON.stringify(result.AuditMessage.change[0].newValue[0]);
          }
          // console.log(`----newValueVariable = ${newValue}`);
          that.dataCb(that.machine, newValueVariable, newValue,
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },

        (cb) => {
          let oldValue = '';
          if (_.has(result.AuditMessage.change[0], 'oldValue')) {
            oldValue = JSON.stringify(result.AuditMessage.change[0].oldValue[0]);
          }
          // console.log(`----oldValueVariable = ${oldValue}`);
          that.dataCb(that.machine, oldValueVariable, oldValue,
            (err, res) => {
              if (res) log.debug(res);
              cb(err);
            });
        },
      ], (err) => {
        if (err) {
          log.error(err);
        }
      });
    }
  }

  function processPublishedData(socket, dataString) {
    // console.log('----------------ProcessPublishedData');
    // console.log(dataString);

    parseXMLString(dataString, (err, result) => {
      if (err) {
        log.error(err);
      }
      // console.log(`err = ${err}`);
      // console.log(`result = ${JSON.stringify(result)}`);
      if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
        updateCombinedResultVariable(result);
      } else {
        parseResultForFilteredVariables(result);
      }

      let responseXMLString = '<AuditResponse version="';
      responseXMLString += result.AuditMessage.$.version;
      responseXMLString = `${responseXMLString}" system="`;
      responseXMLString += result.AuditMessage.$.system;
      responseXMLString = `${responseXMLString}" id="`;
      responseXMLString += result.AuditMessage.$.id;
      responseXMLString = `${responseXMLString}" />`;

      // console.log(`resresponseXMLStringult = ${responseXMLString}`);
      socket.write(responseXMLString);
    });
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
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

  function open(callback) {
    // save current mode as required by close method where config may have changed
    ({ port } = that.machine.settings.model);
    connectionReported = false;

    // set a timer to set any machine connected status variables to false after a delay
    // (the longer of the disconnect report time and 10 seconds) if no connection
    let serverConnectionTimeout = _.get(that.machine.settings.model,
      'disconnectReportTime',
      SERVER_CONNECTION_TIMEOUT) * 1000;
    if (serverConnectionTimeout < SERVER_CONNECTION_TIMEOUT) {
      serverConnectionTimeout = SERVER_CONNECTION_TIMEOUT;
    }
    serverConnectionTimer = setTimeout(() => {
      disconnectionDetected();
      updateConnectionStatus(false);
    }, serverConnectionTimeout);

    // add in the individual filtered variables if selected
    if (!_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
      let index = that.machine.variables.indexOf(systemVariable);
      if (index < 0) {
        that.machine.variables.push(systemVariable);
      }
      index = that.machine.variables.indexOf(dateVariable);
      if (index < 0) {
        that.machine.variables.push(dateVariable);
      }
      index = that.machine.variables.indexOf(timeVariable);
      if (index < 0) {
        that.machine.variables.push(timeVariable);
      }
      index = that.machine.variables.indexOf(userVariable);
      if (index < 0) {
        that.machine.variables.push(userVariable);
      }
      index = that.machine.variables.indexOf(idVariable);
      if (index < 0) {
        that.machine.variables.push(idVariable);
      }
      index = that.machine.variables.indexOf(actionTypeVariable);
      if (index < 0) {
        that.machine.variables.push(actionTypeVariable);
      }
      index = that.machine.variables.indexOf(typeVariable);
      if (index < 0) {
        that.machine.variables.push(typeVariable);
      }
      index = that.machine.variables.indexOf(tagNameVariable);
      if (index < 0) {
        that.machine.variables.push(tagNameVariable);
      }
      index = that.machine.variables.indexOf(newValueVariable);
      if (index < 0) {
        that.machine.variables.push(newValueVariable);
      }
      index = that.machine.variables.indexOf(oldValueVariable);
      if (index < 0) {
        that.machine.variables.push(oldValueVariable);
      }
      index = that.machine.variables.indexOf(combinedResultVariable);
      if (index > -1) {
        that.machine.variables.splice(index, 1);
      }
    } else {
      let index = that.machine.variables.indexOf(combinedResultVariable);
      if (index < 0) {
        that.machine.variables.push(combinedResultVariable);
      }
      index = that.machine.variables.indexOf(systemVariable);
      if (index > -1) {
        that.machine.variables.splice(index, 1);
      }
      index = that.machine.variables.indexOf(dateVariable);
      if (index > -1) {
        that.machine.variables.splice(index, 1);
      }
      index = that.machine.variables.indexOf(timeVariable);
      if (index > -1) {
        that.machine.variables.splice(index, 1);
      }
      index = that.machine.variables.indexOf(userVariable);
      if (index > -1) {
        that.machine.variables.splice(index, 1);
      }
      index = that.machine.variables.indexOf(idVariable);
      if (index > -1) {
        that.machine.variables.splice(index, 1);
      }
      index = that.machine.variables.indexOf(actionTypeVariable);
      if (index > -1) {
        that.machine.variables.splice(index, 1);
      }
      index = that.machine.variables.indexOf(typeVariable);
      if (index > -1) {
        that.machine.variables.splice(index, 1);
      }
      index = that.machine.variables.indexOf(tagNameVariable);
      if (index > -1) {
        that.machine.variables.splice(index, 1);
      }
      index = that.machine.variables.indexOf(newValueVariable);
      if (index > -1) {
        that.machine.variables.splice(index, 1);
      }
      index = that.machine.variables.indexOf(oldValueVariable);
      if (index > -1) {
        that.machine.variables.splice(index, 1);
      }
    }

    // raise an alert for client not connected (when client connects the alert will be cleared)
    raiseAlert(WAITING_FOR_CLIENT_ALERT);
    // create the server
    server = net.createServer((socket) => {
      // clear server connection timer
      if (serverConnectionTimer) {
        clearTimeout(serverConnectionTimer);
        serverConnectionTimer = null;
      }

      // client succesfully connected our server
      clearAlert(WAITING_FOR_CLIENT_ALERT);

      // clear alert if we already raised one when the client disconnects
      clearAlert(CLIENT_DISCONNECT_ALERT);

      // set any machine connected status variables to true
      connectionDetected();
      updateConnectionStatus(true);

      // if we are already connected to a client, close it
      if (serverSocket !== null) {
        log.info(`closing socket with client: ${serverSocket.remoteAddress}`);
        serverSocket.destroy();
      }

      log.info(`Connected to client: ${socket.remoteAddress}`);

      // store a reference to the socket (so we can destroy it if we need to close the server)
      serverSocket = socket;

      // subscribe to on 'data' events
      socket.on('data', (data) => {
        // got data from client
        // pass string version to process function
        processPublishedData(socket, data.toString().trim());
      });

      // subscribe to on 'error' events
      socket.on('error', (error) => {
        // emit a disconnect back to the spark machine layer
        log.info(`Server error: ${error.message}`);
        // raise alert to notify client disconnects
        raiseAlert(CLIENT_DISCONNECT_ALERT);
        // set any machine connected status variables to false
        disconnectionDetected();
        updateConnectionStatus(false);
        socket.destroy();
        serverSocket = null;
      });

      // subscribe to on 'end' events
      socket.on('end', () => {
        // emit a disconnect back to the spark machine layer
        log.info('Client disconnected');
        // raise alert to notify client disconnects
        raiseAlert(CLIENT_DISCONNECT_ALERT);
        // set any machine connected status variables to false
        disconnectionDetected();
        updateConnectionStatus(false);
        socket.destroy();
        serverSocket = null;
      });
    }).listen(port);

    // for server, the callback happens immediately, we do not wait for
    // a client connection to declare 'open' a success
    callback(null);
    return undefined;
  }

  function close(callback) {
    // close the client or server port if open
    if (server === null) {
      return callback(new Error('No Net Device To Close'));
    }

    updateConnectionStatus(false);

    // if we are currently in a request/response cycle (for req/res client type)
    // otherwise close immeditalely
    server.close(callback); // callback only trigger when all sockets have been destroyed

    //  if server has an active connection, the socket used must also be destoyed for the
    // above close to be succesful
    if (serverSocket !== null) {
      serverSocket.destroy();
      serverSocket = null;
    }
    return undefined;
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

    netMachineShutdown = false;

    // build an array of variables to be read, including acces property
    variableReadArray = [];
    async.forEachSeries(that.machine.variables, (item, callback) => {
      // skip machine connected variables
      if (!_.has(item, 'machineConnected') || !item.machineConnected) {
        if (!(item.access === 'write' || item.access === 'read')) {
          const itemNoAccess = item;
          itemNoAccess.access = 'read';
          variableReadArray.push(itemNoAccess);
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

    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }

    netMachineShutdown = true;
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
          server = null;
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
  hpl: hplCognex,
  defaults,
  schema,
};
