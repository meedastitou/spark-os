/* jshint esversion: 6 */
/* eslint max-len: ["error", { "code": 100, "ignoreComments": true, "ignoreStrings": true, "ignoreTemplateLiterals": true}] */
const _ = require('lodash');
const async = require('async');
const transportModule = require('./transport/index.js');

const defaults = require('./defaults.json');
const schema = require('./schema.json');


// constructor
const hplArburg = function hplArburg(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'request-error': {
      msg: 'Arburg: Error Sending Request',
      description: x => `Error occurred while sending a request.  Error: ${x.errorMsg}`,
    },
    'transaction-id-mismatch': {
      msg: 'Arburg: Transaction ID Mismatch',
      description: 'Mismatch between transcation IDs in response.',
    },
    'procedure-control-field-incorrect': {
      msg: 'Arburg: Procedural Control Field Incorrect',
      description: 'Procedural control field in response is incorrect.',
    },
    'action-command-field-incorrect': {
      msg: 'Arburg: Action Command Field Incorrect',
      description: 'Action command field in response is incorrect.',
    },
    'response-error-code': {
      msg: 'Arburg: Response Error Code Received',
      description: x => `Receieved a diagnostic response error code of ${x.errorCode}`,
    },
    'invalid-group-header': {
      msg: 'Arburg: Invalid Data Stream Group Header',
      description: 'Invalid data stream grouper header in response.',
    },
    'unexpected-response-size': {
      msg: 'Arburg: Unexepected Response Size',
      description: x => `Unexepected response size: Received: ${x.received} bytes, Expected ${x.expected} bytes.`,
    },
    'database-error': {
      msg: 'Arburg: Error Writing to Database',
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
    'disconnected-error': {
      msg: 'Arburg: Disconnected - Trying to Reconnect',
      description: 'The serial connection to the machine has been lost - trying to reconnect.',
    },
  });

  // Private variables
  const that = this;
  let timer = null;
  let disconnectedTimer = null;
  let connectionReported = false;
  let currentTransactionNumber = 0;
  let reconnectTimer = null;
  let requestFrequencyMs = null;
  let variableReadArray = [];

  const APP_STATUS_REQUEST_MESSAGE = [0x1F, 0x82, 0x00, 0x00, 0x20, 0x01, 0x29, 0x01];
  const APP_STATUS_RESPONSE_HEADER_SIZE = 12;
  const TRANSACTION_NUM_OFFSET = 2;
  const PROCEDURAL_CONTROL_OFFSET = 4;
  const ACTION_COMMAND_OFFSET = 6;
  const DS_DI_OFFSET = 8;
  const DI_ERROR_OFFSET = 9;
  const STATUS_RESPONSE_SIZE_OFFSET = 10;

  const FRS_PROCEDURAL_CONTROL = 0x2003;
  const STATUS_ACTION_COMMAND = 0x2901;
  const DI_HEADER_VALUE = 0x27;
  const DS_HEADER_VALUE = 0x0582;

  // offset to status header
  const STATUS_RESPONSE_MSG_HEADER_OFFSET = 12;
  const STATUS_RESPONSE_MSG_HEADER_SIZE = 18;
  // offsets within status header
  const BASE_STATUS_OFFSET_OFFSET = 2;
  const STRING_ENCODING_OFFSET = 4;
  const CYLINDER_UNITS_INFO_OFFSET = 6;
  const CYLINDER_UNITS_STATUS_OFFSET = 8;
  const AUTOMATION_COMPONTENTS_INFO_OFFSET = 10;
  const AUTOMATION_UNITS_STATUS_OFFSET = 12;
  const ALARM_LENGTH_OFFSET = 14;
  const ALARM_MSG_OFFSET = 16;

  // base status size
  const BASE_STATUS_SIZE = 160;
  // cylinder process data size
  const CYLINDER_PROCESS_DATA_SIZE = 60;
  // automation data size
  const AUTOMATION_DATA_SIZE = 22;

  // public variables
  that.transport = null;
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

  // debug function for dumping the contents of a a buffer in easy-to-read format, 16 bytes per line
  //   function dumpBuffer(buffer) {
  //    var str = '';
  //    for (var i = 0; i < buffer.length; ++i) {
  //      if (buffer[i] < 16) {
  //        str += '0' + buffer[i].toString(16) + ' ';
  //      }
  //      else {
  //        str += buffer[i].toString(16) + ' ';
  //      }
  //      if ((((i + 1) % 16) === 0) || ((i + 1) == buffer.length)) {
  //        console.log(str);
  //        str = '';
  //      }
  //    }
  //  }

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

  function requestTimer() {
    if (!that.transport.isOpen) {
      // eslint-disable-next-line no-use-before-define
      close(() => {});
      clearInterval(timer);
      timer = null;
      // eslint-disable-next-line no-use-before-define
      reconnect();
      alert.raise({ key: 'disconnected-error' });
      return null;
    }

    if (that.transport !== null) {
      // increment transaction number for each request
      // eslint-disable-next-line max-len
      currentTransactionNumber = (currentTransactionNumber !== 65535) ? currentTransactionNumber + 1 : 0;

      // form 'machine status' request with new transaction number inserted
      const applicationRequestMessage = Buffer.from(APP_STATUS_REQUEST_MESSAGE);
      applicationRequestMessage.writeUInt16BE(currentTransactionNumber, TRANSACTION_NUM_OFFSET);

      // make a transport request for the machine status
      that.transport.sendMessageForResponse(applicationRequestMessage, (err, response) => {
        if (err) {
          alert.raise({ key: 'request-error', errorMsg: err.message });
          return;
        }

        alert.clear('request-error');

        // eslint-disable-next-line no-use-before-define
        processResponseData(response);
      });
    }
    return undefined;
  }

  function extractData(buffer, format, offset, length) {
    // place buffer reads in a try/catch block as can cause an assert if offset requested is outside the buffer's range
    try {
      // extract data based on format
      switch (format) {
        case 'char': {
          // trim strings as they are 'right aligned'
          return buffer.toString('ascii', offset, offset + length).trim();
        }
        case 'bool': {
          return (buffer.readUInt8(offset) !== 0);
        }
        case 'float': {
          return buffer.readFloatLE(offset);
        }
        case 'uint32': {
          return buffer.readUInt32LE(offset);
        }
        case 'int32': {
          return buffer.readInt32LE(offset);
        }
        case 'uint16': {
          return buffer.readUInt16LE(offset);
        }
        case 'int16': {
          return buffer.readInt16LE(offset);
        }
        case 'uint8': {
          return buffer.readUInt8(offset);
        }
        case 'int8': {
          return buffer.readInt8(offset);
        }
        default: {
          return null;
        }
      }
    } catch (e) {
      // return null if buffer request was outside its range
      return null;
    }
  }

  // helper function to save array of collected results to the database
  function saveResultsToDb(resultsArray) {
    // process the array of results
    async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
      const variable = that.machine.variables[index];
      // if there wasn't a result
      if (dataItem === null) {
        // highlight that there was not any data for this variable
        alert.raise({
          key: `var-error-${variable.name}`,
          msg: `Arburg: No Data Available For Variable ${variable.name}`,
          description: `Check Block Location and Offset are correct for variable '${variable.name}'. Note that some block locations are optional`,
        });
        // and just move onto next item
        return callback();
      }
      alert.clear(`var-error-${variable.name}`);

      // otherwise update the database
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
    });
  }

  function processResponseData(data) {
    // check transaction number matches request
    const responseTransactionNumber = data.readUInt16BE(TRANSACTION_NUM_OFFSET);
    if (responseTransactionNumber !== currentTransactionNumber) {
      alert.raise({ key: 'transaction-id-mismatch' });
      return;
    }
    alert.clear('transaction-id-mismatch');

    // check procedural control field
    const proceduralControlField = data.readUInt16BE(PROCEDURAL_CONTROL_OFFSET);
    if (proceduralControlField !== FRS_PROCEDURAL_CONTROL) {
      alert.raise({ key: 'procedure-control-field-incorrect' });
      return;
    }
    alert.clear('procedure-control-field-incorrect');

    // check action command  field
    const actionCommandField = data.readUInt16BE(ACTION_COMMAND_OFFSET);
    if (actionCommandField !== STATUS_ACTION_COMMAND) {
      alert.raise({ key: 'action-command-field-incorrect' });
      return;
    }
    alert.clear('action-command-field-incorrect');

    // check if DS or DI code follows
    const diOrDsField = data.readUInt8(DS_DI_OFFSET);
    if (diOrDsField === DI_HEADER_VALUE) {
      // its a DI header, get the error code
      const diErrorField = data.readUInt8(DI_ERROR_OFFSET);
      alert.raise({ key: 'response-error-code', errorCode: diErrorField });
      return;
    }
    alert.clear('response-error-code');

    // check data stream grouper header field
    const dsField = data.readUInt16BE(DS_DI_OFFSET);
    if (dsField !== DS_HEADER_VALUE) {
      alert.raise({ key: 'invalid-group-header' });
      return;
    }
    alert.clear('invalid-group-header');

    // check data stream grouper size field (size given should be size of the application status message minus the application status header)
    const responseSize = data.readUInt16BE(STATUS_RESPONSE_SIZE_OFFSET);
    if (responseSize !== data.length - APP_STATUS_RESPONSE_HEADER_SIZE) {
      alert.raise({ key: 'unexpected-response-size', received: (data.length - APP_STATUS_RESPONSE_HEADER_SIZE), expected: responseSize });
      return;
    }
    alert.clear('unexpected-response-size');
    // status sub sections, some are optional and so may remain null
    let statusMsgHeader = null;
    let baseStatus = null;
    let cylinder1ProcessData = null;
    let cylinder2ProcessData = null;
    let automationData = null;
    let alarmMessage = null;

    // process the status header block to see what other blocks are valid (NOTE PAYLOAD is LE not BE as per headers)
    // eslint-disable-next-line max-len
    statusMsgHeader = data.slice(STATUS_RESPONSE_MSG_HEADER_OFFSET, STATUS_RESPONSE_MSG_HEADER_OFFSET + STATUS_RESPONSE_MSG_HEADER_SIZE);

    // get base status offset and extract it
    // eslint-disable-next-line max-len
    const offsetToBaseStatus = STATUS_RESPONSE_MSG_HEADER_OFFSET + statusMsgHeader.readUInt16LE(BASE_STATUS_OFFSET_OFFSET);
    baseStatus = data.slice(offsetToBaseStatus, offsetToBaseStatus + BASE_STATUS_SIZE);

    // get ascii or unicode encoding offset and extract it
    const stringEncoding = (statusMsgHeader.readUInt16LE(STRING_ENCODING_OFFSET) === 0) ? 'ascii' : _.get(that.machine.settings.model, 'unicodeEncoding', 'utf16le');

    // find out which cyclinders are active and extract their data
    const activeCyclinders = statusMsgHeader.readUInt16LE(CYLINDER_UNITS_INFO_OFFSET);
    if (activeCyclinders > 0) {
      // eslint-disable-next-line no-bitwise
      const cyclinder1Active = (activeCyclinders & 0x01) > 0;
      // eslint-disable-next-line no-bitwise
      const cyclinder2Active = (activeCyclinders & 0x02) > 0;
      // eslint-disable-next-line max-len
      const offsetToCylinderStatus = STATUS_RESPONSE_MSG_HEADER_OFFSET + statusMsgHeader.readUInt16LE(CYLINDER_UNITS_STATUS_OFFSET);
      if (cyclinder1Active && cyclinder2Active) {
        // eslint-disable-next-line max-len
        cylinder1ProcessData = data.slice(offsetToCylinderStatus, offsetToCylinderStatus + CYLINDER_PROCESS_DATA_SIZE);
        // eslint-disable-next-line max-len
        cylinder2ProcessData = data.slice(offsetToCylinderStatus + CYLINDER_PROCESS_DATA_SIZE, offsetToCylinderStatus + (2 * CYLINDER_PROCESS_DATA_SIZE));
      } else if (cyclinder1Active) {
        // eslint-disable-next-line max-len
        cylinder1ProcessData = data.slice(offsetToCylinderStatus, offsetToCylinderStatus + CYLINDER_PROCESS_DATA_SIZE);
      } else if (cyclinder2Active) {
        // eslint-disable-next-line max-len
        cylinder2ProcessData = data.slice(offsetToCylinderStatus, offsetToCylinderStatus + CYLINDER_PROCESS_DATA_SIZE);
      }
    }

    // find out if there is any automation component data
    // eslint-disable-next-line max-len
    const automationComponentActive = (statusMsgHeader.readUInt16LE(AUTOMATION_COMPONTENTS_INFO_OFFSET) > 0);
    if (automationComponentActive) {
      // eslint-disable-next-line max-len
      const offsetToAutomationStatus = STATUS_RESPONSE_MSG_HEADER_OFFSET + statusMsgHeader.readUInt16LE(AUTOMATION_UNITS_STATUS_OFFSET);
      // eslint-disable-next-line max-len
      automationData = data.slice(offsetToAutomationStatus, offsetToAutomationStatus + AUTOMATION_DATA_SIZE);
    }

    // find out if there is an alarm message
    const alarmTextLength = statusMsgHeader.readUInt16LE(ALARM_LENGTH_OFFSET);
    if (alarmTextLength > 0) {
      // eslint-disable-next-line max-len
      const offsetToAlarmMsg = STATUS_RESPONSE_MSG_HEADER_OFFSET + statusMsgHeader.readUInt16LE(ALARM_MSG_OFFSET);
      alarmMessage = data.slice(offsetToAlarmMsg, offsetToAlarmMsg + alarmTextLength);
    }

    // if any alarm, and not 16-bit encoding, strip out nonprintable characters from the start of the alarm, convert interior ones to dashes
    if ((alarmTextLength > 0) && (stringEncoding !== 'utf16le')) {
      let iAlarmMsgStrip = 0;
      for (let iAlarmMsgOrig = 0; iAlarmMsgOrig < alarmTextLength; iAlarmMsgOrig += 1) {
        if (alarmMessage[iAlarmMsgOrig] < 0x20) {
          if (iAlarmMsgStrip > 0) {
            alarmMessage[iAlarmMsgStrip] = 0x2D; // convert to dash (ascii code 2D)
            iAlarmMsgStrip += 1;
          }
        } else {
          alarmMessage[iAlarmMsgStrip] = alarmMessage[iAlarmMsgOrig];
          iAlarmMsgStrip += 1;
        }
      }
      alarmMessage = alarmMessage.slice(0, iAlarmMsgStrip);
    }

    // now process the variable list and extract each variable from the relevant block and write to database

    // point to the variable array
    const { variables } = that.machine;

    // create an empty results array
    const resultsArray = [];
    // loop through the stored variable list
    for (let i = 0; i < variables.length; i += 1) {
      let value = null;
      const valueCharLength = _.get(variables[i], 'length', 1);
      let buffer = null;

      if (variables[i].blockLocation === 'Basic Status') {
        buffer = baseStatus;
      } else if (variables[i].blockLocation === 'Process Data 1st Cylinder') {
        buffer = cylinder1ProcessData;
      } else if (variables[i].blockLocation === 'Process Data 2nd Cylinder') {
        buffer = cylinder2ProcessData;
      } else if (variables[i].blockLocation === 'Automation Components') {
        buffer = automationData;
      } else if (variables[i].blockLocation === 'Alarm String') {
        // ignore using function to extract data (format and offset are not used as should be a single string)
        value = alarmTextLength !== 0 ? alarmMessage.toString(stringEncoding) : '';
        // check if we're got an empty alarm string.  If so, check if we've been
        // instructed to convert it to some other string (for easier processing).
        if ((value === null) || (value === '')) {
          if (({}).hasOwnProperty.call(variables[i], 'alarmStringNullReplacement')) {
            value = variables[i].alarmStringNullReplacement;
          }
        }
      }

      // if we need to extract data from buffer (e.g location set correctly and was not an Alarm String)
      // also don't call if buffer is null (some buffers are only optionally returned)
      if (value === null && buffer !== null) {
        value = extractData(buffer, variables[i].format, variables[i].byteOffset, valueCharLength);
      }

      // store value for this variable in array (value may be null)
      resultsArray.push(value);
    }
    // save all results to the database
    saveResultsToDb(resultsArray);
  }

  function open(callback) {
    // extract the configuration
    requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    const { device } = that.machine.settings.model;
    const baudRate = parseInt(that.machine.settings.model.baudRate, 10);

    // create a transport with the correct configuration
    // eslint-disable-next-line new-cap
    that.transport = new transportModule(device, baudRate);

    // reset the transaction number back to zero
    currentTransactionNumber = 0;

    // attempt to open the transport
    that.transport.openTransport((err) => {
      if (err) {
        disconnectDetected();
        updateConnectionStatus(false);
        return callback(err);
      }
      connectionDetected();
      updateConnectionStatus(true);
      // set up a repeat task to trigger the requests
      timer = setInterval(requestTimer, requestFrequencyMs);

      // trigger callback on succesful connection
      return callback(null);
    });
  }

  function reconnect() {
    log.debug(`Reconnecting hpl ${machine.info.name}..`);
    reconnectTimer = setInterval(() => {
      that.transport.openTransport(() => {
        if (that.transport.isOpen) {
          timer = setInterval(requestTimer, requestFrequencyMs);
          clearInterval(reconnectTimer);
          alert.clear('disconnected-error');
        }
      });
    }, requestFrequencyMs + 3000);
  }

  function close(callback) {
    updateConnectionStatus(false);

    // attempt to close the transport
    that.transport.closeTransport((err) => {
      if (err) {
        return callback(err);
      }
      disconnectDetected();
      updateConnectionStatus(false);
      // trigger callback on succesful close
      return callback(null);
    });
  }

  // Privileged methods
  this.start = function start(dataCb, configUpdateCb, done) {
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

    variableReadArray = [];

    // add the access property if it is not defined explicitly
    async.forEachOfSeries(that.machine.variables, (item, index, callback) => {
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
    updateConnectionStatus(false);

    // stop the request timer task (if being used)
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    // close interface if open
    if (that.transport) {
      close(() => {
        that.transport = null;

        log.info('Stopped');
        alert.clearAll(() => done(null));
      });
    } else {
      disconnectDetected();
      updateConnectionStatus(false);
      log.info('Stopped');
      alert.clearAll(() => done(null));
    }
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
  hpl: hplArburg,
  defaults,
  schema,
};
