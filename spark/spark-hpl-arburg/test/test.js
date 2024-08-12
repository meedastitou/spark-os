/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplArburg = require('../index.js');

const AWAIT_INITIAL_DLE = 1;
const AWAIT_DLE_TO_REQUEST_MESSAGE = 2;
const AWAIT_REACTION_TELEGRAM = 4;
const AWAIT_STX_FOR_RESPONSE_MESSAGE = 5;
const AWAIT_RESPONSE_MESSAGE = 6;
const AWAIT_DLE_BEFORE_SENDING_REACTION_TELEGRAM = 7;
const AWAIT_DLE_AFTER_SENDING_REACTION_TELEGRAM = 8;

const TRANSPORT_HEADER_SIZE_STANDARD = 10;
const TRANSPORT_FOOTER_SIZE = 3;
const APP_STATUS_RESPONSE_HEADER_SIZE = 12;

const APP_MESSAGE_LENGTH_FIELD_OFFSET = 6;
const TRANSACTION_NUM_OFFSET = 2;
const PROCEDURAL_CONTROL_OFFSET = 4;
const ACTION_COMMAND_OFFSET = 6;
const DS_DI_OFFSET = 8;
const STATUS_RESPONSE_SIZE_OFFSET = 10;
const STATUS_RESPONSE_MSG_HEADER_OFFSET = 12;
const STATUS_RESPONSE_MSG_HEADER_SIZE = 18;

const BASE_STATUS_OFFSET_OFFSET = 2;
const CYLINDER_UNITS_INFO_OFFSET = 6;
const CYLINDER_UNITS_STATUS_OFFSET = 8;
const AUTOMATION_COMPONTENTS_INFO_OFFSET = 10;
const AUTOMATION_UNITS_STATUS_OFFSET = 12;
const ALARM_LENGTH_OFFSET = 14;
const ALARM_MSG_OFFSET = 16;

const BASE_STATUS_SIZE = 160;
const CYLINDER_PROCESS_DATA_SIZE = 60;
const AUTOMATION_DATA_SIZE = 22;
const ALARM_MSG_MAX_LENGTH = 20;

const FRS_PROCEDURAL_CONTROL = 0x2003;
const STATUS_ACTION_COMMAND = 0x2901;
const DS_HEADER_VALUE = 0x0582;

const REACTION_TELEGRAM_CODE = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x10, 0x03, 0x13]);

// transport control codes
const STX = 0x02;
const ETX = 0x03;
const DLE = 0x10;

const RESPONSE_BUFFER_SIZE = 511; // MUST be odd

let sparkHplArburg;
let transportState = AWAIT_INITIAL_DLE;
let responseBuffer;

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});


