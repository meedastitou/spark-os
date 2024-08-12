/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const _ = require('lodash');
const bunyan = require('bunyan');
const moment = require('moment');
const os = require('os');
const awsIoTClient = require('../index.js');
const pkg = require('../package.json');

const log = bunyan.createLogger({
  name: pkg.name,
  level: process.env.LOG_LEVEL || 'WARN',
  src: true,
});

const conf = {
  protocols: {
    'spark-protocol-aws-iot-advanced': {
      settings: {
        model: {
          enable: false,
          authMethod: 'File',
          keyFilePath: 'test/privateKey.pem',
          certFilePath: 'test/clientCert.crt',
          caFilePath: 'test/caCert.crt',
          keyBuffer: '-----BEGIN RSA PRIVATE KEY-----\\n\\l-----END RSA PRIVATE KEY-----',
          certBuffer: '-----BEGIN CERTIFICATE-----\\n\\l-----END CERTIFICATE-----',
          caBuffer: '-----BEGIN CERTIFICATE-----\\n\\l-----END CERTIFICATE-----',
          basicIngestEnable: false,
          AWSIoTAct: 'actRule',
          groupId: 'Sparkplug B Devices',
          onChangeOnly: true,
        },
      },
    },
  },
  machines: {
    machine1: {
      info: {
        name: 'machine1',
        description: 'machine 1',
        genericNamespace: 'StampingPress',
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
          outputFormat: 'uint16',
          value: 123,
        },
        {
          name: 'int32',
          format: 'int32',
          access: 'write',
          value: 4567,
        },
        {
          name: 'bool',
          format: 'bool',
          access: 'write',
          value: true,
        },
        {
          name: 'char',
          format: 'char',
          value: 'ABCDE',
        },
        {
          name: 'array',
          format: 'int16',
          array: true,
          value: '[123, 456]',
        },
        {
          name: 'object',
          format: 'object',
          value: { name: 'propName' },
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
          genericNamespace: 'Vision',
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
          value: 234,
        },
        {
          name: 'int32',
          format: 'int32',
          access: 'write',
          value: 5678,
        },
        {
          name: 'char',
          format: 'char',
          value: 'BCDEF',
        },
      ],
    },
    machine3: {
      info: {
        name: 'machine3',
        description: 'machine 3',
        genericNamespace: 'Plating',
      },
      settings: {
        model: {
          enable: false,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'float',
          format: 'float',
          value: 34567.0,
        },
      ],
    },
    machine4: {
      info: {
        name: 'machine4',
        description: 'machine 4',
      },
      settings: {
        model: {
          enable: true,
          deliverEntireResponse: true,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'combFloat',
          format: 'float',
          value: [
            {
              name: 'combVar1',
              value: 123.5,
              lowerLimit: 123.5,
              upperLimit: 345.5,
              nominalValue: 234.5,
              engineeringUnits: 'mm',
            },
            {
              name: 'combVar2',
              value: 234.5,
              lowerLimit: 123.5,
              upperLimit: 345.5,
              nominalValue: 234.5,
              engineeringUnits: 'mm',
            },
            {
              name: 'combVar3',
              value: 345.5,
              lowerLimit: 123.5,
              upperLimit: 345.5,
              nominalValue: 234.5,
              engineeringUnits: 'mm',
            },
          ],
        },
      ],
    },
    machine5: {
      info: {
        name: 'machine5',
        description: 'machine 5',
      },
      settings: {
        model: {
          enable: true,
          deliverEntireResponse: true,
          overrideVariableNameFlag: true,
          overrideVariableNameBase: 'var',
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'combInt32',
          format: 'int32',
          value: [
            {
              name: 'combVar1',
              value: 3456,
              lowerLimit: 3456,
              upperLimit: 5678,
              nominalValue: 456,
              engineeringUnits: 'kg',
            },
            {
              name: 'combVar2',
              value: 4567,
              lowerLimit: 3456,
              upperLimit: 5678,
              nominalValue: 456,
              engineeringUnits: 'kg',
            },
            {
              name: 'combVar3',
              value: 5678,
              lowerLimit: 3456,
              upperLimit: 5678,
              nominalValue: 456,
              engineeringUnits: 'kg',
            },
          ],
        },
      ],
    },
    machine6: {
      info: {
        name: 'machine6',
        description: 'machine 6',
        hpl: 'net',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'csvTest',
          format: 'char',
          deliverEntireResponse: true,
          value: [
            {
              name: 'combVar1',
              value: 123,
            },
            {
              name: 'combVar2',
              value: 234,
            },
            {
              name: 'combVar3',
              value: 345,
            },
          ],
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

const machineNameMap = {};
const machineNameReverseMap = {};
_.forOwn(conf.machines, (machine) => {
  const machineName = machine.info.name;
  let mappedMachineName = _.get(machine.info, 'genericNamespace', machineName);
  mappedMachineName = _.get(machine.settings.model, 'genericNamespace', mappedMachineName);
  machineNameMap[machineName] = mappedMachineName;
  machineNameReverseMap[mappedMachineName] = machineName;
});

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
let configError = null;
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
  return cb(configError, value);
};

const sparkAlert = new EventEmitter();
sparkAlert.getAlerter = function getAlerter() {
  return {
    clearAll(done) {
      return done(null);
    },
    preLoad(alerts) {
      _.forOwn(alerts, (alert) => {
        if (_.isFunction(alert.description)) {
          alert.description({ errMsg: 'error' });
        }
      });
    },
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

const hostname = os.hostname();

describe('Spark AWS IoT Client', () => {
  it('require should succeed', (done) => {
    const result = awsIoTClient.require();
    result.should.be.instanceof(Array);
    result.should.eql(['spark-logging', 'spark-db', 'spark-alert', 'spark-config']);
    return done();
  });

  it('stop should error when not started', (done) => {
    awsIoTClient.stop((err, result) => {
      if (result) throw new Error('result should not be set');
      if (!err) throw new Error('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    awsIoTClient.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.equal(pkg.name);
      return done();
    });
  });

  it('start should error when already started', (done) => {
    awsIoTClient.start(modules, (err, result) => {
      if (result) throw new Error('result should not be set');
      if (!err) throw new Error('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('stop should succeed when started', (done) => {
    awsIoTClient.stop((err) => {
      if (err) throw err;
      return done();
    });
  });

  it('start should succeed with protocol enabled', (done) => {
    conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.enable = true;
    awsIoTClient.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.equal(pkg.name);
      return done();
    });
  });

  it('when the client connects it should publish machine variable meta-data and subscribe to write variables', (done) => {
    let numMachines = 0;
    let numWriteVariables = 0;
    _.forOwn(conf.machines, (machine) => {
      numMachines += 1;
      _.forOwn(machine.variables, (variable) => {
        if (_.get(variable, 'access', 'read') === 'write') {
          numWriteVariables += 1;
        }
      });
    });
    let machineCount = 0;
    let writeVariableCount = 0;
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic, payload) => {
      const topicSplit = topic.split('/');
      const [, groupId, topicType, host, machineName] = topicSplit;
      host.should.equal(hostname);
      groupId.should.equal(conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.groupId);
      const metadata = JSON.parse(payload);
      if (machineName !== undefined) {
        machineCount += 1;
        if (machineCount === numMachines) {
          awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
        }
      } else {
        topicType.should.equal('NBIRTH');
        metadata.metrics[0].name.should.equal('SparkName');
        metadata.metrics[1].name.should.equal('NodeInfo');
        metadata.metrics[2].name.should.equal('DeviceInfo');
      }
    });
    awsIoTClient.awsIoTTester.device().on('testerSubscribe', () => {
      writeVariableCount += 1;
      if (writeVariableCount === numWriteVariables) {
        awsIoTClient.awsIoTTester.device().removeAllListeners('testerSubscribe');
        return done();
      }
      return undefined;
    });
    awsIoTClient.awsIoTTester.device().emit('connect');
  });

  conf.machines.machine1.variables.forEach((v) => {
    if (_.get(v, 'access', 'read') !== 'write') {
      it(`adding variable ${v.name} from machine1 should publish it to AWS`, (done) => {
        awsIoTClient.awsIoTTester.device().on('testerPublish', (topic, payload) => {
          const topicSplit = topic.split('/');
          const [, groupId, topicType, host, machineName] = topicSplit;
          host.should.equal(hostname);
          groupId.should.equal(conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.groupId);
          topicType.should.equal('DDATA');
          machineName.should.equal(machineNameMap.machine1);
          const newData = JSON.parse(payload);
          v.name.should.equal(newData.metrics[0].name);
          let { value } = newData.metrics[0];
          if (typeof v.value === 'object') {
            value = JSON.parse(value);
          }
          v.value.should.eql(value);
          awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
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

  it('adding variable deviceinfo from spark-machine-deviceinfo should publish it to AWS', (done) => {
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic, payload) => {
      const topicSplit = topic.split('/');
      const [, groupId, topicType, host] = topicSplit;
      host.should.equal(hostname);
      groupId.should.equal(conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.groupId);
      topicType.should.equal('NDATA');
      const newData = JSON.parse(payload);
      newData.metrics[0].name.should.equal('NodeInfo');
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
      return done();
    });
    const data = {
      machine: 'spark-machine-deviceinfo',
      variable: 'deviceinfo',
    };
    data[data.variable] = '{info:0}';
    sparkdb.add(data);
  });

  conf.machines.machine1.variables.forEach((v) => {
    if (_.get(v, 'access', 'read') === 'write') {
      it(`if variable ${v.name} from machine1 is published to it should be written to the database`, (done) => {
        sparkdb.on('added', (key) => {
          sparkdb.get(key, (err, data) => {
            v.name.should.equal(data.variable);
            data[v.name].should.eql(v.value);
            sparkdb.removeAllListeners('added');
            return done();
          });
        });
        awsIoTClient.awsIoTTester.device().emit('message', `${hostname}/${machineNameMap.machine1}/${v.name}`,
          JSON.stringify({ value: v.value, timestamp: moment().format('x') }));
      });
    }
  });

  it('changing a protocol setting should cause a restart request', (done) => {
    awsIoTClient.on('restartRequest', (data) => {
      data.should.equal(pkg.name);
      awsIoTClient.removeAllListeners('restartRequest');
      return done();
    });
    sparkConfig.set('protocols:spark-protocol-aws-iot-advanced:settings:model:basicIngestEnable', true);
  });

  it('changing variables should cause unsubscribe, publish metadata, and subscribe', (done) => {
    let unsubscribed = false;
    let subscribed = false;
    awsIoTClient.awsIoTTester.device().on('testerUnsubscribe', (topic) => {
      const [host, machineName] = topic.split('/');
      host.should.equal(hostname);
      machineName.should.equal(machineNameMap.machine1);
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerUnsubscribe');
      unsubscribed = true;
    });
    awsIoTClient.awsIoTTester.device().on('testerSubscribe', (topic) => {
      const [host, machineName] = topic.split('/');
      host.should.equal(hostname);
      machineName.should.equal(machineNameMap.machine1);
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerSubscribe');
      subscribed = true;
    });
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic) => {
      const [, groupId, topicType, host, machineName] = topic.split('/');
      host.should.equal(hostname);
      groupId.should.equal(conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.groupId);
      topicType.should.equal('DBIRTH');
      machineName.should.equal(machineNameMap.machine1);
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
      if (unsubscribed && subscribed) return done();
      return undefined;
    });
    const { variables } = conf.machines.machine1;
    variables.push({ name: 'uint16', format: 'uint16', value: 2345 });
    sparkConfig.set('machines:machine1:variables', variables);
  });

  it('disabling a machine should cause its variables to be unsubscribed', (done) => {
    awsIoTClient.awsIoTTester.device().on('testerUnsubscribe', (topic) => {
      const [host, machineName] = topic.split('/');
      host.should.equal(hostname);
      machineName.should.equal(machineNameMap.machine2);
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerUnsubscribe');
      return done();
    });
    sparkConfig.set('machines:machine2:settings:model:enable', false);
  });

  it('enabling a machine should publish metadata, and subscribe', (done) => {
    let published = false;
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic) => {
      const [, groupId, topicType, host, machineName] = topic.split('/');
      host.should.equal(hostname);
      groupId.should.equal(conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.groupId);
      topicType.should.equal('DBIRTH');
      machineName.should.equal(machineNameMap.machine2);
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
      published = true;
    });
    awsIoTClient.awsIoTTester.device().on('testerSubscribe', (topic) => {
      const [host, machineName] = topic.split('/');
      host.should.equal(hostname);
      machineName.should.equal(machineNameMap.machine2);
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerSubscribe');
      if (published) return done();
      return undefined;
    });
    sparkConfig.set('machines:machine2:settings:model:enable', true);
  });

  it('enabling a machine with no write variabke should publish metadata', (done) => {
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic) => {
      const [, groupId, topicType, host, machineName] = topic.split('/');
      host.should.equal(hostname);
      groupId.should.equal(conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.groupId);
      topicType.should.equal('DBIRTH');
      machineName.should.equal(machineNameMap.machine3);
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
      return done();
    });
    sparkConfig.set('machines:machine3:settings:model:enable', true);
  });

  it('stop should succeed when started', (done) => {
    awsIoTClient.stop((err) => {
      if (err) throw err;
      return done();
    });
  });

  it('start should succeed with protocol authentication method set to buffer ', (done) => {
    conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.authMethod = 'Buffer';
    conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.basicIngestEnable = true;
    conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.enable = true;
    awsIoTClient.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.equal(pkg.name);
      awsIoTClient.awsIoTTester.device().emit('connect');
      return done();
    });
  });

  it('adding a combined variable from machine4 should cause a device birth and publish it to AWS in combined format', (done) => {
    let gotDeviceBirth = false;
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic, payload) => {
      const [, groupId, topicType, host, machineName] = topic.split('/');
      host.should.equal(hostname);
      groupId.should.equal(conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.groupId);
      machineName.should.equal('machine4');
      if (gotDeviceBirth) {
        // variableName.should.equal(conf.machines.machine4.variables[0].name);
        const newData = JSON.parse(payload);
        const nVals = conf.machines.machine4.variables[0].value.length;
        for (let iVal = 0; iVal < nVals; iVal += 1) {
          newData.metrics[iVal].name.should
            .equal(conf.machines.machine4.variables[0].value[iVal].name);
          newData.metrics[iVal].value.should
            .equal(conf.machines.machine4.variables[0].value[iVal].value);
          newData.metrics[iVal]['Engineering Low Limit'].should
            .equal(conf.machines.machine4.variables[0].value[iVal].lowerLimit);
          newData.metrics[iVal]['Engineering High Limit'].should
            .equal(conf.machines.machine4.variables[0].value[iVal].upperLimit);
          newData.metrics[iVal]['Nominal Value'].should
            .equal(conf.machines.machine4.variables[0].value[iVal].nominalValue);
          newData.metrics[iVal]['Engineering Units'].should
            .equal(conf.machines.machine4.variables[0].value[iVal].engineeringUnits);
          newData.metrics[iVal].type.should
            .equal(conf.machines.machine4.variables[0].format);
        }
        awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
        return done();
      }

      topicType.should.equal('DBIRTH');
      gotDeviceBirth = true;
      return undefined;
    });
    const data = {
      machine: 'machine4',
      variable: conf.machines.machine4.variables[0].name,
    };
    data[conf.machines.machine4.variables[0].name] = conf.machines.machine4.variables[0].value;
    sparkdb.add(data);
  });

  it('adding a combined variable from machine5 should cause a device birtpublish it with variable name overrides', (done) => {
    let gotDeviceBirth = false;
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic, payload) => {
      const [, groupId, topicType, host, machineName] = topic.split('/');
      host.should.equal(hostname);
      groupId.should.equal(conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.groupId);
      machineName.should.equal('machine5');
      if (gotDeviceBirth) {
        const newData = JSON.parse(payload);
        const nVals = conf.machines.machine5.variables[0].value.length;
        for (let iVal = 0; iVal < nVals; iVal += 1) {
          newData.metrics[iVal].name.should
            .equal(`${conf.machines.machine5.settings.model.overrideVariableNameBase}${iVal + 1}`);
          newData.metrics[iVal].value.should
            .equal(conf.machines.machine5.variables[0].value[iVal].value);
          newData.metrics[iVal]['Engineering Low Limit'].should
            .equal(conf.machines.machine5.variables[0].value[iVal].lowerLimit);
          newData.metrics[iVal]['Engineering High Limit'].should
            .equal(conf.machines.machine5.variables[0].value[iVal].upperLimit);
          newData.metrics[iVal]['Nominal Value'].should
            .equal(conf.machines.machine5.variables[0].value[iVal].nominalValue);
          newData.metrics[iVal]['Engineering Units'].should
            .equal(conf.machines.machine5.variables[0].value[iVal].engineeringUnits);
          newData.metrics[iVal].type.should
            .equal(conf.machines.machine5.variables[0].format);
        }
        awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
        return done();
      }

      topicType.should.equal('DBIRTH');
      gotDeviceBirth = true;
      return undefined;
    });
    const data = {
      machine: 'machine5',
      variable: conf.machines.machine5.variables[0].name,
    };
    data[conf.machines.machine5.variables[0].name] = conf.machines.machine5.variables[0].value;
    sparkdb.add(data);
  });

  it('disabling and enabling a machine should cause publish metadata', (done) => {
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic) => {
      const [, groupId, topicType, host, machineName] = topic.split('/');
      host.should.equal(hostname);
      groupId.should.equal(conf.protocols['spark-protocol-aws-iot-advanced'].settings.model.groupId);
      topicType.should.equal('DDEATH');
      machineName.should.equal('machine5');
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
      return done();
    });
    sparkConfig.set('machines:machine5:settings:model:enable', false);
    sparkConfig.set('machines:machine5:settings:model:enable', true);
  });

  it('disabling deliver entire response mode for a machine should succeed', (done) => {
    sparkLog.on('debug', (data) => {
      data.should.include('Disabling Deliver Entire Response for Machine:');
      sparkLog.removeAllListeners('debug');
      return done();
    });
    sparkConfig.set('machines:machine5:settings:model:deliverEntireResponse', false);
  });

  it('enabling deliver entire response mode for a machine should succeed', (done) => {
    sparkLog.on('debug', (data) => {
      data.should.include('Enabling Deliver Entire Response for Machine:');
      sparkLog.removeAllListeners('debug');
      return done();
    });
    sparkConfig.set('machines:machine5:settings:model:deliverEntireResponse', true);
  });

  it('disabling override variable name mode for a machine should succeed', (done) => {
    sparkLog.on('debug', (data) => {
      data.should.include('Disabling Override Variable Name for Machine:');
      sparkLog.removeAllListeners('debug');
      return done();
    });
    sparkConfig.set('machines:machine5:settings:model:overrideVariableNameFlag', false);
  });

  it('enabling override variable name mode for a machine should succeed', (done) => {
    sparkLog.on('debug', (data) => {
      data.should.include('Enabling Override Variable Name for Machine:');
      sparkLog.removeAllListeners('debug');
      return done();
    });
    sparkConfig.set('machines:machine5:settings:model:overrideVariableNameFlag', true);
  });

  it('emitting an error event should raise an alert ', (done) => {
    sparkAlert.on('raise', (data) => {
      sparkAlert.removeAllListeners('raise');
      data.key.should.equal('connection-error');
      return done();
    });
    awsIoTClient.awsIoTTester.device().emit('error');
  });

  it('emitting an offline event should raise an alert ', (done) => {
    sparkAlert.on('raise', (data) => {
      sparkAlert.removeAllListeners('raise');
      data.key.should.equal('connection-offline');
      return done();
    });
    awsIoTClient.awsIoTTester.device().emit('offline');
  });

  it('stop should succeed when started', (done) => {
    awsIoTClient.stop((err) => {
      if (err) throw err;
      return done();
    });
  });

  it('start should raise an alert if there is an error creating the device', (done) => {
    awsIoTClient.awsIoTTester.forceDeviceError(true);
    sparkAlert.on('raise', (data) => {
      sparkAlert.removeAllListeners('raise');
      data.key.should.equal('initialization-error');
      awsIoTClient.awsIoTTester.forceDeviceError(false);
      return done();
    });
    awsIoTClient.start(modules, () => {
    });
  });

  it('start should raise an alert if there is an error getting the machine configuration', (done) => {
    configError = Error('Error getting machine configuration');
    sparkAlert.on('raise', (data) => {
      sparkAlert.removeAllListeners('raise');
      data.key.should.equal('initialization-error');
      return done();
    });
    awsIoTClient.start(modules, () => {
    });
  });
});
