/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplModbus = require('../index.js');

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
    hpl: 'modbus',
  },
  settings: {
    model: {
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: false,
      highWordFirst: false,
      swapCharacterPairs: false,
      interface: 'serial',
      mode: 'RTU',
      device: '/dev/ttyUSB0',
      baudRate: '115200',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    },
  },
  variables: [{
    name: 'hrStringTest',
    description: 'HR String Test',
    format: 'char',
    type: 'hr',
    address: '0100',
    length: 4,
    value: 'ABCD',
  }, {
    name: 'hrUInt16Test',
    description: 'HR UInt16 Test',
    format: 'uint16',
    type: 'hr',
    address: '0000',
    value: 1234,
  }, {
    name: 'hrInt16Test',
    description: 'HR Int16 Test',
    format: 'int16',
    type: 'hr',
    address: '0002',
    value: -2345,
  }, {
    name: 'hrInt32Test',
    description: 'HR Int32 Test',
    format: 'int32',
    type: 'hr',
    address: '0004',
    value: -23456,
  }, {
    name: 'hrFloatTest',
    description: 'HR Float Test',
    format: 'float',
    type: 'hr',
    address: '0008',
    value: 1234567.0,
  }, {
    name: 'hrOptTest1',
    description: 'HR Optimization Test 1',
    format: 'int32',
    type: 'hr',
    address: '0010',
    value: 2345,
  }, {
    name: 'hrOptTest2',
    description: 'HR Optimization Test 2',
    format: 'int32',
    type: 'hr',
    address: '0012',
    value: 3456,
  }, {
    name: 'hrDecEncodingTest',
    description: 'HR Decimal Encoding Test',
    format: 'int16',
    type: 'hr',
    address: '2000',
    decEncoding: true,
    value: 100,
  }, {
    name: 'diBoolTrueTest',
    description: 'DI Bool True Test',
    format: 'bool',
    type: 'di',
    address: '0000',
    value: true,
  }, {
    name: 'diBoolFalseTest',
    description: 'DI Bool False Test',
    format: 'bool',
    type: 'di',
    address: '0001',
    value: false,
  }, {
    name: 'coilBoolTrueTest',
    description: 'Coil Bool True Test',
    format: 'bool',
    type: 'coil',
    address: '0000',
    value: true,
  }, {
    name: 'coilBoolFalseTest',
    description: 'Coil Bool False Test',
    format: 'bool',
    type: 'coil',
    address: '0001',
    value: false,
  }, {
    name: 'irStringTest',
    description: 'IR String Test',
    format: 'char',
    type: 'ir',
    address: '0100',
    length: 4,
    value: 'ABCD',
  }, {
    name: 'irUInt16Test',
    description: 'IR UInt16 Test',
    format: 'uint16',
    type: 'ir',
    address: '0000',
    value: 1234,
  }, {
    name: 'irInt16Test',
    description: 'IR Int16 Test',
    format: 'int16',
    type: 'ir',
    address: '0002',
    value: -2345,
  }, {
    name: 'irInt32Test',
    description: 'IR Int32 Test',
    format: 'int32',
    type: 'ir',
    address: '0004',
    value: -23456,
  }, {
    name: 'irFloatTest',
    description: 'IR Float Test',
    format: 'float',
    type: 'ir',
    address: '0008',
    value: 1234567.0,
  }, {
    name: 'irOptTest1',
    description: 'IR Optimization Test 1',
    format: 'int32',
    type: 'ir',
    address: '0010',
    value: 2345,
  }, {
    name: 'irOptTest2',
    description: 'IR Optimization Test 2',
    format: 'int32',
    type: 'ir',
    address: '0012',
    value: 3456,
  }, {
    name: 'hrStringWriteEvenTest',
    description: 'HR String Write Even Test',
    format: 'char',
    type: 'hr',
    address: '0100',
    access: 'write',
    length: 4,
    value: 'ABCD',
  }, {
    name: 'hrStringWriteOddTest',
    description: 'HR String Write Odd Test',
    format: 'char',
    type: 'hr',
    address: '0104',
    access: 'write',
    length: 3,
    value: 'EFG',
  }, {
    name: 'hrUInt16WriteTest',
    description: 'HR UInt16 Write Test',
    format: 'uint16',
    type: 'hr',
    address: '0000',
    access: 'write',
    value: 1234,
  }, {
    name: 'hrInt16WriteTest',
    description: 'HR Int16 Write Test',
    format: 'int16',
    type: 'hr',
    address: '0002',
    access: 'write',
    value: -2345,
  }, {
    name: 'hrInt32WriteTest',
    description: 'HR Int32 Write Test',
    format: 'int32',
    type: 'hr',
    address: '0004',
    access: 'write',
    value: -23456,
  }, {
    name: 'hrFloatWriteTest',
    description: 'HR Float Write Test',
    format: 'float',
    type: 'hr',
    address: '0008',
    access: 'write',
    value: 1234567.0,
  }, {
    name: 'diBoolWriteTrueTest',
    description: 'DI Bool Write True Test',
    format: 'bool',
    type: 'di',
    address: '0000',
    access: 'write',
    value: true,
  }, {
    name: 'diBoolWriteFalseTest',
    description: 'DI Bool Write False Test',
    format: 'bool',
    type: 'di',
    address: '0001',
    access: 'write',
    value: false,
  }, {
    name: 'coilBoolWriteTrueTest',
    description: 'Coil Bool Write True Test',
    format: 'bool',
    type: 'coil',
    address: '0000',
    access: 'write',
    value: true,
  }, {
    name: 'coilBoolWriteFalseTest',
    description: 'Coil Bool Write False Test',
    format: 'bool',
    type: 'coil',
    address: '0001',
    access: 'write',
    value: false,
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
      log.debug({ key }, 'Cleared alert');
    },
  };
};

