/* jshint esversion: 6 */
// eslint-disable-next-line import/no-extraneous-dependencies
require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
// eslint-disable-next-line import/no-extraneous-dependencies
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplOmron = require('../index.js');

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
    name: 'test-machine-ethernet',
    fullname: 'Test Machine Ethernet',
    version: '1.0.0',
    description: 'Test Machine Ethernet',
    hpl: 'omron-fins',
  },
  settings: {
    model: {
      enable: true,
      interface: 'ethernet',
      ipAddress: os.hostname(),
      port: 9600,
      destinationNode: 0,
      updateRate: 2,
      publishDisabled: false,
    },
  },
  variables: [{
    name: 'readInt16',
    description: 'Read Int16 variable',
    format: 'int16',
    address: 'DM0100',
    value: 123,
  }, {
    name: 'readUInt16',
    description: 'Read UInt16 variable',
    format: 'uint16',
    address: 'DM099',
    access: 'read',
    value: 234,
  }, {
    name: 'readInt32',
    description: 'Read Int32 variable',
    format: 'int32',
    address: 'DM0101',
    access: 'read',
    value: 345,
  }, {
    name: 'readUInt32',
    description: 'Read UInt32 variable',
    format: 'uint32',
    address: 'DM0102',
    access: 'read',
    value: 456,
  }, {
    name: 'readBool',
    description: 'Read Bool variable',
    format: 'bool',
    address: 'DM0103',
    access: 'read',
    value: true,
  }, {
    name: 'readUInt16',
    description: 'Write UInt16 variable',
    format: 'UInt16',
    address: 'DM099',
    access: 'write',
    value: 111,
  }, {
    name: 'machineConnected',
    description: 'Machine connected variable',
    format: 'bool',
    machineConnected: true,
  },
  ],
};

