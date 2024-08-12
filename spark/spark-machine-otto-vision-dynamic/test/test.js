/* jshint esversion: 6 */
require('chai').should();
const fs = require('fs');
const net = require('net');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const pkg = require('../package.json');
const ottoVision = require('../index.js');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const TEST_PORT = 10000;
const MAX_PUBLISH_BUFFER_SIZE = (1024 * 1024);

const conf = {
  machines: {
    'spark-machine-otto-vision-dynamic': {
      settings: {
        model: {
          enable: true,
          port: TEST_PORT,
          deliverEntireResponse: false,
        },
      },
    },
  },
};

const sparkConfig = new EventEmitter();
sparkConfig.bReturnEmpty = false;
sparkConfig.set = function set(key, value, done) {
  log.debug({ key, value }, 'conf.set');

  sparkConfig.emit('set', key);

  const path = key.split(':');
  let target = conf;

  let k;
  while (path.length > 1) {
    k = path.shift();
    if (!(k in target)) {
      target[k] = {};
    }
    target = target[k];
  }
  k = path.shift();
  target[k] = value;

  log.debug(conf);

  if (done) return done(null);
  return undefined;
};

sparkConfig.get = function get(key, cb) {
  log.debug({ key }, 'conf.get');

  const path = key.split(':');
  let target = conf;

  let err = null;
  let k;
  while (path.length > 0) {
    k = path.shift();
    if (target && {}.hasOwnProperty.call(target, k)) {
      target = target[k];
    } else {
      err = 'undefined';
    }
  }

  const value = sparkConfig.bReturnEmpty ? {} : target;

  if (!cb) {
    return value;
  }
  return cb(err, value);
};

const sparkAlert = new EventEmitter();
sparkAlert.getAlerter = function getAlerter() {
  return {
    clearAll(done) {
      return done(null);
    },
    preLoad() {},
    raise(data) {
      sparkAlert.emit('raise', data);
    },
    clear(key) {
      sparkAlert.emit('clear', key);
    },
  };
};

