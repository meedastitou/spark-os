require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const SparkHplYamadaDobby = require('../index.js');
// require('serialport/test') must occur after require('../index.js') or serialport fails
// eslint-disable-next-line import/order
const SerialPort = require('serialport/test');
const pkg = require('../package.json');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const testMachine = require('./test-machine.json');
const testMachine2 = require('./test-machine2.json');

const db = new EventEmitter();
const alertEmitter = new EventEmitter();


const UNAVAILABLE_DEVICE = '/dev/unavailable';
const MOCK_DEVICE = '/dev/ttyUSB0';

const MockBinding = SerialPort.Binding;
MockBinding.createPort(MOCK_DEVICE, { echo: false, record: false });

function dataCb(machine, variable, value) {
  const data = {
    machine: machine.info.name,
    variable: variable.name,
  };
  data[variable.name] = value;
  log.debug({ data });
  db.emit('data', data);
}

function configUpdateCb(machine, done) {
  log.debug({ machine });
  return done(null);
}

const sparkAlert = {
  preLoad: function preLoad() {},
  raise: function raise(alert) {
    alertEmitter.emit('alert', alert.key);
  },
  clearAll: function clearAll(done) { return done(); },
  clear: function clear() {},
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

describe('Spark HPL Yamada Dobby', () => {
  let sparkHplYamadaDobby;

  it('successfully create a new yamada dobby hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplYamadaDobby = new SparkHplYamadaDobby.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, { enable: false, device: UNAVAILABLE_DEVICE }, sparkConfig, null, sparkAlert);
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplYamadaDobby.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplYamadaDobby.start(dataCb, 5, (err) => {
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
    sparkHplYamadaDobby.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model to enable the yamada dobby hpl should fail as unavailable serial device', (done) => {
    let alertKey = null;
    alertEmitter.on('alert', (key) => {
      alertKey = key;
    });

    sparkHplYamadaDobby.updateModel({ enable: true, device: UNAVAILABLE_DEVICE }, (err) => {
      alertEmitter.removeAllListeners('alert');
      if (alertKey === null) return done(new Error('No alert raised opening non-available serial device'));
      try {
        alertKey.should.equal('device-open-error');
        if (err) return done();
        return done(new Error('No error opening non-available serial device'));
      } catch (e) {
        return done(e);
      }
    });
  });

  it('update model to enable the yamada dobby with mock serial device should pass', (done) => {
    sparkHplYamadaDobby.updateModel({ enable: true, device: MOCK_DEVICE }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplYamadaDobby.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new yamada dobby hpl with different test variables', (done) => {
    sparkHplYamadaDobby = new SparkHplYamadaDobby.hpl(log.child({
      machine: testMachine2.info.name,
    }), testMachine2, { enable: false, device: MOCK_DEVICE }, sparkConfig, null, sparkAlert);
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplYamadaDobby.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });


  it('update model to enable the yamada dobby hpl should create an alert for wrongly formatted variable', (done) => {
    let alertKey = null;
    alertEmitter.on('alert', (key) => {
      alertKey = key;
    });

    sparkHplYamadaDobby.updateModel({ enable: true, device: MOCK_DEVICE }, (err) => {
      alertEmitter.removeAllListeners('alert');
      if (alertKey === null) return done(new Error('No alert raised with wrongly formatted variable'));
      try {
        alertKey.should.equal('var-error-DPA');
        if (err) return done(err);
        return done();
      } catch (e) {
        return done(e);
      }
    });
  });

  it('try to write to variable without write access should create an alert for error writing variable', (done) => {
    let alertKey = null;
    alertEmitter.on('alert', (key) => {
      alertKey = key;
    });

    sparkHplYamadaDobby.writeData({
      machine: 'test-machine2',
      variable: 'DPA',
    }, (err) => {
      alertEmitter.removeAllListeners('alert');
      if (alertKey === null) return done(new Error('No alert raised for variable without write access'));
      try {
        alertKey.should.equal('var-write-error-DPA');
        if (err) return done(err);
        return done();
      } catch (e) {
        return done(e);
      }
    });
  });

  it('try to write to variable of unsupported type should create an alert for unsupported type', (done) => {
    let alertKey = null;
    alertEmitter.on('alert', (key) => {
      alertKey = key;
    });

    sparkHplYamadaDobby.writeData({
      machine: 'test-machine2',
      variable: 'writeTest',
      access: 'write',
      writeTest: 123,
    }, (err) => {
      alertEmitter.removeAllListeners('alert');
      if (alertKey === null) return done(new Error('No alert raised for variable of unsupported type'));
      try {
        alertKey.should.equal('var-write-type-error-writeTest');
        if (err) return done(err);
        return done();
      } catch (e) {
        return done(e);
      }
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplYamadaDobby.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });
});