const testMachineSerial = {
  info: {
    name: 'test-machine-serial',
    fullname: 'Test Machine Serial',
    version: '1.0.0',
    description: 'Test Machine Serial',
    hpl: 'omron-fins',
  },
  settings: {
    model: {
      enable: true,
      interface: 'serial',
      payload: 'Hostlink (C-mode)',
      device: '/dev/ttyUSB0',
      baudRate: 9600,
      dataBits: 7,
      stopBits: 2,
      parity: 'even',
      updateRate: 2,
      publishDisabled: false,
    },
  },
  variables: [
    {
      name: 'variableRead1', address: 'DM0000', numRegs: 1, values: [123], format: 'int16',
    },
    {
      name: 'variableRead2', address: 'IR0100', numRegs: 3, values: [234, 345, 456], array: true, length: 3, format: 'int16',
    },
    {
      name: 'variableRead3', address: 'DM0010.02', numRegs: 1, values: [1], format: 'bool',
    },
    {
      name: 'variableRead4', address: 'LR0000', numRegs: 1, values: [345], format: 'uint16',
    },
    {
      name: 'variableRead7', address: 'HR0000', numRegs: 2, values: [789], format: 'int32',
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

describe('SPARK HPL OMRON FINS', () => {
  let sparkHplOmron;

  it('successfully create a new Omron-fins', (done) => {
    // eslint-disable-next-line new-cap
    sparkHplOmron = new SparkHplOmron.hpl(log.child({
      machine: testMachineEthernet.info.name,
    }), testMachineEthernet, testMachineEthernet.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should error when datacb is not a function', (done) => {
    sparkHplOmron.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplOmron.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('before a successfull start the connection status should be false', (done) => {
    sparkConfig.get(`machines:${testMachineEthernet.info.name}:settings:model:connectionStatus`).should.equal(false);
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplOmron.start(dataCb, configUpdateCb, (err) => {
      if (err) return done();
      const variableReadArray = [];
      testMachineEthernet.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false) && _.isEqual(_.get(variable, 'access', 'read'), 'read')) {
          variableReadArray.push(variable);
        }
      });
      sparkHplOmron.tester.prototype.setReadVariables(variableReadArray);
      return done();
    });
  });

  it('spark hpl Omron-fins should produce data in Ethernet mode ', (done) => {
    const gotDataForVar = [];
    const variableReadArray = [];
    testMachineEthernet.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && _.isEqual(_.get(variable, 'access', 'read'), 'read')) {
        variableReadArray.push(variable);
      }
    });

    db.on('data', (data) => {
      variableReadArray.forEach((variable) => {
        if (variable.name === data.variable) {
          // eslint-disable-next-line max-len
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

  it('after a successful connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachineEthernet.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('reading should fail when readError is set', (done) => {
    const variableReadArray = [];
    testMachineEthernet.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
      && _.isEqual(_.get(variable, 'access', 'read'), 'read')) {
        variableReadArray.push(variable);
      }
    });

    sparkAlert.on('raise', (alert) => {
      alert.should.have.all.keys('key', 'msg', 'description');
      // alert.key.should.equal(`no-data-${variableReadArray[2].name}`);
      // alert.msg.should.equal('Omron: No Data for Variable');
      // alert.description.should.equal(`No data returned for variable
      // ${variableReadArray[2].name}. Check the machine defininition is correct.`);
      // sparkAlert.removeAllListeners('raise');
      // alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`read-fail-${variableReadArray[0].name}`);
      alert.msg.should.equal('Omron: Read Failed for Variable');
      alert.description.should.equal(`Read failed for variable '${variableReadArray[0].name}'. Check the address of this variable is set correctly.`);
      sparkAlert.removeAllListeners('raise');
      sparkHplOmron.tester.prototype.setReadVarError(null);
      return done();
    });
    sparkHplOmron.tester.prototype.setReadVarError(variableReadArray[2].address);
  }).timeout(3000);

  it('update model should succeed with machine disabled', (done) => {
    sparkHplOmron.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl omron should fails due to connection error', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('client-timeout');
      alert.msg.should.equal('Omron: Timeout on Read request');
      alert.description.should.equal('No response from client. Check cable to Omron and connection settings are ok.');
      sparkAlert.removeAllListeners('raise');
      sparkHplOmron.tester.prototype.setConnectionError(null);
      return done();
    });
    sparkHplOmron.tester.prototype.setConnectionError('Connection Error');
    sparkHplOmron.updateModel({
      enable: true,
    }, (err) => {
      if (err) return undefined;
      return undefined;
    });
  }).timeout(3000);

  it('spark hpl omron start should succeed with machine enabled', (done) => {
    sparkHplOmron.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      const variableReadArray = [];
      testMachineEthernet.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false)
         && _.isEqual(_.get(variable, 'access', 'read'), 'read')) {
          variableReadArray.push(variable);
        }
      });
      sparkHplOmron.tester.prototype.setReadVariables(variableReadArray);
      return done();
    });
  });

  it('spark hpl omron should set write variables', (done) => {
    const variableWriteArray = [];
    testMachineEthernet.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
      && _.isEqual(_.get(variable, 'access', 'read'), 'write')) {
        variableWriteArray.push(variable);
      }
    });
    sparkHplOmron.tester.prototype.setWriteVariables(variableWriteArray);
    return done();
  });

  it('spark hpl omron should succeed with writing data on Ethernet interface', (done) => {
    testMachineEthernet.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && _.isEqual(_.get(variable, 'access', 'read'), 'write')) {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        value.address = variable.address;
        sparkHplOmron.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      }
    });
  });

  it('spark hpl omron setting up write error', (done) => {
    sparkHplOmron.tester.prototype.setWriteError('Write Error');

    const gotDataForVar = [];
    const variableWriteArray = [];
    testMachineEthernet.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && (_.get(variable, 'access', 'read') === 'write') && (variable.format !== undefined)) {
        variableWriteArray.push(variable);
      }
    });

    variableWriteArray.forEach((variable) => {
      const value = { variable: variable.name };
      value[variable.name] = variable.value;
      value.address = variable.address;
      sparkHplOmron.writeData(value, (err) => {
        if (err) {
          gotDataForVar.push(value.address);
          if (gotDataForVar.length === variableWriteArray.length) {
            sparkHplOmron.tester.prototype.setWriteError(null);
            return done();
          }
        }
        return undefined;
      });
    });
    return undefined;
  });

  it('spark hpl omron should fail on starting when it has active connection', (done) => {
    sparkHplOmron.start(dataCb, configUpdateCb, (err) => {
      if (err) return done();
      return undefined;
    });
  });

  it('spark hpl omron should succeed in stoping the machine', (done) => {
    sparkHplOmron.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new Omron HPL for serial', (done) => {
    // eslint-disable-next-line new-cap
    sparkHplOmron = new SparkHplOmron.hpl(log.child({
      machine: testMachineSerial.info.name,
    }), testMachineSerial, testMachineSerial.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('spark hpl omron should succeed in starting serial interface', (done) => {
    sparkHplOmron.start(dataCb, configUpdateCb, (err) => {
      if (err) return done();
      const variableReadArray = [];
      testMachineSerial.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false) && _.isEqual(_.get(variable, 'access', 'read'), 'read')) {
          variableReadArray.push(variable);
        }
      });
      sparkHplOmron.tester.prototype.setReadVariables(variableReadArray);
      return done();
    });
  });

  it('reading address should succeed in host link mode', (done) => {
    const variableReadArray = [];
    const gotDataForVar = [];
    testMachineSerial.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && _.isEqual(_.get(variable, 'access', 'read'), 'read')) {
        variableReadArray.push(variable);
      }
    });

    db.on('data', (data) => {
      variableReadArray.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
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
  }).timeout(5000);
});
