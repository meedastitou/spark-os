/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplSiemensS5 = require('../index.js');

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
    name: 'test-machine-siemens-s5',
    fullname: 'Test Machine Siemens S5',
    version: '1.0.0',
    description: 'Test Machine Siemens S5',
    hpl: 'siemens-s5',
  },
  settings: {
    model: {
      enable: true,
      requestFrequency: '5',
      device: '/dev/ttyUSB0',
      disconnectReportTime: 1,
    },
  },
  variables: [
    {
      name: 'readInt8',
      description: 'Read the Int8 variable',
      format: 'int8',
      address: 'af01',
      value: 12,
    }, {
      name: 'readInt16',
      description: 'Read the Int16 variable',
      format: 'int16',
      address: 'af02',
      access: 'read',
      value: 123,
    }, {
      name: 'readInt32',
      description: 'Read the Int32 variable',
      format: 'int32',
      address: 'af03',
      access: 'read',
      value: 134,
    }, {
      name: 'readUInt16',
      description: 'Read the UInt16 variable',
      format: 'uint16',
      address: 'af05',
      access: 'read',
      value: 156,
    }, {
      name: 'readInt64',
      description: 'Read the Int64 variable',
      format: 'int64',
      address: 'af04',
      access: 'read',
      value: 145,
    }, {
      name: 'readUInt64',
      description: 'Read the UInt64 variable',
      format: 'uint64',
      address: 'af00',
      endian: 'BE',
      access: 'read',
      value: 112,
    }, {
      name: 'readFloat',
      description: 'Read the float variable',
      format: 'float',
      address: 'af06',
      access: 'read',
      value: 178,
    }, {
      name: 'readDouble',
      description: 'Read the double variable',
      format: 'double',
      address: 'af07',
      access: 'read',
      value: 189,
    }, {
      name: 'readBool',
      description: 'Read the bool variable',
      format: 'bool',
      address: 'af08',
      access: 'read',
      value: 1,
    }, {
      name: 'machineConnected',
      description: 'machine connected variable',
      format: 'bool',
      machineConnected: true,
    }, {
      name: 'writeInt16',
      description: 'Write the Int16 variable',
      format: 'int16',
      address: 'af02',
      access: 'write',
      value: 12,
    },
  ],
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
  return done(null);
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

describe('SPARK HPL SIEMENS S5', () => {
  let sparkHplSiemensS5;

  it('successfully create a new Siemens-S5', (done) => {
    // eslint-disable-next-line new-cap
    sparkHplSiemensS5 = new SparkHplSiemensS5.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, null, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplSiemensS5.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplSiemensS5.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplSiemensS5.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      let variableReadArray = [];
      testMachine.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false) && _.isEqual(_.get(variable, 'access', 'read'), 'read')) {
          variableReadArray.push(variable);
        }
      });
      sparkHplSiemensS5.tester.prototype.setVariables(variableReadArray);
      return done();
    });
  });

  it('spark hpl siemens-s5 should produce data', (done) => {
    const variableReadArray = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && (_.isEqual(_.get(variable, 'access', 'read'), 'read'))) {
        variableReadArray.push(variable);
      }
    });

    db.on('data', (data) => {
      variableReadArray.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === variableReadArray.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  }).timeout(3000);

  it('spark hpl-siemens-s5 set variable error', (done) => {
    sparkHplSiemensS5.tester.prototype.setVariableError('variable reading Error');
    return done();
  });

  it('spark hpl-siemens-s5 reads variable should fail after setting variable error', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('connection-error');
      alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
      alert.description.should.equal('Not able to open connection. Please verify the configuration. Error: variable reading Error');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
  }).timeout(3000);

  it('spark hpl siemens-s5 should clear the variable error', (done) => {
    sparkHplSiemensS5.tester.prototype.setVariableError(null);
    return done();
  });

  it('spark hpl siemens-s5 should fail reading a variable after varReadError is set', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('var-read-error');
      alert.msg.should.equal(`${testMachine.info.name}: Variable read error`);
      alert.description.should.equal(`Read error for - ${testMachine.variables[3].name}. Make sure the variable configuration is set correctly `);
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplSiemensS5.tester.prototype.setVarReadError(testMachine.variables[3].address);
  }).timeout(3000);

  it('spark hpl siemens-s5 should set writeVariables', (done) => {
    const variableWriteArray = [];
    testMachine.variables.forEach((variable) => {
      if ((!_.get(variable, 'machineConnected', false) && (_.get(variable, 'access', 'read') === 'write'))) {
        variableWriteArray.push(variable);
      }
    });
    sparkHplSiemensS5.tester.prototype.setWriteVariables(variableWriteArray);
    return done();
  });

  it('spark hpl siemens-s5 should succeed writing to the variable', (done) => {
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && (_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        value.address = variable.address;
        sparkHplSiemensS5.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      }
    });
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplSiemensS5.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl siemens-s5 set the error variable to generate connection error', (done) => {
    sparkHplSiemensS5.tester.prototype.setConnectionError('Generated Error');
    return done();
  });

  it('starting the hpl should fail due to connection error', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('connection-error');
      alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
      alert.description.should.equal('Not able to open connection. Please verify the configuration. Error: Generated Error');
      sparkAlert.removeAllListeners('raise');
      sparkHplSiemensS5.tester.prototype.setConnectionError(null);
      return done();
    });
    sparkHplSiemensS5.updateModel({
      enable: true,
    }, (err) => {
      if (err) return undefined;
      return undefined;
    });
  });

  it('start should succeed with machine enabled', (done) => {
    sparkHplSiemensS5.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      let variableReadArray = [];
      testMachine.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false) && _.isEqual(_.get(variable, 'access', 'read'), 'read')) {
          variableReadArray.push(variable);
        }
      });
      sparkHplSiemensS5.tester.prototype.setVariables(variableReadArray);
      return done();
    });
  });

  it('setting write variable error', (done) => {
    const variableWriteArray = [];
    testMachine.variables.forEach((variable) => {
      if ((!_.get(variable, 'machineConnected', false) && (_.get(variable, 'access', 'read') === 'write'))) {
        variableWriteArray.push(variable);
      }
    });
    sparkHplSiemensS5.tester.prototype.setWriteError(variableWriteArray[0].address);
    return done();
  });

  it('spark-hpl siemens-s5 should fail in writing bad variable', (done) => {
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && (_.get(variable, 'access', 'read') === 'write') && (variable.format !== undefined)) {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        value.address = variable.address;
        sparkHplSiemensS5.writeData(value, (err) => {
          if (err) return done();
          return undefined;
        });
      }
    });
  });

  it('start should result in error', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('opened-client');
      alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
      alert.description.should.equal('Client Connection has been opened already');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplSiemensS5.start(dataCb, configUpdateCb, () => {
    });
  });

  it('stop should valid when passed valid inputs', (done) => {
    sparkHplSiemensS5.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });
});
