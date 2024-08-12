/* jshint esversion: 6 */
require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');

const assert = require('assert');
const _ = require('lodash');
const moment = require('moment');
const bunyan = require('bunyan');
const sparkplugClient = require('../index.js');
const pkg = require('../package.json');

const log = bunyan.createLogger({
  name: pkg.name,
  level: process.env.LOG_LEVEL || 'WARN',
  src: true,
});

const overrideVariableNameBase = 'var';

const conf = {
  protocols: {
    'spark-protocol-sparkplug': {
      settings: {
        model: {
          enable: false,
          mqttServer1Hostname: '127.0.0.1',
          mqttServer1Port: 1883,
          mqttServer2Hostname: '127.0.0.1',
          mqttServer2Port: 1883,
          mqttServer3Hostname: '127.0.0.1',
          mqttServer3Port: 1883,
          mqttServer4Hostname: '127.0.0.1',
          mqttServer4Port: 1883,
          mqttServer5Hostname: '127.0.0.1',
          mqttServer5Port: 1883,
          username: 'ignition',
          password: '"ignition',
          groupId: 'Sparkplug B Devices',
          onChangeOnly: true,
          utcOffset: -4,
        },
      },
    },
  },
  machines: {
    machine1: {
      info: {
        name: 'machine1',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'int16Test',
          format: 'int16',
          outputFormat: 'int16',
          value: 1234,
        },
        {
          name: 'floatTest',
          format: 'float',
          value: 2345.0,
        },
        {
          name: 'boolTest',
          format: 'bool',
          value: true,
        },
        {
          name: 'charTest',
          format: 'char',
          value: 'ABCD',
        },
      ],
    },
    machine2: {
      info: {
        name: 'machine2',
        genericNamespace: 'machine2Namespace',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
          deliverEntireResponse: true,
          genericNamespace: 'machine2Namespace',
        },
      },
      variables: [
        {
          name: 'combinedTest',
          format: 'float',
          value: [
            {
              name: 'int16Test',
              value: 345,
              lowerLimit: 300,
              upperLimit: 400,
            },
            {
              name: 'floatTest',
              value: 4567.5,
              lowerLimit: 4000.0,
              upperLimit: 5000.0,
            },
            {
              name: 'booleanTest',
              value: 'true',
            },
          ],
        },
      ],
    },
    machine3: {
      info: {
        name: 'machine3',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
          deliverEntireResponse: true,
          overrideVariableNameFlag: true,
          overrideVariableNameBase,
        },
      },
      variables: [
        {
          name: 'combinedTest',
          format: 'float',
          value: [
            {
              name: 'int16Test',
              value: 456,
              lowerLimit: 400,
              upperLimit: 500,
            },
            {
              name: 'floatTest',
              value: 5678.0,
              lowerLimit: 5000.0,
              upperLimit: 6000.0,
            },
          ],
        },
      ],
    },
    machine4: {
      info: {
        name: 'machine4',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'complexVariable',
          format: 'string',
          value: { pressure: 10, temp: 20 },
        },
      ],
    },
    'spark-machine-deviceinfo': {
      info: {
        name: 'spark-machine-deviceinfo',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
          deliverEntireResponse: false,
          overrideVariableNameFlag: false,
          overrideVariableNameBase,
        },
      },
      variables: [
        {
          name: 'deviceinfo',
          format: 'char',
          value: 'original device info data',
        },
      ],
    },
  },
};