const sparkDb = new EventEmitter();
sparkDb.add = function add(data, done) {
  log.debug(data);
  sparkDb.emit('added', data);
  return done(null);
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

describe('Spark Machine Otto Vision Dynamic', () => {
  it('require should return array of requirements', (done) => {
    const requireList = ottoVision.require();
    requireList.should.be.instanceof(Array);
    Object.keys(modules).sort().should.eql(requireList.sort());
    return done();
  });

  // NOTE: This test removed so that test in index.js can be removed -
  // it causes a problem: spark-plugin stops machines that are already stopped
  // it('stop should error when not started', (done) => {
  //   ottoVision.stop((err) => {
  //     if (!err) done('err not set');
  //     err.should.be.instanceof(Error);
  //     err.toString().should.equal('Error: not started');
  //     return done();
  //   });
  // });

  it('start should succeed when passed valid inputs', (done) => {
    ottoVision.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-machine-otto-vision-dynamic');
      return done();
    });
  });

  it('start should error when already started', (done) => {
    ottoVision.start(modules, (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: already started');
      return done();
    });
  });

  it('should raise an alert when invalid data is received', (done) => {
    let client;
    sparkAlert.on('raise', (data) => {
      data.key.should.equal('xml-parse-error');
      sparkAlert.removeAllListeners('raise');
      client.end();
      return done();
    });

    client = net.createConnection({
      port: TEST_PORT,
    }, () => {
      setTimeout(() => {
        client.write('this is xml honest<!--END-->');
        setTimeout(() => {
          client.write('this is xml honest<!--END-->');
          setTimeout(() => {
            client.write('this is xml honest<!--END-->');
          }, 100);
        }, 100);
      }, 100);
    });
  });

  it('valid xml should be processed correctly', (done) => {
    let client;
    sparkDb.on('added', (data) => {
      client.end();
      if (data.variable === 'timestamp') {
        sparkDb.removeAllListeners('added');
        return done();
      }
      return undefined;
    });
    client = net.createConnection({
      port: TEST_PORT,
    }, () => {
      client.write(fs.readFileSync('./test/otto-valid-data-1.xml'));
      setTimeout(() => {
        client.write(fs.readFileSync('./test/otto-valid-data-2.xml'));
      }, 100);
    });
  });

  it('writing too much data should raise a buffer overrun alert', (done) => {
    let client;
    sparkAlert.on('raise', (data) => {
      data.key.should.equal('buffer-overrun-error');
      sparkAlert.removeAllListeners('raise');
      client.end();
      return done();
    });
    const buffer = Buffer.allocUnsafe(MAX_PUBLISH_BUFFER_SIZE / 1024).fill('x');
    client = net.createConnection({
      port: TEST_PORT,
    }, () => {
      for (let iWrite = 0; iWrite < 1024; iWrite += 1) {
        client.write(buffer);
      }
      client.write(fs.readFileSync('./test/otto-valid-data-1.xml'));
    });
  });

  it('writing valid data should clear the buffer overrun alert', (done) => {
    let client;
    sparkAlert.on('clear', (key) => {
      if (key === 'buffer-overrun-error') {
        sparkAlert.removeAllListeners('clear');
        client.end();
        done();
      }
    });
    client = net.createConnection({
      port: TEST_PORT,
    }, () => {
      client.write(fs.readFileSync('./test/otto-valid-data-1.xml'));
    });
  });

  it('a configuration change should cause a restart request', (done) => {
    ottoVision.on('restartRequest', () => {
      ottoVision.removeAllListeners('restartRequest');
      sparkConfig.bReturnEmpty = false;
      return done();
    });
    sparkConfig.bReturnEmpty = true;
    sparkConfig.set('machines:spark-machine-otto-vision-dynamic:settings:model:deliverEntireResponse', true);
  });

  it('valid xml should be processed correctly for combined result', (done) => {
    let client;
    sparkDb.on('added', (data) => {
      client.end();
      if (data.variable === 'CombinedResult') {
        sparkDb.removeAllListeners('added');
        return done();
      }
      return undefined;
    });
    client = net.createConnection({
      port: TEST_PORT,
    }, () => {
      client.write(fs.readFileSync('./test/otto-valid-data-1.xml'));
    });
  });

  it('writing data with a duplicate variable should raise an alert', (done) => {
    let client;
    sparkAlert.on('raise', (data) => {
      data.key.should.equal('duplicate-variable-error-bladeWidthRearOut1');
      sparkAlert.removeAllListeners('raise');
      client.end();
      return done();
    });
    client = net.createConnection({
      port: TEST_PORT,
    }, () => {
      let xmlData = fs.readFileSync('./test/otto-valid-data-1.xml').toString();
      xmlData = xmlData.replace(new RegExp('Blade Width {2}Front out 1', 'g'), 'Blade Width  Rear out 1');
      client.write(xmlData);
    });
  });

  it('writing valid data should clear the duplicate variable alert', (done) => {
    let client;
    sparkAlert.on('clear', (key) => {
      if (key === 'duplicate-variable-error-bladeWidthRearOut1') {
        sparkAlert.removeAllListeners('clear');
        client.end();
        done();
      }
    });
    client = net.createConnection({
      port: TEST_PORT,
    }, () => {
      client.write(fs.readFileSync('./test/otto-valid-data-1.xml'));
    });
  });

  it('configuration change to disable should cause a restart request', (done) => {
    ottoVision.on('restartRequest', () => {
      ottoVision.removeAllListeners('restartRequest');
      sparkConfig.bReturnEmpty = false;
      return done();
    });
    sparkConfig.bReturnEmpty = true;
    sparkConfig.set('machines:spark-machine-otto-vision-dynamic:settings:model:enable', false);
  });

  //  it('a configuration change should cause a restart request', (done) => {
  //    ottoVision.on('restartRequest', () => {
  //      sparkConfig.bReturnEmpty = false;
  //      return done();
  //    });
  //    sparkConfig.bReturnEmpty = true;
  //    sparkConfig.set('machines:spark-machine-otto-vision-dynamic:settings:model:enable', false);
  //  });

  it('stop should succeed when started', (done) => {
    ottoVision.stop((err) => {
      if (err) done('err should not be set');
      return done();
    });
  });

  it('stop should succeed when stopped', (done) => {
    ottoVision.stop((err) => {
      if (err) done('err should not be set');
      return done();
    });
  });
});