const sparkConfig = new EventEmitter();
sparkConfig.set = function set(key, value, done) {
  if (done) return done(null);
  return undefined;
};

describe('Spark HPL Modbus', () => {
  let sparkHplModbus;

  it('successfully create a new Modbus HPL', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplModbus = new SparkHplModbus.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    sparkHplModbus.tester.prototype.setVariables(testMachine.variables);
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplModbus.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplModbus.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplModbus.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark HPL modbus should produce data low byte first, low word first', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && (_.get(variable, 'access', 'read') === 'read')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (_.get(variable, 'access', 'read') === 'read') {
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
        }
        return undefined;
      });
    });
  });

  it('spark HPL modbus should produce data low byte first, high word first', (done) => {
    sparkHplModbus.tester.prototype.setEndedness(false, true);
    sparkHplModbus.updateModel({
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: false,
      highWordFirst: true,
      swapCharacterPairs: false,
      interface: 'serial',
      mode: 'RTU',
      device: '/dev/ttyUSB0',
      baudRate: '115200',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && (_.get(variable, 'access', 'read') === 'read')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (_.get(variable, 'access', 'read') === 'read') {
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
        }
        return undefined;
      });
    });
  });

  it('spark HPL modbus should produce data high byte first, low word first', (done) => {
    sparkHplModbus.tester.prototype.setEndedness(true, false);
    sparkHplModbus.updateModel({
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: true,
      highWordFirst: false,
      swapCharacterPairs: true,
      interface: 'serial',
      mode: 'RTU',
      device: '/dev/ttyUSB0',
      baudRate: '115200',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && (_.get(variable, 'access', 'read') === 'read')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (_.get(variable, 'access', 'read') === 'read') {
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
        }
        return undefined;
      });
    });
  });

  it('spark HPL modbus should produce data high byte first, high word first', (done) => {
    sparkHplModbus.tester.prototype.setEndedness(true, true);
    sparkHplModbus.updateModel({
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: true,
      highWordFirst: true,
      swapCharacterPairs: true,
      interface: 'serial',
      mode: 'RTU',
      device: '/dev/ttyUSB0',
      baudRate: '115200',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && (_.get(variable, 'access', 'read') === 'read')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (_.get(variable, 'access', 'read') === 'read') {
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
        }
        return undefined;
      });
    });
  });

  it('update model should succeed selecting low byte first, low word first, combined data mode', (done) => {
    sparkHplModbus.tester.prototype.setEndedness(false, false);
    sparkHplModbus.updateModel({
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: false,
      highWordFirst: false,
      swapCharacterPairs: false,
      interface: 'serial',
      mode: 'RTU',
      device: '/dev/ttyUSB0',
      baudRate: '115200',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      deliverEntireResponse: true,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  it('spark HPL modbus should produce data in combined data mode', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && (_.get(variable, 'access', 'read') === 'read')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      if (data.variable === 'CombinedResult') {
        const combinedResultArray = data[data.variable];
        for (let iCombVar = 0; iCombVar < combinedResultArray.length; iCombVar += 1) {
          readVariables.forEach((variable) => {
            if (_.get(variable, 'access', 'read') === 'read') {
              if (variable.name === combinedResultArray[iCombVar].name) {
                if (gotDataForVar.indexOf(variable.name) === -1) {
                  combinedResultArray[iCombVar].value.should.eql(variable.value);
                  gotDataForVar.push(data.variable);
                  if (gotDataForVar.length === readVariables.length) {
                    db.removeAllListeners('data');
                    return done();
                  }
                }
              }
            }
            return undefined;
          });
        }
      }
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed low byte first, low word first `, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplModbus.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });

  it('update model should succeed selecting low byte first, high word first mode', (done) => {
    sparkHplModbus.tester.prototype.setEndedness(false, true);
    sparkHplModbus.updateModel({
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: false,
      highWordFirst: true,
      swapCharacterPairs: false,
      interface: 'serial',
      mode: 'RTU',
      device: '/dev/ttyUSB0',
      baudRate: '115200',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed low byte first, high word first `, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplModbus.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });

  it('update model should succeed selecting high byte first, low word first mode', (done) => {
    sparkHplModbus.tester.prototype.setEndedness(true, false);
    sparkHplModbus.updateModel({
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: true,
      highWordFirst: false,
      swapCharacterPairs: true,
      interface: 'serial',
      mode: 'RTU',
      device: '/dev/ttyUSB0',
      baudRate: '115200',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed high byte first, low word first `, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplModbus.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });

  it('update model should succeed selecting high byte first, high word first mode', (done) => {
    sparkHplModbus.tester.prototype.setEndedness(true, true);
    sparkHplModbus.updateModel({
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: true,
      highWordFirst: true,
      swapCharacterPairs: true,
      interface: 'serial',
      mode: 'RTU',
      device: '/dev/ttyUSB0',
      baudRate: '115200',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed high byte first, high word first `, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplModbus.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplModbus.updateModel({
      enable: false,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: true,
      highWordFirst: true,
      swapCharacterPairs: true,
      interface: 'serial',
      mode: 'RTU',
      device: '/dev/ttyUSB0',
      baudRate: '115200',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  it('update model should succeed selecting ethernet mode', (done) => {
    sparkHplModbus.updateModel({
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: true,
      highWordFirst: true,
      swapCharacterPairs: true,
      interface: 'ethernet',
      mode: 'RTU',
      device: '/dev/ttyUSB0',
      baudRate: '115200',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  it('an alert should be raised and connection variable set after an error caused', (done) => {
    let alertRaised = false;
    let connectedVariableSet = false;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`${testMachine.info.name}-connectivity-alert`);
      alert.msg.should.equal(`${testMachine.info.name}: Unable to open connection`);
      alert.description.should.equal('Not able to open connection.  Please verify the connection configuration and try again.');
      alertRaised = true;
      sparkAlert.removeAllListeners('raise');
      if (connectedVariableSet) return done();
      return undefined;
    });

    db.on('data', (data) => {
      if (data.variable === 'machineConnected') {
        data[data.variable].should.equal(false);
        connectedVariableSet = true;
        db.removeAllListeners('data');
        if (alertRaised) return done();
      }
      return undefined;
    });

    sparkHplModbus.tester.prototype.setCauseError(Error('Port Not Open'));
  });

  it('connection variable should cleared after reconnection', (done) => {
    sparkHplModbus.tester.prototype.setCauseError(null);
    db.on('data', (data) => {
      if (data.variable === 'machineConnected') {
        data[data.variable].should.equal(true);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
  }).timeout(8000);

  it('stop model should succeed', (done) => {
    sparkHplModbus.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplModbus.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should raise an alert if serial mode invalid', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`${testMachine.info.name}-connectivity-alert`);
      alert.msg.should.equal(`${testMachine.info.name}: Unable to open serial port`);
      alert.description.should.equal('Not able to open serial port.  Please verify the serial connection configuration and try again.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplModbus.updateModel({
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: true,
      highWordFirst: true,
      swapCharacterPairs: true,
      interface: 'serial',
      mode: 'invalid',
      device: '/dev/ttyUSB0',
      baudRate: '115200',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('update model should raise an alert if serial device invalid', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`${testMachine.info.name}-connectivity-alert`);
      alert.msg.should.equal(`${testMachine.info.name}: Unable to open serial port`);
      alert.description.should.equal('Not able to open serial port.  Please verify the serial connection configuration and try again.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplModbus.updateModel({
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: true,
      highWordFirst: true,
      swapCharacterPairs: true,
      interface: 'serial',
      mode: 'RTU',
      device: '',
      baudRate: '115200',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('update model should raise an alert if serial parity invalid', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`${testMachine.info.name}-connectivity-alert`);
      alert.msg.should.equal(`${testMachine.info.name}: Unable to open serial port`);
      alert.description.should.equal('Not able to open serial port.  Please verify the serial connection configuration and try again.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplModbus.updateModel({
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: true,
      highWordFirst: true,
      swapCharacterPairs: true,
      interface: 'serial',
      mode: 'RTU',
      device: '/dev/ttyUSB0',
      baudRate: '115200',
      parity: 'invalid',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('update model should raise an alert if serial baud rate invalid', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`${testMachine.info.name}-connectivity-alert`);
      alert.msg.should.equal(`${testMachine.info.name}: Unable to open serial port`);
      alert.description.should.equal('Not able to open serial port.  Please verify the serial connection configuration and try again.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplModbus.updateModel({
      enable: true,
      requestFrequency: 0.01,
      slaveId: 1,
      highByteFirst: true,
      highWordFirst: true,
      swapCharacterPairs: true,
      interface: 'serial',
      mode: 'RTU',
      device: '/dev/ttyUSB0',
      baudRate: 'invalid',
      parity: 'none',
      ipAddress: '',
      timeoutInterval: 2000,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });
});
