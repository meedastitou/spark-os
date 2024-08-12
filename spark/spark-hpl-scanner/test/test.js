/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplScanner = require('../index.js');

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
    hpl: 'scanner',
  },
  settings: {
    model: {
      enable: true,
      device: '',
    },
  },
  variables: [{
    name: 'testVariable',
    description: 'Test Variable',
  }],
};

const scan8BytesTest = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x04, 0x00]);
const scan8BytesShiftTest = Buffer.from([0x00, 0x00, 0x00, 0x00, 225, 0x00, 0x04, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x04, 0x00]);
const scan16BytesTest = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x04, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00]);
const scan24BytesTest = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x04, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00]);
const scan3BytesTest = Buffer.from([0x00, 0x00, 0x00]);

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

describe('Spark HPL Scanner', () => {
  let sparkHplScanner;

  it('successfully create a new scanner HPL', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplScanner = new SparkHplScanner.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplScanner.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplScanner.start(dataCb, 5, (err) => {
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
    sparkHplScanner.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      // sparkHplScanner.tester.emit('data', 'ABC');
      return done();
    });
  });

  it('an 8-byte scan structure should produce the correct variable value', (done) => {
    db.on('data', (data) => {
      data.testVariable.should.equal('a');
      db.removeAllListeners('data');
      return done();
    });
    sparkHplScanner.tester.emit('data', scan8BytesTest);
    // send a second time to test duplexFlag
    sparkHplScanner.tester.emit('data', scan8BytesTest);
  });

  it('an 8-byte scan structure shifted should produce the correct variable value', (done) => {
    db.on('data', (data) => {
      data.testVariable.should.equal('A');
      db.removeAllListeners('data');
      return done();
    });
    sparkHplScanner.tester.emit('data', scan8BytesShiftTest);
    //    sparkHplScanner.tester.emit('data', scan8BytesTest);
  });

  it('a 16-byte scan structure should produce the correct variable value', (done) => {
    db.on('data', (data) => {
      data.testVariable.should.equal('b');
      db.removeAllListeners('data');
      return done();
    });
    sparkHplScanner.tester.emit('data', scan16BytesTest);
  });

  it('a 24-byte scan structure should produce the correct variable value', (done) => {
    db.on('data', (data) => {
      data.testVariable.should.equal('c');
      db.removeAllListeners('data');
      return done();
    });
    sparkHplScanner.tester.emit('data', scan24BytesTest);
  });

  it('an 8-byte scan after a 3-byte should produce the correct variable value', (done) => {
    db.on('data', (data) => {
      data.testVariable.should.equal('a');
      db.removeAllListeners('data');
      return done();
    });
    sparkHplScanner.tester.emit('data', scan3BytesTest);
    sparkHplScanner.tester.emit('data', scan8BytesTest);
  });

  it('the error alert should be cleared and the connection status set true after 5 seconds', (done) => {
    sparkAlert.on('clear', (key) => {
      key.should.equal('scanner-disconnect');
      sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
      sparkAlert.removeAllListeners('clear');
      return done();
    });
  }).timeout(6000);

  it('an alert should be raised after an error is emitted', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('scanner-disconnect');
      alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
      alert.description.should.equal('Failed to communicate with Scanner. Please ensure Scanner is properly connected');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkHplScanner.tester.emit('error', Error('test error'));
  });

  it('update model should succeed when passed valid inputs', (done) => {
    sparkHplScanner.updateModel({
      enable: false,
      device: '',
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });
});
