/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const _ = require('lodash');
const bunyan = require('bunyan');
const moment = require('moment');
const request = require('supertest');
const sparkGrafana = require('../index.js');
const pkg = require('../package.json');

const agent = request.agent(sparkGrafana.app);

const log = bunyan.createLogger({
  name: pkg.name,
  level: process.env.LOG_LEVEL || 'WARN',
  src: true,
});

const conf = {
  protocols: {
    'spark-protocol-grafana': {
      settings: {
        model: {
          enable: false,
          grafanaPort: 1880,
          filterVariables: false,
        },
      },
    },
  },
  machines: {
    machine1: {
      info: {
        name: 'machine1',
        description: 'machine 1',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'float',
          format: 'float',
          value: 12345.0,
        },
        {
          name: 'int16',
          format: 'int16',
          allowFiltering: false,
          value: 123,
        },
        {
          name: 'int32Array',
          format: 'int32',
          allowFiltering: false,
          array: true,
          value: [1234, 2345, 3456],
        },
        {
          name: 'char',
          format: 'char',
          allowFiltering: true,
          value: 'ABCDE',
        },
      ],
    },
    machine2: {
      info: {
        name: 'machine2',
        description: 'machine 2',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'float',
          format: 'float',
          value: 23456.0,
        },
        {
          name: 'int16',
          format: 'int16',
          allowFiltering: false,
          value: 234,
        },
        {
          name: 'int32Array',
          format: 'int32',
          allowFiltering: false,
          array: true,
          value: [4567, 5678, 6789],
        },
        {
          name: 'char',
          format: 'char',
          allowFiltering: true,
          value: 'BCDEF',
        },
      ],
    },
  },
};

const sparkdb = new EventEmitter();
sparkdb.db = {};
sparkdb.add = function add(_data, done) {
  const now = moment();
  const data = _data;
  data.createdAt = now.format('x');
  const { machine, variable } = data;
  _.set(sparkdb.db, [machine, variable], data);
  sparkdb.emit('added', [machine, variable]);
  if (done) { return done(null, data); }
  return data;
};
sparkdb.get = function get(key, done) {
  const data = _.get(sparkdb.db, key);
  const err = _.get(data, 'err', null);
  return done(err, _.get(data, 'result', data));
};
sparkdb.getLatest = function getLatest(machine, variable, done) {
  const data = _.get(sparkdb.db, [machine, variable]);
  const err = _.get(data, 'err', null);
  return done(err, _.get(data, 'result', data));
};

const sparkConfig = new EventEmitter();
sparkConfig.set = function set(key, value, done) {
  log.debug({ key, value }, 'conf.set');
  _.set(conf, key.split(':'), _.cloneDeep(value));
  sparkConfig.emit('set', key);
  if (done) return done(null);
  return undefined;
};
sparkConfig.get = function get(key, cb) {
  const value = _.cloneDeep(_.get(conf, key.split(':')));
  log.debug({ key, value }, 'conf.get');
  if (!cb) {
    return value;
  }
  return cb(null, value);
};

const sparkAlert = new EventEmitter();
sparkAlert.getAlerter = function getAlerter() {
  return {
    clearAll(done) {
      return done(null);
    },
    preLoad() {},
    raise(data) {
      log.debug({ data }, 'Raised alert');
      sparkAlert.emit('raise', data);
    },
    clear(key) {
      log.debug({ key }, 'Cleared alert');
    },
  };
};

const sparkLog = new EventEmitter();
sparkLog.getLogger = function getLogger() {
  return {
    trace(msg) {
      sparkLog.emit('trace', msg);
    },
    debug(msg) {
      sparkLog.emit('debug', msg);
    },
    info(msg) {
      sparkLog.emit('info', msg);
    },
    warn(msg) {
      sparkLog.emit('warn', msg);
    },
    error(msg) {
      sparkLog.emit('error', msg);
    },
  };
};

const modules = {
  'spark-logging': {
    exports: sparkLog,
  },
  'spark-db': {
    exports: sparkdb,
  },
  'spark-alert': {
    exports: sparkAlert,
  },
  'spark-config': {
    exports: sparkConfig,
  },
};

function addVariablesToDb() {
  _.forEach(conf.machines, (machine) => {
    const machineName = machine.info.name;
    _.forEach(machine.variables, (variable) => {
      const data = {
        machine: machineName,
        variable: variable.name,
      };
      data[variable.name] = variable.value;
      sparkdb.add(data);
    });
  });
}

addVariablesToDb();

