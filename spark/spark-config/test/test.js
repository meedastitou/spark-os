require('chai').should();
const sparkConfig = require('../index.js');

sparkConfig.namespace = 'sparkconfigtest';

const modules = {};
const DEFAULT_REDIS_URL = process.env.DEFAULT_REDIS_URL || 'redis://localhost:6379/0';

describe('Spark Config', () => {
  it('require should return array of requirements', (done) => {
    const result = sparkConfig.require();
    result.should.be.instanceof(Array);
    result.length.should.equal(0);
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkConfig.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-config');
      return done();
    });
  });

  it('stop should succeed', (done) => {
    sparkConfig.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('start should succeed with invalid REDIS_URL', (done) => {
    process.env.REDIS_URL = 'a://b';
    sparkConfig.defaultConf = './test/defaultConf.js';
    sparkConfig.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-config');
      return done();
    });
  });

  it('stop should succeed', (done) => {
    sparkConfig.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('start should succeed with valid REDIS_URL', (done) => {
    process.env.REDIS_URL = DEFAULT_REDIS_URL;
    sparkConfig.defaultConf = './test/defaultConf.js';
    sparkConfig.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-config');
      return done();
    });
  });

  it('set should succeed', (done) => {
    sparkConfig.set('machines:mymachine:enable', true, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('get should succeed', (done) => {
    sparkConfig.get('machines:mymachine:enable', (err, result) => {
      if (err) return done(err);
      result.should.equal(true);
      return done();
    });
  });

  it('get (not callback) should succeed', (done) => {
    const result = sparkConfig.get('NODE_ENV');
    result.should.equal('test');
    return done();
  });

  it('get of undefined value should succeed', (done) => {
    sparkConfig.get('don not exist', (err, result) => {
      if (err) return done(err);
      if (result) return done(result);
      return done();
    });
  });

  it('set should succeed', (done) => {
    sparkConfig.set('machines:mymachine:config', {
      value: 1,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('get should succeed', (done) => {
    sparkConfig.get('machines', (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Object);
      result.should.contain.keys('mymachine');
      result.mymachine.should.contain.keys('enable', 'config');
      result.mymachine.enable.should.contain.equal(true);
      result.mymachine.config.should.contain.keys('value');
      result.mymachine.config.value.should.equal(1);
      return done();
    });
  });

  it('clear existing item should succeed', (done) => {
    sparkConfig.clear('machines:mymachine:config', (err) => {
      if (err) return done(err);
      return done();
    });
  });

  const config = {
    enable: true,
    info: {
      name: 'My Machine',
      description: 'This is My Machine.  There are many like it, but this one is mine.',
    },
    variables: [{
      name: 'temperature',
      description: 'Current temperature',
      protocol: {
        opcua: {
          path: 'Temp',
          type: 'Double',
        },
        mqtt: {
          topic: '/temp',
        },
      },
    }, {
      name: 'pressure',
      description: 'Current pressure',
      protocol: {
        opcua: {
          path: 'Pressure',
          type: 'Double',
        },
        mqtt: {
          topic: '/pressure',
        },
      },
    }],
  };

  it('set existing item should succeed', (done) => {
    sparkConfig.on('set', (k) => {
      k.should.equal('machines:mymachine:config:variables');
      sparkConfig.removeAllListeners('set');
      return done();
    });

    sparkConfig.set('machines:mymachine:config', config, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('get should return updated item', (done) => {
    sparkConfig.get('machines', (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Object);
      result.should.contain.keys('mymachine');
      result.mymachine.should.have.all.keys('enable', 'config');
      result.mymachine.enable.should.contain.equal(true);
      result.mymachine.config.should.have.all.keys('enable', 'info', 'variables');
      result.mymachine.config.enable.should.equal(config.enable);
      result.mymachine.config.info.should.eql(config.info);
      result.mymachine.config.variables.should.eql(config.variables);
      return done();
    });
  });

  it('getFiltered should succeed', (done) => {
    sparkConfig.getFiltered('machines', (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Object);
      result.should.contain.keys('mymachine');
      result.mymachine.should.have.all.keys('enable', 'config');
      result.mymachine.enable.should.contain.equal(true);
      result.mymachine.config.should.have.all.keys('enable', 'info', 'variables');
      result.mymachine.config.enable.should.equal(config.enable);
      result.mymachine.config.info.should.eql(config.info);
      result.mymachine.config.variables.should.eql(config.variables);
      return done();
    });
  });

  it('getFiltered with filter should succeed', (done) => {
    sparkConfig.getFiltered('machines', ['variables', 'info.name'], (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Object);
      result.should.contain.keys('mymachine');
      result.mymachine.should.have.all.keys('enable', 'config');
      result.mymachine.enable.should.contain.equal(true);
      result.mymachine.config.should.have.all.keys('enable', 'info');
      result.mymachine.config.enable.should.equal(config.enable);
      result.mymachine.config.info.should.have.all.keys('description');
      result.mymachine.config.info.description.should.equal(config.info.description);
      return done();
    });
  });

  it('getFiltered with all keys filtered should succeed', (done) => {
    sparkConfig.getFiltered('machines', ['variables', 'info', 'enable'], (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Object);
      Object.keys(result).length.should.equal(0);
      return done();
    });
  });

  it('getFiltered with all keys filtered should succeed', (done) => {
    sparkConfig.getFiltered('doesntexit', [], (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Object);
      Object.keys(result).length.should.equal(0);
      return done();
    });
  });

  it('getFiltered with all keys filtered should succeed', (done) => {
    sparkConfig.getFiltered('machines:mymachine', (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Object);
      result.should.have.all.keys('enable', 'config');
      result.enable.should.contain.equal(true);
      result.config.should.have.all.keys('enable', 'info', 'variables');
      result.config.enable.should.equal(config.enable);
      result.config.info.should.eql(config.info);
      result.config.variables.should.eql(config.variables);
      return done();
    });
  });

  it('clear existing item should succeed', (done) => {
    sparkConfig.clear('machines', (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('stop should succeed', (done) => {
    sparkConfig.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });
});
