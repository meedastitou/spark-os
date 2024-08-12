/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');

let as511 = require('node-as511');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplSiemensS5 = function hplSiemensS5(log, machine, model, conf, db, alert) {
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line global-require
    as511 = require('./test/testServer.js');
    this.tester = as511;
  }

  // Private variables
  const that = this;
  let timer = null;
  let client = null;
  let variableReadArray = [];
  let variablesWriteObj = {};
  let disconnectedTimer = null;
  let connectionReported = false;

  const typeToSize = {
    float: {
      size: 4,
      method: 'Float',
    },
    double: {
      size: 4,
      method: 'Double',
    },
    int8: {
      size: 1,
      method: 'Int8',
    },
    int16: {
      size: 2,
      method: 'Int16',
    },
    int32: {
      size: 4,
      method: 'Int32',
    },
    int64: {
      size: 8,
      method: 'Int64',
    },
    uint8: {
      size: 1,
      method: 'UInt8',
    },
    uint16: {
      size: 2,
      method: 'UInt16',
    },
    uint32: {
      size: 4,
      method: 'UInt32',
    },
    uint64: {
      size: 8,
      method: 'UInt64',
    },
    char: {
      size: 1,
      method: 'Int8',
    },
    bool: {
      size: 1,
      method: 'Int8',
    },
  };

  // Alert_Objects
  alert.preLoad({
    'connection-error': {
      msg: `${machine.info.name}: Connection Error`,
      description: x => `Not able to open connection. Please verify the configuration. Error: ${x.errorMsg}`,
    },
    'opened-client': {
      msg: `${machine.info.name}: Connection Error`,
      description: 'Client Connection has been opened already',
    },
  });

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine, {
    settings: {
      model,
    },
  });

  // private methods
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

  function readTimer() {
    let varErrorCount = 0;
    let errorVariable = null;
    let errorFlag = false;

    for (const i in variableReadArray) {
      const variable = variableReadArray[i];
      const { size } = typeToSize[variable.format];

      let err = null;
      let buff;
      try {
        buff = client.readSync(
          parseInt(variable.address, 16),
          size,
        );
      } catch (e) {
        varErrorCount += 1;
        err = e;
      }

      if (err) {
        if (varErrorCount === variableReadArray.length) {
          errorFlag = false;
          alert.clear('var-read-error');
          alert.raise({ key: 'connection-error', errorMsg: err.message });
          disconnectDetected();
        } else {
          errorVariable = variable.name;
          errorFlag = true;
        }
        // eslint-disable-next-line no-continue
        continue;
      }

      alert.clear('var-read-error');
      if (connectionReported === false) {
        connectionDetected();
      }

      let method = `read${typeToSize[variable.format].method}`;
      if (size > 1) {
        // TODO: what is the endianness of the S5 ?
        method += 'BE';
      }
      let value;
      if (size === 8) {
        // no 64 bit read in nodejs buffer
        if (variable.endian === 'BE') {
          value = (buff.readUInt32BE(0) * 0x100000000) + buff.readUInt32BE(4);
        } else {
          value = (buff.readUInt32LE(4) * 0x100000000) + buff.readUInt32LE(0);
        }
      } else {
        value = buff[method](0);
      }

      that.dataCb(that.machine, variable, value, (error, res) => {
        if (error) log.error(error);
        if (res) log.debug(res);
      });
    }
    if (errorFlag) {
      alert.raise({
        key: 'var-read-error',
        msg: `${machine.info.name}: Variable read error`,
        description: `Read error for - ${errorVariable}. Make sure the variable configuration is set correctly `,
      });
    }
  }

  function open(done) {
    if (client) {
      alert.raise({ key: 'opened-client' });
      return done(new Error('Already open'));
    }
    alert.clear('opened-client');
    const { device } = that.machine.settings.model;

    // from the variable array, form a new array of 'read' specific variables
    // i.e. filter out 'write' only variables
    variableReadArray = [];
    that.machine.variables.forEach((variable) => {
      // if read or write not set, assume read
      if (!_.has(variable, 'machineConnected') || !variable.machineConnected) {
        if (!(variable.access === 'write' || variable.access === 'read')) {
          // eslint-disable-next-line no-param-reassign
          variable.access = 'read';
          variableReadArray.push(variable);
        } else if (variable.access === 'read') {
          variableReadArray.push(variable);
        }
      }
    });

    // convert the variables array to an object for easy searching when writing variables
    // and filter it down to just 'write' variables
    variablesWriteObj = _.keyBy(_.filter(that.machine.variables, variable => (variable.access === 'write')), 'name');

    let err = null;
    try {
      // eslint-disable-next-line new-cap
      client = new as511(device);
      // eslint-disable-next-line no-unused-vars
      const res = client.openSync();

      connectionDetected();
    } catch (e) {
      client = null;
      err = e;
      alert.raise({ key: 'connection-error', errorMsg: err.message });
      disconnectDetected();
    }

    return done(err);
  }

  function close(done) {
    if (!client) {
      disconnectDetected();
      return done(new Error('No open connection to close'));
    }

    let err = null;
    try {
      client.closeSync();
    } catch (e) {
      err = e;
    }

    disconnectDetected();
    return done(err);
  }

  // Privileged methods
  this.writeData = function writeData(value, done) {
    // get the variable name and make sure it exists and is writable
    const variableName = value.variable;
    if (!Object.prototype.hasOwnProperty.call(variablesWriteObj, variableName)) {
      // create 'write' specific variable alert
      alert.raise({
        key: `var-write-error-${variableName}`,
        msg: `${machine.info.name}: Error Writing Variable`,
        description: `Error in writing ${variableName}. Variable does not exist or is not writable`,
      });
      done();
      return;
    }

    // get the variable definition
    const variable = variablesWriteObj[variableName];

    // write the required number of bytes to a buffer
    const { size } = typeToSize[variable.format];
    const buff = Buffer.allocUnsafe(size);

    let method = `write${typeToSize[variable.format].method}`;
    if (size > 1) {
      // TODO: what is the endianness of the S5 ?
      method += 'BE';
    }
    if (size === 8) {
      // no 64 bit read in nodejs buffer
      if (variable.endian === 'BE') {
        buff.writeUInt32BE(Math.floor(value[value.variable] / 0x100000000), 0);
        // eslint-disable-next-line no-bitwise
        buff.writeUInt32BE(value[value.variable] & 0xFFFFFFFF, 4);
      } else {
        buff.writeUInt32LE(Math.floor(value[value.variable] / 0x100000000), 4);
        // eslint-disable-next-line no-bitwise
        buff.writeUInt32LE(value[value.variable] & 0xFFFFFFFF, 0);
      }
    } else {
      buff[method](value[value.variable], 0);
    }

    // write the buffer value to the controller
    try {
      client.writeSync(parseInt(variable.address, 16), size, buff);
    } catch (e) {
      log.warn(e);
      done(e);
      return;
    }

    // clear variable write alert
    alert.clear(`var-write-error-${variable.name}`);
    done(null);
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

    // eslint-disable-next-line no-unused-vars
    alert.clearAll((error, res) => {
      if (error) {
        log.error(error);
      }

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
  hpl: hplSiemensS5,
  defaults,
  schema,
};
