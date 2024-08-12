require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplDummy = require('../index.js');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const testMachine = require('./test-machine.json');
const outData = require('./test-data-out.json');

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
    Object.keys(alert).forEach((k) => {
      // check if the key is a function
      if (typeof alert[k] === 'function') {
        // if it is then run the function and replace
        // the key with the output
        alert[k] = alert[k](alert);
      }
    });
    alertEmitter.emit('alert', alert.key);
  },
  clearAll: function clearAll(done) { return done(); },
  clear: function clear() {},
};

describe('Spark HPL Dummy', () => {
  let sparkHplDummy;
  it('successfully create a new dummy hpl', (done) => {
    sparkHplDummy = new SparkHplDummy.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, { enable: false, updateRate: 1 }, null, null, sparkAlert);
    sparkHplDummy.timerMultiplier = 100;
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplDummy.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplDummy.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplDummy.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model to enable the dummy hpl should succeed', (done) => {
    sparkHplDummy.updateModel({ enable: true, updateRate: 1 }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl dummy should produce data', function testDataCb(done) {
    this.timeout(5000);

    let count = 0;
    db.on('data', (data) => {
      count += 1;

      // the 'data' type has not been configured yet
      // so no variables should produce data
      data.type.should.not.equal('data');

      // run for a while
      if (count > 100) {
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
  });

  it('update model to disable the dummy hpl should succeed', (done) => {
    sparkHplDummy.updateModel({ enable: false }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model to enable the combined output should succeed', (done) => {
    sparkHplDummy.updateModel({ enable: true, deliverEntireResponse: true }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl dummy should produce data for combined output', function testDataCb(done) {
    this.timeout(5000);

    let count = 0;
    db.on('data', (data) => {
      count += 1;

      // the 'data' type has not been configured yet
      // so no variables should produce data
      data.type.should.not.equal('data');

      // run for a while
      if (count > 3) {
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
  });

  it('update model should generate an alert on invalid dataFilePath', (done) => {
    alertEmitter.on('alert', (key) => {
      alertEmitter.removeAllListeners('alert');
      try {
        key.should.equal('file-open-error');
        return done();
      } catch (e) {
        return done(e);
      }
    });

    sparkHplDummy.updateModel({ enable: true, updateRate: 1, dataFilePath: 'does-not-exits.txt' }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('update model should succeed with valid dataFilePath', (done) => {
    sparkHplDummy.updateModel({ enable: true, updateRate: 1, dataFilePath: './test/test-data-in.csv' }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl dummy should produce data', function testDataCb(done) {
    this.timeout(5000);

    const store = [];
    db.on('data', (data) => {
      if (/data[0-9]/.test(data.variable)) {
        store.push(data);
      }

      if (store.length === outData.length) {
        log.debug(JSON.stringify(store, null, 2));
        store.should.eql(outData);
        db.removeAllListeners('data');
        return done();
      }

      return undefined;
    });
  });

  it('update model should succeed with valid dataFilePath', (done) => {
    sparkHplDummy.updateModel({ enable: true, updateRate: 1, dataFilePath: './test/test-data-in.csv' }, (err) => {
      if (err) return done(err);
      return done();
    });
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
    sparkHplDummy.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });
});
