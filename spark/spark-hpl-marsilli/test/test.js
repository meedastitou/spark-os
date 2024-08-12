/* jshint esversion: 6 */
require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const net = require('net');
const pkg = require('../package.json');
const SparkHplMarsilli = require('../index.js');

const PORT = 55001;
const UNIT_1_ERR_OFFSET = 110;

const TEST_ERR_MSG_1 = 'Test Error Message 1';
const TEST_ERR_MSG_2 = 'Test Error Message 2';

let sparkHplMarsilli;

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
    hpl: 'marsilli',
  },
  settings: {
    model: {
      enable: true,
      port: PORT,
      requestFrequency: 2,
    },
  },
  variables: [{
    name: 'stringTest',
    description: 'String Test',
    format: 'char',
    type: 'Raw Data',
    byteOffset: 11,
    length: 11,
    value: '1-234567890',
  }, {
    name: 'uint8Test',
    description: 'UInt8 Test',
    format: 'uint8',
    type: 'Raw Data',
    byteOffset: 369,
    value: 123,
  }, {
    name: 'uint16Test',
    description: 'UInt16 Test',
    format: 'uint16',
    type: 'Raw Data',
    byteOffset: 108,
    value: 1234,
  }, {
    name: 'uint32Test',
    description: 'UInt32 Test',
    format: 'uint32',
    type: 'Raw Data',
    byteOffset: 30,
    value: 123456,
  }, {
    name: 'uint64Test',
    description: 'UInt64 Test',
    format: 'uint64',
    type: 'Raw Data',
    byteOffset: 80,
    value: 1234567,
  }, {
    name: 'int8Test',
    description: 'Int8 Test',
    format: 'int8',
    type: 'Raw Data',
    byteOffset: 1,
    value: 34,
  }, {
    name: 'int16Test',
    description: 'Int16 Test',
    format: 'int16',
    type: 'Raw Data',
    byteOffset: 408,
    value: 2345,
  }, {
    name: 'int32Test',
    description: 'Int32 Test',
    format: 'int32',
    type: 'Raw Data',
    byteOffset: 104,
    value: 234567,
  }, {
    name: 'int64Test',
    description: 'Int64 Test',
    format: 'int64',
    type: 'Raw Data',
    byteOffset: 90,
    value: 34567,
  }, {
    name: 'bitTest',
    description: 'Bit Test',
    format: 'bool',
    type: 'Raw Data',
    byteOffset: 0,
    value: true,
  }, {
    name: 'floatTest',
    description: 'Float Test',
    format: 'float',
    type: 'Raw Data',
    byteOffset: 370,
    value: 1234567.0,
  }, {
    name: 'doubleTest',
    description: 'Double Test',
    format: 'double',
    type: 'Raw Data',
    byteOffset: 380,
    value: 2345678.0,
  }, {
    name: 'alarmCode',
    description: 'Alarm Code Test',
    format: 'in16',
    type: 'Alarm Code',
    unitNumber: 1,
  }, {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
  }],
};

const invalidVariableMachine1 = {
  info: {
    name: 'invalid-machine-1',
    fullname: 'Invalid machine 1',
    version: '1.0.0',
    description: 'Invalid Machine 1',
    hpl: 'marsilli',
  },
  settings: {
    model: {
      enable: true,
      port: 55001,
    },
  },
  variables: [{
    name: 'noByteOffset',
    description: 'No Byte Offset Test',
    format: 'uint16',
    type: 'Raw Data',
    value: 123,
  }],
};

