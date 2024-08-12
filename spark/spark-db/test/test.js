require('chai').should();
const { expect } = require('chai');
const bunyan = require('bunyan');
const IoRedis = require('ioredis');
const pkg = require('../package.json');
const sparkDb = require('../index.js');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const machine = 'Spark Dummy Machine';

const conf = {
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379/0',
};

const redis = new IoRedis(conf.REDIS_URL);

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

describe('Spark DB', () => {
  sparkDb.expireTimeSec = 5;

  sparkDb.on('expired', (key) => {
    log.debug('Expired', key);
  });

  it('require should return array of requirments', (done) => {
    sparkDb.require().should.be.instanceof(Array);
    return done();
  });

  it('stop should error when not started', (done) => {
    sparkDb.stop((err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: not started');
      return done();
    });
  });

  it('add should error when not started', (done) => {
    sparkDb.add({
      temperature: 1,
    }, (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: not started');
      return done();
    });
  });

  it('set should error when not started', (done) => {
    sparkDb.set({
      machine: 'test',
      variable: 'count',
      access: 'persist',
    }, (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: not started');
      return done();
    });
  });

  it('deleteAll should error when not started', (done) => {
    sparkDb.deleteAll(machine, (err) => {
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: not started');
      return done();
    });
  });

  it('getMachines error when not started', (done) => {
    sparkDb.getMachines((err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: not started');
      return done();
    });
  });

  it('getLatest error when not started', (done) => {
    sparkDb.getLatest(machine, 'temperature', (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: not started');
      return done();
    });
  });

  it('getAll error when not started', (done) => {
    sparkDb.getAll(machine, (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: not started');
      return done();
    });
  });

  it('get error when not started', (done) => {
    sparkDb.get(`machine:${machine}:read:data:1`, (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: not started');
      return done();
    });
  });

  it('delete error when not started', (done) => {
    sparkDb.delete(`machine:${machine}:data:1`, (err) => {
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: not started');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkDb.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-db');
      return done();
    });
  });

  it('start should error when already started', (done) => {
    sparkDb.start(modules, (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('getLatest should return an empty object when no data has been added', (done) => {
    sparkDb.getLatest(machine, 'temperature', (err, result) => {
      if (err) return done(err);
      result.should.eql({});
      return done();
    });
  });

  it('add should fail with missing machine', (done) => {
    sparkDb.add({
      temperature: 1,
    }, (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('add should succeed', (done) => {
    sparkDb.on('added', (key) => {
      key.should.equal('machine:Spark Dummy Machine:read:data:1');

      sparkDb.get(key, (err, result) => {
        expect(err).to.equal(null);
        result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'temperature');
        result.machine.should.equal(machine);
        result.temperature.should.equal(1);
        result.access.should.equal('read');
        sparkDb.removeAllListeners('added');
        return done();
      });
    });

    sparkDb.add({
      machine,
      temperature: 1,
    }, (err, result) => {
      if (err) return done(err);
      result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'temperature');
      result.machine.should.equal(machine);
      result.temperature.should.equal(1);
      result.access.should.equal('read');
      return undefined;
    });
  });

  it('add (write) should succeed', (done) => {
    sparkDb.on('write-added', (key) => {
      key.should.equal('machine:Spark Dummy Machine:write:data:1');

      sparkDb.get(key, (err, result) => {
        expect(err).to.equal(null);
        result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'temperature');
        result.machine.should.equal(machine);
        result.temperature.should.equal(100);
        result.access.should.equal('write');
        sparkDb.removeAllListeners('write-added');
        return done();
      });
    });

    sparkDb.add({
      machine,
      temperature: 100,
      access: 'write',
    }, (err, result) => {
      if (err) return done(err);
      result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'temperature');
      result.machine.should.equal(machine);
      result.temperature.should.equal(100);
      result.access.should.equal('write');
      return undefined;
    });
  });

  it('set should fail if access not persist', (done) => {
    sparkDb.set({
      machine,
      variable: 'count',
      access: 'read',
    }, (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      err.toString().should.equal('Error: only persisent data may be set');
      return done();
    });
  });

  it('set should fail with missing machine', (done) => {
    sparkDb.set({
      variable: 'count',
      access: 'persist',
    }, (err, result) => {
      if (result) done('result should not be set');
      if (!err) done('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('set should succeed', (done) => {
    sparkDb.on('added', (key) => {
      key.should.equal('machine:Spark Dummy Machine:persist:count');

      sparkDb.get(key, (err, result) => {
        expect(err).to.equal(null);
        result.should.have.all.keys('createdAt', 'machine', 'variable', 'access', 'count');
        result.machine.should.equal(machine);
        result.count.should.equal(100);
        result.access.should.equal('persist');
        sparkDb.removeAllListeners('added');
        return done();
      });
    });

    sparkDb.set({
      machine,
      variable: 'count',
      count: 100,
      access: 'persist',
    }, (err, result) => {
      if (err) return done(err);
      result.should.have.all.keys('createdAt', 'machine', 'variable', 'access', 'count');
      result.machine.should.equal(machine);
      result.count.should.equal(100);
      result.access.should.equal('persist');
      return undefined;
    });
  });

  it('getLatest should return the correct data', (done) => {
    sparkDb.getLatest(machine, 'temperature', (err, result) => {
      if (err) return done(err);
      result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'temperature');
      result.machine.should.equal(machine);
      result.temperature.should.equal(1);
      result.access.should.equal('read');
      return done();
    });
  });

  it('get should return the correct data', (done) => {
    sparkDb.get(`machine:${machine}:read:data:1`, (err, result) => {
      if (err) return done(err);
      result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'temperature');
      result.machine.should.equal(machine);
      result.temperature.should.equal(1);
      result.access.should.equal('read');
      return done();
    });
  });

  it('get (write) should return the correct data', (done) => {
    sparkDb.get(`machine:${machine}:write:data:1`, (err, result) => {
      if (err) return done(err);
      result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'temperature');
      result.machine.should.equal(machine);
      result.temperature.should.equal(100);
      result.access.should.equal('write');
      return done();
    });
  });

  it('get should return error for corrupt data', (done) => {
    /* corrupt the data */
    redis.set(`machine:${machine}:read:data:1`, 'i am not json', (e) => {
      if (e) return done(e);

      return sparkDb.get(`machine:${machine}:read:data:1`, (err, result) => {
        if (result) done('result should not be set');
        if (!err) done('err not set');
        err.should.be.instanceof(Error);
        return done();
      });
    });
  });

  it('delete should succeed', (done) => {
    sparkDb.delete(`machine:${machine}:read:data:1`, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('delete should succeed', (done) => {
    sparkDb.delete(`machine:${machine}:persist:count`, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('get should return the correct data', (done) => {
    sparkDb.get(`machine:${machine}:read:data:1`, (err, result) => {
      if (err) return done(err);
      expect(result).to.equal(null);
      return done();
    });
  });

  it('add should succeed', (done) => {
    sparkDb.on('added', (key) => {
      key.should.equal('machine:Spark Dummy Machine:read:data:2');

      sparkDb.get(key, (err, result) => {
        expect(err).to.equal(null);
        result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'temperature');
        result.machine.should.equal(machine);
        result.temperature.should.equal('2');
        result.access.should.equal('read');
        sparkDb.removeAllListeners('added');
        return done();
      });
    });

    sparkDb.add({
      machine,
      temperature: '2',
    }, (err, result) => {
      if (err) return done(err);
      result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'temperature');
      result.machine.should.equal(machine);
      result.temperature.should.equal('2');
      result.access.should.equal('read');
      return undefined;
    });
  });

  it('add should succeed', (done) => {
    sparkDb.on('added', (key) => {
      key.should.equal('machine:Spark Dummy Machine:read:data:3');

      sparkDb.get(key, (err, result) => {
        expect(err).to.equal(null);
        result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'pressure');
        result.machine.should.equal(machine);
        result.pressure.should.eql({
          value: 3,
        });
        result.access.should.equal('read');
        sparkDb.removeAllListeners('added');
        return done();
      });
    });

    sparkDb.add({
      machine,
      pressure: {
        value: 3,
      },
    }, (err, result) => {
      if (err) return done(err);
      result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'pressure');
      result.machine.should.equal(machine);
      result.pressure.should.eql({
        value: 3,
      });
      result.access.should.equal('read');
      return undefined;
    });
  });

  it('add should succeed', (done) => {
    sparkDb.on('added', (key) => {
      key.should.equal('machine:Spark Dummy Machine:read:data:4');

      sparkDb.get(key, (err, result) => {
        expect(err).to.equal(null);
        result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'pressure');
        result.machine.should.equal(machine);
        result.pressure.should.eql([4, 5, 6]);
        result.access.should.equal('read');
        sparkDb.removeAllListeners('added');
        return done();
      });
    });

    sparkDb.add({
      machine,
      pressure: [4, 5, 6],
    }, (err, result) => {
      if (err) return done(err);
      result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'pressure');
      result.machine.should.equal(machine);
      result.pressure.should.eql([4, 5, 6]);
      result.access.should.equal('read');
      return undefined;
    });
  });

  it('getLatest should return the correct data', (done) => {
    sparkDb.getLatest(machine, 'pressure', (err, result) => {
      if (err) return done(err);
      result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'pressure');
      result.machine.should.equal(machine);
      result.pressure.should.eql([4, 5, 6]);
      result.access.should.equal('read');
      return done();
    });
  });

  it('getLatest should return the correct data', (done) => {
    sparkDb.getLatest(machine, 'temperature', (err, result) => {
      if (err) return done(err);
      result.should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'temperature');
      result.machine.should.equal(machine);
      result.temperature.should.equal('2');
      result.access.should.equal('read');
      return done();
    });
  });

  it('getAll should return the correct data', (done) => {
    sparkDb.getAll(machine, (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.length.should.equal(3);
      result[0].should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'pressure');
      result[0].machine.should.equal(machine);
      result[0].pressure.should.eql([4, 5, 6]);
      result[0].access.should.equal('read');
      result[1].should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'pressure');
      result[1].machine.should.equal(machine);
      result[1].pressure.should.eql({
        value: 3,
      });
      result[1].access.should.equal('read');
      result[2].should.have.all.keys('_id', 'createdAt', 'machine', 'access', 'temperature');
      result[2].machine.should.equal(machine);
      result[2].temperature.should.equal('2');
      result[2].access.should.equal('read');
      return done();
    });
  });

  it('getMachines should return list of machines', (done) => {
    sparkDb.getMachines((err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.length.should.equal(1);
      result[0].should.equal(machine);
      return done();
    });
  });

  it('getAll should return no data after data expires', function testGetAllTimeout(done) {
    this.timeout(10000);
    setTimeout(() => {
      sparkDb.getAll(machine, (err, result) => {
        if (err) return done(err);
        result.should.be.instanceof(Array);
        result.length.should.equal(0);
        return done();
      });
    }, 5500);
  });

  it('set should succeed', (done) => {
    sparkDb.on('added', (key) => {
      key.should.equal('machine:Spark Dummy Machine:persist:count');

      sparkDb.get(key, (err, result) => {
        expect(err).to.equal(null);
        result.should.have.all.keys('createdAt', 'machine', 'variable', 'access', 'count');
        result.machine.should.equal(machine);
        result.count.should.equal(100);
        result.access.should.equal('persist');
        sparkDb.removeAllListeners('added');
        return done();
      });
    });

    sparkDb.set({
      machine,
      variable: 'count',
      count: 100,
      access: 'persist',
    }, (err, result) => {
      if (err) return done(err);
      result.should.have.all.keys('createdAt', 'machine', 'variable', 'access', 'count');
      result.machine.should.equal(machine);
      result.count.should.equal(100);
      result.access.should.equal('persist');
      return undefined;
    });
  });

  it('delete all should succeed', (done) => {
    sparkDb.deleteAll(machine, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('stop should succeed when started', (done) => {
    sparkDb.stop((err) => {
      if (err) done('err should not be set');
      return done();
    });
  });
});
