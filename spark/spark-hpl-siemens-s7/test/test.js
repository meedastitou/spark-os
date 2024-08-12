/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplS7 = require('../index.js');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const testMachineEthernet = {
  info: {
    name: 'test-machine-ethernet-s7',
    fullname: 'Test Machine Ethernet S7',
    version: '1.0.0',
    description: 'Test Machine Ethernet S7',
    hpl: 'siemens-s7',
  },
  settings: {
    model: {
      enable: true,
      requestFrequency: '2',
      interface: 'ethernet',
      host: '127.0.0.1',
      port: '102',
      customS7_200_Via_CP_243_1: false,
      rack: '0',
      slot: '2',
      disconnectReportTime: '0',
    },
  },
  variables: [
    {
      name: 'readInt8',
      description: 'Read the Int8 variable',
      format: 'int8',
      address: 'DB4.0',
      value: 5,
    }, {
      name: 'readInt16',
      description: 'Read the Int16 variable',
      format: 'int16',
      address: 'SM0.6',
      access: 'read',
      value: 123,
    }, {
      name: 'readInt32',
      description: 'Read the Int32 variable',
      format: 'int32',
      address: 'I0.6',
      access: 'read',
      value: 542,
    }, {
      name: 'readFloat',
      description: 'Read the Float variable',
      format: 'float',
      address: 'VW8',
      access: 'read',
      value: 12.34,
    }, {
      name: 'readDouble',
      description: 'Read the Double variable',
      format: 'double',
      address: 'MW0',
      access: 'read',
      value: 123.456,
    }, {
      name: 'readChar',
      description: 'Read the char variable',
      format: 'char',
      address: 'Q0.6',
      access: 'read',
      value: 'a',
    }, {
      name: 'readUInt16',
      description: 'Read the UInt16 variable',
      format: 'uint16',
      address: 'T33',
      access: 'read',
      value: 12,
    }, {
      name: 'readBool',
      description: 'Read the bool variable',
      format: 'bool',
      address: 'DB3.0',
      access: 'read',
      value: true,
    }, {
      name: 'writeInt16',
      description: 'Write the int16 variable',
      format: 'int16',
      address: 'SM0.6',
      access: 'write',
      value: 100,
    }, {
      name: 'machineConnected',
      description: 'machine connected status variable',
      format: 'bool',
      machineConnected: true,
    }],
};

