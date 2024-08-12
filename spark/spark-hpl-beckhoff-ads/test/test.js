/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplBeckhoffADS = require('../index.js');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const ipAddress = '10.20.30.40';
const amsAddress = '10.20.30.40.1.1';
const localAmsAddress = '10.20.30.41.1.1';
const amsPort = 801;
const autoAmsLocalAddress = '127.0.0.1.1.1';

const testMachine = {
  info: {
    name: 'test-machine',
    fullname: 'Test machine',
    version: '1.0.0',
    description: 'Test Machine',
    hpl: 'beckhoff-ads',
  },
  settings: {
    model: {
      enable: true,
      ipAddress,
      localAmsAddress,
      amsAddress,
      amsPort,
      requestFrequency: 0.1,
    },
  },
  variables: [{
    name: 'stringTest',
    description: 'String Test',
    format: 'char',
    adsAddressName: '.STRINGTEST',
    length: 10,
    value: '1-23456789',
  }, {
    name: 'uint8Test',
    description: 'UInt8 Test',
    format: 'uint8',
    adsAddressName: '.UINT8TEST',
    value: 123,
  }, {
    name: 'uint8ArrayTest',
    description: 'UInt8 Array Test',
    format: 'uint8',
    adsAddressName: '.UINT8ARRAYTEST',
    array: true,
    length: 3,
    value: [12, 23, 34],
  }, {
    name: 'uint16Test',
    description: 'UInt16 Test',
    format: 'uint16',
    adsAddressName: '.UINT16TEST',
    value: 1234,
  }, {
    name: 'uint16ArrayTest',
    description: 'UInt16 Array Test',
    format: 'uint16',
    adsAddressName: '.UINT16ARRAYTEST',
    array: true,
    length: 3,
    value: [1234, 2345, 3456],
  }, {
    name: 'uint32Test',
    description: 'UInt32 Test',
    format: 'uint32',
    adsAddressName: '.UINT32TEST',
    value: 12345,
  }, {
    name: 'uint32ArrayTest',
    description: 'UInt32 Array Test',
    format: 'uint32',
    adsAddressName: '.UINT32ARRAYTEST',
    array: true,
    length: 3,
    value: [12345, 23456, 34567],
  }, {
    name: 'int8Test',
    description: 'Int8 Test',
    format: 'int8',
    adsAddressName: '.INT8TEST',
    value: 127,
  }, {
    name: 'int8ArrayTest',
    description: 'Int8 Array Test',
    format: 'int8',
    adsAddressName: '.INT8ARRAYTEST',
    array: true,
    length: 3,
    value: [23, 34, 45],
  }, {
    name: 'int16Test',
    description: 'Int16 Test',
    format: 'int16',
    adsAddressName: '.INT16TEST',
    value: 2345,
  }, {
    name: 'int16ArrayTest',
    description: 'Int16 Array Test',
    format: 'int16',
    adsAddressName: '.INT16ARRAYTEST',
    array: true,
    length: 3,
    value: [2345, 3456, 4567],
  }, {
    name: 'int32Test',
    description: 'Int32 Test',
    format: 'int32',
    adsAddressName: '.INT32TEST',
    value: 23456,
  }, {
    name: 'int32ArrayTest',
    description: 'Int32 Array Test',
    format: 'int32',
    adsAddressName: '.INT32ARRAYTEST',
    array: true,
    length: 3,
    value: [23456, 34567, 45678],
  }, {
    name: 'boolTest',
    description: 'Bool Test',
    format: 'bool',
    adsAddressName: '.BOOLTEST',
    value: true,
  }, {
    name: 'boolArrayTest',
    description: 'Bool Array Test',
    format: 'bool',
    adsAddressName: '.BOOLARRAYTEST',
    array: true,
    length: 3,
    value: [true, false, true],
  }, {
    name: 'floatTest',
    description: 'Float Test',
    format: 'float',
    adsAddressName: '.FLOATTEST',
    value: 1234567.0,
  }, {
    name: 'floatArrayTest',
    description: 'Float Array Test',
    format: 'float',
    adsAddressName: '.FLOATARRAYTEST',
    array: true,
    length: 2,
    value: [234567.0, 345678.0],
  }, {
    name: 'doubleTest',
    description: 'Double Test',
    format: 'double',
    adsAddressName: '.DOUBLETEST',
    value: 12345678.0,
  }, {
    name: 'doubleArrayTest',
    description: 'Double Array Test',
    format: 'double',
    adsAddressName: '.DOUBLEARRAYTEST',
    array: true,
    length: 2,
    value: [2345678.0, 3456789.0],
  }, {
    name: 'stringWriteTest',
    description: 'String Write Test',
    format: 'char',
    adsAddressName: '.STRINGWRITETEST',
    access: 'write',
    length: 10,
    value: '2-34567890',
  }, {
    name: 'uint8WriteTest',
    description: 'UInt8 Write Test',
    format: 'uint8',
    adsAddressName: '.UINT8WRITETEST',
    access: 'write',
    value: 234,
  }, {
    name: 'uint16WriteTest',
    description: 'UInt16 Write Test',
    format: 'uint16',
    adsAddressName: '.UINT16WRITETEST',
    access: 'write',
    value: 23456,
  }, {
    name: 'uint32WriteTest',
    description: 'UInt32 Write Test',
    format: 'uint32',
    adsAddressName: '.UINT32WRITETEST',
    access: 'write',
    value: 234567,
  }, {
    name: 'int8WriteTest',
    description: 'Int8 Write Test',
    format: 'int8',
    adsAddressName: '.INT8WRITETEST',
    access: 'write',
    value: 123,
  }, {
    name: 'int16WriteTest',
    description: 'Int16 Write Test',
    format: 'int16',
    adsAddressName: '.INT16WRITETEST',
    access: 'write',
    value: 12345,
  }, {
    name: 'int32WriteTest',
    description: 'Int32 Write Test',
    format: 'int32',
    adsAddressName: '.INT32WRITETEST',
    access: 'write',
    value: 123456,
  }, {
    name: 'floatWriteTest',
    description: 'Float Write Test',
    format: 'float',
    adsAddressName: '.FLOATWRITETEST',
    access: 'write',
    value: 234567.0,
  }, {
    name: 'doubleWriteTest',
    description: 'Double Write Test',
    format: 'double',
    adsAddressName: '.DOUBLEWRITETEST',
    access: 'write',
    value: 2345678.0,
  }, {
    name: 'boolWriteTest',
    description: 'Bool Write Test',
    format: 'bool',
    adsAddressName: '.BOOLWRITETEST',
    access: 'write',
    value: true,
  }, {
    name: 'destVarWriteTest',
    description: 'Destination Variable Write Test',
    format: 'uint8',
    adsAddressName: '.DESTVARWRITETEST',
    access: 'write',
    destVariables: [{ name: 'destVarTest' }],
    array: true,
    arrayIndex: 0,
    value: 56,
  }, {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
  }],
};

