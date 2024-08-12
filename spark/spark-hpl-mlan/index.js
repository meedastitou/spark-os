/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const net = require('net');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplMLAN = function hplMLAN(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;

  const GET_PARAMETER_CMD_CODE = 69;
  const CONNECTION_RETRY_FREQUENCY = 5000; // will try to reconnect  every 5 seconds
  const DATA_COMPLETE_TIMEOUT = 50;
  const COMM_TIMEOUT = 5000;
  const RESPONSE_BUFFER_SIZE = 1024;

  let timer = null;
  let dataCompleteTimer = null;
  let commTimeoutTimer = null;
  let sendingActive = false;
  let client = null;
  let variableReadArray = [];
  let commandsToSend = [];
  let commandIndex = 0;
  let port = 0;
  let host = null;
  let requestFrequencyMs = null;
  let netMachineShutdown = false;
  let disconnectedTimer = null;
  let connectionReported = false;

  let responseBuffer = Buffer.allocUnsafe(0);
  let responseBufferByteCount = 0;

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  // preload alert messages that have known keys
  alert.preLoad({
    'connectivity-alert': {
      msg: `${machine.info.name}: Connection Error`,
      description: 'Unable to open connection. please verify the connection configuration',
    },
    'command-code-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: 'All variables require a command code',
    },
    'byte-offset-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: 'All variables require a byte offset',
    },
    'failed-to-get-data-alert': {
      msg: `${machine.info.name}: Failed to Get Variable Data`,
      description: x => `Failed to get the data for variable ${x.variable}`,
    },
    'no-response-alert': {
      msg: `${machine.info.name}: No Response from Equipment`,
      description: 'No response was received from the equiment after a data request',
    },
    'database-error': {
      msg: `${machine.info.name}: Error Writing to Database`,
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
  });

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
    if (!netMachineShutdown) {
      sendingActive = false;
      client.destroy();
      alert.raise({ key: 'connectivity-alert' });
      disconnectionDetected();
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      setTimeout(() => {
        // eslint-disable-next-line no-use-before-define
        clientConnection(() => {
          log.error({
            err: 'connection failed! retrying ...',
          });
        });
      }, CONNECTION_RETRY_FREQUENCY);
    }
  }

  function commTimeout() {
    commTimeoutTimer = null;
    alert.raise({ key: 'no-response-alert' });
    // if communication times out, try to reconnect
    disconnectReconnect();
  }

  function requestTimer() {
    // only start a new request if previous set has finished
    if (!sendingActive && (commandsToSend.length !== 0)) {
      // send the first command
      sendingActive = true;
      commandIndex = 0;
      alert.clear('failed-to-get-data-alert');
      client.write(commandsToSend[0]);

      // start the communication timout timer
      commTimeoutTimer = setTimeout(commTimeout, COMM_TIMEOUT);
    }
  }

  function extractValueFromResponse(data, format, byteOffset, nElements, array) {
    // if variable is non-string array, recursively extract its elements
    if (array && (format !== 'char')) {
      let nBytesPerElement;
      switch (format) {
        case 'uint16':
        case 'int16':
          nBytesPerElement = 2;
          break;
        case 'uint32':
        case 'int32':
        case 'float':
          nBytesPerElement = 4;
          break;
        case 'uint64':
        case 'int64':
        case 'double':
          nBytesPerElement = 8;
          break;
        default:
          nBytesPerElement = 1;
      }

      const valueArray = [];
      for (let iElem = 0; iElem < nElements; iElem += 1) {
        const elementValue = extractValueFromResponse(data, format,
          byteOffset + (iElem * nBytesPerElement), nElements, false);
        if (elementValue === null) return null;
        valueArray.push(elementValue);
      }
      return valueArray;
    }
    // if not an array, extract one value

    let value = null;
    try {
      switch (format) {
        case 'uint8':
          value = data.readUInt8(byteOffset);
          break;
        case 'int8':
          value = data.readInt8(byteOffset);
          break;
        case 'uint16':
          value = data.readUInt16BE(byteOffset);
          break;
        case 'int16':
          value = data.readInt16BE(byteOffset);
          break;
        case 'uint32':
          value = data.readUInt32BE(byteOffset);
          break;
        case 'int32':
          value = data.readInt32BE(byteOffset);
          break;
        case 'uint64':
          value = data.readUInt32BE(byteOffset + 4)
             + (data.readUInt32BE(byteOffset) * 4294967296.0);
          break;
        case 'int64':
        {
          const low = data.readInt32BE(byteOffset + 4);
          value = (data.readInt32BE(byteOffset) * 4294967296.0) + low;
          if (low < 0) value += 4294967296;
          break;
        }
        case 'float':
          value = data.readFloatBE(byteOffset);
          break;
        case 'double':
          value = data.readDoubleBE(byteOffset);
          break;
        case 'bool':
          value = data.readUInt8(byteOffset) !== 0;
          break;
        case 'char':
          value = data.toString('utf8', byteOffset, byteOffset + nElements);
          break;
        default:
          log.error('Unsupported variable format');
      }
    } catch (error) {
      log.error('Error extracting value from response:', error);
    }
    return value;
  }

  function processResponseData(data) {
    // stop the communications timemout timer
    if (commTimeoutTimer) {
      clearTimeout(commTimeoutTimer);
      commTimeoutTimer = null;
      alert.clear('no-response-alert');
    }

    connectionDetected();

    if (sendingActive) {
      // get the command code and possibly subcommand code sent
      const commandCode = commandsToSend[commandIndex].readUInt8(1);
      const subcommandCode = (commandsToSend[commandIndex].length === 4)
        ? commandsToSend[commandIndex].readUInt8(2) : -1;

      // update values of all variables with this command code
      variableReadArray.forEach((variable) => {
        // treat Get Parameter separately, since must get variable with correct param ID for data
        let extract = false;
        if (variable.commandCode === GET_PARAMETER_CMD_CODE) {
          const commandParameterID = commandsToSend[commandIndex].toString('ascii', 2, 5);
          const variableParameterID = `${_.get(variable, 'parameterID', '')}`.slice(0, 3);
          if (commandParameterID === variableParameterID) {
            extract = true;
          }
        } else {
          const variableSubcommandCode = _.get(variable, 'subcommandCode', -1);
          if ((variable.commandCode === commandCode)
           && (subcommandCode === variableSubcommandCode)) {
            extract = true;
          }
        }

        if (extract) {
          const value = extractValueFromResponse(data, variable.format, variable.byteOffset,
            _.get(variable, 'length', 1), _.get(variable, 'array', false));
          if (value !== null) {
            updateDatabase(variable, value);
          } else {
            alert.raise({ key: 'failed-to-get-data-alert', variable: variable.name });
          }
        }
      });

      // if more commands to send, send the next one
      commandIndex += 1;
      if (commandIndex < commandsToSend.length) {
        client.write(commandsToSend[commandIndex]);

        // start the communication timout timer
        commTimeoutTimer = setTimeout(commTimeout, COMM_TIMEOUT);
      } else {
        sendingActive = false;
      }
    }
  }

  function clientConnection(callback) {
    // try and connect to server
    client = net.createConnection(port, host, () => {
      // succesfully connected to server
      alert.clear('connectivity-alert');
      connectionDetected();

      timer = setInterval(requestTimer, requestFrequencyMs);

      return callback(null);
    });

    client.on('error', () => {
      // failed to connect to server,, try to reconnect
      disconnectReconnect();
    });

    // subscribe to on 'data' events
    client.on('data', (data) => {
      // allow time for entire message to arrive and then process it
      if (dataCompleteTimer) {
        clearTimeout(dataCompleteTimer);
        dataCompleteTimer = null;
      }
      if ((responseBufferByteCount + data.length) <= responseBuffer.length) {
        data.copy(responseBuffer, responseBufferByteCount);
        responseBufferByteCount += data.length;
      }
      dataCompleteTimer = setTimeout(() => {
        processResponseData(responseBuffer.slice(0, responseBufferByteCount));

        responseBufferByteCount = 0;
      }, DATA_COMPLETE_TIMEOUT);
    });

    // subscribe to on 'end' events
    client.on('end', () => {
      // this is this getting called, when we stop the machine, but also when we kill the server
      log.info('Disconnected from machine.');
      // raising alert to notify disconnection
      alert.raise({ key: 'connectivity-alert' });
      disconnectionDetected();
      sendingActive = false;

      // stop the request timer task if applicable
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      // nothing else to do. User will have to disable/re-enable to try reconnecting to the server
    });

    return undefined;
  }

  function open(callback) {
    requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    ({ port } = that.machine.settings.model);
    host = that.machine.settings.model.ipAddress;
    connectionReported = false;

    // create the connection
    clientConnection(() => {
      callback(null);
    });

    return undefined;
  }

  function close(callback) {
    // close the client or server port if open
    if (client === null) {
      return callback(new Error('No Net Device To Close'));
    }

    // if we are currently in a request/response cycle (for req/res client type)
    if (sendingActive) {
      // hold off on closing using an interval timer
      let waitCounter = 0;
      const activeWait = setInterval(() => {
        // until safe to do so
        if (!sendingActive || (waitCounter > 20)) {
          sendingActive = false;
          clearInterval(activeWait);
          client.destroy();
          return callback();
        }
        waitCounter += 1;
        return undefined;
      }, 100); // interval set at 100 milliseconds
    } else {
      client.destroy();
      return callback();
    }
    return undefined;
  }


  // Privileged methods
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

    netMachineShutdown = false;

    // build an array of variables to be read, including access property,
    // and an array of commands to send to the controller
    variableReadArray = [];
    commandsToSend = [];
    const commandCodesToSend = [];
    let noCommmandCodeError = false;
    let noByteOffsetError = false;
    that.machine.variables.forEach((variable) => {
      // skip machine connected variables
      if (!_.get(variable, 'machineConnected', false)) {
        // make sure variable has both a command code and a byte offset
        if (variable.commandCode === undefined) {
          noCommmandCodeError = true;
        } else if ((variable.commandCode !== GET_PARAMETER_CMD_CODE)) {
          const subcommandCode = _.get(variable, 'subcommandCode', -1);
          let commandFound = false;
          for (let iCmd = 0; iCmd < commandCodesToSend.length; iCmd += 1) {
            if ((variable.commandCode === commandCodesToSend[iCmd].command)
          && (subcommandCode === commandCodesToSend[iCmd].subcommand)) {
              commandFound = true;
            }
          }
          // if it has command code (and optional subcommand), but not Get Parameters,
          // add it to the codes to send, if not already present
          if (!commandFound) {
            commandCodesToSend.push({ command: variable.commandCode, subcommand: subcommandCode });
          }
        }
        if (variable.byteOffset === undefined) {
          noByteOffsetError = true;
        }

        const variableWithAccess = variable;
        if (!(variable.access === 'write' || variable.access === 'read')) {
          variableWithAccess.access = 'read';
        }
        if (variableWithAccess.access === 'read') {
          variableReadArray.push(variableWithAccess);
        }
      }
    });

    if (noCommmandCodeError) {
      alert.raise({ key: 'command-code-error' });
      return done(new Error('All variables require a command code'));
    }
    alert.clear('command-code-error');
    if (noByteOffsetError) {
      alert.raise({ key: 'byte-offset-error' });
      return done(new Error('All variables require a byte offset'));
    }
    alert.clear('byte-offset-error');

    // for each commmand code, add the address and checksum to build the commmand to send
    commandCodesToSend.forEach((commandCodeToSend) => {
      // if no subcommand, just buffer the command
      if (commandCodeToSend.subcommand === -1) {
        const cmdBuf = Buffer.allocUnsafe(3);
        cmdBuf.writeUInt8(that.machine.settings.model.controllerAddress, 0);
        cmdBuf.writeUInt8(commandCodeToSend.command, 1);
        cmdBuf.writeUInt8(0xFF - ((that.machine.settings.model.controllerAddress
          + commandCodeToSend.command) % 0x100), 2);
        commandsToSend.push(cmdBuf);
      } else { // if subcommand, buffer the command and subcommand
        const cmdBuf = Buffer.allocUnsafe(4);
        cmdBuf.writeUInt8(that.machine.settings.model.controllerAddress, 0);
        cmdBuf.writeUInt8(commandCodeToSend.command, 1);
        cmdBuf.writeUInt8(commandCodeToSend.subcommand, 2);
        cmdBuf.writeUInt8(0xFF - ((that.machine.settings.model.controllerAddress
          + commandCodeToSend.command + commandCodeToSend.subcommand) % 0x100), 3);
        commandsToSend.push(cmdBuf);
      }
    });

    // treat Get Parameters commands separately, since my must add parameter ID
    variableReadArray.forEach((variable) => {
      if (variable.commandCode === GET_PARAMETER_CMD_CODE) {
        const cmdBuf = Buffer.alloc(8);
        cmdBuf.writeUInt8(that.machine.settings.model.controllerAddress, 0);
        cmdBuf.writeUInt8(GET_PARAMETER_CMD_CODE, 1);
        cmdBuf.write(`${_.get(variable, 'parameterID', '')}`, 2, 3, 'ascii');
        cmdBuf.writeUInt8(0xFF - ((that.machine.settings.model.controllerAddress
          + cmdBuf.readUInt8(2) + cmdBuf.readUInt8(3) + cmdBuf.readUInt8(4)
          + GET_PARAMETER_CMD_CODE) % 0x100), 7);
        commandsToSend.push(cmdBuf);
      }
    });

    // allocate memory for the response buffer, now that it is necessary
    responseBuffer = Buffer.allocUnsafe(RESPONSE_BUFFER_SIZE);

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
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }

    // free up memory for response buffer
    responseBuffer = Buffer.allocUnsafe(0);

    netMachineShutdown = true;
    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }

      // close client or server if either is open
      if (client) {
        close((closeErr) => {
          if (closeErr) {
            log.error(closeErr);
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
  hpl: hplMLAN,
  defaults,
  schema,
};
