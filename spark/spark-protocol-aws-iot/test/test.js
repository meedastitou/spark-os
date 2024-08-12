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
    'spark-protocol-aws-iot': {
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
          value: 123,
        },
        {
          name: 'int32',
          format: 'int32',
          access: 'write',
          value: 4567,
        },
        {
          name: 'char',
          format: 'char',
          value: 'ABCDE',
        },
      ],
    },
    machine2: {
      info: {
        name: 'machine2',
        description: 'machine 2',
        genericNamespace: 'Vision',
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
        hpl: 'virtual',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'virtualFloat',
          format: 'float',
          srcVariables: [
            {
              srcMachine: 'machine1',
              srcVariable: 'float',
            },
          ],
          value: 12345.0,
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
            },
            {
              name: 'combVar2',
              value: 234.5,
              lowerLimit: 123.5,
              upperLimit: 345.5,
            },
            {
              name: 'combVar3',
              value: 345.5,
              lowerLimit: 123.5,
              upperLimit: 345.5,
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
            },
            {
              name: 'combVar2',
              value: 4567,
              lowerLimit: 3456,
              upperLimit: 5678,
            },
            {
              name: 'combVar3',
              value: 5678,
              lowerLimit: 3456,
              upperLimit: 5678,
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

const hostname = os.hostname();

function getCSVFromValueArray(valueArray) {
  let csvString = '';
  for (let iVal = 0; iVal < valueArray.length; iVal += 1) {
    if (csvString.length !== 0) csvString += ',';
    csvString += `${valueArray[iVal].name},${valueArray[iVal].value}`;
  }
  return csvString;
}

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
    conf.protocols['spark-protocol-aws-iot'].settings.model.enable = true;
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
      const [host, machineName] = topicSplit;
      host.should.equal(hostname);
      const metadata = JSON.parse(payload);
      const actualMachineName = machineNameReverseMap[machineName];
      metadata.info.should.eql(conf.machines[actualMachineName].info);
      machineCount += 1;
      if (machineCount === numMachines) {
        awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
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
          const [host, machineName, variableName] = topicSplit;
          host.should.equal(hostname);
          machineName.should.equal(machineNameMap.machine1);
          variableName.should.equal(v.name);
          const newData = JSON.parse(payload);
          v.value.should.equal(newData.value);
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
    sparkConfig.set('protocols:spark-protocol-aws-iot:settings:model:basicIngestEnable', true);
  });

  it('changing variables should cause unsubscribe, publish metadata, and subscribe', (done) => {
    let unsubscribed = false;
    let published = false;
    awsIoTClient.awsIoTTester.device().on('testerUnsubscribe', (topic) => {
      const [host, machineName] = topic.split('/');
      host.should.equal(hostname);
      machineName.should.equal(machineNameMap.machine1);
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerUnsubscribe');
      unsubscribed = true;
    });
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic) => {
      const [host, machineName] = topic.split('/');
      host.should.equal(hostname);
      machineName.should.equal(machineNameMap.machine1);
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
      published = true;
    });
    awsIoTClient.awsIoTTester.device().on('testerSubscribe', (topic) => {
      const [host, machineName] = topic.split('/');
      host.should.equal(hostname);
      machineName.should.equal(machineNameMap.machine1);
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerSubscribe');
      if (unsubscribed && published) return done();
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

  it('enabling a machine should cause publish metadata, and subscribe', (done) => {
    let published = false;
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic) => {
      const [host, machineName] = topic.split('/');
      host.should.equal(hostname);
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

  it('changing variables in a virtual machine should cause publish metadata', (done) => {
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic) => {
      const [host, machineName] = topic.split('/');
      host.should.equal(hostname);
      machineName.should.equal('machine3');
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
      return done();
    });
    const { variables } = conf.machines.machine3;
    variables[0].name = 'unit16';
    variables[0].format = 'unit16';
    sparkConfig.set('machines:machine3:variables', variables);
  });

  it('disabling and enabling a virtual machine should cause publish metadata', (done) => {
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic) => {
      const [host, machineName] = topic.split('/');
      host.should.equal(hostname);
      machineName.should.equal('machine3');
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
      return done();
    });
    sparkConfig.set('machines:machine3:settings:model:enable', false);
    sparkConfig.set('machines:machine3:settings:model:enable', true);
  });

  it('stop should succeed when started', (done) => {
    awsIoTClient.stop((err) => {
      if (err) throw err;
      return done();
    });
  });

  it('start should succeed with protocol authentication method set to buffer ', (done) => {
    conf.protocols['spark-protocol-aws-iot'].settings.model.authMethod = 'Buffer';
    conf.protocols['spark-protocol-aws-iot'].settings.model.basicIngestEnable = true;
    conf.protocols['spark-protocol-aws-iot'].settings.model.enable = true;
    awsIoTClient.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.equal(pkg.name);
      awsIoTClient.awsIoTTester.device().emit('connect');
      return done();
    });
  });

  conf.machines.machine2.variables.forEach((v) => {
    if (_.get(v, 'access', 'read') !== 'write') {
      it(`adding variable ${v.name} from machine2 should publish it to AWS in basic ingest mode`, (done) => {
        awsIoTClient.awsIoTTester.device().on('testerPublish', (topic, payload) => {
          const topicSplit = topic.split('/');
          const [aws, rules, actRule, host, machineName, variableName] = topicSplit;
          aws.should.equal('$aws');
          rules.should.equal('rules');
          actRule.should.equal(conf.protocols['spark-protocol-aws-iot'].settings.model.AWSIoTAct);
          host.should.equal(hostname);
          machineName.should.equal(machineNameMap.machine2);
          variableName.should.equal(v.name);
          const newData = JSON.parse(payload);
          v.value.should.equal(newData.value);
          awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
          return done();
        });
        const data = {
          machine: 'machine2',
          variable: v.name,
        };
        data[v.name] = v.value;
        sparkdb.add(data);
      });
    }
  });

  it('adding a combined variable from machine4 should publish it to AWS in combined format', (done) => {
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic, payload) => {
      const topicSplit = topic.split('/');
      const [aws, rules, actRule, host, machineName, variableName] = topicSplit;
      aws.should.equal('$aws');
      rules.should.equal('rules');
      actRule.should.equal(conf.protocols['spark-protocol-aws-iot'].settings.model.AWSIoTAct);
      host.should.equal(hostname);
      machineName.should.equal('machine4');
      variableName.should.equal(conf.machines.machine4.variables[0].name);
      const newData = JSON.parse(payload);
      const nVals = conf.machines.machine4.variables[0].value.length;
      for (let iVal = 0; iVal < nVals; iVal += 1) {
        newData.value[iVal].name.should
          .equal(conf.machines.machine4.variables[0].value[iVal].name);
        newData.value[iVal].value.should
          .equal(conf.machines.machine4.variables[0].value[iVal].value);
        newData.value[iVal].lowerLimit.should
          .equal(conf.machines.machine4.variables[0].value[iVal].lowerLimit);
        newData.value[iVal].upperLimit.should
          .equal(conf.machines.machine4.variables[0].value[iVal].upperLimit);
        newData.value[iVal].type.should
          .equal(conf.machines.machine4.variables[0].format);
      }
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
      return done();
    });
    const data = {
      machine: 'machine4',
      variable: conf.machines.machine4.variables[0].name,
    };
    data[conf.machines.machine4.variables[0].name] = conf.machines.machine4.variables[0].value;
    sparkdb.add(data);
  });

  it('adding a combined variable from machine5 should publish it with variable name overrides', (done) => {
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic, payload) => {
      const topicSplit = topic.split('/');
      const [aws, rules, actRule, host, machineName, variableName] = topicSplit;
      aws.should.equal('$aws');
      rules.should.equal('rules');
      actRule.should.equal(conf.protocols['spark-protocol-aws-iot'].settings.model.AWSIoTAct);
      host.should.equal(hostname);
      machineName.should.equal('machine5');
      variableName.should.equal(conf.machines.machine5.variables[0].name);
      const newData = JSON.parse(payload);
      const nVals = conf.machines.machine5.variables[0].value.length;
      for (let iVal = 0; iVal < nVals; iVal += 1) {
        newData.value[2 * iVal].name.should
          .equal(`${conf.machines.machine5.settings.model.overrideVariableNameBase}${iVal + 1}Name`);
        newData.value[2 * iVal].type.should.equal('string');
        newData.value[2 * iVal].value.should
          .equal(conf.machines.machine5.variables[0].value[iVal].name);
        newData.value[2 * iVal + 1].name.should
          .equal(`${conf.machines.machine5.settings.model.overrideVariableNameBase}${iVal + 1}`);
        newData.value[2 * iVal + 1].value.should
          .equal(conf.machines.machine5.variables[0].value[iVal].value);
        newData.value[2 * iVal + 1].lowerLimit.should
          .equal(conf.machines.machine5.variables[0].value[iVal].lowerLimit);
        newData.value[2 * iVal + 1].upperLimit.should
          .equal(conf.machines.machine5.variables[0].value[iVal].upperLimit);
        newData.value[2 * iVal + 1].type.should
          .equal(conf.machines.machine5.variables[0].format);
      }
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
      return done();
    });
    const data = {
      machine: 'machine5',
      variable: conf.machines.machine5.variables[0].name,
    };
    data[conf.machines.machine5.variables[0].name] = conf.machines.machine5.variables[0].value;
    sparkdb.add(data);
  });

  it('adding a combined net variable from machine6 should publish it to AWS in combined format', (done) => {
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic, payload) => {
      const topicSplit = topic.split('/');
      const [aws, rules, actRule, host, machineName, variableName] = topicSplit;
      aws.should.equal('$aws');
      rules.should.equal('rules');
      actRule.should.equal(conf.protocols['spark-protocol-aws-iot'].settings.model.AWSIoTAct);
      host.should.equal(hostname);
      machineName.should.equal('machine6');
      variableName.should.equal(conf.machines.machine6.variables[0].name);
      const newData = JSON.parse(payload);
      const nVals = conf.machines.machine6.variables[0].value.length;
      for (let iVal = 0; iVal < nVals; iVal += 1) {
        newData.value[iVal].name.should
          .equal(conf.machines.machine6.variables[0].value[iVal].name);
        parseInt(newData.value[iVal].value, 10).should
          .equal(conf.machines.machine6.variables[0].value[iVal].value);
        newData.value[iVal].type.should.equal('int32');
      }
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
      return done();
    });
    const data = {
      machine: 'machine6',
      variable: conf.machines.machine6.variables[0].name,
    };
    data[conf.machines.machine6.variables[0].name] = getCSVFromValueArray(conf
      .machines.machine6.variables[0].value);
    sparkdb.add(data);
  });

  it('adding a combined net variable from machine6 should publish it with variable name overrides', (done) => {
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic, payload) => {
      const topicSplit = topic.split('/');
      const [aws, rules, actRule, host, machineName, variableName] = topicSplit;
      aws.should.equal('$aws');
      rules.should.equal('rules');
      actRule.should.equal(conf.protocols['spark-protocol-aws-iot'].settings.model.AWSIoTAct);
      host.should.equal(hostname);
      machineName.should.equal('machine6');
      variableName.should.equal(conf.machines.machine6.variables[0].name);
      const newData = JSON.parse(payload);
      const nVals = conf.machines.machine6.variables[0].value.length;
      for (let iVal = 0; iVal < nVals; iVal += 1) {
        newData.value[2 * iVal].name.should
          .equal(`${conf.machines.machine6.settings.model.overrideVariableNameBase}${iVal + 1}Name`);
        newData.value[2 * iVal].type.should.equal('string');
        newData.value[2 * iVal].value.should
          .equal(conf.machines.machine6.variables[0].value[iVal].name);
        newData.value[2 * iVal + 1].name.should
          .equal(`${conf.machines.machine6.settings.model.overrideVariableNameBase}${iVal + 1}`);
        parseInt(newData.value[2 * iVal + 1].value, 10).should
          .equal(conf.machines.machine6.variables[0].value[iVal].value);
        newData.value[2 * iVal + 1].type.should.equal('int32');
      }
      awsIoTClient.awsIoTTester.device().removeAllListeners('testerPublish');
      return done();
    });
    sparkConfig.set('machines:machine6:settings:model:overrideVariableNameFlag', true);
    sparkConfig.set('machines:machine6:settings:model:overrideVariableNameBase', 'var');
    const data = {
      machine: 'machine6',
      variable: conf.machines.machine6.variables[0].name,
    };
    data[conf.machines.machine6.variables[0].name] = getCSVFromValueArray(conf
      .machines.machine6.variables[0].value);
    sparkdb.add(data);
  });


  it('disabling and enabling a machine should cause publish metadata', (done) => {
    awsIoTClient.awsIoTTester.device().on('testerPublish', (topic) => {
      const [host, machineName] = topic.split('/');
      host.should.equal(hostname);
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
      return done();
    });
    awsIoTClient.start(modules, () => {
    });
  });
});