const sparkdb = new EventEmitter();
sparkdb.db = {};
sparkdb.add = function add(_data, done) {
  const data = _data;
  data.createdAt = moment();
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
sparkConfig.listeners = function listeners() {
  return {
    indexOf() {
      return -1;
    },
  };
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

function getSparkplugType(sparkFormat) {
  switch (sparkFormat) {
    case 'bool':
      return 'boolean';
    case 'char':
      return 'string';
    default:
      return sparkFormat;
  }
}

describe('Spark Sparkplug Client', () => {
  it('require should succeed', (done) => {
    const result = sparkplugClient.require();
    result.should.be.instanceof(Array);
    result.should.eql(['spark-logging', 'spark-db', 'spark-alert', 'spark-config']);
    return done();
  });

  it('stop should error when not started', (done) => {
    sparkplugClient.stop((err, result) => {
      if (result) throw new Error('result should not be set');
      if (!err) throw new Error('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkplugClient.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.equal(pkg.name);
      return done();
    });
  });

  it('start should error when already started', (done) => {
    sparkplugClient.start(modules, (err, result) => {
      if (result) throw new Error('result should not be set');
      if (!err) throw new Error('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('stop should succeed when started', (done) => {
    sparkplugClient.stop((err) => {
      if (err) throw err;
      return done();
    });
  });

  it('start should succeed with protocol enabled', (done) => {
    conf.protocols['spark-protocol-sparkplug'].settings.model.enable = true;
    sparkplugClient.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.equal(pkg.name);
      sparkplugClient.sparkplugTester.newClient().emit('connect');
      return done();
    });
  });

  it('on birth event node birth and device births should be published', (done) => {
    const machines = [];
    _.forOwn(conf.machines, (machine) => {
      if (!_.get(machine, 'settings.model.deliverEntireResponse', false)) {
        machines.push(machine.info.name);
      }
    });
    sparkplugClient.sparkplugTester.newClient().on('testerPublishNodeBirth', (nodePayload) => {
      nodePayload.metrics[0].name.should.equal('SparkName');
      nodePayload.metrics[0].value.should.equal(os.hostname());
      nodePayload.metrics[0].type.should.equal('string');
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishNodeBirth');
      let iMachine = 0;
      sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceBirth',
        (machineName, devicePayload) => {
          console.log(`machineName = ${machineName}`);
          machineName.should.equal(machines[iMachine]);
          const machine = conf.machines[machineName];
          devicePayload.metrics.length.should.equal(machine.variables.length);
          for (let iVar = 0; iVar < devicePayload.metrics.length; iVar += 1) {
            devicePayload.metrics[iVar].name.should.equal(machine.variables[iVar].name);
            devicePayload.metrics[iVar].type.should
              .equal(getSparkplugType(machine.variables[iVar].format));
          }
          iMachine += 1;
          if (iMachine === machines.length) {
            sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceBirth');
            return done();
          }

          return undefined;
        });
    });
    sparkplugClient.sparkplugTester.newClient().emit('birth');
  });

  it('on ncmd event node birth and device births should be published', (done) => {
    const machines = [];
    _.forOwn(conf.machines, (machine) => {
      if (!_.get(machine, 'settings.model.deliverEntireResponse', false)) {
        machines.push(machine.info.name);
      }
    });
    sparkplugClient.sparkplugTester.newClient().on('testerPublishNodeBirth', (nodePayload) => {
      nodePayload.metrics[0].name.should.equal('SparkName');
      nodePayload.metrics[0].value.should.equal(os.hostname());
      nodePayload.metrics[0].type.should.equal('string');
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishNodeBirth');
      let iMachine = 0;
      sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceBirth',
        (machineName, devicePayload) => {
          machineName.should.equal(machines[iMachine]);
          const machine = conf.machines[machineName];
          devicePayload.metrics.length.should.equal(machine.variables.length);
          for (let iVar = 0; iVar < devicePayload.metrics.length; iVar += 1) {
            devicePayload.metrics[iVar].name.should.equal(machine.variables[iVar].name);
            devicePayload.metrics[iVar].type.should
              .equal(getSparkplugType(machine.variables[iVar].format));
          }
          iMachine += 1;
          if (iMachine === machines.length) {
            sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceBirth');
            return done();
          }

          return undefined;
        });
    });
    const payload = {
      timestamp: 1510161029711,
      metrics: [
        {
          name: 'Node Control/Rebirth',
          type: 'Boolean',
          value: true,
        },
      ],
      seq: 18446744073709552000,
    };
    sparkplugClient.sparkplugTester.newClient().emit('ncmd', payload);
  });

  conf.machines.machine1.variables.forEach((v) => {
    if (_.get(v, 'access', 'read') !== 'write') {
      it(`adding variable ${v.name} from machine1 should publish it`, (done) => {
        sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceData', (deviceId, payload) => {
          deviceId.should.equal('machine1');
          payload.metrics[0].name.should.equal(v.name);
          payload.metrics[0].value.should.equal(v.value);
          payload.metrics[0].type.should.equal(getSparkplugType(v.format));
          sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceData');
          return done();
        });
        const data = {
          machine: 'machine1',
          variable: v.name,
        };
        data[v.name] = v.value;
        sparkdb.add(data);
      });
    }
  });

  it('adding variable a variable with no change should not publish in on change only mode', (done) => {
    const variable = conf.machines.machine1.variables[0];
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceData', () => {
      assert(false, 'Should not publish if no variable change in on change only mode');
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceData');
    });
    const data = {
      machine: 'machine1',
      variable: variable.name,
    };
    data[variable.name] = variable.value;
    sparkdb.add(data);
    setTimeout(() => {
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceData');
      return done();
    }, 100);
  });

  it('changing the value of an object variable type should publish as a string', (done) => {
    const variable = conf.machines.machine4.variables[0];
    const complexData = { pressure: 100, temp: 200 };
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceData', (dataDeviceId, dataPayload) => {
      dataDeviceId.should.equal(conf.machines.machine4.info.name);
      dataPayload.metrics[0].name.should.equal(variable.name);
      dataPayload.metrics[0].type.should.equal('string');
      dataPayload.metrics[0].value.should.equal(JSON.stringify(complexData));
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceData');
      return done();
    });
    const data = {
      machine: 'machine4',
      variable: variable.name,
    };
    data[variable.name] = complexData;
    sparkdb.add(data);
  });

  it('updating device-info variable should result in a node data message', (done) => {
    const variable = conf.machines['spark-machine-deviceinfo'].variables[0];
    sparkplugClient.sparkplugTester.newClient().on('testerPublishNodeData', (payload) => {
      payload.metrics[1].name.should.equal('DeviceInfo');
      payload.metrics[1].value.should.equal('"new device info data"');
      payload.metrics[1].type.should.equal('string');
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishNodeData');
      return done();
    });
    const data = {
      machine: 'spark-machine-deviceinfo',
      variable: variable.name,
    };
    data[variable.name] = 'new device info data';
    sparkdb.add(data);
  });

  it('adding combined variable from machine2 should publish device birth and values', (done) => {
    const variable = conf.machines.machine2.variables[0];
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceBirth', (birthDeviceId, birthPayload) => {
      birthDeviceId.should.equal(conf.machines.machine2.settings.model.genericNamespace);
      for (let iVar = 0; iVar < variable.value.length; iVar += 1) {
        birthPayload.metrics[iVar].name.should.equal(variable.value[iVar].name);
      }
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceBirth');
      sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceData', (dataDeviceId, dataPayload) => {
        dataDeviceId.should.equal(conf.machines.machine2.settings.model.genericNamespace);
        for (let iMetric = 0; iMetric < variable.value.length; iMetric += 1) {
          dataPayload.metrics[iMetric].name.should.equal(variable.value[iMetric].name);
          dataPayload.metrics[iMetric].value.should.eql(variable.value[iMetric].value);
          if (_.has(variable.value[iMetric], 'lowerLimit')) {
            dataPayload.metrics[iMetric]['Engineering Low Limit'].should
              .equal(variable.value[iMetric].lowerLimit);
          }
          if (_.has(variable.value[iMetric], 'upperLimit')) {
            dataPayload.metrics[iMetric]['Engineering High Limit'].should
              .equal(variable.value[iMetric].upperLimit);
          }
        }
        sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceData');
        conf.machines.machine2.info.genericNamespace = 'NONE';
        return done();
      });
    });
    const data = {
      machine: 'machine2',
      variable: variable.name,
    };
    data[variable.name] = variable.value;
    sparkdb.add(data);
  });

  it('adding combined variable from machine3 should publish device birth and values with override names', (done) => {
    const variable = conf.machines.machine3.variables[0];
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceBirth', (birthDeviceId, birthPayload) => {
      birthDeviceId.should.equal('machine3');
      for (let iVar = 0; iVar < variable.value.length; iVar += 1) {
        birthPayload.metrics[2 * iVar].name.should.equal(`${overrideVariableNameBase + (iVar + 1)}Name`);
        birthPayload.metrics[(2 * iVar) + 1].name.should
          .equal(overrideVariableNameBase + (iVar + 1));
      }
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceBirth');
      sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceData', (dataDeviceId, dataPayload) => {
        dataDeviceId.should.equal('machine3');
        for (let iMetric = 0; iMetric < variable.value.length; iMetric += 1) {
          dataPayload.metrics[iMetric].name.should.equal(overrideVariableNameBase + (iMetric + 1));
          dataPayload.metrics[iMetric].value.should.eql(variable.value[iMetric].value);
          dataPayload.metrics[iMetric]['Engineering Low Limit'].should
            .equal(variable.value[iMetric].lowerLimit);
          dataPayload.metrics[iMetric]['Engineering High Limit'].should
            .equal(variable.value[iMetric].upperLimit);
        }
        sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceData');
        return done();
      });
    });
    const data = {
      machine: 'machine3',
      variable: variable.name,
    };
    data[variable.name] = variable.value;
    sparkdb.add(data);
  });

  it('changing a protocol setting should cause a restart request', (done) => {
    sparkplugClient.on('restartRequest', (data) => {
      data.should.equal(pkg.name);
      sparkplugClient.removeAllListeners('restartRequest');
      return done();
    });
    sparkConfig.set('protocols:spark-protocol-sparkplug:settings:model:onChangeOnly', false);
  });

  it('changing variables should should publish a new device birth', (done) => {
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceBirth',
      (machineName, payload) => {
        machineName.should.equal('machine1');
        const machine = conf.machines.machine1;
        payload.metrics.length.should.equal(machine.variables.length);
        for (let iVar = 0; iVar < payload.metrics.length; iVar += 1) {
          payload.metrics[iVar].name.should.equal(machine.variables[iVar].name);
          payload.metrics[iVar].type.should.equal(getSparkplugType(machine.variables[iVar].format));
        }
        sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceBirth');
        return done();
      });
    const { variables } = conf.machines.machine1;
    variables.push({ name: 'newvar', format: 'uint16', value: 2345 });
    sparkConfig.set('machines:machine1:variables', variables);
  });

  it('disabling a machine should publish a new device death', (done) => {
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceDeath', (machineName, payload) => {
      machineName.should.equal('machine1');
      payload.timestamp.should.not.equal(undefined);
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceDeath');
      return done();
    });
    sparkConfig.set('machines:machine1:settings:model:enable', false);
  });

  it('enabling a machine should publish a new device birth', (done) => {
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceBirth', (machineName) => {
      machineName.should.equal('machine1');
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceBirth');
      return done();
    });
    sparkConfig.set('machines:machine1:settings:model:enable', true);
  });

  it('turning off deliver entire response should publish a new device birth', (done) => {
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceBirth', (machineName) => {
      machineName.should.equal(conf.machines.machine2.settings.model.genericNamespace);
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceBirth');
      return done();
    });
    sparkConfig.set('machines:machine2:settings:model:deliverEntireResponse', false);
  });

  it('turning on deliver entire response should publish a new device birth', (done) => {
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceBirth', (machineName) => {
      machineName.should.equal(conf.machines.machine2.settings.model.genericNamespace);
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceBirth');
      return done();
    });
    sparkConfig.set('machines:machine2:settings:model:deliverEntireResponse', true);
  });

  it('turning off override variable should publish a new device birth', (done) => {
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceBirth', (machineName) => {
      machineName.should.equal('machine3');
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceBirth');
      return done();
    });
    sparkConfig.set('machines:machine3:settings:model:overrideVariableNameFlag', false);
  });

  it('turning on override variable should publish a new device birth', (done) => {
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceBirth', (machineName) => {
      machineName.should.equal('machine3');
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceBirth');
      return done();
    });
    sparkConfig.set('machines:machine3:settings:model:overrideVariableNameFlag', true);
  });

  it('disabling a machine should publish a new device death', (done) => {
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceDeath', (machineName, payload) => {
      machineName.should.equal('machine2');
      payload.timestamp.should.not.equal(undefined);
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceDeath');
      return done();
    });
    sparkConfig.set('machines:machine2:settings:model:enable', false);
  });

  it('enabling a machine and adding a combined variable should publish a new device birth', (done) => {
    const variable = conf.machines.machine2.variables[0];
    sparkplugClient.sparkplugTester.newClient().on('testerPublishDeviceBirth', (machineName) => {
      machineName.should.equal(conf.machines.machine2.settings.model.genericNamespace);
      sparkplugClient.sparkplugTester.newClient().removeAllListeners('testerPublishDeviceBirth');
      return done();
    });
    sparkConfig.set('machines:machine2:settings:model:enable', true);
    const data = {
      machine: 'machine2',
      variable: variable.name,
    };
    data[variable.name] = variable.value;
    sparkdb.add(data);
  });

  it('a dcmd event should be logged', (done) => {
    sparkLog.on('debug', (data) => {
      data.should.equal('received \'dcmd\' event, payload: ');
      sparkLog.removeAllListeners('debug');
      return done();
    });

    sparkplugClient.sparkplugTester.newClient().emit('dcmd', 'Payload');
  });

  it('a reconnect event should be logged', (done) => {
    sparkLog.on('debug', (data) => {
      data.should.equal('received \'reconnect\' event');
      sparkLog.removeAllListeners('debug');
      return done();
    });

    sparkplugClient.sparkplugTester.newClient().emit('reconnect');
  });

  it('a close event should be logged', (done) => {
    sparkLog.on('debug', (data) => {
      data.should.equal('received \'close\' event');
      sparkLog.removeAllListeners('debug');
      return done();
    });

    sparkplugClient.sparkplugTester.newClient().emit('close');
  });

  it('on error event an alert should be raised', (done) => {
    sparkAlert.on('raise', (data) => {
      sparkAlert.removeAllListeners('raise');
      data.key.should.equal('connection-error');
      data.errorMsg.should.equal('An error occurred');
      return done();
    });

    sparkplugClient.sparkplugTester.newClient().emit('error', Error('An error occurred'));
  });

  it('stop should succeed when started', (done) => {
    sparkplugClient.stop((err) => {
      if (err) throw err;
      return done();
    });
  });

  it('start should succeed with protocol enabled', (done) => {
    conf.protocols['spark-protocol-sparkplug'].settings.model.enable = true;
    sparkplugClient.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.equal(pkg.name);
      sparkplugClient.sparkplugTester.newClient().emit('connect');
      return done();
    });
  });

  it('on offline event an alert should be raised', (done) => {
    sparkAlert.on('raise', (data) => {
      sparkAlert.removeAllListeners('raise');
      data.key.should.equal('connection-error');
      data.errorMsg.should.equal('Server appears offline. Check server hostname is set correctly and that the server is running.');
      return done();
    });

    sparkplugClient.sparkplugTester.newClient().emit('offline');
  });
});