describe('Spark Protocol Grafana', () => {
  it('require should succeed', (done) => {
    const result = sparkGrafana.require();
    result.should.be.instanceof(Array);
    result.should.eql(['spark-logging', 'spark-db', 'spark-alert', 'spark-config']);
    return done();
  });

  it('stop should error when not started', (done) => {
    sparkGrafana.stop((err, result) => {
      if (result) throw new Error('result should not be set');
      if (!err) throw new Error('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkGrafana.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.equal(pkg.name);
      return done();
    });
  });

  it('start should error when already started', (done) => {
    sparkGrafana.start(modules, (err, result) => {
      if (result) throw new Error('result should not be set');
      if (!err) throw new Error('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('stop should succeed when started', (done) => {
    sparkGrafana.stop((err) => {
      if (err) throw err;
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    conf.protocols['spark-protocol-grafana'].settings.model.enable = true;
    sparkGrafana.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.equal(pkg.name);
      return done();
    });
  });

  it('a post to / should return 200', (done) => {
    agent.post('/')
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });

  it('a post to /search should return all machine:variable targets', (done) => {
    agent.post('/search')
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const targets = [];
        _.forEach(conf.machines, (machine) => {
          const machineName = machine.info.name;
          _.forEach(machine.variables, (variable) => {
            targets.push(`${machineName}:${variable.name}`);
          });
        });

        res.body.should.be.instanceof(Object);
        res.body.should.eql(targets);
        return done();
      });
  });

  _.forEach(conf.machines, (machine) => {
    const machineName = machine.info.name;
    it(`a post to /query should return the values of all variables in machine ${machineName}`, (done) => {
      const body = { targets: [] };
      const values = {};
      _.forEach(machine.variables, (variable) => {
        const target = `${machineName}:${variable.name}`;
        body.targets.push(
          {
            target,
            type: 'timeserie',
          },
        );
        values[target] = variable.value;
      });
      const now = Date.now();
      agent.post('/query')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          const targets = [];
          _.forEach(conf.machines, (targetMachine) => {
            const targetMachineName = targetMachine.info.name;
            _.forEach(targetMachine.variables, (variable) => {
              targets.push(`${targetMachineName}:${variable.name}`);
            });
          });
          res.body.should.be.instanceof(Object);
          _.forEach(res.body, (bodyObj) => {
            const value = values[bodyObj.target];
            if (_.isArray(value)) {
              for (let iVal = 0; iVal < value.length; iVal += 1) {
                bodyObj.datapoints[iVal][0].should.equal(value[iVal]);
                bodyObj.datapoints[iVal][1].should.within(now, now + 1000);
              }
            } else {
              bodyObj.datapoints[0][0].should.equal(value);
              bodyObj.datapoints[0][1].should.within(now, now + 1000);
            }
          });
          return done();
        });
    });
  });

  it('stop should succeed when started', (done) => {
    sparkGrafana.stop((err) => {
      if (err) throw err;
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    conf.protocols['spark-protocol-grafana'].settings.model.filterVariables = true;
    sparkGrafana.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.equal(pkg.name);
      return done();
    });
  });

  it('a post to /search should return all unfiltered machine:variable targets', (done) => {
    agent.post('/search')
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        const targets = [];
        _.forEach(conf.machines, (machine) => {
          const machineName = machine.info.name;
          _.forEach(machine.variables, (variable) => {
            if (!_.get(variable, 'allowFiltering', false)) {
              targets.push(`${machineName}:${variable.name}`);
            }
          });
        });

        res.body.should.be.instanceof(Object);
        res.body.should.eql(targets);
        return done();
      });
  });

  it('changing a variable should update its machine', (done) => {
    sparkLog.on('info', (data) => {
      data.should.include('Updating Machine:');
      sparkLog.removeAllListeners('info');
      return done();
    });
    sparkConfig.set('machines:machine2:variables', conf.machines.machine1.variables);
  });

  it('disabling a machine should cause it to be removed', (done) => {
    sparkLog.on('info', (data) => {
      data.should.include('Removing Machine:');
      sparkLog.removeAllListeners('info');
      return done();
    });
    sparkConfig.set('machines:machine2:settings:model:enable', false);
  });

  it('enabling a machine should cause it to be added', (done) => {
    sparkLog.on('info', (data) => {
      data.should.include('Adding Machine:');
      sparkLog.removeAllListeners('info');
      return done();
    });
    sparkConfig.set('machines:machine2:settings:model:enable', true);
  });

  it('changing a protocol setting should cause a restart request', (done) => {
    sparkGrafana.on('restartRequest', (data) => {
      data.should.equal(pkg.name);
      sparkGrafana.removeAllListeners('restartRequest');
      return done();
    });
    sparkConfig.set('protocols:spark-protocol-grafana:settings:model:filterVariables', false);
  });
});
