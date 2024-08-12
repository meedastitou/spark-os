/* jshint esversion: 6 */
/* eslint no-bitwise: ["error", { "allow": ["^="] }] */
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
const hplSikora = function hplSikora(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'request-error': {
      msg: 'Sikora: Error Sending Request',
      description: x => `An error occurred sending a request on the serial port. Error: ${x.errorMsg}. Check the serial port configuration and connection.`,
    },
    'request-ignored': {
      msg: 'Sikora: New Request Ignored',
      description: 'New request ignored as still processing last request. Check the serial port configuration and connection.',
    },
    'database-error': {
      msg: 'Sikora: Error Writing to Database',
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
    'close-error': {
      msg: 'Sikora: Error Closing Serial Connection',
      description: x => `An error occurred while trying to close the serial connection to the PLC. Error: ${x.errorMsg}`,
    },
  });

  // Private variables
  const that = this;
  let sendingActive = false;
  let timer = null;
  let resultsArray = [];
  let requestBlockedCounter = 0;
  let bValueVariables = false;
  let bSettingVariables = false;
  let bSettingRequestPending = false;
  let sRequestType = '';

  // the type of requests that may be made
  const VALUE_REQUEST = 'value';
  const SETTING_REQUEST = 'setting';

  // the requests of data from the machine for values and settings
  const valuesRequestPayload = Buffer.from([0x1B, 0x31, 0x0D, 0x0A, 0x36]);
  const settingsRequestPayload = Buffer.from([0x1B, 0x32, 0x0D, 0x0A, 0x36]);

  // variable and constants to define the received data state machine
  const ESC = 0x1B;
  const CR = 0x0D;
  const WAITING_FOR_ESC = 0;
  const RECEIVING_DATA = 1;
  const WAITING_FOR_LF = 2;
  const WAITING_FOR_CSUM = 3;
  let receiveState = WAITING_FOR_ESC;
  let receivedString = '';
  let receivedDataCheckSum = 0;

  // public variables
  that.serialPort = null;
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  function sendRequest(bValueRequest) {
    // make a serial request for the data, either for values or for settings
    sendingActive = true;
    receiveState = WAITING_FOR_ESC;
    sRequestType = bValueRequest ? VALUE_REQUEST : SETTING_REQUEST;
    that.serialPort.write(bValueRequest ? valuesRequestPayload : settingsRequestPayload, (err) => {
      if (err) {
        alert.raise({ key: 'request-error', errorMsg: err.message });
        sendingActive = false;
      } else {
        alert.clear('request-error');
      }
    });
  }

  function convertType(format, resultAsString) {
    if (resultAsString !== null) {
      let result;
      switch (format) {
        case 'char':
        {
          result = resultAsString;
          break;
        }
        case 'int8':
        case 'int16':
        case 'int32':
        case 'int64':
        case 'uint8':
        case 'uint16':
        case 'uint32':
        case 'uint64':
        {
          const isNumberInt = /^[0-9]+$/.test(resultAsString);
          if (isNumberInt) {
            result = parseInt(resultAsString, 10);
          } else {
            result = null;
          }
          break;
        }
        case 'float':
        case 'double':
        {
          const isNumber = /^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$/.test(resultAsString);
          if (isNumber) {
            result = parseFloat(resultAsString);
          } else {
            result = null;
          }
          break;
        }
        case 'bool':
        {
          result = resultAsString === 'true';
          break;
        }
        default:
        {
          result = null;
          break;
        }
      }

      return result;
    }
    return null;
  }

  function saveResultsToDb(doneCallback) {
    // process the array of results
    async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
      const variable = that.machine.variables[index];

      // if there wasn't a result
      if (dataItem === null) {
        // it has the correct request type, there should be a result, so give an error
        if (variable.requestType === sRequestType) {
          // highlight that there was an error getting this variables data
          alert.raise({
            key: `read-fail-${variable.name}`,
            msg: 'Sikora: Read Failed for Variable',
            description: `Read failed for variable '${variable.name}'. Check that this variable is defined correctly in the machine.`,
          });
        } else {
          alert.clear(`read-fail-${variable.name}`);
        }

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
    },
    // callback to say results saving is done
    () => {
      doneCallback(null);
    });
  }

  // private methods
  function processResponseData(data) {
    switch (receiveState) {
      // if waiting for ESC character and received, move to receiving data
      case WAITING_FOR_ESC:
        if (data === ESC) {
          receiveState = RECEIVING_DATA;
          receivedString = '';
          receivedDataCheckSum = 0;
        }
        return;

        // if receiving data, and not CR, add it to the string
      case RECEIVING_DATA:
        receivedDataCheckSum ^= data;
        if (data === CR) {
          receiveState = WAITING_FOR_LF;
          return;
        }
        receivedString += String.fromCharCode(data);
        return;

        // if waiting for LF, move to waiting for checksum
      case WAITING_FOR_LF:
        receiveState = WAITING_FOR_CSUM;

        // compute final checksum XOR and add 0x20 of < 0x20
        receivedDataCheckSum ^= data;
        if (receivedDataCheckSum < 0x20) receivedDataCheckSum += 0x20;
        return;

        // if waiting for checksum, if it is correct process the complete message,
        // otherwise wait for next one
      case WAITING_FOR_CSUM:
        receiveState = WAITING_FOR_ESC;
        if (data !== receivedDataCheckSum) {
          sendingActive = false;
          return;
        }
        break;

      default:
        return;
    }

    // point to the variable array
    const { variables } = that.machine;

    // reset results array
    resultsArray = [];

    // loop through the stored variable array
    for (let iVar = 0; iVar < variables.length; iVar += 1) {
      // start with a null value in case it is the wrong request type or
      // we do not have valid data for this variable
      let processedValue = null;

      // if this is the correct type of request add its results to the results array
      const variable = variables[iVar];
      if (variable.requestType === sRequestType) {
        // extract this variable's value (as a string) using its offset and length parameters
        const varAsString = receivedString.substr(variable.charOffset, variable.charLength).trim();

        // if some data is found
        if (varAsString.length > 0) {
          // convert type based on variables format property
          processedValue = convertType(variable.format, varAsString);
        }
      }

      // store the date, if any, in the variable's results array
      resultsArray.push(processedValue);
    }

    // we have finished processing this response
    sendingActive = false;

    // must complete saving result before sending another request
    async.series([
      (callback) => {
        // save all results to the database
        saveResultsToDb(callback);
      },
      (callback) => {
        // if there is a setting request pending, send the request
        if (bSettingRequestPending) {
          bSettingRequestPending = false;
          sendRequest(false);
        }
        callback(null);
      },
    ]);
  }

  function requestTimer() {
    // only start a new request if previous set has finished
    // (although allow for failed response by adding a counter )
    if ((sendingActive === false) || (requestBlockedCounter > 3)) {
      alert.clear('request-ignored');

      // reset storage and index for starting a new request set
      requestBlockedCounter = 0;

      if (that.serialPort.isOpen) {
        // set the a request: value request if any, otherwise a settings request
        sendRequest(bValueVariables);

        // if both value and setting requests, set flag for pending settings requests
        bSettingRequestPending = bValueVariables && bSettingVariables;
      }
      // now wait for processResponseData method to be called by 'on data'
    } else {
      requestBlockedCounter += 1;
      alert.raise({ key: 'request-ignored' });
    }
  }

  function open(callback) {
    const requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;

    const { device } = that.machine.settings.model;
    const baudRate = parseInt(that.machine.settings.model.baudRate, 10);
    const { parity } = that.machine.settings.model;
    const dataBits = parseInt(that.machine.settings.model.dataBits, 10);
    const stopBits = parseInt(that.machine.settings.model.stopBits, 10);

    // create a serial port with the correct configuration
    that.serialPort = new SerialPort(device, {
      baudRate,
      dataBits,
      stopBits,
      parity,
      autoOpen: false,
    });

    // attempt to open the serial port
    that.serialPort.open((err) => {
      if (err) {
        return callback(err);
      }

      // read data that is available but keep the stream from entering "flowing mode"
      that.serialPort.on('readable', () => {
        const data = that.serialPort.read();

        // only attempt processing if we are expecting it
        if (sendingActive === true) {
          // otherwise send each byte for processing
          for (let iBuf = 0; iBuf < data.length; iBuf += 1) {
            processResponseData(data[iBuf]);
          }
        }
      });

      // subscribe to on 'close' events
      that.serialPort.on('close', () => {
        log.debug('Serial port closed');

        // stop the request timer task
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        // reset flags
        sendingActive = false;
      });

      // set up a repeat task to trigger the requests
      timer = setInterval(requestTimer, requestFrequencyMs);

      // trigger callback on succesful connection
      callback(null);

      return undefined;
    });
  }

  function close(callback) {
    sendingActive = false;
    if (that.serialPort.isOpen) {
      that.serialPort.close(callback);
    } else {
      callback();
    }
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

    // determine whether any variables are for values and/or settings
    bValueVariables = false;
    bSettingVariables = false;
    const { variables } = that.machine;
    for (let iVar = 0; iVar < variables.length; iVar += 1) {
      if (variables[iVar].requestType === 'setting') {
        bSettingVariables = true;
      } else {
        bValueVariables = true;
      }
    }

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
      alert.clearAll(() => done('machine undefined'));
    }

    // stop the request timer task (if being used)
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    // close interface if open
    if (that.serialPort) {
      close((err) => {
        if (err) {
          alert.raise({ key: 'close-error', errorMsg: err.message });
        } else {
          alert.clear('close-error');
        }
        that.serialPort = null;
        // reset flags
        sendingActive = false;

        log.info('Stopped');
        alert.clearAll(() => done(null));
      });
    } else {
      log.info('Stopped');
      alert.clearAll(() => done(null));
    }
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
  hpl: hplSikora,
  defaults,
  schema,
};
