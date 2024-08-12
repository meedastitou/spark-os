/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
let SerialPort = require('serialport');

if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line global-require
  SerialPort = require('virtual-serialport');
}

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplADC = function hplADC(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;

  const DATA_COMPLETE_TIMEOUT = 50;
  const TEMP_CMD = 'temp';
  const VERBOSE_ON_CMD = 'von';
  const VERBOSE_OFF_CMD = 'voff';
  const VERBOSE_ON_RESPONSE = 'verbose on';
  const VERBOSE_SPLIT_MIN_COUNT = 15;
  const RESPONSE_TIMEOUT = 2000;
  const MAX_RETRY_COUNT = 3;

  let sendingActive = false;
  let temperatureRequestsProcessed = false;
  let requestTimer = null;
  let responseTimer = null;
  let verboseOnTimer = null;
  let dataCompleteTimer = null;
  let requestIndex = 0;
  let variableReadArray = [];
  let variablesWriteObj = {};
  let receiveBufferString = '';
  let lastCommandSent = '';
  let retryCount = 0;
  let periodicReportsEnabled = false;
  let disconnectedTimer = null;
  let connectionReported = false;
  let disconnectionReported = false;

  // Alert Object
  alert.preLoad({
    'connection-error': {
      msg: `${machine.info.name}: Connection Error`,
      description: 'Not able to open connection. Please verify the configuration',
    },
    'command-name-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: 'All general command variables require a command name',
    },
    'temperature-descriptor-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: 'All temperature request variables require a temperature descriptor',
    },
    'temperature-index-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: 'All periodic temperature value variables require a temperature index',
    },
    'only-command-writable-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: 'Only general command variables are writable',
    },
    'no-response-error': {
      msg: `${machine.info.name}: No Response`,
      description: 'No response or an invalid response to a command was received',
    },
    'failed-to-get-data-alert': {
      msg: `${machine.info.name}: Failed to Get Variable Data`,
      description: x => `Failed to get the data for variable ${x.variable}`,
    },
    'database-error': {
      msg: `${machine.info.name}: Error Writing to Database`,
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
  });

  // public variables
  that.serialPort = null;
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  // private methods
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

  // helper function to convert a string formatted result into its correct 'format'
  function convertStringResult(format, resultString) {
    let result = null;
    if (resultString !== null) {
      switch (format) {
        case 'char':
          result = resultString;
          break;

        case 'int8':
        case 'int16':
        case 'int32':
        case 'int64':
        case 'uint8':
        case 'uint16':
        case 'uint32':
        case 'uint64':
          result = parseInt(resultString, 10);
          break;

        case 'float':
        case 'double':
          result = parseFloat(resultString);
          break;

        case 'bool':

          result = ((resultString === 'on') || (resultString === 'ON')
                    || (resultString === 'enabled') || (resultString === 'enabled')
                    || (resultString === 'true') || (resultString === 'TRUE')
                    || (resultString === '1'));
          break;
        default:
      }
    }
    return result;
  }

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

  function sendCommandRequest(command) {
    // attach a carriage return to the end, as require, according to testing
    that.serialPort.write(`${command}\r`, (err) => {
      if (err) {
        log.error(`Error sending ${command} command: ${err}\r\n`);
      }
      // if polling for variable values, save the command and start the response timeout timer
      if (sendingActive) {
        lastCommandSent = command;
        // eslint-disable-next-line no-use-before-define
        responseTimer = setTimeout(retry, RESPONSE_TIMEOUT);
      }
    });
  }

  function retry() {
    retryCount += 1;
    // if not too many retries already, retry the command
    if (retryCount <= MAX_RETRY_COUNT) {
      sendCommandRequest(lastCommandSent);
    } else { // if too many retries, give up
      disconnectionDetected();
      alert.raise({ key: 'no-response-error' });
      sendingActive = false;
      lastCommandSent = '';
    }
  }

  function requestTimerFunction() {
    // only start a new request if previous set has finished (although allow for failed
    // response by adding a counter )
    if (!sendingActive) {
      // reset storage and index for starting a new request set
      requestIndex = 0;
      receiveBufferString = '';
      retryCount = 0;
      temperatureRequestsProcessed = false;

      if (variableReadArray.length !== 0) {
        sendingActive = true;
        if (variableReadArray[0].type === 'General Command') {
          sendCommandRequest(variableReadArray[0].commandName);
        } else {
          sendCommandRequest(TEMP_CMD);
        }
      }
    }
  }

  function processPeriodicTemperatureResponse(values) {
    // update all periodic temperature values
    that.machine.variables.forEach((variable) => {
      if (variable.type === 'Periodic Temperature Value') {
        if (variable.temperatureIndex >= values.length) {
          alert.raise({ key: 'failed-to-get-data-alert', variable: variable.name });
        } else {
          const value = convertStringResult(variable.format, values[variable.temperatureIndex]);
          if (value === null) {
            alert.raise({ key: 'failed-to-get-data-alert', variable: variable.name });
          } else {
            updateDatabase(variable, value);
          }
        }
      }
    });
  }

  function processResponseData(dataString) {
    connectionDetected();

    // if waiting for verbose on response, check if it received
    if (verboseOnTimer) {
      if (dataString.startsWith(VERBOSE_ON_CMD)
       && (dataString.toLowerCase().indexOf(VERBOSE_ON_RESPONSE) !== -1)) {
        clearInterval(verboseOnTimer);
        verboseOnTimer = null;
        return;
      }
    }

    // check if expecting reponse and response to last command sent (irst line is echoed command)
    if (sendingActive && (lastCommandSent.length > 0) && dataString.startsWith(lastCommandSent)) {
      const responseString = dataString.substring(lastCommandSent.length).trim();

      let gotResponse = false;
      const variable = variableReadArray[requestIndex];
      // if general command, extract value from response
      if (variable.type === 'General Command') {
        const value = convertStringResult(variable.format, responseString);
        if (value !== null) {
          gotResponse = true;
          updateDatabase(variable, value);
        }
      } else { // if temperature request, extract temperatures for all temperature requests
        const lines = responseString.split(/\r?\n/);
        if (lines.length >= 2) {
          const descriptors = lines[0].split(/[\s,]+/);
          const values = lines[1].split(/[\s,]+/);
          variableReadArray.forEach((readVariable) => {
            if (readVariable.type === 'Temperature Request') {
              const iDescriptor = descriptors.indexOf(readVariable.temperatureDescriptor);
              if ((iDescriptor !== -1) && (iDescriptor < values.length)) {
                const value = convertStringResult(readVariable.format, values[iDescriptor]);
                if (value !== null) {
                  gotResponse = true;
                  temperatureRequestsProcessed = true;
                  updateDatabase(readVariable, value);
                }
              }
            }
          });
        }
      }

      // if we got a valid response, stop response timer and continue
      if (gotResponse) {
        alert.clear('no-response-error');

        if (responseTimer) {
          clearTimeout(responseTimer);
          responseTimer = null;
        }

        // send the next command, if any, skipping  temperature requests if already processed
        retryCount = 0;
        requestIndex += 1;
        while (requestIndex < variableReadArray.length) {
          if (variableReadArray[requestIndex].type === 'General Command') {
            sendCommandRequest(variableReadArray[requestIndex].commandName);
            return;
          } if (!temperatureRequestsProcessed) {
            sendCommandRequest(TEMP_CMD);
            return;
          }
          requestIndex += 1;
        }

        // if no more general commands, stop sending requests
        sendingActive = false;
        lastCommandSent = '';
      }
    } else if (periodicReportsEnabled) {
      // if periodic temperature reports enabled, check if this is one
      // split on commas and spaces, look for many values, first numeric
      const dataSplit = dataString.split(/[\s,]+/);
      if (dataSplit.length >= VERBOSE_SPLIT_MIN_COUNT) {
        // eslint-disable-next-line no-self-compare
        if (+dataSplit[0] === +dataSplit[0]) { // this tests if numeric
          processPeriodicTemperatureResponse(dataSplit);
        }
      }
    }
  }

  function open(callback) {
    const requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    const { device } = that.machine.settings.model;
    const baudRate = parseInt(that.machine.settings.model.baudRate, 10);
    const { parity } = that.machine.settings.model;
    connectionReported = false;
    disconnectionReported = false;
    lastCommandSent = '';

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
        return callback(err);
      }

      alert.clear('connection-error');

      // if periodic reports enabled, turn on verbose mode
      if (periodicReportsEnabled) {
        verboseOnTimer = setInterval(() => {
          sendCommandRequest(VERBOSE_ON_CMD);
        }, 1000);
      }

      that.serialPort.on('data', (data) => {
        // allow time for entire message to arrive and then process it
        if (dataCompleteTimer) {
          clearTimeout(dataCompleteTimer);
          dataCompleteTimer = null;
        }
        receiveBufferString += data.toString('ascii');
        dataCompleteTimer = setTimeout(() => {
          processResponseData(receiveBufferString);
          receiveBufferString = '';
        }, DATA_COMPLETE_TIMEOUT);
      });

      // subscribe to on 'close' events
      that.serialPort.on('close', () => {
        log.debug('Serial port closed');

        // stop the request timer task if applicable (i.e. if not closed by our request)
        if (requestTimer) {
          clearInterval(requestTimer);
          requestTimer = null;
          sendingActive = false;
        }
      });

      requestTimer = setInterval(requestTimerFunction, requestFrequencyMs);

      // trigger callback on succesful connection
      return callback(null);
    });

    return undefined;
  }

  function close(callback) {
    // close the serial port if open
    if (that.serialPort === null) {
      return callback(new Error('No Serial Device To Close'));
    }

    // if periodic temperature reports enabled, turn off verbose mode
    if (periodicReportsEnabled) {
      sendCommandRequest(VERBOSE_OFF_CMD);
    }

    // if we are currently in a request/response cycle (for req/res type)
    if ((sendingActive === true)) {
      // hold off on closing using an interval timer
      let waitCounter = 0;
      const activeWait = setInterval(() => {
        // until safe to do so
        if ((sendingActive === false) || (waitCounter > 20)) {
          sendingActive = false;
          clearInterval(activeWait);
          that.serialPort.close(callback);
        }
        waitCounter += 1;
      }, 100); // interval set at 100 milliseconds
    } else {
      // otherwise close immeditalely
      that.serialPort.close(callback);
    }

    return undefined;
  }


  // Privileged methods
  this.writeData = function writeData(value, done) {
    // get the variable name and make sure it exists and is writable
    const variableName = value.variable;
    if (!_.has(variablesWriteObj, variableName)) {
      // create 'write' specific variable alert
      alert.raise({
        key: `variable-not-writable-error-${variableName}`,
        msg: `${machine.info.name}: Error Writing Variable`,
        description: `Error writing ${variableName}. Variable does not exist or is not writable`,
      });
      done();
      return;
    }
    alert.clear(`variable-not-writable-error-${variableName}`);

    // get the variable definition
    const variable = variablesWriteObj[variableName];

    // write the command to set the value
    sendCommandRequest(`${variable.commandName}=${value[variable.name]}`);

    done();
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

    // build an array of variables to be read (excluding periodic), including access property
    variableReadArray = [];
    let noCommmandNameError = false;
    let noTemperatureDescriptorError = false;
    let noTemperatureIndexError = false;
    let invalidTypeWriteError = false;
    periodicReportsEnabled = false;
    that.machine.variables.forEach((variable) => {
      // skip machine connected variables
      if (!_.get(variable, 'machineConnected', false)) {
        const variableWithAccess = variable;
        if (!((variable.access === 'write') || (variable.access === 'read'))) {
          variableWithAccess.access = 'read';
        }
        if (variableWithAccess.access === 'read') {
          switch (variable.type) {
            case 'Temperature Request':
              variableReadArray.push(variableWithAccess);
              if (variable.temperatureDescriptor === undefined) {
                noTemperatureDescriptorError = true;
              }
              break;
            case 'Periodic Temperature Value':
              if (variable.temperatureIndex === undefined) {
                noTemperatureIndexError = true;
              } else {
                periodicReportsEnabled = true;
              }
              break;
            default:
              variableReadArray.push(variableWithAccess);
              if (variable.commandName === undefined) {
                noCommmandNameError = true;
              }
          }
        } else if (variable.type !== 'General Command') {
          invalidTypeWriteError = true;
        } else if (variable.commandName === undefined) {
          noCommmandNameError = true;
        }
      }
    });

    if (noCommmandNameError) {
      alert.raise({ key: 'command-name-error' });
      return done(new Error('All general command variables require a command name'));
    }
    alert.clear('command-name-error');
    if (noTemperatureDescriptorError) {
      alert.raise({ key: 'temperature-descriptor-error' });
      return done(new Error('All temperature request variables require a temperature descriptor'));
    }
    alert.clear('temperature-descriptor-error');
    if (noTemperatureIndexError) {
      alert.raise({ key: 'temperature-index-error' });
      return done(new Error('All periodic temperature value variables require a temperature index'));
    }
    alert.clear('temperature-index-error');
    if (invalidTypeWriteError) {
      alert.raise({ key: 'only-command-writable-error' });
      return done(new Error('Only general command variables are writable'));
    }
    alert.clear('only-command-writable-error');

    // convert the variables array to an object for easy searching when writing variables
    // and filter it down to just 'write' variables
    variablesWriteObj = _.keyBy(_.filter(that.machine.variables,
      variable => (variable.access === 'write')), 'name');

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

    // stop the request timer task (if being used)
    if (requestTimer) {
      clearInterval(requestTimer);
      requestTimer = null;
    }

    // stop the timer to turn on verbose mode
    if (verboseOnTimer) {
      clearInterval(verboseOnTimer);
      verboseOnTimer = null;
    }

    // stop the response timer, if it is running
    if (responseTimer) {
      clearTimeout(responseTimer);
      responseTimer = null;
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
      // close serial port if open
      if (that.serialPort) {
        close((closeErr) => {
          if (closeErr) {
            log.error(closeErr);
          }
          that.serialPort = null;
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
  hpl: hplADC,
  defaults,
  schema,
};
