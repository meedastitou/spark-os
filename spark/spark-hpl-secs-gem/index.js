/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const net = require('net');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplSecsGem = function hplSecsGem(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;

  const DATA_COMPLETE_TIMEOUT = 500;
  const COMM_TIMEOUT = 2000;
  const WRITE_TIMEOUT = 2000;
  const RECONNECT_TIMER = 5000;
  const reconnectTimerValue = RECONNECT_TIMER;
  // const MAX_RECONNECT_TIMER = 2 * 60 * 1000; // 2 minutes
  let reconnectCount = 1;
  const MAX_RECONNECT_TRYS_BEFORE_SPARK_HARDWARE_RESTART = 3;

  const WAIT_NONE = 0; // normal commState when we're not sending anything or expecting a reply
  const SEND_SELECT_RESPONSE = 1;
  const WAIT_SELECT_RESPONSE = 2;
  const SEND_ESTABLISH_COMM_REQUEST = 3;
  const WAIT_ESTABLISH_COMM_REQUEST = 4;
  const WAIT_ESTABLISH_COMM_RESPONSE = 5;
  const SEND_ENABLE_ALARMS = 6;
  const WAIT_ENABLE_ALARMS_ACK = 7;
  const SEND_DELETE_REPORT = 8;
  const WAIT_DELETE_REPORT_ACK = 9;
  const SEND_DEFINE_REPORT = 10;
  const WAIT_DEFINE_REPORT_ACK = 11;
  const SEND_LINK_REPORT = 12;
  const WAIT_LINK_REPORT_ACK = 13;
  const SEND_EVENT_ENABLE = 14;
  const WAIT_EVENT_ENABLE_ACK = 15;
  const SEND_STATUS_VARIABLES_REQUEST = 16;
  const WAIT_STATUS_VARIABLES_RESPONSE = 17;
  const SEND_EQUIPMENT_CONSTANTS_REQUEST = 18;
  const WAIT_EQUIPMENT_CONSTANTS_RESPONSE = 19;
  const WAIT_CONSTANT_WRITE_ACK = 20;

  let requestRetryCount = 0;
  const MAX_NUMBER_OF_REQUEST_RETRIES = 3;


  const LIST_ITEM = 0;
  const BINARY_ITEM = 0x20;
  const BOOLEAN_ITEM = 0x24;
  const ASCII_ITEM = 0x40;
  const I8_ITEM = 0x60;
  const I1_ITEM = 0x64;
  const I2_ITEM = 0x68;
  const I4_ITEM = 0x70;
  const F8_ITEM = 0x80;
  const F4_ITEM = 0x90;
  const U8_ITEM = 0xA0;
  const U1_ITEM = 0xA4;
  const U2_ITEM = 0xA8;
  const U4_ITEM = 0xB0;

  const WAIT_BIT = 0x80;
  const ENABLE_ALARMS = 0x80;
  const S_INDEX = 6;
  const F_INDEX = 7;
  const ACCEPTED = 0;
  const ALARM_SET = 0x80;

  const DATA_ID = 3000;

  let commState = WAIT_NONE;
  let pollingRequestTimer = null;
  let dataCompleteTimer = null;
  let commTimeoutTimer = null;
  let writeTimeoutTimer = null;
  let client = null;
  let statusVariablesReadArray = [];
  let equipmentConstantsReadArray = [];
  let CEIDListArray = [];
  let CEIDVariableList = {};
  let variablesWriteObj = {};
  let currentAlarmCodes = [];
  let currentAlarmTexts = [];
  let extractPos = 0;
  let port = 0;
  let host = null;
  let requestFrequencyMs = null;
  let disconnectedTimer = null;
  let reconnectTimer = null;
  let reestablishConnectionTimer = null;
  let connectionReported = false;
  let transactionId = 0;
  let lastSourceId = 0;
  let lastTransactionId = 0;

  let transmitBufSize;
  let receiveBufSize;
  const transmitBufferBaseSize = 20;
  const transmitBufferMinSize = 100;
  const receiveBufferBaseSize = 20;
  const receiveBufferMinSize = 100;

  let transmitBuffer;
  let receiveBuffer;
  let receiveBufferByteCount = 0;

  let startupState = WAIT_SELECT_RESPONSE;

  let startMilliseconds = 0;
  let endMilliseconds = 0;

  let linkTestTimer = null;

  let verificationTransactionID = 0;
  let transactionIDCheckOK = true;

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
    'numeric-id-missing-alert': {
      msg: `${machine.info.name}: All status variables and equipment constants require a numericID`,
      description: x => `No numericID is defined for variable ${x.errorMsg}`,
    },
    'DV-requires-CEID-alert': {
      msg: `${machine.info.name}: Data variables (DV) require Collection Event (CEID)`,
      description: x => `CEID required for variable ${x.errorMsg}`,
    },
    'failed-to-get-data-alert': {
      msg: `${machine.info.name}: Failed to Get Variable Data`,
      description: x => `Failed to get the data for variable ${x.errorMsg}`,
    },
    'bad-status-response-alert': {
      msg: `${machine.info.name}: Bad Status Variable Response`,
      description: 'A failed-transaction response was received to a status variable request',
    },
    'bad-constant-response-alert': {
      msg: `${machine.info.name}: Bad Equipment Constant Response`,
      description: 'A failed-transaction response was received to an equipment constant request',
    },
    'bad-alarm-report-alert': {
      msg: `${machine.info.name}: Bad Alarm Report`,
      description: 'A bad alarm report was received',
    },
    'no-response-alert': {
      msg: `${machine.info.name}: No Response from Equipment`,
      description: 'No response was received from the equiment after a data request',
    },
    'write-failed-alert': {
      msg: `${machine.info.name}: Equipment Constant Write Failed`,
      description: 'Writing to an equipment constant failed ',
    },
    'database-error': {
      msg: `${machine.info.name}: Error Writing to Database`,
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
  });

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

  // private methods

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  //    debug function for dumping the contents of a a buffer in easy-to-read format, 16 bytes/line
  // function dumpBuffer(buffer) {
  //   let str = '';
  //   for (let i = 0; i < buffer.length; i += 1) {
  //     if (buffer[i] < 16) {
  //       str += `0${buffer[i].toString(16)} `;
  //     } else {
  //       str += `${buffer[i].toString(16)} `;
  //     }
  //     if ((((i + 1) % 16) === 0) || ((i + 1) === buffer.length)) {
  //       console.log(str);
  //       str = '';
  //     }
  //   }
  // }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

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

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function convertType(result, format, array) {
    let resultOut = null;

    switch (typeof result) {
      // if the result is a string, convert to required format
      case 'string':
        switch (format) {
          case 'char':
            resultOut = result;
            break;
          case 'float':
          case 'double':
            resultOut = parseFloat(result);
            break;
          case 'bool':
            resultOut = ((result === 'true') || (result === '1'));
            break;
          default:
            resultOut = parseInt(result, 10);
        }
        break;
      // if the result is a number convert only if string or boolean
      case 'number':
        switch (format) {
          case 'char':
            resultOut = result.toString();
            break;
          case 'bool':
            resultOut = result !== 0;
            break;
          default:
            resultOut = result;
        }
        break;
      // if the result is a boolean convert only if string or number
      case 'boolean':
        switch (format) {
          case 'char':
            resultOut = result ? '1' : '0';
            break;
          case 'bool':
            resultOut = result;
            break;
          default:
            resultOut = result ? 1 : 0;
        }
        break;
      // if it is an object, it must be an array, so convert its element if output is array
      case 'object':
        if (array) {
          resultOut = [];
          for (let iElement = 0; iElement < result.length; iElement += 1) {
            resultOut.push(convertType(result[iElement], format, false));
          }
          return resultOut;
        }

        return convertType(result[0], format, false);
      default:
    }

    // if the result was not an array, but the output is an array make it one
    if (array) return [resultOut];

    return resultOut;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferSelectRequest() {
    // write the message length
    transmitBuffer.writeUInt32BE(10, 0);

    // write the message header for select.req
    transmitBuffer.writeUInt16BE(0xffff, 4);
    transmitBuffer.writeUInt8(0, 6);
    transmitBuffer.writeUInt8(0, 7);
    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(1, 9);
    transmitBuffer.writeUInt16BE(that.machine.settings.model.sparkDeviceID, 10);
    transmitBuffer.writeUInt16BE(transactionId, 12);
    transactionId += 1;

    log.info(`sending packet - bufferSelectRequest (transactionId = ${transactionId - 1}):`);
    // dumpBuffer(transmitBuffer.slice(0, 14));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, 14);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function sendLinkTestRequest() {
    const localTransmitBuffer = Buffer.allocUnsafe(14);

    // write the message length
    localTransmitBuffer.writeUInt32BE(10, 0);

    // write the message header for select.req
    localTransmitBuffer.writeUInt16BE(0xffff, 4);
    localTransmitBuffer.writeUInt8(0, 6);
    localTransmitBuffer.writeUInt8(0, 7);
    localTransmitBuffer.writeUInt8(0, 8);
    localTransmitBuffer.writeUInt8(5, 9);
    localTransmitBuffer.writeUInt16BE(that.machine.settings.model.sparkDeviceID, 10);
    localTransmitBuffer.writeUInt16BE(transactionId, 12);
    transactionId += 1;

    log.info(`<<<<<<<<<< sendLinkTestRequest (transactionId = ${transactionId - 1}) >>>>>>>>>>:`);
    // dumpBuffer(localTransmitBuffer.slice(0, 14));

    // return a buffer with the size of the command
    client.write(localTransmitBuffer);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function restartConnectionProcess() {
    reestablishConnectionTimer = null;
    // eslint-disable-next-line no-use-before-define
    setCommState(SEND_SELECT_RESPONSE);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function sendSeparatetRequest() {
    reestablishConnectionTimer = null;

    const localTransmitBuffer = Buffer.allocUnsafe(14);

    // write the message length
    localTransmitBuffer.writeUInt32BE(10, 0);

    // write the message header for select.req
    localTransmitBuffer.writeUInt16BE(0xffff, 4);
    localTransmitBuffer.writeUInt8(0, 6);
    localTransmitBuffer.writeUInt8(0, 7);
    localTransmitBuffer.writeUInt8(0, 8);
    localTransmitBuffer.writeUInt8(9, 9);
    localTransmitBuffer.writeUInt16BE(that.machine.settings.model.sparkDeviceID, 10);
    localTransmitBuffer.writeUInt16BE(transactionId, 12);
    transactionId += 1;

    log.info(`<<<<<<<<<< sendSeparatetRequest (transactionId = ${transactionId - 1}) >>>>>>>>>>:`);
    // dumpBuffer(localTransmitBuffer.slice(0, 14));

    // return a buffer with the size of the command
    client.write(localTransmitBuffer);

    reestablishConnectionTimer = setTimeout(restartConnectionProcess, 2000);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferEstablishCommResponse() {
    // write the message length
    transmitBuffer.writeUInt32BE(17, 0);

    // write the message header: device ID, S1 (wait bit set), F13, SType, Source ID, transaction ID
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(1, 6);
    transmitBuffer.writeUInt8(14, 7);
    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);
    transmitBuffer.writeUInt16BE(lastSourceId, 10);
    transmitBuffer.writeUInt16BE(lastTransactionId, 12);

    transmitBuffer.writeUInt8(LIST_ITEM + 1, 14);
    transmitBuffer.writeUInt8(2, 15);

    transmitBuffer.writeUInt8(BINARY_ITEM + 1, 16);
    transmitBuffer.writeUInt8(1, 17);
    transmitBuffer.writeUInt8(ACCEPTED, 18);

    transmitBuffer.writeUInt8(LIST_ITEM + 1, 19);
    transmitBuffer.writeUInt8(0, 20);

    log.info(`sending packet - EstablishCommResponse (transactionId = ${lastTransactionId}): S1F14:`);
    // dumpBuffer(transmitBuffer.slice(0, 21));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, 21);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferEstablishCommRequest() {
    // write the message length
    transmitBuffer.writeUInt32BE(12, 0);

    // write the message header: device ID, S1 (wait bit set), F13, SType, Source ID, transaction ID
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(1 + WAIT_BIT, 6);
    transmitBuffer.writeUInt8(13, 7);
    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);
    transmitBuffer.writeUInt16BE(that.machine.settings.model.sparkDeviceID, 10);
    transmitBuffer.writeUInt16BE(transactionId, 12);
    transactionId += 1;

    // write a zero-length list
    transmitBuffer.writeUInt8(LIST_ITEM + 1, 14);
    transmitBuffer.writeUInt8(0, 15);

    log.info(`sending packet - EstablishCommRequest (transactionId = ${transactionId - 1}): S1F13:`);
    // dumpBuffer(transmitBuffer.slice(0, 16));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, 16);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferEnableAlarms() {
    // write the message length
    transmitBuffer.writeUInt32BE(17, 0);

    // write the message header: device ID, S5 (wait bit set), F3, SType, Source ID, transaction ID
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(5 + WAIT_BIT, 6);
    transmitBuffer.writeUInt8(3, 7);
    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);
    transmitBuffer.writeUInt16BE(that.machine.settings.model.sparkDeviceID, 10);
    transmitBuffer.writeUInt16BE(transactionId, 12);
    transactionId += 1;

    // write a 2 element list
    transmitBuffer.writeUInt8(LIST_ITEM + 1, 14);
    transmitBuffer.writeUInt8(2, 15);

    // write the 1-byte binary ALED (alarm code)
    transmitBuffer.writeUInt8(BINARY_ITEM + 1, 16);
    transmitBuffer.writeUInt8(1, 17);
    transmitBuffer.writeUInt8(ENABLE_ALARMS, 18);

    // write a zero-length unsigned 4-byte int for ALID (alarm identification code)
    transmitBuffer.writeUInt8(U4_ITEM + 1, 19);
    transmitBuffer.writeUInt8(0, 20);

    log.info(`sending packet - EnableAlarmsCmd (transactionId = ${transactionId - 1}): S5F3:`);
    // dumpBuffer(transmitBuffer.slice(0, 21));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, 21);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferDeleteReportRequest() {
    // write message header: device ID, S2 (wait bit set), F33, SType, Source ID, transaction ID
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(2 + WAIT_BIT, 6);
    transmitBuffer.writeUInt8(33, 7);
    log.info('S2F33');

    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);
    transmitBuffer.writeUInt16BE(that.machine.settings.model.sparkDeviceID, 10);
    transmitBuffer.writeUInt16BE(transactionId, 12);
    transactionId += 1;

    // write an 2 element list (data id, list of reports, which will be 0 to indicate deleting all)
    transmitBuffer.writeUInt8(LIST_ITEM + 1, 14);
    transmitBuffer.writeUInt8(2, 15);
    log.info('  >L [2]');
    let transmitBufferIndex = 16;

    // // write the data id (36)
    // transmitBuffer.writeUInt8(U1_ITEM + 1, transmitBufferIndex);
    // transmitBufferIndex += 1;
    // transmitBuffer.writeUInt8(1, transmitBufferIndex);
    // transmitBufferIndex += 1;
    // transmitBuffer.writeUInt8(36, transmitBufferIndex);
    // transmitBufferIndex += 1;

    // write the data id (0)
    transmitBuffer.writeUInt8(U4_ITEM + 1, transmitBufferIndex);
    transmitBufferIndex += 1;
    transmitBuffer.writeUInt8(4, transmitBufferIndex);
    transmitBufferIndex += 1;
    transmitBuffer.writeUInt32BE(DATA_ID, transmitBufferIndex);
    transmitBufferIndex += 4;
    log.info(`    >U4 [1] ${DATA_ID}`);

    // write an x-element list, one elemnt for each report
    if (CEIDListArray.length < 0x100) {
      transmitBuffer.writeUInt8(LIST_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(CEIDListArray.length, transmitBufferIndex);
      transmitBufferIndex += 1;
    } else {
      transmitBuffer.writeUInt8(LIST_ITEM + 2, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt16BE(CEIDListArray.length, transmitBufferIndex);
      transmitBufferIndex += 2;
    }
    log.info(`    >L [${CEIDListArray.length}]`);

    // loop through all of our events, generating a delete-report for each
    for (let CEIDListArrayIndex = 0; CEIDListArrayIndex < CEIDListArray.length;
      CEIDListArrayIndex += 1) {
      // write a 2 element list (report id, list of variables)
      transmitBuffer.writeUInt8(LIST_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(2, transmitBufferIndex);
      transmitBufferIndex += 1;
      log.info('      >L [2]');

      // write the report id - use the same number as the event id
      transmitBuffer.writeUInt8(U4_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(4, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt32BE(CEIDListArray[CEIDListArrayIndex], transmitBufferIndex);
      transmitBufferIndex += 4;
      log.info(`        >U4 [1] ${CEIDListArray[CEIDListArrayIndex]}`);

      // write a 0 element list - indicating that we want to delete this report
      transmitBuffer.writeUInt8(LIST_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(0, transmitBufferIndex);
      transmitBufferIndex += 1;
      log.info('        >L [0]');
    }

    // write the message length
    transmitBuffer.writeUInt32BE(transmitBufferIndex - 4, 0);

    log.info(`sending packet - DeleteReportRequest (transactionId = ${transactionId - 1}): S2F33`);
    // dumpBuffer(transmitBuffer.slice(0, transmitBufferIndex));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, transmitBufferIndex);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferDefineReportRequest() {
    // write message header: device ID, S2 (wait bit set), F33, SType, Source ID, transaction ID
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(2 + WAIT_BIT, 6);
    transmitBuffer.writeUInt8(33, 7);
    log.info('S2F33');

    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);
    transmitBuffer.writeUInt16BE(that.machine.settings.model.sparkDeviceID, 10);
    transmitBuffer.writeUInt16BE(transactionId, 12);
    transactionId += 1;

    // write an 2 element list (data id, list of reports)
    transmitBuffer.writeUInt8(LIST_ITEM + 1, 14);
    transmitBuffer.writeUInt8(2, 15);
    log.info('  >L [2]');
    let transmitBufferIndex = 16;

    // // write the data id (36)
    // transmitBuffer.writeUInt8(U1_ITEM + 1, transmitBufferIndex);
    // transmitBufferIndex += 1;
    // transmitBuffer.writeUInt8(1, transmitBufferIndex);
    // transmitBufferIndex += 1;
    // transmitBuffer.writeUInt8(36, transmitBufferIndex);
    // transmitBufferIndex += 1;

    // write the data id (0)
    transmitBuffer.writeUInt8(U4_ITEM + 1, transmitBufferIndex);
    transmitBufferIndex += 1;
    transmitBuffer.writeUInt8(4, transmitBufferIndex);
    transmitBufferIndex += 1;
    transmitBuffer.writeUInt32BE(DATA_ID, transmitBufferIndex);
    transmitBufferIndex += 4;
    log.info(`    >U4 [1] ${DATA_ID}`);

    // write an x-element list, one elemnt for each report
    if (CEIDListArray.length < 0x100) {
      transmitBuffer.writeUInt8(LIST_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(CEIDListArray.length, transmitBufferIndex);
      transmitBufferIndex += 1;
    } else {
      transmitBuffer.writeUInt8(LIST_ITEM + 2, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt16BE(CEIDListArray.length, transmitBufferIndex);
      transmitBufferIndex += 2;
    }
    log.info(`    >L [${CEIDListArray.length}]`);

    // loop through all of our events, generating a report for each
    for (let CEIDListArrayIndex = 0; CEIDListArrayIndex < CEIDListArray.length;
      CEIDListArrayIndex += 1) {
      // write a 2 element list (report id, list of variables)
      transmitBuffer.writeUInt8(LIST_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(2, transmitBufferIndex);
      transmitBufferIndex += 1;
      log.info('      >L [2]');

      // write the report id - use the same number as the event id
      transmitBuffer.writeUInt8(U4_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(4, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt32BE(CEIDListArray[CEIDListArrayIndex], transmitBufferIndex);
      transmitBufferIndex += 4;
      log.info(`        >U4 [1] ${CEIDListArray[CEIDListArrayIndex]}`);

      // write an x-eleemnt list, one element for each variale in the report
      const variableListArray = CEIDVariableList[CEIDListArray[CEIDListArrayIndex]];
      if (variableListArray.length < 0x100) {
        transmitBuffer.writeUInt8(LIST_ITEM + 1, transmitBufferIndex);
        transmitBufferIndex += 1;
        transmitBuffer.writeUInt8(variableListArray.length, transmitBufferIndex);
        transmitBufferIndex += 1;
      } else {
        transmitBuffer.writeUInt8(LIST_ITEM + 2, transmitBufferIndex);
        transmitBufferIndex += 1;
        transmitBuffer.writeUInt16BE(variableListArray.length, transmitBufferIndex);
        transmitBufferIndex += 2;
      }
      log.info(`        >L [${variableListArray.length}]`);

      // loop through all of our variables for this report/event
      for (let variableListArrayIndex = 0; variableListArrayIndex < variableListArray.length;
        variableListArrayIndex += 1) {
        transmitBuffer.writeUInt8(U4_ITEM + 1, transmitBufferIndex);
        transmitBufferIndex += 1;
        transmitBuffer.writeUInt8(4, transmitBufferIndex);
        transmitBufferIndex += 1;
        transmitBuffer.writeUInt32BE(variableListArray[variableListArrayIndex].numericID,
          transmitBufferIndex);
        transmitBufferIndex += 4;
        log.info(`        >U4 [1] ${variableListArray[variableListArrayIndex].numericID}`);
      }
    }

    // write the message length
    transmitBuffer.writeUInt32BE(transmitBufferIndex - 4, 0);

    log.info(`sending packet - DefineReportRequest (transactionId = ${transactionId - 1}): S2F33`);
    // dumpBuffer(transmitBuffer.slice(0, transmitBufferIndex));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, transmitBufferIndex);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferLinkReportRequest() {
    // write message header: device ID, S2 (wait bit set), F35, SType, Source ID, transaction ID
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(2 + WAIT_BIT, 6);
    transmitBuffer.writeUInt8(35, 7);
    log.info('S2F35');
    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);
    transmitBuffer.writeUInt16BE(that.machine.settings.model.sparkDeviceID, 10);
    transmitBuffer.writeUInt16BE(transactionId, 12);
    transactionId += 1;

    // write an 2 element list (data id, number of collection events)
    transmitBuffer.writeUInt8(LIST_ITEM + 1, 14);
    transmitBuffer.writeUInt8(2, 15);
    log.info('  >L [2]');
    let transmitBufferIndex = 16;

    // // write the data id (37)
    // transmitBuffer.writeUInt8(U1_ITEM + 1, transmitBufferIndex);
    // transmitBufferIndex += 1;
    // transmitBuffer.writeUInt8(1, transmitBufferIndex);
    // transmitBufferIndex += 1;
    // transmitBuffer.writeUInt8(37, transmitBufferIndex);
    // transmitBufferIndex += 1;

    // write the data id (0)
    transmitBuffer.writeUInt8(U4_ITEM + 1, transmitBufferIndex);
    transmitBufferIndex += 1;
    transmitBuffer.writeUInt8(4, transmitBufferIndex);
    transmitBufferIndex += 1;
    transmitBuffer.writeUInt32BE(DATA_ID, transmitBufferIndex);
    transmitBufferIndex += 4;
    log.info(`    >U4 [1] ${DATA_ID}`);

    // write an x-element list, one elemnt for each collection event
    if (CEIDListArray.length < 0x100) {
      transmitBuffer.writeUInt8(LIST_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(CEIDListArray.length, transmitBufferIndex);
      transmitBufferIndex += 1;
    } else {
      transmitBuffer.writeUInt8(LIST_ITEM + 2, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt16BE(CEIDListArray.length, transmitBufferIndex);
      transmitBufferIndex += 2;
    }
    log.info(`    >L [${CEIDListArray.length}]`);

    // loop through all of our events, linking the report to each
    for (let CEIDListArrayIndex = 0; CEIDListArrayIndex < CEIDListArray.length;
      CEIDListArrayIndex += 1) {
      // write a 2 element list (CEID, list of reports to link)
      transmitBuffer.writeUInt8(LIST_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(2, transmitBufferIndex);
      transmitBufferIndex += 1;
      log.info('      >L [2]');

      // write the CEID - use the same number as the event id
      transmitBuffer.writeUInt8(U4_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(4, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt32BE(CEIDListArray[CEIDListArrayIndex], transmitBufferIndex);
      transmitBufferIndex += 4;
      log.info(`        >U4 [1] ${CEIDListArray[CEIDListArrayIndex]}`);

      // write a 1 element list (the single report tied to this CEID
      // note that we chose to set the report ID to the same value as the CEID)
      transmitBuffer.writeUInt8(LIST_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(1, transmitBufferIndex);
      transmitBufferIndex += 1;
      log.info('        >L [1]');

      // write the CEID - use the same number as the event id
      transmitBuffer.writeUInt8(U4_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(4, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt32BE(CEIDListArray[CEIDListArrayIndex], transmitBufferIndex);
      transmitBufferIndex += 4;
      log.info(`          >U4 [1] ${CEIDListArray[CEIDListArrayIndex]}`);
    }

    // write the message length
    transmitBuffer.writeUInt32BE(transmitBufferIndex - 4, 0);

    log.info(`sending packet - LinkReportRequest (transactionId = ${transactionId - 1}): S2F35`);
    // dumpBuffer(transmitBuffer.slice(0, transmitBufferIndex));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, transmitBufferIndex);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferEventEnableRequest() {
    // write message header: device ID, S2 (wait bit set), F37, SType, Source ID, transaction ID
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(2 + WAIT_BIT, 6);
    transmitBuffer.writeUInt8(37, 7);
    log.info('S2F37');
    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);
    transmitBuffer.writeUInt16BE(that.machine.settings.model.sparkDeviceID, 10);
    transmitBuffer.writeUInt16BE(transactionId, 12);
    transactionId += 1;

    // write an 2 element list (CEED enable.disable, list of events to enable)
    transmitBuffer.writeUInt8(LIST_ITEM + 1, 14);
    transmitBuffer.writeUInt8(2, 15);
    let transmitBufferIndex = 16;
    log.info('  >L [2]');

    // write the CEED (enable.disable)
    transmitBuffer.writeUInt8(BOOLEAN_ITEM + 1, transmitBufferIndex);
    transmitBufferIndex += 1;
    transmitBuffer.writeUInt8(1, transmitBufferIndex);
    transmitBufferIndex += 1;
    transmitBuffer.writeUInt8(1, transmitBufferIndex); // enable
    transmitBufferIndex += 1;
    log.info('    >Boolean [1] 1');

    // write an x-element list, one elemnt for each collection event
    if (CEIDListArray.length < 0x100) {
      transmitBuffer.writeUInt8(LIST_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(CEIDListArray.length, transmitBufferIndex);
      transmitBufferIndex += 1;
    } else {
      transmitBuffer.writeUInt8(LIST_ITEM + 2, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt16BE(CEIDListArray.length, transmitBufferIndex);
      transmitBufferIndex += 2;
    }
    log.info(`    >L [${CEIDListArray.length}]`);

    // loop through all of our events, listing each event to enable
    for (let CEIDListArrayIndex = 0; CEIDListArrayIndex < CEIDListArray.length;
      CEIDListArrayIndex += 1) {
      // write the CEID
      transmitBuffer.writeUInt8(U4_ITEM + 1, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt8(4, transmitBufferIndex);
      transmitBufferIndex += 1;
      transmitBuffer.writeUInt32BE(CEIDListArray[CEIDListArrayIndex], transmitBufferIndex);
      transmitBufferIndex += 4;
      log.info(`      >U4 [1] ${CEIDListArray[CEIDListArrayIndex]}`);
    }

    // write the message length
    transmitBuffer.writeUInt32BE(transmitBufferIndex - 4, 0);

    log.info(`sending packet - bufferEventEnableRequest (transactionId = ${transactionId - 1}): S2F37`);
    // dumpBuffer(transmitBuffer.slice(0, transmitBufferIndex));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, transmitBufferIndex);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferStatusVariablesRequest() {
    // write the message header: device ID, S1 (wait bit set), F3, SType, Source ID, transaction ID
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(1 + WAIT_BIT, 6);
    transmitBuffer.writeUInt8(3, 7);
    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);
    transmitBuffer.writeUInt16BE(that.machine.settings.model.sparkDeviceID, 10);
    transmitBuffer.writeUInt16BE(transactionId, 12);
    verificationTransactionID = transactionId;
    transactionId += 1;

    // write n element list, where n = # of status Variables
    let iBufSVID;
    if (statusVariablesReadArray.length < 0x100) {
      transmitBuffer.writeUInt8(LIST_ITEM + 1, 14);
      transmitBuffer.writeUInt8(statusVariablesReadArray.length, 15);
      iBufSVID = 16;
    } else {
      transmitBuffer.writeUInt8(LIST_ITEM + 2, 14);
      transmitBuffer.writeUInt16BE(statusVariablesReadArray.length, 15);
      iBufSVID = 17;
    }

    // write the 2-byte unsigned SVID (status variable ID) for each status variable
    for (let iVar = 0; iVar < statusVariablesReadArray.length; iVar += 1) {
      transmitBuffer.writeUInt8(U4_ITEM + 1, iBufSVID);
      transmitBuffer.writeUInt8(4, iBufSVID + 1);
      transmitBuffer.writeUInt32BE(statusVariablesReadArray[iVar].numericID, iBufSVID + 2);
      iBufSVID += 6;
    }

    // write the message length
    transmitBuffer.writeUInt32BE(iBufSVID - 4, 0);

    log.info(`sending packet - StatusVariablesRequest (transactionId = ${transactionId - 1}): S1F3:`);
    // dumpBuffer(transmitBuffer.slice(0, iBufSVID));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, iBufSVID);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferEquipmentConstantsRequest() {
    // write message header: device ID, S2 (wait bit set), F13, SType, Source ID, transaction ID
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(2 + WAIT_BIT, 6);
    transmitBuffer.writeUInt8(13, 7);
    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);
    transmitBuffer.writeUInt16BE(that.machine.settings.model.sparkDeviceID, 10);
    transmitBuffer.writeUInt16BE(transactionId, 12);
    verificationTransactionID = transactionId;
    transactionId += 1;

    // write an n element list, where n = # of equipment constants
    let iBufECID;
    if (equipmentConstantsReadArray.length < 0x100) {
      transmitBuffer.writeUInt8(LIST_ITEM + 1, 14);
      transmitBuffer.writeUInt8(equipmentConstantsReadArray.length, 15);
      iBufECID = 16;
    } else {
      transmitBuffer.writeUInt8(LIST_ITEM + 2, 14);
      transmitBuffer.writeUInt16BE(equipmentConstantsReadArray.length, 15);
      iBufECID = 17;
    }

    // write the 2-byte unsigned ECID (equipment constant ID) for each equipment constant
    for (let iVar = 0; iVar < equipmentConstantsReadArray.length; iVar += 1) {
      transmitBuffer.writeUInt8(U4_ITEM + 1, iBufECID);
      transmitBuffer.writeUInt8(4, iBufECID + 1);
      transmitBuffer.writeUInt32BE(equipmentConstantsReadArray[iVar].numericID, iBufECID + 2);
      iBufECID += 6;
    }

    // write the message length
    transmitBuffer.writeUInt32BE(iBufECID - 4, 0);

    log.info(`sending packet - EquipmentConstantsRequest (transactionId = ${transactionId - 1}): S2F13:`);
    // dumpBuffer(transmitBuffer.slice(0, iBufECID));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, iBufECID);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferConstantWrite(variable, value) {
    // write the message header: device ID, S2 (wait bit set), F15, SType, Source ID, transaction ID
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(2 + WAIT_BIT, 6);
    transmitBuffer.writeUInt8(15, 7);
    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);
    transmitBuffer.writeUInt16BE(that.machine.settings.model.sparkDeviceID, 10);
    transmitBuffer.writeUInt16BE(transactionId, 12);
    transactionId += 1;

    // write a 1 element list for the single equipment constant
    transmitBuffer.writeUInt8(LIST_ITEM + 1, 14);
    transmitBuffer.writeUInt8(1, 15);

    // write a 2 element list for the ID and value
    transmitBuffer.writeUInt8(LIST_ITEM + 1, 16);
    transmitBuffer.writeUInt8(2, 17);

    // write the 2-byte unsigned ECID (equipment constant ID)
    transmitBuffer.writeUInt8(U2_ITEM + 1, 18);
    transmitBuffer.writeUInt8(2, 19);
    transmitBuffer.writeUInt16BE(variable.numericID, 20);

    // write the constant value and set value length in bytes, according the the variable type
    let valueLength = 0;
    switch (variable.format) {
      case 'char':
        transmitBuffer.writeInt8(ASCII_ITEM + 1, 22);
        valueLength = value.length;
        // don't allow writing of strings longer tha 255 characters
        if (valueLength > 255) valueLength = 255;
        transmitBuffer.write(value, 24, valueLength, 'ascii');
        break;

      case 'int8':
        transmitBuffer.writeInt8(I1_ITEM + 1, 22);
        transmitBuffer.writeInt8(value, 24);
        valueLength = 1;
        break;

      case 'int16':
        transmitBuffer.writeInt8(I2_ITEM + 1, 22);
        transmitBuffer.writeInt16BE(value, 24);
        valueLength = 2;
        break;

      case 'int32':
        transmitBuffer.writeInt8(I4_ITEM + 1, 22);
        transmitBuffer.writeInt32BE(value, 24);
        valueLength = 4;
        break;

      case 'int64':
        transmitBuffer.writeInt8(I8_ITEM + 1, 22);
        transmitBuffer.writeInt32BE(value / 0x100000000, 24);
        transmitBuffer.writeInt32BE(value % 0x100000000, 28);
        valueLength = 8;
        break;

      case 'uint8':
        transmitBuffer.writeUInt8(U1_ITEM + 1, 22);
        transmitBuffer.writeUInt8(value, 24);
        valueLength = 1;
        break;

      case 'uint16':
        transmitBuffer.writeUInt8(U2_ITEM + 1, 22);
        transmitBuffer.writeUInt16BE(value, 24);
        valueLength = 2;
        break;

      case 'uint32':
        transmitBuffer.writeUInt8(U4_ITEM + 1, 22);
        transmitBuffer.writeUInt32BE(value, 24);
        valueLength = 4;
        break;

      case 'uint64':
        transmitBuffer.writeUInt8(U8_ITEM + 1, 22);
        transmitBuffer.writeUInt32BE(value / 0x100000000, 24);
        transmitBuffer.writeUInt32BE(value % 0x100000000, 28);
        valueLength = 8;
        break;

      case 'float':
        transmitBuffer.writeUInt8(F4_ITEM + 1, 22);
        transmitBuffer.writeFloatBE(value, 24);
        valueLength = 4;
        break;

      case 'double':
        transmitBuffer.writeUInt8(F8_ITEM + 1, 22);
        transmitBuffer.writeDoubleBE(value, 24);
        valueLength = 8;
        break;

      case 'bool':
        transmitBuffer.writeUInt8(BOOLEAN_ITEM + 1, 22);
        transmitBuffer.writeUInt8(value ? 1 : 0, 24);
        valueLength = 1;
        break;
      default:
    }

    // set the length of the value and length of the message
    transmitBuffer.writeUInt8(valueLength, 23);
    transmitBuffer.writeUInt32BE(valueLength + 20, 0);

    log.info(`sending packet - bufferConstantWrite (transactionId = ${transactionId - 1}): S2F15:`);
    // dumpBuffer(transmitBuffer.slice(0, valueLength + 24));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, valueLength + 24);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferAlarmReportAck() {
    // write the message length
    transmitBuffer.writeUInt32BE(13, 0);

    // write the message header: device ID, S5, F2, SType, system bytes from report
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(5, 6);
    transmitBuffer.writeUInt8(2, 7);
    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);

    transmitBuffer.writeUInt16BE(lastSourceId, 10);
    transmitBuffer.writeUInt16BE(lastTransactionId, 12);

    // write a 1-byte binary item with ACKC5 = 0
    transmitBuffer.writeUInt8(BINARY_ITEM + 1, 14);
    transmitBuffer.writeUInt8(1, 15);
    transmitBuffer.writeUInt8(ACCEPTED, 16);

    log.info(`sending packet - bufferAlarmReportAck (transactionId = ${lastTransactionId}): S5F2:`);
    // dumpBuffer(transmitBuffer.slice(0, 17));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, 17);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferEventReportAck() {
    // write the message length
    transmitBuffer.writeUInt32BE(13, 0);

    // write the message header: device ID, S5, F2, SType, system bytes from report
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(6, 6);
    transmitBuffer.writeUInt8(12, 7);
    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);

    transmitBuffer.writeUInt16BE(lastSourceId, 10);
    transmitBuffer.writeUInt16BE(lastTransactionId, 12);

    // write a 1-byte binary item with ACKC5 = 0
    transmitBuffer.writeUInt8(BINARY_ITEM + 1, 14);
    transmitBuffer.writeUInt8(1, 15);
    transmitBuffer.writeUInt8(ACCEPTED, 16);

    log.info(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>sending packet - bufferEventReportAck (transactionId = ${lastTransactionId}): S6F12:`);
    // dumpBuffer(transmitBuffer.slice(0, 17));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, 17);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function bufferOnLineData() {
    // write the message length
    transmitBuffer.writeUInt32BE(12, 0);

    // write the message header: device ID, S5, F2, SType, system bytes from report
    transmitBuffer.writeUInt16BE(that.machine.settings.model.equipDeviceID, 4);
    transmitBuffer.writeUInt8(1, 6);
    transmitBuffer.writeUInt8(2, 7);
    transmitBuffer.writeUInt8(0, 8);
    transmitBuffer.writeUInt8(0, 9);

    transmitBuffer.writeUInt16BE(lastSourceId, 10);
    transmitBuffer.writeUInt16BE(lastTransactionId, 12);

    // write a 0 element list
    transmitBuffer.writeUInt8(LIST_ITEM + 1, 14);
    transmitBuffer.writeUInt8(0, 15);

    log.info(`sending packet - bufferOnLineData: S1F2 (transactionId = ${lastTransactionId}):`);
    // dumpBuffer(transmitBuffer.slice(0, 16));

    // return a buffer with the size of the command
    return transmitBuffer.slice(0, 16);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractSelectResponse(data) {
    // make sure message length is sufficient
    if (data.length < 14) return 0;

    // make sure the message length dword is correct
    const messageLength = data.readUInt32BE(0);
    if (messageLength !== 10) return 0;

    // make sure device id is 0xffff
    if (data.readUInt16BE(4) !== 0xffff) return 0;

    // make sure this is a select.rsp header
    if ((data.readUInt8(6) !== 0) || (data.readUInt8(7) !== 0)
        || (data.readUInt8(8) !== 0) || (data.readUInt8(9) !== 2)) return 0;

    lastTransactionId = data.readUInt16BE(12);
    log.info(`received packet - SELECT_RESPONSE (transactionId = ${lastTransactionId}):`);
    // dumpBuffer(data);

    return (messageLength + 4);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractEstablishCommRequest(data) {
    // make sure message length is sufficient
    if (data.length < 22) return 0;

    // make sure the message length dword is correct
    const messageLength = data.readUInt32BE(0);
    if (messageLength < 18) return 0;

    // check for S1, F13
    // make sure this is an S1, F14 response in 10-byte header
    if ((data.readUInt8(S_INDEX) !== 0x81) || (data.readUInt8(F_INDEX) !== 13)
        || (data.readUInt8(8) !== 0) || (data.readUInt8(9) !== 0)) return 0;

    // check for message: List (L), 2 elements
    if ((data.readUInt8(14) !== (LIST_ITEM + 1))
        || (data.readUInt8(15) !== 2)) return 0;

    lastSourceId = data.readUInt16BE(10);
    lastTransactionId = data.readUInt16BE(12);
    log.info(`received packet - ESTABLISH_COMM_REQUEST (transactionId = ${lastTransactionId}): S1F13`);
    // dumpBuffer(data);

    return (messageLength + 4);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractEstablishCommAck(data) {
    // make sure message length is sufficient
    if (data.length < 4) {
      return 0;
    }

    // make sure the message length dword is correct
    const messageLength = data.readUInt32BE(0);
    if (messageLength < 15) {
      return 0;
    }

    // make sure this is an S1, F14 response in 10-byte header
    if ((data.readUInt8(S_INDEX) !== 1) || (data.readUInt8(F_INDEX) !== 14)) {
      return 0;
    }

    // make sure first item in list is binary, 1 byte, COMMACK = ACCEPTED
    if ((data.readUInt8(16) !== (BINARY_ITEM + 1))
        || (data.readUInt8(17) !== 1)
        || (data.readUInt8(18) !== ACCEPTED)) {
      return 0;
    }

    lastTransactionId = data.readUInt16BE(12);
    log.info(`received packet - ESTABLISH_COMM_RESPONSE (transactionId = ${lastTransactionId}): S1F14:`);
    // dumpBuffer(data);

    return (messageLength + 4);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractConstantWriteAck(data) {
    // make sure message length is sufficient
    if ((data.length < 4) || (data.readUInt32BE(0) < 13)) return false;

    // make sure this is an S2, F16 response in 10-byte header
    if ((data.readUInt8(S_INDEX) !== 2) || (data.readUInt8(F_INDEX) !== 16)) return false;

    // make sure first item is binary, 1 byte, EAC = ACCEPTED
    if (
      (data.readUInt8(14) !== (BINARY_ITEM + 1))
      || (data.readUInt8(15) !== 1)
      || (data.readUInt8(16) !== ACCEPTED)) return false;

    lastTransactionId = data.readUInt16BE(12);
    log.info(`received packet - CONSTANT_WRITE_ACK (transactionId = ${lastTransactionId}): S2F16:`);
    // dumpBuffer(data);

    return true;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractEnableAlarmsAck(data) {
    // make sure message length is sufficient
    if ((data.length < 4) || (data.readUInt32BE(0) < 13)) return false;

    // make sure this is an S5, F4 response in 10-byte header
    if ((data.readUInt8(S_INDEX) !== 5)
        || ((data.readUInt8(F_INDEX) !== 4) && (data.readUInt8(F_INDEX) !== 0))) return false;

    // make sure first item is binary, 1 byte, ACKC5 = ACCEPTED
    if (
      (data.readUInt8(14) !== (BINARY_ITEM + 1))
      || (data.readUInt8(15) !== 1)
      || (data.readUInt8(16) !== ACCEPTED)) return false;

    lastTransactionId = data.readUInt16BE(12);

    log.info(`received packet - ENABLE_ALARMS_ACK (transactionId = ${lastTransactionId}): S5F4:`);
    // dumpBuffer(data);

    return true;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractDefineReportAck(data) {
    // make sure message length is sufficient
    if ((data.length < 4) || (data.readUInt32BE(0) < 13)) return false;

    // make sure this is an S2, F34 response in 10-byte header
    if ((data.readUInt8(S_INDEX) !== 2) || (data.readUInt8(F_INDEX) !== 34)) return false;

    // make sure first item is binary, 1 byte, ACKC5 = ACCEPTED
    if (
      (data.readUInt8(14) !== (BINARY_ITEM + 1))
      || (data.readUInt8(15) !== 1)
      || (data.readUInt8(16) !== ACCEPTED)) return false;

    lastTransactionId = data.readUInt16BE(12);

    log.info(`received packet - DELETE_REPORT_ACK (DEFINE_REPORT_ACK) (transactionId = ${lastTransactionId}): S2F34:`);
    // dumpBuffer(data);
    log.info('S2F34');
    log.info('  >Boolean [1] 0');

    return true;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractLinkReportAck(data) {
    // make sure message length is sufficient
    if ((data.length < 4) || (data.readUInt32BE(0) < 13)) return false;

    // make sure this is an S2, F34 response in 10-byte header
    if ((data.readUInt8(S_INDEX) !== 2) || (data.readUInt8(F_INDEX) !== 36)) return false;

    // make sure first item is binary, 1 byte, ACKC5 = ACCEPTED
    if (
      (data.readUInt8(14) !== (BINARY_ITEM + 1))
      || (data.readUInt8(15) !== 1)
      || (data.readUInt8(16) !== ACCEPTED)) return false;

    lastTransactionId = data.readUInt16BE(12);

    log.info(`received packet - LINK_REPORT_ACK (transactionId = ${lastTransactionId}): S2F36:`);
    // dumpBuffer(data);
    log.info('S2F36');
    log.info('  >Boolean [1] 0');

    return true;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractEventEnableAck(data) {
    // make sure message length is sufficient
    if ((data.length < 4) || (data.readUInt32BE(0) < 13)) return false;

    // make sure this is an S2, F34 response in 10-byte header
    if ((data.readUInt8(S_INDEX) !== 2) || (data.readUInt8(F_INDEX) !== 38)) return false;

    // make sure first item is binary, 1 byte, ACKC5 = ACCEPTED
    if (
      (data.readUInt8(14) !== (BINARY_ITEM + 1))
      || (data.readUInt8(15) !== 1)
      || (data.readUInt8(16) !== ACCEPTED)) return false;

    lastTransactionId = data.readUInt16BE(12);

    log.info(`received packet - EVENT_ENABLE_ACK (transactionId = ${lastTransactionId}): S2F38:`);
    // dumpBuffer(data);
    log.info('S2F38');
    log.info('  >Boolean [1] 0');

    return true;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractAreYouThereRequest(data) {
    // make sure message length is sufficient
    if (data.length < 14) {
      return 0;
    }

    // make sure the message length dword is correct
    const messageLength = data.readUInt32BE(0);
    if (messageLength !== 10) {
      return 0;
    }

    // make sure this is a select.rsp header
    if ((data.readUInt8(6) !== 0x81) || (data.readUInt8(7) !== 1)) {
      return 0;
    }

    lastSourceId = data.readUInt16BE(10);
    lastTransactionId = data.readUInt16BE(12);

    log.info(`------------------ received asynchronous ARE-YOU-THERE-REQUEST (transactionId = ${lastTransactionId}): S1F1`);

    client.write(bufferOnLineData());

    return (messageLength + 4);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractTransactionTimerTimeoutRequest(data) {
    // make sure message length is sufficient
    if (data.length < 26) {
      return 0;
    }

    // make sure the message length dword is correct
    const messageLength = data.readUInt32BE(0);
    if (messageLength !== 0x16) {
      return 0;
    }

    // make sure this is a select.rsp header
    if ((data.readUInt8(6) !== 0x09) || (data.readUInt8(7) !== 9)) {
      return 0;
    }

    lastTransactionId = data.readUInt16BE(12);
    log.info(`------------------ received asynchronous TRANSACTION-TIMER-TIMEOUT (transactionId = ${lastTransactionId})`);

    return (messageLength + 4);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractAlarmReport(data) {
    // make sure message length is sufficient
    if ((data.length < 4) || (data.readUInt32BE(0) < 27)) {
      return 0;
    }

    if ((data.readUInt8(S_INDEX) !== (5 + WAIT_BIT)) || (data.readUInt8(F_INDEX) !== 1)) {
      return 0;
    }

    // make sure this a 3-element list
    if ((data.readUInt8(14) !== (LIST_ITEM + 1)) || (data.readUInt8(15) !== 3)) {
      return 0;
    }

    // make sure 1st list item is 1-byte binary item
    if ((data.readUInt8(16) !== (BINARY_ITEM + 1)) || (data.readUInt8(17) !== 1)) {
      return 0;
    }

    // get whether alarm set or cleared
    // eslint-disable-next-line no-bitwise
    const alarmSet = (data.readUInt8(18) & ALARM_SET) !== 0;

    // make sure 2nd list item is 4-byte alarm code
    if ((data.readUInt8(19) !== (U4_ITEM + 1)) || (data.readUInt8(20) !== 4)) {
      return 0;
    }

    // get the alarm code
    const alarmCode = data.readUInt32BE(21);

    // make sure 3rd list item is an ascii text
    if (data.readUInt8(25) !== (ASCII_ITEM + 1)) {
      return 0;
    }

    const alarmTextLength = data.readUInt8(26);
    if (alarmTextLength === 0) {
      return 0;
    }

    // get the alarm text
    const alarmText = data.toString('ascii', 27, (26 + alarmTextLength));

    // send an acknowledge to the equipment
    lastSourceId = data.readUInt16BE(10);
    lastTransactionId = data.readUInt16BE(12);

    log.info(`------------------ received asynchronous ALARM-REPORT (transactionId = ${lastTransactionId}): S5F1`);
    log.info('packet:');
    // dumpBuffer(data);

    log.info(`previous currentAlarmCodes:${JSON.stringify(currentAlarmCodes)}`);
    log.info(`previous currentAlarmTexts:${JSON.stringify(currentAlarmTexts)}`);

    client.write(bufferAlarmReportAck());

    // if the alarm was set, add it to our list if it is not present
    let alarmsChanged = false;
    if (alarmSet) {
      if (!currentAlarmCodes.includes(alarmCode)) {
        currentAlarmCodes.push(alarmCode);
        currentAlarmTexts.push(alarmText);
        alarmsChanged = true;
      }
    } else { // if the alarm was cleared, remove it from out list if it is present
      const iAlarm = currentAlarmCodes.indexOf(alarmCode);
      if (iAlarm !== -1) {
        currentAlarmCodes.splice(iAlarm, 1);
        currentAlarmTexts.splice(iAlarm, 1);
        alarmsChanged = true;
      }
    }

    log.info(`new currentAlarmCodes:${JSON.stringify(currentAlarmCodes)}`);
    log.info(`new currentAlarmTexts:${JSON.stringify(currentAlarmTexts)}`);

    // if the alarms changed, update any alarm variables in the database
    if (alarmsChanged) {
      log.info('alarms changed');
      that.machine.variables.forEach((variable) => {
        if (variable.type === 'Active Alarm Codes') {
          log.info(`updating variable: ${variable.name}`);
          updateDatabase(variable, currentAlarmCodes);
        } else if (variable.type === 'Active Alarm Texts') {
          log.info(`updating variable: ${variable.name}`);
          updateDatabase(variable, currentAlarmTexts);
        }
      });
    } else {
      log.info('alarms not changed');
    }

    return (27 + alarmTextLength);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractListElementDataType(data) {
    try {
      const pos = extractPos;
      let itemType = data.readUInt8(pos);
      // eslint-disable-next-line no-bitwise
      const numLenBytes = itemType & 0x03;
      if (numLenBytes === 0) return null;
      // eslint-disable-next-line no-bitwise
      itemType &= 0xFC;
      return itemType;
    } catch (err) {
      log.error(`Error reading response buffer: ${err}`);
      return null;
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractListElementValue(data) {
    try {
      const pos = extractPos;
      let itemType = data.readUInt8(pos);
      // eslint-disable-next-line no-bitwise
      const numLenBytes = itemType & 0x03;
      if (numLenBytes === 0) return null;
      // eslint-disable-next-line no-bitwise
      itemType &= 0xFC;
      let numBytes = data.readUInt8(pos + 1);
      if (numLenBytes > 1) {
        numBytes = (256 * numBytes) + data.readUInt8(pos + 2);
      }
      if (numLenBytes > 2) {
        numBytes = (256 * numBytes) + data.readUInt8(pos + 3);
      }
      extractPos += 1; // skip past the item type
      extractPos += numLenBytes; // skip past the number of length bytes
      extractPos += numBytes; // skip past the number of data bytes

      switch (itemType) {
        case LIST_ITEM:
          { // Note 'numBytes' is actually the number of list elements
            extractPos -= numBytes;
            const array = [];
            for (let iElement = 0; iElement < numBytes; iElement += 1) {
              array.push(extractListElementValue(data));
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;

        case BINARY_ITEM:
          if (numBytes === 1) {
            return data.readUInt8(pos + numLenBytes + 1);
          }
          {
            const array = [];
            for (let iByte = 1; iByte <= numBytes; iByte += 1) {
              array.push(data.readUInt8(pos + numLenBytes + iByte));
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;


        case BOOLEAN_ITEM:
          if (numBytes === 1) {
            return data.readUInt8(pos + numLenBytes + 1) !== 0;
          }
          {
            const array = [];
            for (let iByte = 1; iByte <= numBytes; iByte += 1) {
              array.push(data.readUInt8(pos + numLenBytes + iByte) !== 0);
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;

        case ASCII_ITEM:
          return data.toString('ascii', pos + numLenBytes + 1, pos + numLenBytes + numBytes + 1);

        case I8_ITEM:
          if (numBytes === 8) {
            const low = data.readInt32BE(pos + numLenBytes + 5);
            let result = (data.readInt32BE(pos + numLenBytes + 1) * 4294967296.0) + low;
            if (low < 0) {
              result += 4294967296;
            }
            return result;
          }
          {
            const array = [];
            for (let iByte = 1; iByte <= numBytes; iByte += 8) {
              const low = data.readInt32BE(pos + numLenBytes + iByte + 4);
              let result = (data.readInt32BE(pos + numLenBytes + iByte) * 4294967296.0) + low;
              if (low < 0) {
                result += 4294967296;
              }
              array.push(result);
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;

        case I1_ITEM:
          if (numBytes === 1) {
            return data.readInt8(pos + numLenBytes + 1);
          }
          {
            const array = [];
            for (let iByte = 1; iByte <= numBytes; iByte += 1) {
              array.push(data.readInt8(pos + numLenBytes + iByte));
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;

        case I2_ITEM:
          if (numBytes === 2) {
            return data.readInt16BE(pos + numLenBytes + 1);
          }
          {
            const array = [];
            for (let iByte = 1; iByte <= numBytes; iByte += 2) {
              array.push(data.readInt16BE(pos + numLenBytes + iByte));
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;

        case I4_ITEM:
          if (numBytes === 4) {
            return data.readInt32BE(pos + numLenBytes + 1);
          }
          {
            const array = [];
            for (let iByte = 1; iByte <= numBytes; iByte += 4) {
              array.push(data.readInt32BE(pos + numLenBytes + iByte));
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;

        case F8_ITEM:
          if (numBytes === 8) {
            return data.readDoubleBE(pos + numLenBytes + 1);
          }
          {
            const array = [];
            for (let iByte = 1; iByte <= numBytes; iByte += 8) {
              array.push(data.readDoubleBE(pos + numLenBytes + iByte));
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;

        case F4_ITEM:
          if (numBytes === 4) {
            return data.readFloatBE(pos + numLenBytes + 1);
          }
          {
            const array = [];
            for (let iByte = 1; iByte <= numBytes; iByte += 4) {
              array.push(data.readFloatBE(pos + numLenBytes + iByte));
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;

        case U8_ITEM:
          if (numBytes === 8) {
            return (data.readUInt32BE(pos + numLenBytes + 1) * 4294967296.0)
                    + data.readUInt32BE(pos + numLenBytes + 5);
          }
          {
            const array = [];
            for (let iByte = 1; iByte <= numBytes; iByte += 8) {
              array.push((data.readUInt32BE(pos + numLenBytes + iByte) * 4294967296.0)
                          + data.readUInt32BE(pos + numLenBytes + iByte + 4));
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;

        case U1_ITEM:
          if (numBytes === 1) {
            return data.readUInt8(pos + numLenBytes + 1);
          }
          {
            const array = [];
            for (let iByte = 1; iByte <= numBytes; iByte += 1) {
              array.push(data.readUInt8(pos + numLenBytes + iByte));
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;

        case U2_ITEM:
          if (numBytes === 2) {
            return data.readUInt16BE(pos + numLenBytes + 1);
          }
          {
            const array = [];
            for (let iByte = 1; iByte <= numBytes; iByte += 2) {
              array.push(data.readUInt16BE(pos + numLenBytes + iByte));
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;

        case U4_ITEM:
          if (numBytes === 4) {
            return data.readUInt32BE(pos + numLenBytes + 1);
          }
          {
            const array = [];
            for (let iByte = 1; iByte <= numBytes; iByte += 4) {
              array.push(data.readUInt32BE(pos + numLenBytes + iByte));
            }
            return array;
          }
          // eslint-disable-next-line no-unreachable
          break;

        default:
          return null;
      }
    } catch (err) {
      log.error(`Error reading response buffer: ${err}`);
      return null;
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function flushReportVariables(reportIndex, data) {
    // first element defines the list of  report values
    let nListItems;
    if (data.readUInt8(extractPos) === (LIST_ITEM + 1)) {
      nListItems = data.readUInt8(extractPos + 1);
      extractPos += 2;
    } else if (data.readUInt8(extractPos) === (LIST_ITEM + 2)) {
      nListItems = data.readUInt16BE(extractPos + 1);
      extractPos += 3;
    } else {
      log.info('>>>>> Event handler error, <results list> is not a list');
      return true;
    }

    let valueIndex = 1;
    while ((extractPos < data.length) && (valueIndex <= nListItems)) {
      const dummyValue = extractListElementValue(data);
      if (dummyValue === null) {
        log.info(`>>>>> Event handler error:  L${reportIndex}: invalid report value #: ${valueIndex}`);
        return true;
      }
      valueIndex += 1;
    }

    if (extractPos >= data.length) {
      log.info(`>>>>> Event handler error:  L${reportIndex}: invalid report value list`);
      return true;
    }

    return false;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  const EVENT_REPORT_ERROR = 0;
  const EVENT_REPORT_SKIPPED = 1;
  const EVENT_REPORT_TO_PROCESS = 2;

  function extractReportIDFromEventReport(reportIndex, collectionEventID, data) {
    // make sure the first element of the reportID is a 2-element list
    let nListItems;
    if (data.readUInt8(extractPos) === (LIST_ITEM + 1)) {
      nListItems = data.readUInt8(extractPos + 1);
      extractPos += 2;
    } else if (data.readUInt8(extractPos) === (LIST_ITEM + 2)) {
      nListItems = data.readUInt16BE(extractPos + 1);
      extractPos += 3;
    } else {
      log.info(`>>>>> Event handler error:  L${reportIndex}: first element is not a 2-element list`);
      return EVENT_REPORT_ERROR;
    }
    if (nListItems !== 2) {
      log.info(`>>>>> Event handler error:  L${reportIndex}: first element is not a 2-element list`);
      return EVENT_REPORT_ERROR;
    }

    // make sure the first element of this list (REPORTID) matches the CEID,
    // because we defined them to match
    const elementDataType = extractListElementDataType(data);
    if (elementDataType !== U4_ITEM) {
      log.info(`>>>>> Event handler error:  L${reportIndex}: REPORTID not a U4_ITEM`);
      return EVENT_REPORT_ERROR;
    }
    const reportID = extractListElementValue(data);
    if (reportID !== collectionEventID) {
      log.info(`>>>>> Event handler:  L${reportIndex}: REPORTID:${reportID} does not match <CEID>`);
      const reportError = flushReportVariables(reportIndex, data);
      if (reportError) {
        return EVENT_REPORT_ERROR;
      }
      return EVENT_REPORT_SKIPPED;
    }

    return EVENT_REPORT_TO_PROCESS;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractEventReport(data) {
    // make sure message length is sufficient
    if (data.length < 4) {
      return 0;
    }

    const messageLength = data.readUInt32BE(0);
    if (messageLength < 12) {
      return 0;
    }

    if ((data.readUInt8(S_INDEX) !== (6 + WAIT_BIT))
        || (data.readUInt8(F_INDEX) !== 11)) {
      return 0;
    }

    log.info('>>>>> received asynchronous event report: S6F11 packet:');
    // dumpBuffer(data);

    // make sure the first item is a 3-element list
    let nListItems;
    if (data.readUInt8(14) === (LIST_ITEM + 1)) {
      nListItems = data.readUInt8(15);
      extractPos = 16;
    } else if (data.readUInt8(14) === (LIST_ITEM + 2)) {
      nListItems = data.readUInt16BE(15);
      extractPos = 17;
    } else {
      log.info('>>>>> Event handler error, first item is not a 3-element list');
      return 0;
    }
    if (nListItems !== 3) {
      log.info('>>>>> Event handler error, first item is not a 3-element list');
      return 0;
    }

    // extract the first list element: <DATAID>
    let elementDataType = extractListElementDataType(data);
    if (elementDataType !== U4_ITEM) {
      log.info('>>>>> Event handler error, first list element not a U4_ITEM');
      return 0;
    }
    elementDataType = extractListElementValue(data); // use elementDataType to hold dataid value

    // extract the second list element: <CEID>
    elementDataType = extractListElementDataType(data);
    if (elementDataType !== U4_ITEM) {
      log.info('>>>>> Event handler error, second list element not a U4_ITEM');
      return 0;
    }
    const collectionEventID = extractListElementValue(data);

    log.info(`>>>>> S6F11 report: CEID: ${collectionEventID}`);

    // check if we care about this CEID
    const CEIDIndex = CEIDListArray.indexOf(collectionEventID);
    if (CEIDIndex < 0) {
      log.info('>>>>> Event handler error, CEID does not match an event we are monitoring');
      lastSourceId = data.readUInt16BE(10);
      lastTransactionId = data.readUInt16BE(12);
      client.write(bufferEventReportAck());
      return (messageLength + 4);
    }

    log.info(`>>>>> S6F11 report: CEID: ${collectionEventID} - found in our machine definition`);

    // make sure the next item is a list
    let numberOfReportIDs = 0;
    if (data.readUInt8(extractPos) === (LIST_ITEM + 1)) {
      numberOfReportIDs = data.readUInt8(extractPos + 1);
      extractPos += 2;
    } else if (data.readUInt8(extractPos) === (LIST_ITEM + 2)) {
      numberOfReportIDs = data.readUInt16BE(extractPos + 1);
      extractPos += 3;
    } else {
      log.info('>>>>> Event handler error, third element of the first list is not a list');
      return 0;
    }

    // go through each report ID, checking if it's one we are looking for
    let reportResult = EVENT_REPORT_SKIPPED;
    let reportIndex = 1;
    while ((extractPos < data.length)
           && (reportIndex <= numberOfReportIDs)
           && (reportResult !== EVENT_REPORT_TO_PROCESS)) {
      reportResult = extractReportIDFromEventReport(reportIndex, collectionEventID, data);
      switch (reportResult) {
        case EVENT_REPORT_TO_PROCESS:
          break;

        case EVENT_REPORT_ERROR:
          return 0;

        case EVENT_REPORT_SKIPPED:
          reportIndex += 1;
          break;

        default:
          reportIndex += 1;
          break;
      }
    }

    if (reportResult !== EVENT_REPORT_TO_PROCESS) {
      return 0;
    }

    log.info(`>>>>> S6F11 report: CEID: ${collectionEventID}: RPTID: ${reportIndex}- all element checks passed, processing variables`);

    // if we make it her, everything checks out, read in our report values.

    // first element defines the list of  report values
    if (data.readUInt8(extractPos) === (LIST_ITEM + 1)) {
      nListItems = data.readUInt8(extractPos + 1);
      extractPos += 2;
    } else if (data.readUInt8(extractPos) === (LIST_ITEM + 2)) {
      nListItems = data.readUInt16BE(extractPos + 1);
      extractPos += 3;
    } else {
      log.info('>>>>> Event handler error, <results list> is not a list');
      return 0;
    }

    if (nListItems !== CEIDVariableList[CEIDListArray[CEIDIndex]].length) {
      log.info(`>>>>> Event handler error, <results list> = L [${nListItems}], should be L [${CEIDVariableList[CEIDListArray[CEIDIndex]].length}]`);
      return 0;
    }

    let failedToGetData = false;
    // read each of the n values
    for (let iResult = 0;
      iResult < CEIDVariableList[CEIDListArray[CEIDIndex]].length;
      iResult += 1) {
      let extractedValue = null;
      if (iResult < nListItems) {
        extractedValue = extractListElementValue(data);
      }
      const variable = CEIDVariableList[CEIDListArray[CEIDIndex]][iResult];
      if (extractedValue === null) {
        alert.raise({ key: 'failed-to-get-data-alert', errorMsg: variable.name });
        failedToGetData = true;
      } else {
        const variableValue = convertType(extractedValue, variable.format, _.get(variable, 'array', false));
        log.info(`>>>>> received value for ${variable.name}: ${variableValue}`);
        updateDatabase(variable, variableValue);
      }
    }

    if (!failedToGetData) {
      alert.clear('failed-to-get-data-alert');
    }

    lastSourceId = data.readUInt16BE(10);
    lastTransactionId = data.readUInt16BE(12);

    log.info(`!!!!!!!!!!!!!!!!!!!!!!!!!!! received asynchronous EVENT-REPORT (transactionId = ${lastTransactionId})`);

    client.write(bufferEventReportAck());

    return (messageLength + 4);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractFailedTransactionResponse(data) {
    // make sure message length is correct
    if (data.length !== 18) {
      return 0;
    }

    if (data.readUInt32BE(0) !== 14) {
      return 0;
    }

    if ((data.readUInt8(S_INDEX) !== 1)
        || (data.readUInt8(F_INDEX) !== 0)) {
      return 0;
    }

    // stop the communication timeout timer
    if (commTimeoutTimer) {
      clearTimeout(commTimeoutTimer);
      commTimeoutTimer = null;
    }

    return 18; // size of a failed-transaction packet
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractStatusVariablesResponse(data) {
    // make sure message length is sufficient
    if (data.length < 4) {
      return 0;
    }

    if (data.readUInt32BE(0) < 12) {
      return 0;
    }

    if ((data.readUInt8(S_INDEX) !== 1)
        || (data.readUInt8(F_INDEX) !== 4)) {
      return 0;
    }

    lastTransactionId = data.readUInt16BE(12);

    // make sure the first item is an n element list (ignore list length > 65535)
    let nListItems;
    if (data.readUInt8(14) === (LIST_ITEM + 1)) {
      nListItems = data.readUInt8(15);
      extractPos = 16;
    } else if (data.readUInt8(14) === (LIST_ITEM + 2)) {
      nListItems = data.readUInt16BE(15);
      extractPos = 17;
    } else {
      return 0;
    }

    // stop the communication timeout timer
    if (commTimeoutTimer) {
      clearTimeout(commTimeoutTimer);
      commTimeoutTimer = null;
    }

    let failedToGetData = false;
    // read each of the n values
    for (let iResult = 0; iResult < statusVariablesReadArray.length; iResult += 1) {
      let extractedValue = null;
      if (iResult < nListItems) {
        extractedValue = extractListElementValue(data);
      }
      const variable = statusVariablesReadArray[iResult];
      if (extractedValue === null) {
        alert.raise({ key: 'failed-to-get-data-alert', errorMsg: variable.name });
        failedToGetData = true;
      } else {
        const variableValue = convertType(extractedValue, variable.format, _.get(variable, 'array', false));
        log.info(`>>>>> received value for ${variable.name}: ${variableValue}`);
        updateDatabase(variable, variableValue);
      }
    }

    transactionIDCheckOK = false;
    if (!failedToGetData) {
      alert.clear('failed-to-get-data-alert');
      endMilliseconds = Date.now();
      log.info(`>>>>> received all StatusVariable values (transactionId = ${lastTransactionId}).  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
      if (lastTransactionId === verificationTransactionID) {
        transactionIDCheckOK = true;
      } else {
        log.info(`!!!!!!!!!! transactionId: ${lastTransactionId} does not match verificationTransactionID: ${verificationTransactionID}`);
      }
    }

    return extractPos;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function extractEquipmentConstantsResponse(data) {
    // make sure message length is sufficient
    if (data.length < 4) {
      return 0;
    }

    if (data.readUInt32BE(0) < 12) {
      return 0;
    }

    if ((data.readUInt8(S_INDEX) !== 2)
        || (data.readUInt8(F_INDEX) !== 14)) {
      return 0;
    }

    lastTransactionId = data.readUInt16BE(12);

    // make sure the first item is an n element list (ignore list length > 65535)
    let nListItems;
    if (data.readUInt8(14) === (LIST_ITEM + 1)) {
      nListItems = data.readUInt8(15);
      extractPos = 16;
    } else if (data.readUInt8(14) === (LIST_ITEM + 2)) {
      nListItems = data.readUInt16BE(15);
      extractPos = 17;
    } else {
      return 0;
    }

    // stop the communication timeout timer
    if (commTimeoutTimer) {
      clearTimeout(commTimeoutTimer);
      commTimeoutTimer = null;
    }

    let failedToGetData = false;
    // read each of the n values
    for (let iResult = 0; iResult < equipmentConstantsReadArray.length; iResult += 1) {
      let extractedValue = null;
      if (iResult < nListItems) {
        extractedValue = extractListElementValue(data);
      }
      const variable = equipmentConstantsReadArray[iResult];
      if (extractedValue === null) {
        alert.raise({ key: 'failed-to-get-data-alert', errorMsg: variable.name });
        failedToGetData = true;
      } else {
        const variableValue = convertType(extractedValue, variable.format, _.get(variable, 'array', false));
        log.info(`>>>>> received value for ${variable.name}: ${variableValue}`);
        updateDatabase(variable, variableValue);
      }
    }

    transactionIDCheckOK = false;
    if (!failedToGetData) {
      alert.clear('failed-to-get-data-alert');
      endMilliseconds = Date.now();
      log.info(`>>>>> received all EquipmentConstants values (transactionId = ${lastTransactionId}).  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
      if (lastTransactionId === verificationTransactionID) {
        transactionIDCheckOK = true;
      } else {
        log.info(`!!!!!!!!!! transactionId: ${lastTransactionId} does not match verificationTransactionID: ${verificationTransactionID}`);
      }
    }

    return extractPos;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

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

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

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

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function clearAllOperationTimers() {
    if (pollingRequestTimer) {
      clearTimeout(pollingRequestTimer);
      pollingRequestTimer = null;
    }
    if (dataCompleteTimer) {
      clearTimeout(dataCompleteTimer);
      dataCompleteTimer = null;
    }
    if (commTimeoutTimer) {
      clearTimeout(commTimeoutTimer);
      commTimeoutTimer = null;
    }
    if (writeTimeoutTimer) {
      clearTimeout(writeTimeoutTimer);
      writeTimeoutTimer = null;
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function disconnectReconnect(sendClientEndFlag) {
    if (client) {
      commState = WAIT_NONE;

      // clear any timers that may be active
      clearAllOperationTimers();

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (linkTestTimer) {
        clearInterval(linkTestTimer);
        linkTestTimer = null;
      }

      if (sendClientEndFlag) {
        client.end();
      }
      client.destroy();

      alert.raise({ key: 'connectivity-alert' });
      disconnectionDetected();
      updateConnectionStatus(false);

      log.info(`----setting reconnect timer: reconnectCount = ${reconnectCount}, reconnectTimer = ${reconnectTimerValue}`);
      reconnectTimer = setTimeout(() => {
        log.info(`----calling clientConnection, reconnectCount = ${reconnectCount}, reconnectTimer = ${reconnectTimerValue}`);
        reconnectCount += 1;
        if (reconnectCount > MAX_RECONNECT_TRYS_BEFORE_SPARK_HARDWARE_RESTART) {
          log.info('Intentional crash in secs-gems reconnect logic to restart spark-hardware!!!!!');
          client.resetAndDestroy();
        }

        // reconnectTimerValue = reconnectTimerValue * 2;
        // if (reconnectTimerValue > MAX_RECONNECT_TIMER) {
        //   reconnectTimerValue = MAX_RECONNECT_TIMER;
        // }

        // eslint-disable-next-line no-use-before-define
        clientConnection();
      }, reconnectTimerValue);
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function clearCommTimeout() {
    // called when we receive a response from the machine

    log.info('---CLEARING COMM TIMEOUT');

    if (commTimeoutTimer) {
      clearTimeout(commTimeoutTimer);
      commTimeoutTimer = null;
    }

    requestRetryCount = 0;

    alert.clear('no-response-alert');
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function clearConnectionRetryData() {
    // called when we've made it through our entire startup sequence

    log.info('----- STARTUP SEQUENCE COMPLETED SUCCESSFULLY!!!');

    reconnectCount = 1;
    reconnectTimer = RECONNECT_TIMER;

    if (that.machine.settings.model.enablePeriodicLinkTestMessages) {
      if (linkTestTimer) {
        clearInterval(linkTestTimer);
      }
      linkTestTimer = setInterval(sendLinkTestRequest,
        (that.machine.settings.model.linkTestFrequency * 1000));
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function startCommTimeoutTimer() {
    if (commTimeoutTimer) {
      clearTimeout(commTimeoutTimer);
      commTimeoutTimer = null;
    }

    log.info('---STARTING COMM TIMEOUT');

    // start the communication timout timer
    commTimeoutTimer = setTimeout(() => {
      commTimeoutTimer = null;
      alert.raise({ key: 'no-response-alert' });
      // if communication times out, try to reconnect
      requestRetryCount += 1;
      if (requestRetryCount > MAX_NUMBER_OF_REQUEST_RETRIES) {
        requestRetryCount = 0;
        log.info(`----no-response-alert - requestRetryCount = ${requestRetryCount}.  Calling disconnectReconnect(true)`);
        disconnectReconnect(true);
      } else {
        log.info(`----no-response-alert - requestRetryCount = ${requestRetryCount}.  Calling retryRequest`);
        // eslint-disable-next-line no-use-before-define
        retryRequest();
      }
    }, COMM_TIMEOUT);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function setCommState(newCommState) {
    if (commTimeoutTimer) {
      clearTimeout(commTimeoutTimer);
      commTimeoutTimer = null;
    }

    switch (newCommState) {
      case SEND_SELECT_RESPONSE:
        commState = WAIT_SELECT_RESPONSE;
        log.info('changing state to WAIT_SELECT_RESPONSE');
        startMilliseconds = Date.now();
        startCommTimeoutTimer();
        client.write(bufferSelectRequest());
        break;

      case SEND_ESTABLISH_COMM_REQUEST:
        commState = WAIT_ESTABLISH_COMM_RESPONSE;
        log.info('changing state to WAIT_ESTABLISH_COMM_RESPONSE');
        startMilliseconds = Date.now();
        startCommTimeoutTimer();
        client.write(bufferEstablishCommRequest());
        break;

      case SEND_ENABLE_ALARMS:
        commState = WAIT_ENABLE_ALARMS_ACK;
        startCommTimeoutTimer();
        client.write(bufferEnableAlarms());
        break;

      case SEND_DELETE_REPORT:
        commState = WAIT_DELETE_REPORT_ACK;
        startCommTimeoutTimer();
        client.write(bufferDeleteReportRequest());
        break;

      case SEND_DEFINE_REPORT:
        commState = WAIT_DEFINE_REPORT_ACK;
        startCommTimeoutTimer();
        client.write(bufferDefineReportRequest());
        break;

      case SEND_LINK_REPORT:
        commState = WAIT_LINK_REPORT_ACK;
        startCommTimeoutTimer();
        client.write(bufferLinkReportRequest());
        break;

      case SEND_EVENT_ENABLE:
        commState = WAIT_EVENT_ENABLE_ACK;
        startCommTimeoutTimer();
        client.write(bufferEventEnableRequest());
        break;

      case SEND_STATUS_VARIABLES_REQUEST:
        commState = WAIT_STATUS_VARIABLES_RESPONSE;
        startCommTimeoutTimer();
        client.write(bufferStatusVariablesRequest());
        break;

      case SEND_EQUIPMENT_CONSTANTS_REQUEST:
        commState = WAIT_EQUIPMENT_CONSTANTS_RESPONSE;
        startCommTimeoutTimer();
        client.write(bufferEquipmentConstantsRequest());
        break;

      default:
        break;
    } // switch (newCommState)
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function retryRequest() {
    switch (commState) {
      case WAIT_SELECT_RESPONSE:
        setCommState(SEND_SELECT_RESPONSE);
        break;

      case WAIT_ESTABLISH_COMM_REQUEST:
      case WAIT_ESTABLISH_COMM_RESPONSE:
        setCommState(SEND_ESTABLISH_COMM_REQUEST);
        break;

      case WAIT_ENABLE_ALARMS_ACK:
        setCommState(SEND_ENABLE_ALARMS);
        break;

      case WAIT_DELETE_REPORT_ACK:
        setCommState(SEND_DELETE_REPORT);
        break;

      case WAIT_DEFINE_REPORT_ACK:
        setCommState(SEND_DEFINE_REPORT);
        break;

      case WAIT_LINK_REPORT_ACK:
        setCommState(SEND_LINK_REPORT);
        break;

      case WAIT_EVENT_ENABLE_ACK:
        setCommState(SEND_EVENT_ENABLE);
        break;

      case WAIT_STATUS_VARIABLES_RESPONSE:
        setCommState(SEND_STATUS_VARIABLES_REQUEST);
        break;

      case WAIT_EQUIPMENT_CONSTANTS_RESPONSE:
        setCommState(SEND_EQUIPMENT_CONSTANTS_REQUEST);
        break;

      default:
        break;
    } // switch (commState) {
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function requestTimer() {
    // only start a new request if previous set has finished
    if (commState !== WAIT_NONE) {
      return;
    }

    if (client === null) {
      return;
    }

    startMilliseconds = Date.now();

    if (statusVariablesReadArray.length !== 0) {
      setCommState(SEND_STATUS_VARIABLES_REQUEST);
    } else if (equipmentConstantsReadArray.length !== 0) {
      setCommState(SEND_EQUIPMENT_CONSTANTS_REQUEST);
    } else {
      pollingRequestTimer = setTimeout(requestTimer, requestFrequencyMs);
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function waitEstablishCommResponseTimerFunc() {
    log.info('changing state to WAIT_ESTABLISH_COMM_RESPONSE');
    commTimeoutTimer = null;
    setCommState(SEND_ESTABLISH_COMM_REQUEST);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function HandleReceivedPackets() {
    let doneFlag = false;
    let processedPacket = false;
    let processedByteCount = 0;

    while (!doneFlag) {
      const packetLength = receiveBuffer.readUInt32BE(0);
      if ((packetLength + 4) <= receiveBufferByteCount) {
        // we have enough received bytes to satisfy the length specified for this message.
        const truncatedBuffer = receiveBuffer.slice(0, (packetLength + 4));

        log.info('received packet:');
        // dumpBuffer(truncatedBuffer);
        endMilliseconds = Date.now();
        log.info(`----- Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);

        // first, check for an asynchronous are-you-there-request
        processedByteCount = extractAreYouThereRequest(truncatedBuffer);
        if (processedByteCount) {
          processedPacket = true;
        }

        if (!processedPacket) {
          processedByteCount = extractTransactionTimerTimeoutRequest(truncatedBuffer);
          if (processedByteCount) {
            processedPacket = true;
          }
        }

        // next, check for an asynchronous alarm report
        if (!processedPacket) {
          processedByteCount = extractAlarmReport(truncatedBuffer);
          if (processedByteCount) {
            processedPacket = true;
          }
        }

        // next, check for an asynchronous event report
        if (!processedPacket) {
          processedByteCount = extractEventReport(truncatedBuffer);
          if (processedByteCount) {
            processedPacket = true;
          }
        }

        if (!processedPacket) {
          switch (commState) {
            case WAIT_SELECT_RESPONSE:
              if (extractSelectResponse(truncatedBuffer)) {
                processedPacket = true;

                clearCommTimeout();

                log.info('changing state to WAIT_ESTABLISH_COMM_REQ');
                commState = WAIT_ESTABLISH_COMM_REQUEST;

                // it appears that for some machines, we do not receive
                // a follow up ESTABLISHCOMM_REQ.  For those cases, we set this timer
                // so that we still send our own ESTABLISH_COMM_REQ.
                commTimeoutTimer = setTimeout(waitEstablishCommResponseTimerFunc, 500);
              }
              break;

            case WAIT_ESTABLISH_COMM_REQUEST:
              if (extractEstablishCommRequest(truncatedBuffer)) {
                processedPacket = true;

                // since we received the ESTABLISH_COMM_REQ from the machine, we can cancel
                // our fallback timer - and set a new one to send our ESTABLISH_COMM_REQ,
                // after we respond with a ESTABLISH_COMM_RESPONSE to the machine
                clearCommTimeout();

                // first, send our response to the equipments S1F13 - establish communications
                client.write(bufferEstablishCommResponse());
                // then, after 500 msec, send out own S1F13
                commTimeoutTimer = setTimeout(waitEstablishCommResponseTimerFunc, 500);
              }
              break;

            case WAIT_ESTABLISH_COMM_RESPONSE:
              log.info('received packet - WAIT_ESTABLISH_COMM_RESPONSE');
              // dumpBuffer(data);
              if (extractEstablishCommAck(truncatedBuffer)) {
                processedPacket = true;

                clearCommTimeout();
                setCommState(SEND_ENABLE_ALARMS);
              }
              break;

            case WAIT_ENABLE_ALARMS_ACK:
              if (extractEnableAlarmsAck(truncatedBuffer)) {
                processedPacket = true;

                clearCommTimeout();

                if (CEIDListArray.length === 0) { // no variables tied to events
                  commState = WAIT_NONE;

                  clearConnectionRetryData();

                  log.info('changing state to WAIT_NONE');

                  if (pollingRequestTimer) {
                    clearTimeout(pollingRequestTimer);
                    pollingRequestTimer = null;
                  }
                  pollingRequestTimer = setTimeout(requestTimer, requestFrequencyMs);
                } else {
                  setCommState(SEND_DELETE_REPORT);
                }
              }
              break;

            case WAIT_DELETE_REPORT_ACK:
              if (extractDefineReportAck(truncatedBuffer)) {
                processedPacket = true;

                clearCommTimeout();

                setCommState(SEND_DEFINE_REPORT);
              }
              break;

            case WAIT_DEFINE_REPORT_ACK:
              if (extractDefineReportAck(truncatedBuffer)) {
                processedPacket = true;

                clearCommTimeout();

                setCommState(SEND_LINK_REPORT);
              }
              break;

            case WAIT_LINK_REPORT_ACK:
              if (extractLinkReportAck(truncatedBuffer)) {
                processedPacket = true;

                clearCommTimeout();

                setCommState(SEND_EVENT_ENABLE);
              }
              break;

            case WAIT_EVENT_ENABLE_ACK:
              if (extractEventEnableAck(truncatedBuffer)) {
                processedPacket = true;

                clearCommTimeout();

                commState = WAIT_NONE;
                clearConnectionRetryData();
                //  console.log('changing state to WAIT_NONE');
                if (pollingRequestTimer) {
                  clearTimeout(pollingRequestTimer);
                  pollingRequestTimer = null;
                }
                pollingRequestTimer = setTimeout(requestTimer, requestFrequencyMs);
              }
              break;

            case WAIT_CONSTANT_WRITE_ACK:
              if (extractConstantWriteAck(truncatedBuffer)) {
                processedPacket = true;

                if (writeTimeoutTimer) {
                  clearTimeout(writeTimeoutTimer);
                  writeTimeoutTimer = null;
                }
                commState = WAIT_NONE;
                alert.clear('write-failed-alert');
              }
              break;

            default:
              // do we still have a message to process
              switch (commState) {
                case WAIT_STATUS_VARIABLES_RESPONSE:
                  processedByteCount = extractStatusVariablesResponse(truncatedBuffer);
                  if (processedByteCount) {
                    processedPacket = true;
                    alert.clear('bad-status-response-alert');
                  } else {
                    processedByteCount = extractFailedTransactionResponse(truncatedBuffer);
                    if (processedByteCount) {
                      transactionIDCheckOK = false;
                      processedPacket = true;
                      endMilliseconds = Date.now();
                      log.info(`>>>>> received failed-transaction response to Status-Variables request.  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
                      alert.raise({ key: 'bad-status-response-alert' });
                    }
                  }

                  if (processedByteCount) {
                    clearCommTimeout();

                    if (transactionIDCheckOK) {
                      if (equipmentConstantsReadArray.length > 0) {
                        setCommState(SEND_EQUIPMENT_CONSTANTS_REQUEST);
                      } else {
                        commState = WAIT_NONE;
                        // we're done with our requests, do restart the poling timer
                        if (pollingRequestTimer) {
                          clearTimeout(pollingRequestTimer);
                          pollingRequestTimer = null;
                        }
                        pollingRequestTimer = setTimeout(requestTimer, requestFrequencyMs);
                      }
                    } else {
                      log.info('----------------- setting reestablishConnectionTimer');
                      reestablishConnectionTimer = setTimeout(sendSeparatetRequest, 2000);
                    }
                  }
                  break;

                case WAIT_EQUIPMENT_CONSTANTS_RESPONSE:
                  processedByteCount = extractEquipmentConstantsResponse(truncatedBuffer);
                  if (processedByteCount) {
                    processedPacket = true;
                    alert.clear('bad-constant-response-alert');
                  } else {
                    processedByteCount = extractFailedTransactionResponse(truncatedBuffer);
                    if (processedByteCount) {
                      processedPacket = true;
                      endMilliseconds = Date.now();
                      log.info(`>>>>> received failed-transaction response to Equipment-Constants request.  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
                      alert.raise({ key: 'bad-constant-response-alert' });
                    }
                  }

                  if (processedByteCount) {
                    clearCommTimeout();

                    commState = WAIT_NONE;
                    // we're done with our requests, do restart the poling timer
                    if (pollingRequestTimer) {
                      clearTimeout(pollingRequestTimer);
                      pollingRequestTimer = null;
                    }
                    pollingRequestTimer = setTimeout(requestTimer, requestFrequencyMs);
                  }
                  break;

                default:
                  break;
              }
              break;
          } // switch (commState)
        }

        if (!processedPacket) {
          // if we still have not processed this, log it as un unknown packet
          log.info('received UNPROCESSED packet:');
          // dumpBuffer(truncatedBuffer);
        }
        // strip out the packet we just processed
        receiveBuffer = receiveBuffer.slice(packetLength + 4);
        receiveBufferByteCount -= (packetLength + 4);
        if (receiveBufferByteCount <= 4) {
          doneFlag = true;
        }
      } else {
        doneFlag = true;
      }
    } // while (!doneFlag) {
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function HandleReceivedData(data) {
    log.info('received data:');
    // dumpBuffer(data);
    endMilliseconds = Date.now();
    log.info(`----- Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);

    // allow time for entire message to arrive and then process it
    if (dataCompleteTimer) {
      clearTimeout(dataCompleteTimer);
      dataCompleteTimer = null;
    }
    if ((receiveBufferByteCount + data.length) <= receiveBufSize) {
      receiveBuffer = Buffer.concat([receiveBuffer, data]);
      // data.copy(receiveBuffer, receiveBufferByteCount);
      receiveBufferByteCount += data.length;
    }
    if (receiveBufferByteCount > 4) {
      HandleReceivedPackets();
    }
    if (receiveBufferByteCount > 0) {
      dataCompleteTimer = setTimeout(() => {
        HandleReceivedPackets();
        if (receiveBufferByteCount) {
          log.info('---- clearing unused receiveBuffer:');
          // dumpBuffer(receiveBuffer);
          receiveBuffer = Buffer.allocUnsafe(0);
          receiveBufferByteCount = 0;
        }
      }, DATA_COMPLETE_TIMEOUT);
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function clientConnection() {
    // try and connect to server
    log.info('----calling net.CreateConnection');


    transactionId = 0;

    client = net.createConnection(port, host, () => {
      // succesfully connected to server
      log.info('----succesfully connected to server');
      alert.clear('connectivity-alert');
      connectionDetected();
      updateConnectionStatus(true);

      if (startupState === WAIT_SELECT_RESPONSE) {
        setCommState(SEND_SELECT_RESPONSE);
        startupState = SEND_ESTABLISH_COMM_REQUEST; // toggle the startup state for the next retry
      } else {
        setCommState(SEND_ESTABLISH_COMM_REQUEST);
        startupState = WAIT_SELECT_RESPONSE; // toggle the startup state for the next retry
      }
    });

    //------------------------------------------------------------------------------

    client.on('error', (err) => {
      // failed to connect to server,, try to reconnect
      log.info(`----client.on error - calling disconnectReconnect(false) : err = ${err}`);
      log.info(`----client.on error - calling disconnectReconnect(false) : err = ${err}`);
      disconnectReconnect(false);
    });

    //------------------------------------------------------------------------------

    // subscribe to on 'data' events
    client.on('data', (data) => {
      HandleReceivedData(data);
    });

    //------------------------------------------------------------------------------

    // subscribe to on 'end' events
    client.on('end', () => {
      // this is this getting called, when we stop the machine, but also when we kill the server
      log.info('Disconnected from machine.');

      log.info('received client.on:end - Disconnected from machine.');

      // raising alert to notify disconnection
      alert.raise({ key: 'connectivity-alert' });
      disconnectionDetected();
      updateConnectionStatus(false);

      // stop the request timer task if applicable
      if (pollingRequestTimer) {
        clearTimeout(pollingRequestTimer);
        pollingRequestTimer = null;
        commState = WAIT_NONE;
      }

      // try to reconnect, after our retry timeout
      startupState = WAIT_SELECT_RESPONSE;
      disconnectReconnect(false);
    });
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function open(callback) {
    requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    ({ port } = that.machine.settings.model);
    host = that.machine.settings.model.ipAddress;
    connectionReported = false;

    log.info('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>');
    log.info(`-----CEIDListArray = ${JSON.stringify(CEIDListArray)}`);
    for (let CEIDListArrayIndex = 0; CEIDListArrayIndex < CEIDListArray.length;
      CEIDListArrayIndex += 1) {
      log.info(`----------CEIDVariableList.${CEIDListArray[CEIDListArrayIndex]}:`);
      for (let CEIDVariableListIndex = 0;
        CEIDVariableListIndex < CEIDVariableList[CEIDListArray[CEIDListArrayIndex]].length;
        CEIDVariableListIndex += 1) {
        log.info(CEIDVariableList[CEIDListArray[CEIDListArrayIndex]][CEIDVariableListIndex].name);
      }
    }
    log.info('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');


    for (let iVar = 0; iVar < statusVariablesReadArray.length; iVar += 1) {
      if (statusVariablesReadArray[iVar].numericID === undefined) {
        // return with an error if this is not the case
        alert.raise({ key: 'numeric-id-missing-alert', errorMsg: statusVariablesReadArray[iVar].name });
        return callback(new Error('All status variables require a numericID'));
      }
    }
    for (let iVar = 0; iVar < equipmentConstantsReadArray.length; iVar += 1) {
      if (equipmentConstantsReadArray[iVar].numericID === undefined) {
        // return with an error if this is not the case
        alert.raise({ key: 'numeric-id-missing-alert', errorMsg: equipmentConstantsReadArray[iVar].name });
        return callback(new Error('All equipment constants require a numericID'));
      }
    }
    alert.clear('numeric-id-missing-alert');

    // assume there are now active alarms
    currentAlarmCodes = [];
    currentAlarmTexts = [];

    // initalize alarm codes and texts to none
    that.machine.variables.forEach((variable) => {
      if (variable.type === 'Active Alarm Codes') {
        updateDatabase(variable, []);
      } else if (variable.type === 'Active Alarm Texts') {
        updateDatabase(variable, []);
      }
    });

    // create the connection
    clientConnection();

    callback(null);

    return undefined;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function close(callback) {
    updateConnectionStatus(false);

    // close the client or server port if open
    if (client === null) {
      return callback(new Error('No Net Device To Close'));
    }

    // if we are currently in a request/response cycle (for req/res client type)
    if ((commState !== WAIT_NONE)) {
      // hold off on closing using an interval timer
      let waitCounter = 0;
      const activeWait = setInterval(() => {
        // until safe to do so
        if ((commState === WAIT_NONE) || (waitCounter > 20)) {
          commState = WAIT_NONE;
          clearInterval(activeWait);
          client.end();
          client.destroy();
          return callback();
        }
        waitCounter += 1;
        return undefined;
      }, 100); // interval set at 100 milliseconds
    } else {
      client.end();
      client.destroy();
      return callback();
    }
    return undefined;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  // Privileged methods
  this.writeData = function writeData(value, done) {
    // get the variable name and make sure it exists and is writable
    const variableName = value.variable;
    if (!Object.prototype.hasOwnProperty.call(variablesWriteObj, variableName)) {
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

    // make sure variable is an equipment constant
    if (variable.type !== 'Equipment Constant (EC)') {
      alert.raise({
        key: `not-eqipment-constant-error-${variableName}`,
        msg: `${machine.info.name}: Variable Is Not an Equipment Constant`,
        description: `Error writing ${variableName}. Only equipment constants may be written`,
      });
      done();
      return;
    }
    alert.clear(`not-eqipment-constant-error-${variableName}`);

    // make sure variable has numeric ID
    if (!_.has(variable, 'numericID')) {
      alert.raise({
        key: `no-numeric-id-error-${variableName}`,
        msg: `${machine.info.name}: Variable Has No Numeric ID`,
        description: `Error writing ${variableName}. Variable does not have a numeric ID`,
      });
      done();
      return;
    }
    alert.clear(`no-numeric-id-error-${variableName}`);

    // send the command to set the equipment constant
    commState = WAIT_CONSTANT_WRITE_ACK;
    client.write(bufferConstantWrite(variable, value[variableName]));

    // wait for the acknowledge
    writeTimeoutTimer = setTimeout(() => {
      writeTimeoutTimer = null;
      alert.raise({ key: 'write-failed-alert' });
    }, WRITE_TIMEOUT);

    done();
  };

  //------------------------------------------------------------------------------

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

    alert.clear('DV-requires-CEID-alert');

    // build two arrays of variables to be read,
    // one for status variables and one for equipment constants
    statusVariablesReadArray = [];
    equipmentConstantsReadArray = [];
    CEIDListArray = [];
    CEIDVariableList = {};
    // at the end of this loop, we should have the following structures:
    //    CEIDListArray - an array containing every CEID referenced in the machine definition
    //    CEIDVariableList - a JSON object where every CEID keyword contains an array of the
    //                       items associated with that CEID. For example:
    //                       CEIDVariableList[12345] = [SV12, EC34, DC56]
    //   statusVariablesReadArray - an array containing every SV to be polled
    //   equipmentConstantsReadArray - an array containing every DV to be polled
    async.forEachSeries(that.machine.variables, (item, callback) => {
      // skip machine connected variables
      if (!_.get(item, 'machineConnected', false)) {
        const itemWithAccess = item;
        if (!(item.access === 'write' || item.access === 'read')) {
          itemWithAccess.access = 'read';
        }
        if (itemWithAccess.access === 'read') {
          if (_.has(itemWithAccess, 'CEID')) {
            switch (itemWithAccess.type) {
              case 'Status Variable (SV)':
              case 'Equipment Constant (EC)':
              case 'Data Variable (DV) (requires CEID)':
                if (!CEIDListArray.includes(itemWithAccess.CEID)) {
                  // only add it once for each CEID
                  CEIDListArray.push(itemWithAccess.CEID);
                  CEIDVariableList[itemWithAccess.CEID] = [];
                }
                // add the variable to the list for this CEID
                CEIDVariableList[itemWithAccess.CEID].push(itemWithAccess);
                break;
              default:
            }
          } else {
            // no CEID, we just poll it - so add it to the appropriate poll array
            switch (itemWithAccess.type) {
              case 'Status Variable (SV)':
                statusVariablesReadArray.push(itemWithAccess);
                break;
              case 'Equipment Constant (EC)':
                equipmentConstantsReadArray.push(itemWithAccess);
                break;
              case 'Data Variable (DV) (requires CEID)':
                alert.raise({ key: 'DV-requires-CEID-alert', errorMsg: itemWithAccess.name });
                break;
              default:
                break;
            }
          }
        }
      }
      return callback();
    });

    // convert the variables array to an object for easy searching when writing variables
    // and filter it down to just 'write' variables
    variablesWriteObj = _.keyBy(_.filter(that.machine.variables,
      variable => (variable.access === 'write')), 'name');

    // allocate at least enough menory for the transmit and receive buffers
    // worst case for receive is 10 bytes/variable (8 bytes + item type and length)

    // note that we're allocating 100 bytes for each received item.
    // it's possible that the actual data will exceed this, but we have yet to see
    // an item exceeding 10 bytes, so this feels safe (for now).
    if (statusVariablesReadArray.length > equipmentConstantsReadArray.length) {
      transmitBufSize = transmitBufferBaseSize + (6 * statusVariablesReadArray.length);
      receiveBufSize = receiveBufferBaseSize + (100 * statusVariablesReadArray.length);
    } else {
      transmitBufSize = transmitBufferBaseSize + (6 * equipmentConstantsReadArray.length);
      receiveBufSize = receiveBufferBaseSize + (100 * equipmentConstantsReadArray.length);
    }

    // add in the header for the request command
    transmitBufSize += 18;

    // buffer size to define the reports is 24 bytes, but give extra
    let defineReportTransmitBufSize = 30;
    let eventReportReceiveBufSize = 30;
    let maxNumberOfEventVariables = 0;
    for (let CEIDListArrayIndex = 0; CEIDListArrayIndex < CEIDListArray.length;
      CEIDListArrayIndex += 1) {
      // buffer size for each report being define is 8 bytes, but give extra
      defineReportTransmitBufSize += 12;
      // space for each variable in a report needs to be 6 bytes
      defineReportTransmitBufSize += CEIDVariableList[CEIDListArray[CEIDListArrayIndex]].length * 6;
      if (CEIDVariableList[CEIDListArray[CEIDListArrayIndex]].length > maxNumberOfEventVariables) {
        maxNumberOfEventVariables = CEIDVariableList[CEIDListArray[CEIDListArrayIndex]].length;
      }
    }
    eventReportReceiveBufSize += (maxNumberOfEventVariables * 100);
    if (defineReportTransmitBufSize > transmitBufSize) {
      transmitBufSize = defineReportTransmitBufSize;
    }
    if (eventReportReceiveBufSize > receiveBufSize) {
      receiveBufSize = eventReportReceiveBufSize;
    }

    // add in the potential async keep alive message
    receiveBufSize += 14;
    // add in the potential async alarm message
    receiveBufSize += 100;

    if (transmitBufSize < transmitBufferMinSize) {
      transmitBufSize = transmitBufferMinSize;
    }
    if (receiveBufSize < receiveBufferMinSize) {
      receiveBufSize = receiveBufferMinSize;
    }
    transmitBuffer = Buffer.allocUnsafe(transmitBufSize);
    receiveBuffer = Buffer.allocUnsafe(0);

    startupState = WAIT_SELECT_RESPONSE;

    open((err) => {
      if (err) {
        return done(err);
      }

      log.info('Started');
      return done(null);
    });
    return undefined;
  };

  //------------------------------------------------------------------------------

  this.stop = function stop(done) {
    if (!that.machine) {
      return done('machine undefined');
    }

    clearAllOperationTimers();

    if (reestablishConnectionTimer) {
      clearTimeout(reestablishConnectionTimer);
      reestablishConnectionTimer = null;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (linkTestTimer) {
      clearInterval(linkTestTimer);
      linkTestTimer = null;
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

  //------------------------------------------------------------------------------

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop((err) => {
      if (err) return done(err);
      that.start(that.dataCb, that.configUpdateCb, startErr => done(startErr));
      return undefined;
    });
  };


  //------------------------------------------------------------------------------

  this.updateModel = function updateModel(newModel, done) {
    log.debug('Updating');
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

module.exports = {
  hpl: hplSecsGem,
  defaults,
  schema,
};
