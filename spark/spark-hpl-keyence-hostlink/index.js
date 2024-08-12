/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const net = require('net');
let SerialPort = require('serialport');

let testing = false;
if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line global-require
  SerialPort = require('virtual-serialport');
  testing = true;
}

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplKeyenceHostlink = function hplKeyenceHostlink(log, machine, model, conf, db, alert) {
  // Private variables
  let sendingActive = false;
  const that = this;
  let timer = null;
  let interfaceType;
  let requestFrequencyMs;
  let client = null;
  let variableReadArray = [];
  let variablesWriteObj = {};
  let resultsArray = [];
  let requestIndex = 0;
  let requestBlockedCounter = 0;
  let variableRequests = [];
  let onOpenCallback = null;
  let onCloseCallback = null;
  let machineShutdown = false;
  let startCommsSuccess = false;
  let endCommsSuccess = false;
  let reconnectTimer = null;
  let writeTimer = null;
  let hostIP = null;
  let hostPort = 0;
  const connectionRetryFrequency = 2000; // will try to reconnect every 2 seconds

  const WRITE_TIMEOUT = 2000;

  const CR = '\u000D';
  const LF = '\u000A';

  // public variables
  that.serialPort = null;
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  // Alert Object
  alert.preLoad({
    'connection-error': {
      msg: `${machine.info.name}: Connection Error`,
      description: 'Not able to open connection. Please verify the configuration',
    },
    'variable-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: x => `Failed to get data for the variable. please check the variable configuration for ${x.variableName}`,
    },
    'write-error': {
      msg: `${machine.info.name}: Write Error`,
      description: x => `An error occurred while trying to write to a variable: ${x.errorMsg}`,
    },
  });

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

  // private methods
  // helper function to convert a string formatted result into its correct 'format'
  function convertStringResult(format, resultString) {
    let result = null;
    if (resultString !== null) {
      switch (format) {
        case 'char':
          // keep numeric result as a string?
          result = resultString;
          break;

        case 'int8':
        case 'int16':
        case 'uint8':
        case 'uint16':
          // convert from the hex string
          result = parseInt(resultString, 10);
          break;

        case 'int32':
        case 'uint32':
          // TODO may need to correct the word order
          // convert from the decimal string
          result = parseInt(resultString, 10);
          break;

        case 'int64':
        case 'uint64':
          // TODO may need to correct the word order.
          // convert from the decimal string
          result = parseInt(resultString, 10);
          break;

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
    return result;
  }

  function convertValueToString(format, value) {
    let retVal = '';
    switch (format) {
      case 'char':
        retVal = value;
        break;
      case 'bool':
        retVal = value ? '1' : '0';
        break;
        // floating point numbers are not permitted - convert to integer
      case 'float':
      case 'double':
        retVal = Math.round(value).toString();
        break;
      default:
        retVal = value.toString();
    }

    return retVal;
  }

  // helper function to save array of collected results to the database
  function saveResultsToDb() {
    if (!_.includes(resultsArray, null)) {
      alert.clear('variable-error');
    }
    // process the array of results
    async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
      // if there wasn't a result
      if (dataItem === null) {
        // highlight that there was an error getting this variables data
        alert.raise({ key: 'variable-error', variableName: variableReadArray[index].name });
        // and just move onto next item
        return callback();
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

  function serialReconnect() {
    // close and try to reconnect
    that.serialPort.close(() => {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        // eslint-disable-next-line no-use-before-define
        open((openErr) => {
          if (!openErr) {
            alert.clear('connection-error');
          }
        });
      }, 10000);
    });
  }

  function requestTimer() {
    // if waiting for a write response, try again after a short delay (100 ms)
    if (writeTimer) {
      setTimeout(requestTimer, 100);
      return;
    }

    // only start a new request if previous set has finished
    // (although allow for failed response by adding a counter )
    if ((sendingActive === false) || (requestBlockedCounter > 3)) {
      // reset storage and index for starting a new request set
      requestIndex = 0;
      resultsArray = [];

      if ((interfaceType === 'ethernet') && (client !== null)) {
        // make a tcp request for first var in list
        sendingActive = true;
        client.write(variableRequests[0]);

        // now wait for processResponseData method to be called by 'on data'
      } else if ((interfaceType === 'serial') && (that.serialPort.isOpen)) {
        // if too many failed responses, close and reopen the serial port
        if (requestBlockedCounter > 3) {
          sendingActive = false;
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          serialReconnect();
        } else {
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
      }

      requestBlockedCounter = 0;
    } else {
      requestBlockedCounter += 1;
    }
  }

  function processResponseData(data) {
    // if waiting for a write response, check for an error
    if (writeTimer) {
      switch (data) {
        case 'OK':
          clearTimeout(writeTimer);
          writeTimer = null;
          alert.clear('write-error');
          break;
        case 'E0':
          clearTimeout(writeTimer);
          writeTimer = null;
          alert.raise({ key: 'write-error', errorMsg: 'Device Number Error' });
          break;
        case 'E1':
          clearTimeout(writeTimer);
          writeTimer = null;
          alert.raise({ key: 'write-error', errorMsg: 'Command Error' });
          break;
        case 'E4':
          clearTimeout(writeTimer);
          writeTimer = null;
          alert.raise({ key: 'write-error', errorMsg: 'Write Protected' });
          break;
        default:
      }
    } else if (sendingActive === true) {
      // will be triggered for each repsonse to a request, assumes response is for last sent request
      // only attempt processing if we are expecting it
      let valueToStore = null;
      // check for error response
      if (data === 'E0') {
        log.error(`Response Error for variable ${variableReadArray[requestIndex].name}: Device Number Error`);
      } else if (data === 'E1') {
        log.error(`Response Error for variable ${variableReadArray[requestIndex].name}: Command Error`);
      } else {
        // otherwise extract/convert the value from the response
        valueToStore = convertStringResult(variableReadArray[requestIndex].format, data);
      }

      // store the variable in the results array
      resultsArray.push(valueToStore);

      // send request for next var (if any left, else process whole array result)
      requestIndex += 1;
      if (requestIndex !== variableReadArray.length) {
        if (interfaceType === 'ethernet') {
          client.write(variableRequests[requestIndex]);
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
    }
  }

  // helper function to determine if we need to add an optional format specifier in the message
  function calcuateDataFormat(name, sparkFormat, memoryArea) {
    if (sparkFormat === 'float' || sparkFormat === 'double' || sparkFormat === 'int64' || sparkFormat === 'uint64' || sparkFormat === 'char') {
      log.warn(`Unsupported Format for variable ${name}, data will be read using the default type for the memory area chosen`);
      return '';
    }

    switch (memoryArea) {
      case 'R':
      case 'B':
      case 'MR':
      case 'LR':
      case 'CR':
      case 'VB':
      {
        // 1 bit native registers
        break;
      }
      case 'DM':
      case 'EM':
      case 'FM':
      case 'ZF':
      case 'W':
      case 'TM':
      case 'Z':
      case 'AT':
      case 'CM':
      case 'VM':
      {
        // 16 bit native registers
        // if format is 32 bit, will retrive this and the next address to make a 32 bit result
        if (sparkFormat === 'int32' || sparkFormat === 'uint32') {
          // if format is signed
          if (sparkFormat === 'int32') {
            return '.L';
          }
          return '.D';
        }
        // if format is signed
        if (sparkFormat === 'int16' || sparkFormat === 'int8') {
          return '.S';
        }
        // default for these registers


        break;
      }
      case 'TC':
      case 'CC':
      case 'TS':
      case 'CS':
      {
        // 32 bit native registers
        // if format is 16 bit or less, will retrive the lower 16 bits of the 32 bit memory location
        if (sparkFormat !== 'int32' && sparkFormat !== 'uint32') {
          // if format is signed
          if (sparkFormat === 'int16' || sparkFormat === 'int8') {
            return '.S';
          }
          return '.U';
        }
        // if format is signed
        if (sparkFormat === 'int32') {
          return '.L';
        }
        // default for these registers


        break;
      }
      default:
    }

    // return an empty string if no adjustment to the default
    return '';
  }

  // helper function triggered when we get string data from serial client
  function onSerialDataFunction(data) {
    // if we are not connected yet
    if (startCommsSuccess === false) {
      // this should be a connected response packet
      if (data.trim() !== 'CC') {
        // if not callback with appropriate error
        onOpenCallback(new Error('Problem connecting to Keyence. Start Communication failed'));
      } else {
        // otherwise mark that we are now connected
        startCommsSuccess = true;
        updateConnectionStatus(true);
        // set up a repeat task to trigger the requests
        timer = setInterval(requestTimer, requestFrequencyMs);
        // and trigger callback on succesful connection
        onOpenCallback(null);
      }
    } else if (data.trim() === 'CF') {
      // if we are connected first check for a disconnect response
      // mark that we are now disconnected
      endCommsSuccess = true;
      // close and trigger correct callback on succesful disconnect
      that.serialPort.close(onCloseCallback);
    } else {
      // otherwise process the data as a response, removing any cr/lf at the end
      processResponseData(data.trim());
    }
  }

  function clientConnection() {
    // try and connect to server
    // console.log('----client - net.createConnection');
    client = net.createConnection(hostPort, hostIP, () => {
      // succesfully connected to server
      // console.log('----client - net.createConnection callback');
      log.info(`Connected to server: ${hostIP}:${hostPort}`);
      updateConnectionStatus(true);
      alert.clear('connection-error');

      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      // set up a repeat task to trigger the requests
      timer = setInterval(requestTimer, requestFrequencyMs);
    });

    client.on('connect', () => {
      // console.log('----client on connect');
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    });

    client.on('error', (error) => {
      // failed to connect to server, trigger a callback error
      // console.log(`------------client.on - error: ${error}`);
      log.debug(`clientConnection - on error${error}`);
      if (!machineShutdown) {
        // console.log('------------client.on - error: removeAllListeners');
        client.removeAllListeners();
        // console.log('------------client.on - error: destroy');
        client.destroy();
        updateConnectionStatus(false);
        alert.raise({ key: 'connection-error' });

        if (timer) {
          clearInterval(timer);
          timer = null;
        }

        if (reconnectTimer) {
          clearInterval(reconnectTimer);
          reconnectTimer = null;
        }

        // console.log('------------client.on - error: set reconnectTimer');
        // set a timer to attempt to reconnect
        reconnectTimer = setTimeout(() => {
          // console.log('reconnectTimer timeout - trying to reconnect');
          clientConnection();
        }, connectionRetryFrequency);
      }
    });

    // subscribe to on 'data' events
    client.on('data', (data) => {
      // got data from server, process it as a string, removing any cr/lf at the end
      processResponseData(data.toString().trim());
    });

    // subscribe to on 'end' events
    client.on('end', () => {
      // console.log('------------client.on - end');
      if (!machineShutdown) {
        updateConnectionStatus(false);
        alert.raise({ key: 'connection-error' });
        // stop the request timer task if applicable

        if (timer) {
          clearInterval(timer);
          timer = null;
          sendingActive = false;
        }

        if (writeTimer) {
          clearTimeout(writeTimer);
          writeTimer = null;
        }

        if (reconnectTimer) {
          clearInterval(reconnectTimer);
          reconnectTimer = null;
        }

        // set a timer to attempt to reconnect
        reconnectTimer = setTimeout(() => {
          // console.log('reconnectTimer timeout - trying to reconnect');
          clientConnection();
        }, connectionRetryFrequency);
      }
    });
  }

  function open(callback) {
    interfaceType = that.machine.settings.model.interface;
    requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    const { variables } = that.machine;

    // build an array of variables to be read, including access property
    variableReadArray = [];
    async.forEachSeries(variables, (item, seriesCb) => {
      const itemWithAccess = item;
      if (!(item.access === 'write' || item.access === 'read')) {
        itemWithAccess.access = 'read';
      }
      if (itemWithAccess.access === 'read') {
        variableReadArray.push(itemWithAccess);
      }
      return seriesCb();
    });

    // convert the variables array to an object for easy searching when writing variables
    // and filter it down to just 'write' variables
    variablesWriteObj = _.keyBy(_.filter(variables,
      variable => (variable.access === 'write')), 'name');

    // form the array of requests to be sent
    for (let i = 0; i < variableReadArray.length; i += 1) {
      const format = calcuateDataFormat(variableReadArray[i].name,
        variableReadArray[i].format, variableReadArray[i].memoryArea);
      // form the message
      const keyenceVariableRequest = `RD ${variableReadArray[i].memoryArea}${variableReadArray[i].address}${format}${CR}${LF}`;

      // store each request in the array
      variableRequests.push(keyenceVariableRequest);
    }

    // check whether configured for ethernet or serial
    if (interfaceType === 'ethernet') {
      // get the ip address to use and convert the chosen port number from string to number
      hostIP = that.machine.settings.model.ipAddress;
      hostPort = that.machine.settings.model.port;

      clientConnection();
      callback(null);
    } else {
      // store a reference to the open callback
      onOpenCallback = callback;
      // get the serial specific configuration
      const { device } = that.machine.settings.model;
      const baudRate = parseInt(that.machine.settings.model.baudRate, 10);

      // create a serial port with the correct configuration
      that.serialPort = new SerialPort(device, {
        baudRate,
        parity: 'even',
        autoOpen: false,
      });

      const { Readline } = SerialPort.parsers;
      let parser;
      if (!testing) {
        parser = that.serialPort.pipe(new Readline());
      }

      // attempt to open the serial port
      that.serialPort.open((err) => {
        if (err) {
          updateConnectionStatus(false);
          alert.raise({ key: 'connection-error' });
          return callback(err);
        }

        // clear the alert when it gets connected
        alert.clear('connection-error');

        // subscribe to on 'data' events
        if (!testing) {
          parser.on('data', onSerialDataFunction);
        } else {
          that.serialPort.on('data', onSerialDataFunction);
        }

        // subscribe to on 'close' events
        that.serialPort.on('close', () => {
          log.debug('Serial port closed');
          updateConnectionStatus(false);
          if (!machineShutdown) {
            alert.raise({ key: 'connection-error' });
          }

          // stop the request timer task
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          if (writeTimer) {
            clearTimeout(writeTimer);
            writeTimer = null;
          }
          // reset flags
          sendingActive = false;
        });

        // send the 'start communication' message (reset success flag first)
        startCommsSuccess = false;
        that.serialPort.write(`CR${CR}${LF}`, (writeErr) => {
          if (writeErr) {
            return callback(writeErr);
          }
          // start a timout function incase we get no response
          setTimeout(() => {
            // if we had no response to our 'Start Communication' message
            if (startCommsSuccess === false) {
              updateConnectionStatus(false);
              alert.raise({ key: 'connection-error' });

              // close and try to reconnect
              serialReconnect();

              // callback with appropriate error
              onOpenCallback(new Error('Problem connecting to Keyence. Start Communication failed'));
            }
          }, 2000);

          return undefined;
        });

        return undefined;
      });
    }
  }

  function serialCloseHelper(callback) {
    updateConnectionStatus(false);

    // store a reference to the close callback
    onCloseCallback = callback;
    if (that.serialPort.isOpen) {
      // if we are 'connected'
      if (startCommsSuccess === true) {
        // we need to send an 'end communication' message before closing the port
        // (reset success flag first)
        endCommsSuccess = false;
        that.serialPort.write(`CQ${CR}${LF}`, (err) => {
          if (err) {
            that.serialPort.close(onCloseCallback);
          } else {
            // start a timout function incase we get no response
            setTimeout(() => {
              // if we had no response to our 'end Communication' message
              if (endCommsSuccess === false) {
                // just close the port
                that.serialPort.close(onCloseCallback);
              }
            }, 2000);
          }
        });
      } else {
        that.serialPort.close(onCloseCallback);
      }
    } else {
      // if serial port is not open, then just call the callback immeditalely
      onCloseCallback();
    }
  }

  function ethernetCloseHelper(callback) {
    client.destroy();
    callback();
  }

  function close(callback) {
    // if we are currently in a request/response cycle
    if ((sendingActive === true)) {
      let waitCounter = 0;
      const activeWait = setInterval(() => {
        if ((sendingActive === false) || (waitCounter > 20)) {
          clearInterval(activeWait);
          sendingActive = false;
          if (interfaceType === 'ethernet') {
            ethernetCloseHelper(callback);
          } else {
            serialCloseHelper(callback);
          }
        }
        waitCounter += 1;
      }, 100); // interval set at 100 milliseconds
    } else if (interfaceType === 'ethernet') { // otherwise close immeditalely
      ethernetCloseHelper(callback);
    } else {
      serialCloseHelper(callback);
    }
  }


  this.writeData = function writeData(value, done) {
    // ignore if already waiting for a write command to complete
    if (writeTimer) return;

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

    // get any required format suffix
    const format = calcuateDataFormat(variable.name, variable.format, variable.memoryArea);

    // form the command
    const writeCommand = `WR ${variable.memoryArea}${variable.address
    }${format} ${convertValueToString(variable.format, value[variableName])}${CR}${LF}`;

    // create a timer to wait for the OK response
    writeTimer = setTimeout(() => {
      writeTimer = null;
      alert.raise({ key: 'write-error', errorMsg: 'No response from PLC' });
    }, WRITE_TIMEOUT);

    // send the command
    if ((interfaceType === 'ethernet') && (client !== null)) {
      client.write(writeCommand);
    } else if ((interfaceType === 'serial') && (that.serialPort.isOpen)) {
      that.serialPort.write(writeCommand, (err) => {
        if (err) {
          log.error(`Error sending write command: ${err}`);
        }
      });
    }

    done();
  };

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
    machineShutdown = false;
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
    updateConnectionStatus(false);

    if (!that.machine) {
      return done('machine undefined');
    }

    // stop the request timer task (if being used)
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (writeTimer) {
      clearInterval(writeTimer);
      writeTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    machineShutdown = true;
    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }

      // close interface if open
      if (client || that.serialPort) {
        close((closeErr) => {
          if (closeErr) {
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
        // reset flags
        sendingActive = false;
        // clear list of variables
        variableRequests = [];

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
  hpl: hplKeyenceHostlink,
  defaults,
  schema,
};
