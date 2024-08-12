require('chai').should();
const bunyan = require('bunyan');
const pkg = require('../package.json');
const sparkHardwareDetect = require('../index.js');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'DEBUG',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const modules = {
  'spark-config': {
    exports: {
      set(key, value, done) {
        log.debug({
          key,
          value,
        });
        return done(null);
      },
      get(key) {
        log.debug({
          key,
        });
        return null;
      },
      clear(key, done) {
        log.debug({
          key,
        });
        return done(null);
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

describe('Spark Hardware Detect', () => {
  it('require should succeed', (done) => {
    const result = sparkHardwareDetect.require();
    result.should.be.instanceof(Array);
    result.should.eql(['spark-config', 'spark-logging']);
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHardwareDetect.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-hardware-detect');
      return done();
    });
  });

  it('wait for hardwarePollTimer', function waitForhardwarePollTimer(done) {
    this.timeout(15 * 1000);
    setTimeout(() => done(), 12 * 1000);
  });

  it('getCurrentHardware should succeed', (done) => {
    const currentHardware = sparkHardwareDetect.getCurrentHardware();
    currentHardware.should.be.instanceof(Object);
    return done();
  });

  it('stop should succeed when started', (done) => {
    sparkHardwareDetect.stop((err) => {
      if (err) done(err);
      return done();
    });
  });
});
