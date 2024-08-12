require('chai').should();
const _ = require('lodash');
const bunyan = require('bunyan');
const pkg = require('../package.json');
const sparkAlert = require('../index.js');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const conf = {
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379/0',
};

const modules = {
  'spark-config': {
    exports: {
      get(key) {
        return conf[key];
      },
    },
  },
  'spark-logging': {
    exports: {
      getLogger(moduleName) {
        return log.child({
          module: moduleName,
        });
      },
    },
  },
};

const validAlerts = [{
  key: 'first',
  msg: 'first message',
  description: 'This is the first message',
}, {
  key: 'second',
  msg: 'second message',
  description: 'This is the second message',
  level: 'warn',
}, {
  key: 'third',
  msg: 'third message',
  description: 'This is the third message',
}];

const invalidAlerts = [{
  description: 'missing key',
  data: {
    msg: 'missing key',
    description: 'missing key description',
  },
  result: 'Error: alert.key missing',
}, {
  description: 'missing msg',
  data: {
    key: 'missing-msg',
    description: 'missing msg description',
  },
  result: 'Error: alert.msg missing',
}, {
  description: 'missing description',
  data: {
    key: 'missing-description',
    msg: 'missing description',
  },
  result: 'Error: alert.description missing',
}];

describe('Spark Alert', () => {
  it('require should succeed', (done) => {
    const result = sparkAlert.require();
    result.should.be.instanceof(Array);
    return done();
  });

  it('stop should error when not started', (done) => {
    sparkAlert.stop((err) => {
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: not started');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkAlert.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-alert');
      return done();
    });
  });

  it('start should error when already started', (done) => {
    sparkAlert.start(modules, (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: already started');
      return done();
    });
  });

  it('clear all alerts should succeed', (done) => {
    sparkAlert.clearAlerts((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('get all alerts - no alerts', (done) => {
    sparkAlert.getAlerts((err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.length.should.equal(0);
      return done();
    });
  });

  it('get aleter with invalid module should error', (done) => {
    const err = sparkAlert.getAlerter();
    err.should.be.instanceof(Error);
    err.toString().should.equal('Error: invalid module');
    return done();
  });

  it('get aleter with invalid module should error', (done) => {
    const err = sparkAlert.getAlerter('');
    err.should.be.instanceof(Error);
    err.toString().should.equal('Error: invalid module');
    return done();
  });

  it('get aleter with invalid module should error', (done) => {
    const err = sparkAlert.getAlerter(x => x);
    err.should.be.instanceof(Error);
    err.toString().should.equal('Error: invalid module');
    return done();
  });

  const alert = sparkAlert.getAlerter('test1');

  invalidAlerts.forEach((invalidAlert) => {
    it(`error raising alert, ${invalidAlert.description}`, (done) => {
      const err = alert.raise(invalidAlert.data);
      err.should.be.instanceof(Error);
      err.toString().should.equal(invalidAlert.result);
      return done();
    });
  });

  it('successfully raise first alert', (done) => {
    sparkAlert.on('raised', (machine, alertObj) => {
      machine.should.equal('test1');
      alertObj.should.eql(validAlerts[0]);
      sparkAlert.removeAllListeners('raised');
      return done();
    });

    alert.raise(validAlerts[0]);
  });

  it('get all alerts - 1 alert', (done) => {
    sparkAlert.getAlerts((err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.length.should.equal(1);
      result[0].key.should.equal(validAlerts[0].key);
      result[0].msg.should.equal(validAlerts[0].msg);
      result[0].description.should.equal(validAlerts[0].description);
      return done();
    });
  });

  it('successfully raise second alert', (done) => {
    sparkAlert.on('raised', (machine, alertObj) => {
      machine.should.equal('test1');
      alertObj.should.eql(validAlerts[1]);
      sparkAlert.removeAllListeners('raised');
      return done();
    });

    alert.raise(validAlerts[1]);
  });

  it('get all 1st module alerts - 2 alerts', (done) => {
    sparkAlert.getAlerts('test1', (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.length.should.equal(2);
      result[0].key.should.equal(validAlerts[0].key);
      result[0].msg.should.equal(validAlerts[0].msg);
      result[0].description.should.equal(validAlerts[0].description);
      result[1].key.should.equal(validAlerts[1].key);
      result[1].msg.should.equal(validAlerts[1].msg);
      result[1].description.should.equal(validAlerts[1].description);
      return done();
    });
  });

  const alert2 = sparkAlert.getAlerter('test2');
  it('successfully raise 2nd modules alert', (done) => {
    sparkAlert.on('raised', (machine, alertObj) => {
      machine.should.equal('test2');
      alertObj.should.eql(validAlerts[2]);
      sparkAlert.removeAllListeners('raised');
      return done();
    });

    alert2.raise(validAlerts[2]);
  });

  it('get alerts count should return 3 alerts', (done) => {
    sparkAlert.getAlertsCount((err, result) => {
      if (err) return done(err);
      result.should.equal(3);
      return done();
    });
  });

  it('get "test1" alerts count should return 2 alerts', (done) => {
    sparkAlert.getAlertsCount('test1', (err, result) => {
      if (err) return done(err);
      result.should.equal(2);
      return done();
    });
  });

  it('get all alerts - 3 alerts', (done) => {
    sparkAlert.getAlerts((err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.length.should.equal(3);
      result[0].key.should.equal(validAlerts[0].key);
      result[0].msg.should.equal(validAlerts[0].msg);
      result[0].description.should.equal(validAlerts[0].description);
      result[1].key.should.equal(validAlerts[1].key);
      result[1].msg.should.equal(validAlerts[1].msg);
      result[1].description.should.equal(validAlerts[1].description);
      result[2].key.should.equal(validAlerts[2].key);
      result[2].msg.should.equal(validAlerts[2].msg);
      result[2].description.should.equal(validAlerts[2].description);
      return done();
    });
  });

  it('clear should fail with invalid key', (done) => {
    const err = alert.clear();
    err.should.be.instanceof(Error);
    err.toString().should.equal('Error: invalid key');
    return done();
  });

  it('clear should fail with invalid key', (done) => {
    const err = alert.clear('');
    err.should.be.instanceof(Error);
    err.toString().should.equal('Error: invalid key');
    return done();
  });

  it('clear should fail with invalid key', (done) => {
    const err = alert.clear(x => x);
    err.should.be.instanceof(Error);
    err.toString().should.equal('Error: invalid key');
    return done();
  });

  it('successfully clear first alert', (done) => {
    sparkAlert.on('cleared', (machine, alertKey) => {
      machine.should.equal('test1');
      alertKey.should.equal(validAlerts[0].key);
      sparkAlert.removeAllListeners('cleared');
      return done();
    });

    alert.clear(validAlerts[0].key);
  });

  it('get all alerts - 2 alerts', (done) => {
    sparkAlert.getAlerts((err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.length.should.equal(2);
      result[0].key.should.equal(validAlerts[1].key);
      result[0].msg.should.equal(validAlerts[1].msg);
      result[0].description.should.equal(validAlerts[1].description);
      result[1].key.should.equal(validAlerts[2].key);
      result[1].msg.should.equal(validAlerts[2].msg);
      result[1].description.should.equal(validAlerts[2].description);
      return done();
    });
  });

  it('successfully clear 1st modules alerts', (done) => {
    sparkAlert.on('cleared', (machine, alertKey) => {
      machine.should.equal('test1');
      alertKey.should.equal(validAlerts[1].key);
      sparkAlert.removeAllListeners('cleared');
      return done();
    });

    sparkAlert.clearAlerts('test1', (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('get all alerts - 1 alert', (done) => {
    sparkAlert.getAlerts((err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.length.should.equal(1);
      result[0].key.should.equal(validAlerts[2].key);
      result[0].msg.should.equal(validAlerts[2].msg);
      result[0].description.should.equal(validAlerts[2].description);
      return done();
    });
  });

  it('successfully clear third alert', (done) => {
    sparkAlert.on('cleared', (machine, alertKey) => {
      machine.should.equal('test2');
      alertKey.should.equal(validAlerts[2].key);
      sparkAlert.removeAllListeners('cleared');
      return done();
    });

    alert2.clearAll((err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('get all alerts - no alerts', (done) => {
    sparkAlert.getAlerts((err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.length.should.equal(0);
      return done();
    });
  });

  it('preLoad alerts should succeed', (done) => {
    alert.preLoad(_.keyBy(validAlerts, 'key'));
    return done();
  });

  it('successfully raise a preloaded alert', (done) => {
    alert.raise({
      key: validAlerts[0].key,
    });
    return done();
  });

  it('get all alerts - 1 alert', (done) => {
    sparkAlert.getAlerts((err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.length.should.equal(1);
      result[0].key.should.equal(validAlerts[0].key);
      result[0].msg.should.equal(validAlerts[0].msg);
      result[0].description.should.equal(validAlerts[0].description);
      return done();
    });
  });

  it('successfully clear first alert', (done) => {
    sparkAlert.on('cleared', (machine, alertKey) => {
      machine.should.equal('test1');
      alertKey.should.equal(validAlerts[0].key);
      sparkAlert.removeAllListeners('cleared');
      return done();
    });

    alert.clear(validAlerts[0].key);
  });

  it('successfully raise an alert with a template literal', (done) => {
    const alertData = {
      key: 'template-literal-alert',
      msg: 'my message',
      description: x => `my description someValue = ${x.someValue + 3}`,
      someValue: 7,
    };

    sparkAlert.on('raised', (machine, alertObj) => {
      machine.should.equal('test1');
      alertObj.key.should.eql(alertData.key);
      alertObj.msg.should.eql(alertData.msg);
      alertObj.description.should.eql('my description someValue = 10');
      sparkAlert.removeAllListeners('raised');
      return done();
    });

    alert.raise(alertData);
  });

  it('get all alerts - 1 alert', (done) => {
    sparkAlert.getAlerts((err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.length.should.equal(1);
      result[0].key.should.equal('template-literal-alert');
      result[0].msg.should.equal('my message');
      result[0].description.should.equal('my description someValue = 10');
      return done();
    });
  });

  it('successfully clear first alert', (done) => {
    sparkAlert.on('cleared', (machine, alertKey) => {
      machine.should.equal('test1');
      alertKey.should.equal('template-literal-alert');
      sparkAlert.removeAllListeners('cleared');
      return done();
    });

    alert.clear('template-literal-alert');
  });

  it('successfully raise then immediately clear an alert', async () => {
    // test only the cleared event is emitted

    const raised = () => new Promise((resolve, reject) => {
      sparkAlert.on('raised', () => {
        reject(new Error('raised event should not be emitted'));
      });

      setTimeout(() => {
        // wait 1 second to check the raised event is not emitted
        sparkAlert.removeAllListeners('raised');
        resolve();
      }, 1000);
    });

    const cleared = () => new Promise((resolve) => {
      sparkAlert.on('cleared', (machine, alertKey) => {
        machine.should.equal('test1');
        alertKey.should.equal('client-error');
        sparkAlert.removeAllListeners('cleared');
        resolve();
      });
    });

    alert.preLoad({
      'client-error': {
        msg: 'Omron: Error From Client',
        description: x => `An error was received from the client. Error: ${x.errorMsg}`,
      },
    });
    alert.raise({
      key: 'client-error',
      errorMsg: 'There was an error',
    });
    alert.clear('client-error');

    await cleared();
    await raised();
  });

  it('stop should succeed when started', (done) => {
    sparkAlert.stop((err) => {
      if (err) done(err);
      return done();
    });
  });
});
