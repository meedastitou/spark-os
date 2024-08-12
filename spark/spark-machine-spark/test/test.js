/*jshint esversion: 6 */
require('chai').should();
const EventEmitter = require('events').EventEmitter;
const pkg = require('../package.json');
const sparkMachineSpark = require('../index.js');
const bunyan = require('bunyan');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const conf = {
  machines: {
    'spark-machine-spark': {
      settings: {
        model: {
          enable: true,
        },
      },
    },
    'settings-missing': {
      value: 7,
    },
    'model-missing': {
      settings: {
        value: 7,
      },
    },
    'enable-missing': {
      settings: {
        model: {
          value: 7,
        },
      },
    },
    'enabled-machine': {
      settings: {
        model: {
          enable: true,
        },
      },
    },
    'disabled-machine': {
      settings: {
        model: {
          enable: false,
        },
      },
    },
  },
};

const sparkAlert = new EventEmitter();
const alerts = [];
sparkAlert.getAlertsCount = function getAlertsCount(machine, done) {
  return done(null, alerts.length);
};
sparkAlert.listeners = function listeners(listener) {
  return [];
};
sparkAlert.on = function on(ev, callback) {
  callback('spark-machine-spark', {key: 'test-alert', msg: 'test-msg'});
};
const sparkHWDetect = new EventEmitter();
sparkHWDetect.listeners = function listeners(listener) {
  return [];
};
sparkHWDetect.on = function on(ev, callback) {
};
sparkHWDetect.mountDir = '';
var enabledMachines = [];

const modules = {
  'spark-config': {
    exports: {
      set(key, value, done) {
        log.debug(key, value);
        if (done) return done(null);
        return undefined;
      },
      get(key, cb) {
        const path = key.split(':');
        let target = conf;

        let err = null;
        while (path.length > 0) {
          const k = path.shift();
          if (target && {}.hasOwnProperty.call(target, k)) {
            target = target[k];
          } else {
            err = 'undefined';
          }
        }

        const value = target;

        if (!cb) {
          return value;
        }
        return cb(err, value);
      },
      listeners() {
        return {
          indexOf() {
            return -1;
          },
        };
      },
      removeListener() {

      },
      on(ev, callback) {
        setTimeout(function() {
          callback('machines:spark-machine-spark:settings:model:enable');
          callback('machines:spark-machine-wasabi:settings:model:enable');
        }, 10);
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
  'spark-db': {
    exports: {
      add(data, done) {
        if (data.hasOwnProperty('enabled-machines')) {
          enabledMachines = data['enabled-machines'];
        }
        log.debug(data);
        return done(null);
      },
    },
  },
  'spark-alert': {
    exports: sparkAlert,
  },
  'spark-hardware-detect': {
    exports: sparkHWDetect,
  }
};

describe('Spark Machine Spark', () => {
  it('require should return array of requirements', (done) => {
    sparkMachineSpark.require().should.be.instanceof(Array);
    return done();
  });

  // NOTE: This test removed so that test in index.js can be removed - it causes a problem: spark-plugin stops machines that are already stopped
  // it('stop should error when not started', (done) => {
  //   sparkMachineSpark.stop((err) => {
  //     if (!err) done('err not set');
  //     err.should.be.instanceof(Error);
  //     err.toString().should.equal('Error: not started');
  //     return done();
  //   });
  // });

  it('start should succeed when passed valid inputs', (done) => {
    sparkMachineSpark.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-machine-spark');
      setTimeout(function () {
        return done();
      }, 100);
    });
  });

  it('spark-machine-wasabi should have been added to the enabled machines', (done) => {
    enabledMachines.indexOf('spark-machine-wasabi').should.not.equal(-1);
    return done();
  });

  it('start should error when already started', (done) => {
    sparkMachineSpark.start(modules, (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: already started');
      return done();
    });
  });

  it('stop should succeed when started', (done) => {
    sparkMachineSpark.stop((err) => {
      if (err) done('err should not be set');
      return done();
    });
  });
});
