/* jshint esversion: 6 */
// eslint-disable-next-line import/no-extraneous-dependencies
require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
// eslint-disable-next-line import/no-extraneous-dependencies
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplAbEthernet = require('../index.js');

const PORT = 44818;

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
    name: 'test-machine-ab-ethernet',
    fullname: 'Test Machine AB Ethenet',
    version: '1.0.0',
    description: 'Test Machine AB Ethernet',
    hpl: 'ab-ethernet',
  },
  settings: {
    model: {
      enable: true,
      requestFrequency: 2,
      host: os.hostname(),
      port: PORT,
      doRouting: false,
      backPlanePort: 1,
      backPlaneSlot: 0,
      disconnectReportTime: 0,
    },
  },
  variables: [
    {
      name: 'readInt8',
      description: 'Read the Int8 variable',
      format: 'int8',
      address: 'L12:12',
      value: 12,
    }, {
      name: 'readInt16',
      description: 'Read the Int16 variable',
      format: 'int16',
      address: 'B3:10/0',
      value: 23,
    }, {
      name: 'readInt32',
      description: 'Read the Int32 variable',
      format: 'int32',
      address: 'B3:10/1',
      value: 43,
    }, {
      name: 'readInt64',
      description: 'Read the Int64 variable',
      format: 'int64',
      address: 'L12:10',
      value: 54,
    }, {
      name: 'readUInt16',
      description: 'Read the UInt16 variable',
      format: 'uint16',
      address: 'L12:11',
      value: 65,
    }, {
      name: 'readFloat',
      description: 'Read the Float variable',
      format: 'float',
      address: 'B3:10/2',
      value: 76,
    }, {
      name: 'readDouble',
      description: 'Read the Double variable',
      format: 'double',
      address: 'B3:10/3',
      value: 87,
    }, {
      name: 'readBool',
      description: 'Read the Bool variable',
      format: 'bool',
      address: 'L12:9',
      value: true,
    }, {
      name: 'writeInt16',
      description: 'Read the Int16 variable',
      format: 'int16',
      address: 'B3:10/0',
      access: 'write',
      value: 123,
    }, {
      name: 'machineConnected',
      description: 'Machine connected variable',
      format: 'bool',
      machineConnected: true,
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

describe('SPARK HPL AB ETHERNET', () => {
  let sparkHplAbEthernet;

  it('successfully create a new ab-ethernet', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplAbEthernet = new SparkHplAbEthernet.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplAbEthernet.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplAbEthernet.start(dataCb, 5, (err) => {
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
    sparkHplAbEthernet.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      sparkHplAbEthernet.tester.prototype.setVariables(testMachine.variables);
      return done();
    });
  });

  it('spark hpl ab-ethernet should produce data', (done) => {
    const gotDataForVar = [];
    const variableReadArray = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && _.isEqual(_.get(variable, 'access', 'read'), 'read')) {
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

  it('after a successful connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('spark hpl ab-ethernet should succeed writing data to variable', (done) => {
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && (_.get(variable, 'access', 'read') === 'write') && (variable.format !== undefined)) {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        value.address = variable.address;
        sparkHplAbEthernet.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      }
    });
  });

  it('writing should fail when passed invalid inputs', (done) => {
    const value = { variable: 'invalid' };
    value.invalid = null;
    value.address = 'invalid';
    sparkHplAbEthernet.writeData(value, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('setting the write error', (done) => {
    sparkHplAbEthernet.tester.prototype.setWriteError('Write Error');
    return done();
  });

  it('spark hpl ab-ether should fails in writing data', (done) => {
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false) && (_.get(variable, 'access', 'read') === 'write') && (variable.format !== undefined)) {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        value.address = variable.address;
        sparkHplAbEthernet.writeData(value, (err) => {
          if (err) return done();
          sparkHplAbEthernet.tester.prototype.setWriteError(null);
          return undefined;
        });
      }
    });
  });

  it('setting the read error', (done) => {
    sparkHplAbEthernet.tester.prototype.setReadError('Reading Error');
    return done();
  });

  it('spark hpl eb-ethernet should fail reading variable', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('connection-lost-error');
      alert.msg.should.equal(`Connection Lost Error: ${testMachine.info.name}`);
      alert.description.should.equal('The connection to the PLC was lost. Please verify the connection.');
      sparkAlert.removeAllListeners('raise');
      sparkHplAbEthernet.tester.prototype.setReadError(null);
      return done();
    });
  }).timeout(5000);

  it('setting connection error', (done) => {
    sparkHplAbEthernet.tester.prototype.setConnectionError('Connection Error');
    return done();
  });

  it('spark hpl ab-ethernet should fail starting the machine', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('connection-error');
      alert.msg.should.equal(`Connection Error: ${testMachine.info.name}`);
      alert.description.should.equal('Not able to open connection. Please verify the configuration setting. Error: Connection Error');
      sparkAlert.removeAllListeners('raise');
      sparkHplAbEthernet.tester.prototype.setConnectionError(null);
      return done();
    });
    sparkHplAbEthernet.start(dataCb, configUpdateCb, () => undefined);
    return undefined;
  });

  it('starting the machine should succeed', (done) => {
    sparkHplAbEthernet.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  it('stop should valid when passed valid inputs', (done) => {
    sparkHplAbEthernet.stop((err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(3000);

  it('update model should succeed with machine disabled', (done) => {
    sparkHplAbEthernet.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });
});