const testMachine = {
  info: {
    name: 'test-machine',
    fullname: 'Test machine',
    version: '1.0.0',
    description: 'Test Machine',
    hpl: 'arburg',
  },
  settings: {
    model: {
      enable: true,
      device: '/dev/ttyS1',
      baudRate: '4800',
      requestFrequency: 0.1,
      unicodeEncoding: 'utf16le',
    },
  },
  // Note: All variables MUST have unique request keys!
  variables: [{
    name: 'uint8Test',
    description: 'UInt8 Test',
    format: 'uint8',
    blockLocation: 'Basic Status',
    byteOffset: 0,
    value: 123,
  }, {
    name: 'uint16Test',
    description: 'UInt16 Test',
    format: 'uint16',
    blockLocation: 'Basic Status',
    byteOffset: 1,
    value: 1234,
  }, {
    name: 'uint32Test',
    description: 'UInt32 Test',
    format: 'uint32',
    blockLocation: 'Basic Status',
    byteOffset: 3,
    value: 123456,
  }, {
    name: 'int8Test',
    description: 'Int8 Test',
    format: 'int8',
    blockLocation: 'Basic Status',
    byteOffset: 7,
    value: 34,
  }, {
    name: 'int16Test',
    description: 'Int16 Test',
    format: 'int16',
    blockLocation: 'Basic Status',
    byteOffset: 8,
    value: 2345,
  }, {
    name: 'int32Test',
    description: 'Int32 Test',
    format: 'int32',
    blockLocation: 'Basic Status',
    byteOffset: 10,
    value: 234567,
  }, {
    name: 'bitTest',
    description: 'Bit Test',
    format: 'bool',
    blockLocation: 'Basic Status',
    byteOffset: 14,
    value: true,
  }, {
    name: 'floatTest',
    description: 'Float Test',
    format: 'float',
    blockLocation: 'Basic Status',
    byteOffset: 15,
    value: 345678.0,
  }, {
    name: 'stringTest',
    description: 'String Test',
    format: 'char',
    blockLocation: 'Basic Status',
    byteOffset: 19,
    length: 4,
    value: 'ABCD',
  }, {
    name: 'cyl1Test',
    description: 'Cylinder 1 Test',
    format: 'int16',
    blockLocation: 'Process Data 1st Cylinder',
    byteOffset: 0,
    value: 1234,
  }, {
    name: 'cyl2Test',
    description: 'Cylinder 2 Test',
    format: 'int16',
    blockLocation: 'Process Data 2nd Cylinder',
    byteOffset: 0,
    value: 2345,
  }, {
    name: 'automationTest',
    description: 'Automation Components Test',
    format: 'float',
    blockLocation: 'Automation Components',
    byteOffset: 4,
    value: 56789.0,
  }, {
    name: 'alarmTest',
    description: 'Alarm Message Test',
    format: 'char',
    blockLocation: 'Alarm String',
    value: 'Test Alarm',
  }, {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
  }],
};

const db = new EventEmitter();

function dataCb(machine, variable, value, done) {
  const data = {
    machine: machine.info.name,
    variable: variable.name,
  };
  data[variable.name] = value;
  log.debug({ data });
  db.emit('data', data);
  done(null);
}

function configUpdateCb(machine, done) {
  log.debug({ machine });
  return done(null);
}

let alerts = {};
const sparkAlert = new EventEmitter();
sparkAlert.getAlerter = function getAlerter() {
  return {
    clearAll(done) {
      return done(null);
    },
    preLoad: function preLoad(preloadAlerts) {
      alerts = preloadAlerts;
    },
    raise: function raise(_alert) {
      const alert = _alert;
      if (_.has(alerts, alert.key)) _.extend(alert, alerts[alert.key]);
      Object.keys(alert).forEach((k) => {
        // check if the key is a function
        if (typeof alert[k] === 'function') {
          // if it is then run the function and replace
          // the key with the output
          alert[k] = alert[k](alert);
        }
      });
      sparkAlert.emit('raise', alert);
    },
    clear(key) {
      sparkAlert.emit('clear', key);
    },
  };
};

const config = {};
const sparkConfig = new EventEmitter();
sparkConfig.set = function set(key, value, done) {
  config[key] = value;
  if (done) return done(null);
  return undefined;
};
sparkConfig.get = function get(key, done) {
  if (done) {
    return done(null, config[key]);
  }

  return config[key];
};

function calculateBcc(inputBuffer, length) {
  let bcc = 0;
  for (let iBuf = 0; iBuf < length; iBuf += 1) {
    // eslint-disable-next-line no-bitwise
    bcc ^= inputBuffer[iBuf];
  }
  return bcc;
}

function writeVariableValueToBuffer(variable, buffer) {
  switch (variable.format) {
    case 'char':
      buffer.write(variable.value, variable.byteOffset,
        _.get(variable, 'length', 1));
      break;
    case 'bool':
      buffer.writeUInt8(variable.value ? 1 : 0, variable.byteOffset);
      break;
    case 'float':
      buffer.writeFloatLE(variable.value, variable.byteOffset);
      break;
    case 'uint32':
      buffer.writeUInt32LE(variable.value, variable.byteOffset);
      break;
    case 'int32':
      buffer.writeInt32LE(variable.value, variable.byteOffset);
      break;
    case 'uint16':
      buffer.writeUInt16LE(variable.value, variable.byteOffset);
      break;
    case 'int16':
      buffer.writeInt16LE(variable.value, variable.byteOffset);
      break;
    case 'uint8':
      buffer.writeUInt8(variable.value, variable.byteOffset);
      break;
    case 'int8':
      buffer.writeInt8(variable.value, variable.byteOffset);
      break;
    default:
  }
}