const autoAmsMachine = {
  info: {
    name: 'auto_ams-machine',
    fullname: 'Auto AMS machine',
    version: '1.0.0',
    description: 'Auto AMS Machine',
    hpl: 'beckhoff-ads',
  },
  settings: {
    model: {
      enable: true,
      ipAddress,
      localAmsAddress,
      amsAddress,
      amsPort,
      autoLocalAmsAddress: true,
      requestFrequency: 0.1,
    },
  },
  variables: [],
};

const invalidVariableMachine = {
  info: {
    name: 'invalid-variable-machine',
    fullname: 'Invalid variable machine',
    version: '1.0.0',
    description: 'Invalid Variable Machine',
    hpl: 'beckhoff-ads',
  },
  settings: {
    model: {
      enable: true,
      ipAddress,
      localAmsAddress,
      amsAddress,
      amsPort,
      requestFrequency: 0.1,
    },
  },
  variables: [{
    name: 'int8Test',
    description: 'Int8 Test',
    format: 'int8',
    adsAddressName: '.INT8TEST',
    value: 127,
  }, {
    name: 'invalid',
    description: 'Invalid',
    format: 'int64',
    access: 'write',
    adsAddressName: '.INVALIDTEST',
    value: 0,
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


function conf() {
  const confData = {};
  this.set = function set(key, value) {
    confData[key] = value;
  };
  this.get = function get(key) {
    return confData[key];
  };
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

describe('Spark HPL Beckhoff ADS', () => {
  let sparkHplBeckhoffADS;

  it('successfully create a new net Beckhoff ADS', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplBeckhoffADS = new SparkHplBeckhoffADS.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, new conf(), null,
    sparkAlert.getAlerter());
    sparkHplBeckhoffADS.tester.setVariables(testMachine.variables);
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplBeckhoffADS.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplBeckhoffADS.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplBeckhoffADS.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark HPL Beckhoff ADS should produce data', (done) => {
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

  it('spark HPL Beckhoff ADS should produce data in combined data mode', (done) => {
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
    sparkHplBeckhoffADS.updateModel({
      enable: true,
      ipAddress,
      localAmsAddress,
      amsAddress,
      amsPort,
      deliverEntireResponse: true,
      requestFrequency: 0.1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('spark HPL Beckhoff ADS should produce data in multi-read data mode', (done) => {
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
    sparkHplBeckhoffADS.updateModel({
      enable: true,
      ipAddress,
      localAmsAddress,
      amsAddress,
      amsPort,
      deliverEntireResponse: true,
      requestFrequency: 0.1,
      multiReadEnabled: true,
      multiReadRequestCount: 10,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed`, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        let alertTimer = null;
        sparkAlert.on('raise', (alert) => {
          sparkAlert.removeAllListeners('raise');
          if (alertTimer) clearTimeout(alertTimer);
          return done(Error(alert.msg));
        });
        sparkHplBeckhoffADS.writeData(value, (err) => {
          if (err) return done(err);
          alertTimer = setTimeout(() => {
            sparkAlert.removeAllListeners('raise');
            return done();
          }, 100);
          return undefined;
        });
      });
    }
  });

  it('an alert should be raised and connection variable set after an error emitted', (done) => {
    let alertRaised = false;
    let connectedVariableSet = false;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('connection-issue');
      alert.msg.should.equal(`${testMachine.info.name}: Connection Issue`);
      alert.description.should.equal('Connection issue with remote plc. Error: Host unreachable. Attempting to re-connect');
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

    sparkHplBeckhoffADS.tester.emit('error', { code: 'EHOSTUNREACH', message: 'Host unreachable' });
  });

  it('connection variable should cleared after reconnection', (done) => {
    db.on('data', (data) => {
      if (data.variable === 'machineConnected') {
        data[data.variable].should.equal(true);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
  });

  it('an alert should be raised and connection variable set after an error emitted', (done) => {
    let alertRaised = false;
    let connectedVariableSet = false;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('connection-error');
      alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
      alert.description.should.equal('Failed to connect to remote plc. Error: Target machine not found. Check addresses are correct and that Spark has been added as a route on the remote plc');
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

    sparkHplBeckhoffADS.tester.emit('error',
      { code: 'NOTFOUND', message: 'Target machine not found' });
  });

  it('update model should succeed when passed the same valid machine', (done) => {
    sparkHplBeckhoffADS.updateModel(testMachine.settings.model, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should raise an alert with an invalid IP address ', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('configuration-error');
      alert.msg.should.equal(`${testMachine.info.name}: Configuration Error`);
      alert.description.should.equal('Cannot start due to invalid configuration. Error: Invalid IP Address.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplBeckhoffADS.updateModel({
      enable: true,
      ipAddress: '',
      localAmsAddress,
      amsAddress,
      amsPort,
      requestFrequency: 0.1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('update model should raise an alert with an invalid AMS address ', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('configuration-error');
      alert.msg.should.equal(`${testMachine.info.name}: Configuration Error`);
      alert.description.should.equal('Cannot start due to invalid configuration. Error: Invalid AMS Address.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplBeckhoffADS.updateModel({
      enable: true,
      ipAddress,
      localAmsAddress,
      amsAddress: '',
      amsPort,
      requestFrequency: 0.1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('update model should raise an alert with an invalid local AMS address ', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('configuration-error');
      alert.msg.should.equal(`${testMachine.info.name}: Configuration Error`);
      alert.description.should.equal('Cannot start due to invalid configuration. Error: Invalid Local AMS Address.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplBeckhoffADS.updateModel({
      enable: true,
      ipAddress,
      localAmsAddress: '',
      amsAddress,
      amsPort,
      requestFrequency: 0.1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('update model should raise an alert with an invalid AMS port ', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('configuration-error');
      alert.msg.should.equal(`${testMachine.info.name}: Configuration Error`);
      alert.description.should.equal('Cannot start due to invalid configuration. Error: Invalid AMS Port.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplBeckhoffADS.updateModel({
      enable: true,
      ipAddress,
      localAmsAddress,
      amsAddress,
      amsPort: 0,
      requestFrequency: 0.1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('stop model should succeed', (done) => {
    sparkHplBeckhoffADS.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('if auto local AMS address enabled, it should be set correctly', (done) => {
    const config = new conf();
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplBeckhoffADS = new SparkHplBeckhoffADS.hpl(log.child({
      machine: autoAmsMachine.info.name,
    }), autoAmsMachine, autoAmsMachine.settings.model, config, null,
    sparkAlert.getAlerter());
    sparkHplBeckhoffADS.tester.setVariables(autoAmsMachine.variables);
    config.get(`machines:${autoAmsMachine.info.name}`).settings.model.localAmsAddress.should.equal(autoAmsLocalAddress);
    return done();
  });

  it('successfully create a new net Beckhoff ADS', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplBeckhoffADS = new SparkHplBeckhoffADS.hpl(log.child({
      machine: invalidVariableMachine.info.name,
    }), invalidVariableMachine, invalidVariableMachine.settings.model, new conf(), null,
    sparkAlert.getAlerter());
    sparkHplBeckhoffADS.tester.setVariables(invalidVariableMachine.variables);
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplBeckhoffADS.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('writing to read variable should raise an alert', (done) => {
    const variable = invalidVariableMachine.variables[0];
    const value = { variable: variable.name };
    value[variable.name] = variable.value;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`var-write-error-${variable.name}`);
      alert.msg.should.equal(`${invalidVariableMachine.info.name}: Error Writing Variable`);
      alert.description.should.equal('Error in writing int8Test. Variable does not exist or is not writable');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplBeckhoffADS.writeData(value, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('writing to variable with an unsupported format should raise an alert', (done) => {
    const variable = invalidVariableMachine.variables[1];
    const value = { variable: variable.name };
    value[variable.name] = variable.value;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('var-write-error-invalid');
      alert.msg.should.equal(`${invalidVariableMachine.info.name}: Error Writing Variable`);
      alert.description.should.equal('Error in writing invalid. Error: Unsupported Format');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplBeckhoffADS.writeData(value, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });
});
