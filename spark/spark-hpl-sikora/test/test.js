/* jshint esversion: 6 */
/* eslint no-bitwise: ["error", { "allow": ["^=", "~"] }] */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplSikora = require('../index.js');

const MAX_RESP_BUF_SIZE = 100;
const ESC = 0x1B;
const CR = 0x0D;
const LF = 0x0A;
const REQUEST_TYPE_POS = 1;
const REQUEST_VALUES_TYPE = 0x31;

let sparkHplSikora;

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
    hpl: 'sikora',
  },
  settings: {
    model: {
      enable: true,
      requestFrequency: 0.01,
    },
  },
  // Note: All variables MUST have unique request keys!
  variables: [{
    name: 'int16ValueTest',
    description: 'Int16 Value Test',
    format: 'int16',
    requestType: 'value',
    charOffset: 0,
    charLength: 5,
    value: 2345,
  }, {
    name: 'floatValueTest',
    description: 'Float Value Test',
    format: 'float',
    requestType: 'value',
    charOffset: 5,
    charLength: 6,
    value: 34567.0,
  }, {
    name: 'stringValueTest',
    description: 'String Value Test',
    format: 'char',
    requestType: 'value',
    charOffset: 11,
    charLength: 3,
    value: 'ABC',
  }, {
    name: 'bitValueTest',
    description: 'Bit Value Test',
    format: 'bool',
    requestType: 'value',
    charOffset: 14,
    charLength: 5,
    value: true,
  }, {
    name: 'int32SettingTest',
    description: 'Int16 Setting Test',
    format: 'int32',
    requestType: 'setting',
    charOffset: 0,
    charLength: 6,
    value: 234567,
  }, {
    name: 'doubleSettingTest',
    description: 'Double Setting Test',
    format: 'double',
    requestType: 'setting',
    charOffset: 6,
    charLength: 8,
    value: 456789.0,
  }, {
    name: 'stringSettingTest',
    description: 'String Setting Test',
    format: 'char',
    requestType: 'setting',
    charOffset: 14,
    charLength: 4,
    value: 'DEFG',
  }, {
    name: 'bitSettingTest',
    description: 'Bit Setting Test',
    format: 'bool',
    requestType: 'setting',
    charOffset: 18,
    charLength: 5,
    value: false,
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
      log.debug({ key }, 'Cleared alert');
    },
  };
};

function calculateChecksum(respBuffer, iBufEnd) {
  let checksumTotal = 0;
  for (let iBuf = 1; iBuf < iBufEnd; iBuf += 1) {
    checksumTotal ^= respBuffer[iBuf];
  }
  if (checksumTotal < 0x20) checksumTotal += 0x20;
  return checksumTotal;
}

let valueResponseBuffer = Buffer.alloc(MAX_RESP_BUF_SIZE, ' ');
let settingResponseBuffer = Buffer.alloc(MAX_RESP_BUF_SIZE, ' ');
let invalidResponseBuffer;
function buildResponses() {
  let iMaxValue = 1;
  let iMaxSetting = 1;
  valueResponseBuffer[0] = ESC;
  settingResponseBuffer[0] = ESC;
  testMachine.variables.forEach((variable) => {
    let valueString = '';
    switch (variable.format) {
      case 'char':
        valueString = variable.value;
        break;
      case 'bool':
        valueString = variable.value ? 'true' : 'false';
        break;
      default:
        valueString = variable.value.toString();
    }
    const iStartPos = variable.charOffset + 1 + variable.charLength - valueString.length;
    const iEndPos = iStartPos + valueString.length;
    if (variable.requestType === 'value') {
      valueResponseBuffer.write(valueString, iStartPos, valueString.length);
      if (iEndPos > iMaxValue) iMaxValue = iEndPos;
    } else {
      settingResponseBuffer.write(valueString, iStartPos, valueString.length);
      if (iEndPos > iMaxSetting) iMaxSetting = iEndPos;
    }
  });
  valueResponseBuffer[iMaxValue] = CR;
  valueResponseBuffer[iMaxValue + 1] = LF;
  valueResponseBuffer[iMaxValue + 2] = calculateChecksum(valueResponseBuffer, iMaxValue + 2);
  valueResponseBuffer = valueResponseBuffer.slice(0, iMaxValue + 3);

  settingResponseBuffer[iMaxSetting] = CR;
  settingResponseBuffer[iMaxSetting + 1] = LF;
  settingResponseBuffer[iMaxSetting + 2] = calculateChecksum(settingResponseBuffer,
    iMaxSetting + 2);
  settingResponseBuffer = settingResponseBuffer.slice(0, iMaxSetting + 3);

  invalidResponseBuffer = Buffer.from(valueResponseBuffer);
  invalidResponseBuffer.write('xxx', 1, 3);
  invalidResponseBuffer[iMaxValue + 2] = calculateChecksum(invalidResponseBuffer, iMaxValue + 2);
}

buildResponses();

function writeToSerialPort(data) {
  if (data[REQUEST_TYPE_POS] === REQUEST_VALUES_TYPE) {
    sparkHplSikora.serialPort.writeToComputer(valueResponseBuffer);
  } else {
    sparkHplSikora.serialPort.writeToComputer(settingResponseBuffer);
  }
}

describe('Spark HPL Sikora', () => {
  it('successfully create a new Sikora hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSikora = new SparkHplSikora.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, null, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplSikora.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplSikora.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplSikora.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl Sikora should produce data', (done) => {
    sparkHplSikora.serialPort.on('dataToDevice', writeToSerialPort);
    const gotDataForVar = [];
    db.on('data', (data) => {
      testMachine.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachine.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('the database should not be written to if the checksum is incorrect', (done) => {
    const checksum = valueResponseBuffer[valueResponseBuffer.length - 1];
    valueResponseBuffer[valueResponseBuffer.length - 1] = ~checksum;
    let databaseWrite = false;
    db.on('data', () => {
      databaseWrite = true;
      db.removeAllListeners('data');
    });

    setTimeout(() => {
      databaseWrite.should.equal(false);
      valueResponseBuffer[valueResponseBuffer.length - 1] = checksum;
      return done();
    }, 100);
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplSikora.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('an alert should be raised if the request is ignored', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('request-ignored');
      alert.msg.should.equal('Sikora: New Request Ignored');
      alert.description.should.equal('New request ignored as still processing last request. Check the serial port configuration and connection.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkHplSikora.updateModel({
      enable: true,
      requestFrequency: 0.01,
    }, (err) => {
      if (err) done(err);
    });
  });

  it('stop should succeed', (done) => {
    sparkHplSikora.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplSikora.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('an alert should be raised if a numeric variable has a non-numeric value', (done) => {
    invalidResponseBuffer.copy(valueResponseBuffer);
    sparkHplSikora.serialPort.on('dataToDevice', writeToSerialPort);
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      const variableName = testMachine.variables[0].name;
      alert.key.should.equal(`read-fail-${variableName}`);
      alert.msg.should.equal('Sikora: Read Failed for Variable');
      alert.description.should.equal(`Read failed for variable '${variableName}'. Check that this variable is defined correctly in the machine.`);
      sparkAlert.removeAllListeners('raise');
      return done();
    });
  });
});
