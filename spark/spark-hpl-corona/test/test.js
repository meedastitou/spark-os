require('chai').should();
const net = require('net');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplCorona = require('../index.js');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const testMachine = require('./test-machine.json');

const db = new EventEmitter();
const alertEmitter = new EventEmitter();

let dbSwitch = true;
function dataCb(machine, variable, value, cb) {
  const data = {
    machine: machine.info.name,
    variable: variable.name,
    type: variable.type,
  };
  data[variable.name] = value;
  log.debug({ data });
  if (dbSwitch) {
    db.emit('data', data);
    cb(null);
  } else {
    cb(new Error('Error with Database Write Functionality'));
  }
}

function configUpdateCb(machine, done) {
  log.debug({ machine });
  return done(null);
}

let alerts = {};
const sparkAlert = {
  preLoad: function preLoad(preloadAlerts) {
    alerts = preloadAlerts;
  },
  raise: function raise(alert) {
    if (Object.prototype.hasOwnProperty.call(alerts, alert.key)) {
      _.extend(alert, alerts[alert.key]);
    }
    // iterate over keys in the object
    Object.keys(alert).forEach((k) => {
      // check if the key is a function
      if (_.isFunction(alert[k])) {
        // if it is then run the function and replace
        // the key with the output
        _.set(alert, k, alert[k](alert));
      }
    });
    alertEmitter.emit('alert', alert.key);
  },
  clearAll: function clearAll(done) { return done(); },
  clear: function clear() {},
};

describe('Spark HPL Corona', () => {
  const server = net.createServer((c) => {
    // every second send test data to the client
    setInterval(() => {
      const int16arr = new Int16Array([0x0000, 0x0000, 0x152c, 0x7551,
        0x7551, 0x3373, 0x6e6a, 0x7551]);
      c.write(Buffer.from(int16arr.buffer));
    }, 1000);
  });

  let sparkHplCorona;
  it('successfully create a new corona hpl', (done) => {
    sparkHplCorona = new SparkHplCorona.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, { enable: false }, null, null, sparkAlert);
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplCorona.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplCorona.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplCorona.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model to enable the corona hpl should succeed', function updateWithReconnect(done) {
    this.timeout(10000);

    db.on('data', (data) => {
      data.machine.should.equal('test-machine');
      if (data.variable === 'ch0') {
        data.ch0.should.eql([0x0000, 0x152c, 0x7551, 0x6e6a]);
      } else {
        data.variable.should.equal('ch1');
        data.ch1.should.eql([0x0000, 0x7551, 0x3373, 0x7551]);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });

    sparkHplCorona.updateModel({ enable: true, url: 'tcp://127.0.0.1:5000' }, (err) => {
      if (err) return done(err);
      return undefined;
    });

    // wait 5 seconds before starting the server listening
    // to force spark-hpl-corona to try and reconnect
    setTimeout(() => {
      server.listen(5000, () => { });
    }, 5000);
  });

  it('spark hpl dummy should produce an alert if database disabled', function testDisabledDataCb(done) {
    dbSwitch = false;
    this.timeout(5000);
    alertEmitter.on('alert', (key) => {
      alertEmitter.removeAllListeners('alert');
      try {
        key.should.equal('db-add-error');
        return done();
      } catch (e) {
        return done(e);
      }
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplCorona.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });
});
