/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const sparkMachineDeviceInfo = require('../index.js');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const conf = {
  MACHINES_USER_DIR: './test/user',
  machines: {
    'spark-machine-deviceinfo': {
      info: {
        name: 'spark-machine-deviceinfo',
      },
      settings: {
        model: {
          enable: true,
        },
      },
    },
    'spark-hpl-test-1': {
      info: {
        name: 'spark-hpl-test-1',
        fullname: 'Test HPL 1',
        version: '0.0.1',
        genericNamespace: 'Stamping',
      },
      settings: {
        model: {
          enable: true,
        },
      },
    },
    'spark-machine-test-1': {
      info: {
        name: 'spark-machine-test-1',
        fullname: 'Test Machine 1',
        version: '0.0.1',
      },
      settings: {
        model: {
          enable: true,
        },
      },
    },
    'spark-hpl-test-2': {
      info: {
        name: 'spark-hpl-test-2',
        fullname: 'Test HPL 2',
        version: '0.0.1',
      },
      settings: {
        model: {
          enable: false,
        },
      },
    },
  },
};

const testAlert = { key: 'test-alert', msg: 'test-msg' };

const sparkAlert = new EventEmitter();
const alerts = [];
sparkAlert.getAlertsCount = function getAlertsCount(machineName, done) {
  return done(null, alerts.length);
};
sparkAlert.getAlerts = function getAlerts(machineName, done) {
  return done(null, alerts);
};
sparkAlert.raise = function raise(machineName, alert) {
  alerts.push(alert);
  sparkAlert.emit('raised', machineName, alert);
};
sparkAlert.clear = function raise(machineName, key) {
  _.remove(alerts, alert => alert.key === key);
  sparkAlert.emit('cleared', machineName, key);
};
sparkAlert.listeners = function listeners() {
  return [];
};

const sparkConfig = new EventEmitter();
sparkConfig.set = function set(key, value, done) {
  log.debug(key, value);
  if (done) return done(null);
  return undefined;
};
sparkConfig.get = function get(key, cb) {
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
};
sparkConfig.listeners = function listeners() {
  return {
    indexOf() {
      return -1;
    },
  };
};
sparkConfig.removeListener = function removeListener() {
};

const sparkDb = new EventEmitter();
sparkDb.add = function add(data, done) {
  log.debug(data);
  sparkDb.emit('added', data);
  return done(null, data);
};

const modules = {
  'spark-config': {
    exports: sparkConfig,
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
    exports: sparkDb,
  },
  'spark-alert': {
    exports: sparkAlert,
  },
};