function writeToSerialPort(data) {
  switch (transportState) {
    case AWAIT_INITIAL_DLE:
      if ((data.length === 1) && (data[0] === STX)) {
        sparkHplArburg.transport.serialPort.writeToComputer(Buffer.from([DLE]));
        transportState = AWAIT_DLE_TO_REQUEST_MESSAGE;
      }
      break;
    case AWAIT_DLE_TO_REQUEST_MESSAGE: {
      // update the transaction number in the response from this incoming message
      const transactionNum = data.readInt16BE(TRANSPORT_HEADER_SIZE_STANDARD
         + TRANSACTION_NUM_OFFSET);
      responseBuffer.writeInt16BE(transactionNum,
        TRANSPORT_HEADER_SIZE_STANDARD + TRANSACTION_NUM_OFFSET);
      responseBuffer[responseBuffer.length - 1] = calculateBcc(responseBuffer,
        responseBuffer.length - 1);
      sparkHplArburg.transport.serialPort.writeToComputer(Buffer.from([DLE, STX]));
      transportState = AWAIT_REACTION_TELEGRAM;
      break;
    }
    case AWAIT_REACTION_TELEGRAM:
      sparkHplArburg.transport.serialPort.writeToComputer(REACTION_TELEGRAM_CODE);
      transportState = AWAIT_STX_FOR_RESPONSE_MESSAGE;
      break;
    case AWAIT_STX_FOR_RESPONSE_MESSAGE:
      if ((data.length === 1) && (data[0] === DLE)) {
        sparkHplArburg.transport.serialPort.writeToComputer(Buffer.from([STX]));
        transportState = AWAIT_RESPONSE_MESSAGE;
      }
      break;
    case AWAIT_RESPONSE_MESSAGE:
      sparkHplArburg.transport.serialPort.writeToComputer(responseBuffer);
      transportState = AWAIT_DLE_BEFORE_SENDING_REACTION_TELEGRAM;
      break;
    case AWAIT_DLE_BEFORE_SENDING_REACTION_TELEGRAM:
      sparkHplArburg.transport.serialPort.writeToComputer(Buffer.from([DLE]));
      transportState = AWAIT_DLE_AFTER_SENDING_REACTION_TELEGRAM;
      break;
    case AWAIT_DLE_AFTER_SENDING_REACTION_TELEGRAM:
      sparkHplArburg.transport.serialPort.writeToComputer(Buffer.from([DLE]));
      transportState = AWAIT_INITIAL_DLE;
      break;
    default:
  }
}