const testMachineSerial = {
  info: {
    name: 'test-machine-serial-s7',
    fullname: 'Test Machine Serial S7',
    version: '1.0.0',
    description: 'Test Machine Serial S7',
    hpl: 'siemens-s7',
  },
  settings: {
    model: {
      enable: true,
      requestFrequency: '2',
      interface: 'serial',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      customS7_200_Via_CP_243_1: false,
      parity: 'even',
      localAddress: 0,
      plcAddress: 2,
      protocolMode: 'PPI',
      mpiMode: 'MPI v1',
      mpiSpeed: '187K',
      rack: 0,
      slot: 2,
      disconnectReportTime: 1,
    },
  },
  variables: [
    {
      name: 'readInt8',
      description: 'Read the Int8 variable',
      format: 'int8',
      address: 'DB4.0',
      access: 'read',
      value: '5',
    }, {
      name: 'readInt16',
      description: 'Read the Int16 variable',
      format: 'int16',
      address: 'SM0.6',
      access: 'read',
      value: 123,
    }, {
      name: 'readInt32',
      description: 'Read the Int32 variable',
      format: 'int32',
      address: 'I0.6',
      access: 'read',
      value: 542,
    }, {
      name: 'readFloat',
      description: 'Read the Float variable',
      format: 'float',
      address: 'VW8',
      value: 12.34,
    }, {
      name: 'readDouble',
      description: 'Read the Double variable',
      format: 'double',
      address: 'MW0',
      access: 'read',
      value: 123.456,
    }, {
      name: 'readChar',
      description: 'Read the char variable',
      format: 'char',
      address: 'Q0.6',
      access: 'read',
      value: 'a',
    }, {
      name: 'readUInt16',
      description: 'Read the UInt16 variable',
      format: 'uint16',
      address: 'T33',
      access: 'read',
      value: 12,
    }, {
      name: 'readBool',
      description: 'Read the bool variable',
      format: 'bool',
      address: 'DB3.0',
      access: 'read',
      value: true,
    }, {
      name: 'writeInt16',
      description: 'Write the int16 variable',
      format: 'int16',
      address: 'SM0.6',
      access: 'write',
      value: 100,
    }, {
      name: 'machineConnected',
      description: 'machine connected status variable',
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

describe('SPARK HPL SIEMENS S7', () => {
  let sparkHplS7;

  it('successfully create a new net S7', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplS7 = new SparkHplS7.hpl(log.child({
      machine: testMachineEthernet.info.name,
    }), testMachineEthernet, testMachineEthernet.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplS7.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplS7.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplS7.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      sparkHplS7.tester.prototype.setVariables(testMachineEthernet.variables);
      return done();
    });
  });

  it('spark hpl Siemens-S7 should produce data in Ethernet mode', (done) => {
    const gotDataForVar = [];
    const variableReadArray = [];
    testMachineEthernet.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && _.isEqual(_.get(variable, 'access'), 'read')) {
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
  }).timeout(6000);

  it('spark-hpl siemens-s7 should succeed in writing value to the variable in Ethernet mode', (done) => {
    testMachineEthernet.variables.forEach((variable) => {
      if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        value.address = variable.address;
        sparkHplS7.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      }
    });
  });

  it('spark-hpl siemens-s7 should fail in writing bad variable in Ethernet', (done) => {
    sparkHplS7.tester.prototype.setWriteError(Error('write fails'), () => {
      testMachineEthernet.variables.forEach((variable) => {
        if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
          const value = { variable: variable.name };
          value[variable.name] = variable.value;
          value.address = variable.address;
          sparkHplS7.writeData(value, (err) => {
            if (err) {
              return done();
            }
            return undefined;
          });
        }
      });
    });
  });

  it('write Error should be cleared in Ethernet', (done) => {
    sparkHplS7.tester.prototype.setWriteError(null, () => done());
  });

  it('read should error for single bad variable in serial mode', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'variableName');
      alert.key.should.equal('data-null-error');
      alert.msg.should.equal(`${testMachineEthernet.info.name}: Data Error`);
      alert.description.should.equal(`Error in reading the values of the variable. Please verify the variable configuration for the variable ${testMachineEthernet.variables[1].name}`);
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkHplS7.tester.prototype.setDataNullError(testMachineEthernet.variables[1].address);
  }).timeout(4000);

  it('update model should succeed enabling localTSAP and remoteTSAP', (done) => {
    sparkHplS7.updateModel({
      enable: true,
      customS7_200_Via_CP_243_1: true,
      requestFrequency: 2,
      localTSAP: 256,
      remoteTSAP: 512,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  // generating disconnect using string value instead of integer value for connection parameter
  it('alert is raised and connection variable is set after an error caused', (done) => {
    let alertRaised = false;
    let connectedVariableSet = false;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('variable-configuration-error');
      alert.msg.should.equal(`${testMachineEthernet.info.name}: Configuration Error`);
      alert.description.should.equal('Failed to list some variables. Please make sure all the variables are configured with proper format.');
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

    sparkHplS7.tester.prototype.setConnectionError(Error('Connection Error'));
  }).timeout(4000);

  it('connection variable should cleared after reconnection', (done) => {
    sparkHplS7.tester.prototype.setConnectionError(null);
    db.on('data', (data) => {
      if (data.variable === 'machineConnected') {
        data[data.variable].should.equal(true);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
  }).timeout(6000);

  it('update model should succeed with machine disabled', (done) => {
    sparkHplS7.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });


  it('set the connection error in Ethernet mode', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('connection-error');
      alert.msg.should.equal(`${testMachineEthernet.info.name}: Connection Error`);
      alert.description.should.equal('Not able to open connection. Please verify the configuration');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkHplS7.tester.prototype.setConnectionError(Error('Connection Error'));

    sparkHplS7.updateModel({
      enable: true,
      requestFrequency: '2',
      interface: 'ethernet',
      host: '127.0.0.1',
      port: '102',
      customS7_200_Via_CP_243_1: false,
      rack: '0',
      slot: '2',
      disconnectReportTime: 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  }).timeout(4000);

  it('connection variable should be cleared after reconnection', (done) => {
    sparkHplS7.tester.prototype.setConnectionError(null);
    return done();
  });

  it('stop should valid when passed valid inputs', (done) => {
    sparkHplS7.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new serial S7', (done) => {
    sparkHplS7 = new SparkHplS7.hpl(log.child({
      machine: testMachineSerial.info.name,
    }), testMachineSerial, testMachineSerial.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should succeed when passes valid inputs', (done) => {
    sparkHplS7.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      sparkHplS7.tester.prototype.setVariables(testMachineSerial.variables);
      return done();
    });
  });

  it('spark hpl siemens-s7 should produce data in serial mode', (done) => {
    const variableReadArray = [];
    const gotDataForVar = [];
    testMachineSerial.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && _.isEqual(_.get(variable, 'access'), 'read')) {
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
  }).timeout(6000);

  it('spark hpl siemens-s7 should succeed writing to the variable in serial mode', (done) => {
    testMachineSerial.variables.forEach((variable) => {
      if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        value.address = variable.address;
        sparkHplS7.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      }
    });
  });

  it('spark-hpl siemens-s7 should fail in writing bad variable in serial mode', (done) => {
    sparkHplS7.tester.prototype.setWriteError(Error('write fails'), () => {
      testMachineSerial.variables.forEach((variable) => {
        if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
          const value = { variable: variable.name };
          value[variable.name] = variable.value;
          value.address = variable.address;
          sparkHplS7.writeData(value, (err) => {
            if (err) {
              return done();
            }
            return undefined;
          });
        }
      });
    });
  });

  it('write Error should be cleared in serial', (done) => {
    sparkHplS7.tester.prototype.setWriteError(null, () => done());
  });

  it('alert is raised and bad value is set after an error caused in serial mode', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('dataset-empty-error');
      alert.msg.should.equal(`${testMachineSerial.info.name}: variable Error`);
      alert.description.should.equal('Error in reading list of variables. Please make sure variable configuration is correct');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkHplS7.tester.prototype.setVariableError(Error('variable Error'));
  }).timeout(6000);

  it('variable error should be cleared', (done) => {
    sparkHplS7.tester.prototype.setVariableError(null);
    return done();
  });

  it('set the connection error in serial mode', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('connection-error');
      alert.msg.should.equal(`${testMachineSerial.info.name}: Connection Error`);
      alert.description.should.equal('Not able to open connection. Please verify the configuration');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplS7.tester.prototype.setConnectionError(Error('Connection Error'));

    sparkHplS7.updateModel({
      enable: true,
      requestFrequency: '.50',
      interface: 'serial',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      customS7_200_Via_CP_243_1: false,
      parity: 'even',
      customAddressing: true,
      localAddress: 0,
      plcAddress: 2,
      protocolMode: 'PPI',
      mpiMode: 'MPI v1',
      mpiSpeed: '187K',
      rack: 0,
      slot: 2,
      disconnectReportTime: 0.50,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('connection error should be cleared', (done) => {
    sparkHplS7.tester.prototype.setConnectionError(null);
    return done();
  });

  it('stop the hpl', (done) => {
    sparkHplS7.stop(() => done());
  });
});