const invalidVariableMachine2 = {
  info: {
    name: 'invalid-machine-2',
    fullname: 'Invalid machine 2',
    version: '1.0.0',
    description: 'Invalid Machine 2',
    hpl: 'marsilli',
  },
  settings: {
    model: {
      enable: true,
      port: 55001,
    },
  },
  variables: [{
    name: 'noUnitNumber',
    description: 'No Unit Number Test',
    format: 'uint16',
    type: 'Alarm Code',
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

// const conf = {
//   content: [],
//   set(key, value, done) {
//     this.content[key] = value;
//     done(null);
//   },
//   get(key, done) {
//     done(null, this.content[key]);
//   },
// };
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

// build the machine data buffer from variable values
const machineDataBuffer = Buffer.alloc(4600);
testMachine.variables.forEach((variable) => {
  if (!_.get(variable, 'machineConnected', false) && (variable.type === 'Raw Data')) {
    switch (variable.format) {
      case 'char':
        machineDataBuffer.write(variable.value, variable.byteOffset, variable.length);
        break;
      case 'bool':
        machineDataBuffer.writeUInt8(variable.value ? 1 : 0, variable.byteOffset);
        break;
      case 'uint8':
        machineDataBuffer.writeUInt8(variable.value, variable.byteOffset);
        break;
      case 'uint16':
        machineDataBuffer.writeUInt16LE(variable.value, variable.byteOffset);
        break;
      case 'uint32':
        machineDataBuffer.writeUInt32LE(variable.value, variable.byteOffset);
        break;
      case 'uint64':
        machineDataBuffer.writeUInt32LE(variable.value % 0x100000000, variable.byteOffset);
        machineDataBuffer.writeUInt32LE(variable.value / 0x100000000, variable.byteOffset + 4);
        break;
      case 'int8':
        machineDataBuffer.writeInt8(variable.value, variable.byteOffset);
        break;
      case 'int16':
        machineDataBuffer.writeInt16LE(variable.value, variable.byteOffset);
        break;
      case 'int32':
        machineDataBuffer.writeInt32LE(variable.value, variable.byteOffset);
        break;
      case 'int64':
        machineDataBuffer.writeInt32LE(variable.value % 0x100000000, variable.byteOffset);
        machineDataBuffer.writeInt32LE(variable.value / 0x100000000, variable.byteOffset + 4);
        break;
      case 'float':
        machineDataBuffer.writeFloatLE(variable.value, variable.byteOffset);
        break;
      case 'double':
        machineDataBuffer.writeDoubleLE(variable.value, variable.byteOffset);
        break;
      default:
    }
  }
});

let client;

describe('Spark HPL Marsilli', () => {
  it('successfully create a new Marsilli hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplMarsilli = new SparkHplMarsilli.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplMarsilli.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplMarsilli.start(dataCb, 5, (err) => {
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
    sparkHplMarsilli.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl Marsilli should produce data', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && (variable.type === 'Raw Data')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === readVariables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });

    client = net.createConnection(PORT, os.hostname(), () => {
    });
    client.write(machineDataBuffer);
  });

  it('after a successful connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('the first alarm should set alarm codes to 1', (done) => {
    db.on('data', (data) => {
      testMachine.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false) && (variable.type === 'Alarm Code')) {
          if (variable.name === data.variable) {
            data[variable.name].should.eql(1);
            db.removeAllListeners('data');
            return done();
          }
        }
        return undefined;
      });
    });

    machineDataBuffer.write(TEST_ERR_MSG_1, UNIT_1_ERR_OFFSET, TEST_ERR_MSG_1.length);
    client.write(machineDataBuffer);
  });

  it('the second alarm should set alarm codes to 2', (done) => {
    db.on('data', (data) => {
      testMachine.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false) && (variable.type === 'Alarm Code')) {
          if (variable.name === data.variable) {
            data[variable.name].should.eql(2);
            db.removeAllListeners('data');
            return done();
          }
        }
        return undefined;
      });
    });

    machineDataBuffer.write(TEST_ERR_MSG_2, UNIT_1_ERR_OFFSET, TEST_ERR_MSG_2.length);
    client.write(machineDataBuffer);
  });

  it('the first alarm should set alarm codes to 1', (done) => {
    db.on('data', (data) => {
      testMachine.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false) && (variable.type === 'Alarm Code')) {
          if (variable.name === data.variable) {
            data[variable.name].should.eql(1);
            db.removeAllListeners('data');
            return done();
          }
        }
        return undefined;
      });
    });

    machineDataBuffer.write(TEST_ERR_MSG_1, UNIT_1_ERR_OFFSET, TEST_ERR_MSG_1.length);
    client.write(machineDataBuffer);
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplMarsilli.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed with machine enabled', (done) => {
    sparkHplMarsilli.updateModel({
      enable: true,
      port: PORT,
      requestFrequency: 10,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('machine connected variables should be cleared on timeout', (done) => {
    db.on('data', (data) => {
      testMachine.variables.forEach((variable) => {
        if (_.get(variable, 'machineConnected', false)) {
          if (variable.name === data.variable) {
            data[variable.name].should.eql(false);
            db.removeAllListeners('data');
            return done();
          }
        }
        return undefined;
      });
    });
  }).timeout(12000);

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplMarsilli.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new Marsilli hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplMarsilli = new SparkHplMarsilli.hpl(log.child({
      machine: invalidVariableMachine1.info.name,
    }), invalidVariableMachine1, invalidVariableMachine1.settings.model,
    sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should generate an alert with missing variable byte offset', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'variableName');
      alert.key.should.equal('byte-offset-error');
      alert.msg.should.equal(`${invalidVariableMachine1.info.name}: Variable Error`);
      alert.description.should.equal('Variable noByteOffset is a raw data variable but does not have a byte offset');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkHplMarsilli.start(dataCb, configUpdateCb, (err) => {
      err.shold.equal('All raw data variables require a byte offset');
      return undefined;
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplMarsilli.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new Marsilli hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplMarsilli = new SparkHplMarsilli.hpl(log.child({
      machine: invalidVariableMachine2.info.name,
    }), invalidVariableMachine2, invalidVariableMachine2.settings.model,
    sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should generate an alert with missing variable unit number', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'variableName');
      alert.key.should.equal('unit-number-error');
      alert.msg.should.equal(`${invalidVariableMachine2.info.name}: Variable Error`);
      alert.description.should.equal('Variable noUnitNumber is an alarm code variable but does not have a unit number');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkHplMarsilli.start(dataCb, configUpdateCb, (err) => {
      err.shold.equal('All alarm code variables require a unit number');
      return undefined;
    });
  });
});