function buildResponse() {
  responseBuffer = Buffer.alloc(RESPONSE_BUFFER_SIZE);
  responseBuffer.writeInt16BE((RESPONSE_BUFFER_SIZE - (TRANSPORT_HEADER_SIZE_STANDARD
     + TRANSPORT_FOOTER_SIZE)) / 2, APP_MESSAGE_LENGTH_FIELD_OFFSET);
  const responseData = responseBuffer.slice(TRANSPORT_HEADER_SIZE_STANDARD,
    responseBuffer.length - TRANSPORT_FOOTER_SIZE);
  responseData.writeInt16BE(1, TRANSACTION_NUM_OFFSET);
  responseData.writeInt16BE(FRS_PROCEDURAL_CONTROL, PROCEDURAL_CONTROL_OFFSET);
  responseData.writeInt16BE(STATUS_ACTION_COMMAND, ACTION_COMMAND_OFFSET);
  responseData.writeUInt16BE(DS_HEADER_VALUE, DS_DI_OFFSET);
  responseData.writeInt16BE((responseData.length - APP_STATUS_RESPONSE_HEADER_SIZE),
    STATUS_RESPONSE_SIZE_OFFSET);
  const statusMsgHeader = responseData.slice(STATUS_RESPONSE_MSG_HEADER_OFFSET,
    STATUS_RESPONSE_MSG_HEADER_OFFSET + STATUS_RESPONSE_MSG_HEADER_SIZE);
  statusMsgHeader.writeUInt16LE(STATUS_RESPONSE_MSG_HEADER_SIZE, BASE_STATUS_OFFSET_OFFSET);
  const baseStatus = responseData.slice(STATUS_RESPONSE_MSG_HEADER_OFFSET
     + STATUS_RESPONSE_MSG_HEADER_SIZE,
  STATUS_RESPONSE_MSG_HEADER_OFFSET + STATUS_RESPONSE_MSG_HEADER_SIZE + BASE_STATUS_SIZE);
  statusMsgHeader.writeUInt16LE(0x03, CYLINDER_UNITS_INFO_OFFSET);
  statusMsgHeader.writeUInt16LE(STATUS_RESPONSE_MSG_HEADER_SIZE + BASE_STATUS_SIZE,
    CYLINDER_UNITS_STATUS_OFFSET);
  const cylinder1ProcessData = responseData.slice(STATUS_RESPONSE_MSG_HEADER_OFFSET
     + STATUS_RESPONSE_MSG_HEADER_SIZE + BASE_STATUS_SIZE,
  STATUS_RESPONSE_MSG_HEADER_OFFSET + STATUS_RESPONSE_MSG_HEADER_SIZE
      + BASE_STATUS_SIZE + CYLINDER_PROCESS_DATA_SIZE);
  const cylinder2ProcessData = responseData.slice(STATUS_RESPONSE_MSG_HEADER_OFFSET
     + STATUS_RESPONSE_MSG_HEADER_SIZE + BASE_STATUS_SIZE + CYLINDER_PROCESS_DATA_SIZE,
  STATUS_RESPONSE_MSG_HEADER_OFFSET + STATUS_RESPONSE_MSG_HEADER_SIZE
      + BASE_STATUS_SIZE + 2 * CYLINDER_PROCESS_DATA_SIZE);
  statusMsgHeader.writeUInt16LE(1, AUTOMATION_COMPONTENTS_INFO_OFFSET);
  statusMsgHeader.writeUInt16LE(STATUS_RESPONSE_MSG_HEADER_SIZE + BASE_STATUS_SIZE
    + 2 * CYLINDER_PROCESS_DATA_SIZE, AUTOMATION_UNITS_STATUS_OFFSET);
  const automationData = responseData.slice(STATUS_RESPONSE_MSG_HEADER_OFFSET
    + STATUS_RESPONSE_MSG_HEADER_SIZE + BASE_STATUS_SIZE + 2 * CYLINDER_PROCESS_DATA_SIZE,
  STATUS_RESPONSE_MSG_HEADER_OFFSET + STATUS_RESPONSE_MSG_HEADER_SIZE
     + BASE_STATUS_SIZE + 2 * CYLINDER_PROCESS_DATA_SIZE + AUTOMATION_DATA_SIZE);
  statusMsgHeader.writeUInt16LE(STATUS_RESPONSE_MSG_HEADER_SIZE + BASE_STATUS_SIZE
    + 2 * CYLINDER_PROCESS_DATA_SIZE + AUTOMATION_DATA_SIZE, ALARM_MSG_OFFSET);
  const alarmMessage = responseData.slice(STATUS_RESPONSE_MSG_HEADER_OFFSET
    + STATUS_RESPONSE_MSG_HEADER_SIZE + BASE_STATUS_SIZE + 2 * CYLINDER_PROCESS_DATA_SIZE
    + AUTOMATION_DATA_SIZE,
  STATUS_RESPONSE_MSG_HEADER_OFFSET + STATUS_RESPONSE_MSG_HEADER_SIZE
     + BASE_STATUS_SIZE + 2 * CYLINDER_PROCESS_DATA_SIZE + AUTOMATION_DATA_SIZE
      + ALARM_MSG_MAX_LENGTH);

  testMachine.variables.forEach((variable) => {
    if (!_.get(variable, 'machineConnected', false)
      && (_.get(variable, 'access', 'read') === 'read')) {
      switch (variable.blockLocation) {
        case 'Basic Status':
          writeVariableValueToBuffer(variable, baseStatus);
          break;
        case 'Process Data 1st Cylinder':
          writeVariableValueToBuffer(variable, cylinder1ProcessData);
          break;
        case 'Process Data 2nd Cylinder':
          writeVariableValueToBuffer(variable, cylinder2ProcessData);
          break;
        case 'Automation Components':
          writeVariableValueToBuffer(variable, automationData);
          break;
        case 'Alarm String':
          statusMsgHeader.writeUInt16LE(variable.value.length, ALARM_LENGTH_OFFSET);
          writeVariableValueToBuffer(variable, alarmMessage);
          break;
        default:
      }
    }
  });

  responseBuffer[responseBuffer.length - 3] = DLE;
  responseBuffer[responseBuffer.length - 2] = ETX;
  responseBuffer[responseBuffer.length - 1] = calculateBcc(responseBuffer,
    responseBuffer.length - 1);
}