describe('Spark Machine Spark', () => {
  it('require should return array of requirements', (done) => {
    sparkMachineDeviceInfo.require().should.be.instanceof(Array);
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkMachineDeviceInfo.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-machine-deviceinfo');
      setTimeout(() => done(), 100);
      return undefined;
    });
  });

  it('the deviceinfo variable should be published when a machine is enabled', (done) => {
    sparkDb.on('added', (data) => {
      data.deviceinfo.length.should.equal(3);
      data.machine.should.equal('spark-machine-deviceinfo');
      data.variable.should.equal('deviceinfo');
      data.deviceinfo[0].deviceName.should.equal(conf.machines['spark-hpl-test-1'].info.fullname);
      data.deviceinfo[0].deviceVersion.should.equal(conf.machines['spark-hpl-test-1'].info.version);
      data.deviceinfo[0].deviceStore.should.equal('user');
      data.deviceinfo[0].numberOfAlerts.should.equal(0);
      data.deviceinfo[0].deviceAlias.should.equal(conf.machines['spark-hpl-test-1'].info.genericNamespace);
      data.deviceinfo[1].deviceName.should.equal(conf.machines['spark-machine-test-1'].info.fullname);
      data.deviceinfo[1].deviceVersion.should.equal(conf.machines['spark-machine-test-1'].info.version);
      data.deviceinfo[1].deviceStore.should.equal('machine');
      data.deviceinfo[1].numberOfAlerts.should.equal(0);
      data.deviceinfo[2].deviceName.should.equal(conf.machines['spark-hpl-test-2'].info.fullname);
      data.deviceinfo[2].deviceVersion.should.equal(conf.machines['spark-hpl-test-2'].info.version);
      data.deviceinfo[2].deviceStore.should.equal('system');
      data.deviceinfo[2].numberOfAlerts.should.equal(0);
      sparkDb.removeAllListeners('added');
      return done();
    });
    conf.machines['spark-hpl-test-2'].settings.model.enable = true;
    sparkConfig.emit('set', 'machines:spark-hpl-test-2:settings:model:enable', true);
  });

  it('the deviceinfo variable should be published when an alert is raised', (done) => {
    sparkDb.on('added', (data) => {
      data.deviceinfo.length.should.equal(3);
      data.machine.should.equal('spark-machine-deviceinfo');
      data.variable.should.equal('deviceinfo');
      data.deviceinfo[0].deviceName.should.equal(conf.machines['spark-hpl-test-1'].info.fullname);
      data.deviceinfo[0].deviceVersion.should.equal(conf.machines['spark-hpl-test-1'].info.version);
      data.deviceinfo[0].deviceStore.should.equal('user');
      data.deviceinfo[0].numberOfAlerts.should.equal(1);
      data.deviceinfo[0].deviceAlias.should.equal(conf.machines['spark-hpl-test-1'].info.genericNamespace);
      sparkDb.removeAllListeners('added');
      return done();
    });
    sparkAlert.raise('spark-hpl-test-1', testAlert);
  });

  it('the deviceinfo variable should be published when an alert is cleared', (done) => {
    sparkDb.on('added', (data) => {
      data.deviceinfo.length.should.equal(3);
      data.machine.should.equal('spark-machine-deviceinfo');
      data.variable.should.equal('deviceinfo');
      data.deviceinfo[0].deviceName.should.equal(conf.machines['spark-hpl-test-1'].info.fullname);
      data.deviceinfo[0].deviceVersion.should.equal(conf.machines['spark-hpl-test-1'].info.version);
      data.deviceinfo[0].deviceStore.should.equal('user');
      data.deviceinfo[0].numberOfAlerts.should.equal(0);
      data.deviceinfo[0].deviceAlias.should.equal(conf.machines['spark-hpl-test-1'].info.genericNamespace);
      sparkDb.removeAllListeners('added');
      return done();
    });
    sparkAlert.clear('spark-hpl-test-1', testAlert.key);
  });

  it('the deviceinfo variable should be published when a machine is disabled', (done) => {
    sparkDb.on('added', (data) => {
      data.deviceinfo.length.should.equal(2);
      data.machine.should.equal('spark-machine-deviceinfo');
      data.variable.should.equal('deviceinfo');
      data.deviceinfo[0].deviceName.should.equal(conf.machines['spark-hpl-test-1'].info.fullname);
      data.deviceinfo[0].deviceVersion.should.equal(conf.machines['spark-hpl-test-1'].info.version);
      data.deviceinfo[0].deviceStore.should.equal('user');
      data.deviceinfo[0].numberOfAlerts.should.equal(0);
      data.deviceinfo[0].deviceAlias.should.equal(conf.machines['spark-hpl-test-1'].info.genericNamespace);
      sparkDb.removeAllListeners('added');
      return done();
    });
    conf.machines['spark-hpl-test-2'].settings.model.enable = false;
    sparkConfig.emit('set', 'machines:spark-hpl-test-2:settings:model:enable', false);
  });

  it('the deviceinfo variable should not be published when a change is made to this machine', (done) => {
    let deviceinfoAdded = false;
    sparkDb.on('added', () => {
      deviceinfoAdded = true;
      sparkDb.removeAllListeners('added');
    });
    conf.machines['spark-machine-deviceinfo'].settings.model.enable = false;
    sparkConfig.emit('set', 'machines:spark-machine-deviceinfo:settings:model:enable', false);
    setTimeout(() => {
      deviceinfoAdded.should.equal(false);
      return done();
    }, 100);
  });

  it('the deviceinfo variable should not be published when a change is made to a disabled machine', (done) => {
    let deviceinfoAdded = false;
    sparkDb.on('added', () => {
      deviceinfoAdded = true;
      sparkDb.removeAllListeners('added');
    });
    conf.machines['spark-hpl-test-2'].info.genericNamespace = 'Plating';
    sparkConfig.emit('set', 'machines:spark-hpl-test-2:info:genericNamespace', 'Plating');
    setTimeout(() => {
      deviceinfoAdded.should.equal(false);
      return done();
    }, 100);
  });

  it('the deviceinfo variable should not be published when a alert is raised on a disabled machine', (done) => {
    let deviceinfoAdded = false;
    sparkDb.on('added', () => {
      deviceinfoAdded = true;
      sparkDb.removeAllListeners('added');
    });
    sparkAlert.raise('spark-hpl-test-2', testAlert);
    setTimeout(() => {
      deviceinfoAdded.should.equal(false);
      return done();
    }, 100);
  });

  it('start should error when already started', (done) => {
    sparkMachineDeviceInfo.start(modules, (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: already started');
      return done();
    });
  });

  it('stop should succeed when started', (done) => {
    sparkMachineDeviceInfo.stop((err) => {
      if (err) done('err should not be set');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkMachineDeviceInfo.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-machine-deviceinfo');
      setTimeout(() => done(), 100);
      return undefined;
    });
  });
});