buildResponse();

describe('Spark HPL Arburg', () => {
  it('successfully create a new Arburg hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplArburg = new SparkHplArburg.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplArburg.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplArburg.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('before a successfull start the connection status should be false', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(false);
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    db.on('data', (data) => {
      testMachine.variables.forEach((variable) => {
        if (_.get(variable, 'machineConnected', false)
         && (variable.name === data.variable)) {
          data[variable.name].should.equal(true);
          db.removeAllListeners('data');
          return done();
        }
        return undefined;
      });
    });
    sparkHplArburg.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      sparkHplArburg.transport.serialPort.on('dataToDevice', writeToSerialPort);
      return undefined;
    });
  });

  it('spark hpl Arburg should produce data', (done) => {
    const readVariables = [];
    let gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && (_.get(variable, 'access', 'read') === 'read')) {
        readVariables.push(variable);
      }
    });
    let iMsg = 1;
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === readVariables.length) {
              // wait for 16 message to exercie "byte stuffing" code when msg contains DLE
              if (iMsg === DLE) {
                db.removeAllListeners('data');
                return done();
              }

              gotDataForVar = [];
              iMsg += 1;
            }
          }
        }
        return undefined;
      });
    });
  }).timeout(4000);

  it('after a successful connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplArburg.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed with machine enabled', (done) => {
    sparkHplArburg.updateModel({
      enable: true,
      device: '/dev/ttyS1',
      baudRate: '4800',
      requestFrequency: 1,
      unicodeEncoding: 'utf16le',
    }, (err) => {
      if (err) return done(err);
      sparkHplArburg.transport.serialPort.on('dataToDevice', writeToSerialPort);
      return done();
    });
  });

  it('closing the serial transport should generate a disconnection alert', (done) => {
    sparkHplArburg.transport.closeTransport(() => {
      sparkAlert.on('raise', (alert) => {
        alert.should.be.instanceof(Object);
        alert.should.have.all.keys('key', 'msg', 'description');
        alert.key.should.equal('disconnected-error');
        alert.msg.should.equal('Arburg: Disconnected - Trying to Reconnect');
        alert.description.should.equal('The serial connection to the machine has been lost - trying to reconnect.');
        sparkAlert.removeAllListeners('raise');
        return done();
      });
    });
  });

  it('the disconnection alert should be cleared after the serial transport is reopened', (done) => {
    sparkAlert.on('clear', (key) => {
      key.should.equal('disconnected-error');
      sparkAlert.removeAllListeners('clear');
      return done();
    });
  }).timeout(5000);
});
