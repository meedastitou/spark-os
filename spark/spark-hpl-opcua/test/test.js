/* jshint esversion: 6 */
require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const opcua = require('node-opcua');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplOpcua = require('../index.js');

const {
  OPCUAServer, Variant, VariantArrayType,
} = opcua;

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

// conversion object to generate opcua types from spark types
const sparkToOpcuaTypes = {
  float: 'Float',
  double: 'Double',
  int8: 'SByte',
  int16: 'Int16',
  int32: 'Int32',
  int64: 'Int64',
  uint8: 'Byte',
  uint16: 'UInt16',
  uint32: 'UInt32',
  uint64: 'UInt64',
  char: 'String',
  bool: 'Boolean',
};

const testMachine = {
  info: {
    name: 'test-machine',
    fullname: 'Test machine',
    version: '1.0.0',
    description: 'Test Machine',
    hpl: 'opcua',
  },
  settings: {
    model: {
      enable: true,
      scheme: 'req/res',
      opcuaHost: os.hostname(),
      opcuaPort: 4334,
    },
  },
  variables: [{
    name: 'count',
    description: 'Count',
    format: 'int16',
    nodeId: 'ns=2;s=count,S',
    value: 1234,
  },
  {
    name: 'temperature',
    description: 'Temperature',
    format: 'float',
    nodeId: 'ns=2;s=temperature,S',
    value: 23.0,
  },
  {
    name: 'uint64Test',
    description: 'UInt64 Test',
    format: 'uint64',
    nodeId: 'ns=2;s=uint64Test,S',
    value: 1234567,
  },
  {
    name: 'arrayVariable',
    description: 'Array Variable',
    format: 'int16',
    nodeId: 'ns=2;s=arrayVariable,A',
    array: true,
    destVariables: [
      {
        destVariable: 'destinationVariable',
        arrayIndex: 0,
      },
    ],
    value: [1, 2, 3],
  },
  {
    name: 'eventScalarTest',
    description: 'Event Scalar Test',
    format: 'int16',
    type: 'Event Value',
    eventValueName: '2:CycleNumber',
    eventField: { arrayType: 0, value: 123 },
    value: 123,
  },
  {
    name: 'eventStructureArrayFloatTest',
    description: 'Event Structure Array Float Test',
    format: 'float',
    type: 'Event Value',
    eventValueName: '2:ProcessValuesFloat',
    eventValueStructure: true,
    eventValueSelectedStructureName: 'name1',
    eventValueSelectedStructureMatchValue: '0',
    eventField: { arrayType: 1, value: [] },
    value: 12345.0,
  },
  {
    name: 'eventStructureArrayDoubleTest',
    description: 'Event Structure Array Double Test',
    format: 'double',
    type: 'Event Value',
    eventValueName: '2:ProcessValuesDouble',
    eventValueStructure: true,
    eventValueSelectedStructureName: 'name2',
    eventValueSelectedStructureMatchValue: '0',
    eventField: { arrayType: 1, value: [] },
    value: 23456.0,
  },
  {
    name: 'eventStructureArrayInt8Test',
    description: 'Event Structure Array Int8 Test',
    format: 'int8',
    type: 'Event Value',
    eventValueName: '2:ProcessValuesInt8',
    eventValueStructure: true,
    eventValueSelectedStructureName: 'name3',
    eventValueSelectedStructureMatchValue: '0',
    eventField: { arrayType: 1, value: [] },
    value: 125,
  },
  {
    name: 'eventStructureArrayInt16Test',
    description: 'Event Structure Array Int16 Test',
    format: 'int16',
    type: 'Event Value',
    eventValueName: '2:ProcessValuesInt16',
    eventValueStructure: true,
    eventValueSelectedStructureName: 'name1',
    eventValueSelectedStructureMatchValue: '1',
    eventField: { arrayType: 1, value: [] },
    value: 2345,
  },
  {
    name: 'eventStructureArrayInt32Test',
    description: 'Event Structure Array Int32 Test',
    format: 'int32',
    type: 'Event Value',
    eventValueName: '2:ProcessValuesInt32',
    eventValueStructure: true,
    eventValueSelectedStructureName: 'name2',
    eventValueSelectedStructureMatchValue: '1',
    eventField: { arrayType: 1, value: [] },
    value: 23456,
  },
  {
    name: 'eventStructureArrayInt64Test',
    description: 'Event Structure Array Int64 Test',
    format: 'int64',
    type: 'Event Value',
    eventValueName: '2:ProcessValuesInt64',
    eventValueStructure: true,
    eventValueSelectedStructureName: 'name3',
    eventValueSelectedStructureMatchValue: '1',
    eventField: { arrayType: 1, value: [] },
    value: 234567,
  },
  {
    name: 'eventStructureArrayUInt8Test',
    description: 'Event Structure Array UInt8 Test',
    format: 'uint8',
    type: 'Event Value',
    eventValueName: '2:ProcessValuesUInt8',
    eventValueStructure: true,
    eventValueSelectedStructureName: 'name1',
    eventValueSelectedStructureMatchValue: '2',
    eventField: { arrayType: 1, value: [] },
    value: 234,
  },
  {
    name: 'eventStructureArrayUInt16Test',
    description: 'Event Structure Array UInt16 Test',
    format: 'uint16',
    type: 'Event Value',
    eventValueName: '2:ProcessValuesUInt16',
    eventValueStructure: true,
    eventValueSelectedStructureName: 'name2',
    eventValueSelectedStructureMatchValue: '2',
    eventField: { arrayType: 1, value: [] },
    value: 3456,
  },
  {
    name: 'eventStructureArrayUInt32Test',
    description: 'Event Structure Array UInt32 Test',
    format: 'uint32',
    type: 'Event Value',
    eventValueName: '2:ProcessValuesUInt32',
    eventValueStructure: true,
    eventValueSelectedStructureName: 'name3',
    eventValueSelectedStructureMatchValue: '2',
    eventField: { arrayType: 1, value: [] },
    value: 34567,
  },
  {
    name: 'eventStructureArrayUInt64Test',
    description: 'Event Structure Array UInt64 Test',
    format: 'uint64',
    type: 'Event Value',
    eventValueName: '2:ProcessValuesUInt64',
    eventValueStructure: true,
    eventValueSelectedStructureName: 'name1',
    eventValueSelectedStructureMatchValue: '0',
    eventField: { arrayType: 1, value: [] },
    value: 345678,
  },
  {
    name: 'eventStructureArrayBoolTest',
    description: 'Event Structure Array Bool Test',
    format: 'bool',
    type: 'Event Value',
    eventValueName: '2:ProcessValuesBool',
    eventValueStructure: true,
    eventValueSelectedStructureName: 'name2',
    eventValueSelectedStructureMatchValue: '0',
    eventField: { arrayType: 1, value: [] },
    value: true,
  },
  {
    name: 'writeInt8',
    description: 'Write Int8',
    format: 'int8',
    nodeId: 'ns=2;s=writeInt8,S',
    access: 'write',
    value: 1,
  },
  {
    name: 'writeInt16',
    description: 'Write Int16',
    format: 'int16',
    nodeId: 'ns=2;s=writeInt16,S',
    access: 'write',
    value: 2,
  },
  {
    name: 'writeInt32',
    description: 'Write Int32',
    format: 'int32',
    nodeId: 'ns=2;s=writeInt32,S',
    access: 'write',
    value: 3,
  },
  {
    name: 'writeInt64',
    description: 'Write Int64',
    format: 'int64',
    nodeId: 'ns=2;s=writeInt64,S',
    access: 'write',
    value: 4,
  },
  {
    name: 'writeUint8',
    description: 'Write Uint8',
    format: 'uint8',
    nodeId: 'ns=2;s=writeUint8,S',
    access: 'write',
    value: 5,
  },
  {
    name: 'writeUint16',
    description: 'Write Uint16',
    format: 'uint16',
    nodeId: 'ns=2;s=writeUint16,S',
    access: 'write',
    value: 6,
  },
  {
    name: 'writeUint32',
    description: 'Write Uint32',
    format: 'uint32',
    nodeId: 'ns=2;s=writeUint32,S',
    access: 'write',
    value: 7,
  },
  {
    name: 'writeUint64',
    description: 'Write Uint64',
    format: 'uint64',
    nodeId: 'ns=2;s=writeUint64,S',
    access: 'write',
    value: 8,
  },
  {
    name: 'writeFloat',
    description: 'Write Float',
    format: 'float',
    nodeId: 'ns=2;s=writeFloat,S',
    access: 'write',
    value: 123.0,
  },
  {
    name: 'writeDouble',
    description: 'Write Double',
    format: 'double',
    nodeId: 'ns=2;s=writeDouble,S',
    access: 'write',
    value: 456.0,
  },
  {
    name: 'writeBool',
    description: 'Write Boolean',
    format: 'bool',
    nodeId: 'ns=2;s=writeBool,S',
    access: 'write',
    value: true,
  },
  {
    name: 'writeChar',
    description: 'Write Char',
    format: 'char',
    nodeId: 'ns=2;s=writeChar,S',
    access: 'write',
    value: 'A',
  },
  {
    name: 'writeInvalid',
    description: 'Write Invalid',
    nodeId: 'ns=2;s=writeInvalid,S',
    access: 'write',
    value: 0,
  },
  {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
  }],
};

const noNodeIdMachine = {
  info: {
    name: 'no-node-id-machine',
    fullname: 'No node id machine',
    version: '1.0.0',
    description: 'No Node ID Machine',
    hpl: 'opcua',
  },
  settings: {
    model: {
      enable: true,
      scheme: 'req/res',
      opcuaHost: os.hostname(),
      opcuaPort: 4334,
    },
  },
  variables: [{
    name: 'node-node-id',
    description: 'No Node ID',
    format: 'int16',
  }],
};

const db = new EventEmitter();

function dataCb(machine, variable, value, done) {
  const data = {
    machine: machine.info.name,
    variable: variable.name,
  };
  data[variable.name] = value;
  log.debug({ data });
  db.emit('data', data);
  done(null);
}

function configUpdateCb(machine, done) {
  log.debug({ machine });
  return done(null);
}

let alerts = {};
const sparkAlert = new EventEmitter();
sparkAlert.getAlerter = function getAlerter() {
  return {
    clearAll(done) {
      return done(null);
    },
    preLoad: function preLoad(preloadAlerts) {
      alerts = preloadAlerts;
    },
    raise: function raise(_alert) {
      const alert = _alert;
      if (_.has(alerts, alert.key)) _.extend(alert, alerts[alert.key]);
      Object.keys(alert).forEach((k) => {
        // check if the key is a function
        if (typeof alert[k] === 'function') {
          // if it is then run the function and replace
          // the key with the output
          alert[k] = alert[k](alert);
        }
      });
      sparkAlert.emit('raise', alert);
    },
    clear(key) {
      log.debug({ key }, 'Cleared alert');
    },
  };
};

const config = {};
const sparkConfig = new EventEmitter();
sparkConfig.set = function set(key, value, done) {
  config[key] = value;
  if (done) return done(null);
  return undefined;
};
sparkConfig.get = function get(key, done) {
  if (done) {
    return done(null, config[key]);
  }

  return config[key];
};

function setEventVariableStructureArrayMembers() {
  for (let iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
    const variable = testMachine.variables[iVar];
    if ((_.get(variable, 'type') === 'Event Value')
    && _.get(variable, 'eventValueStructure')
    && (variable.eventField.arrayType === 1)) {
      variable.eventValueStructureMembers = [
        {
          memberName: 'name',
          memberFormat: 'char',
          memberSpecialRole: 'Name',
        },
        {
          memberName: 'value',
          memberFormat: variable.format,
          memberSpecialRole: 'Value',
        },
        {
          memberName: 'cavityId',
          memberFormat: 'int32',
          memberSpecialRole: 'Match Value',
        },
      ];
    }
  }
}

function buildEventVariableStructureArrayBuffers() {
  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'type') === 'Event Value')
    && _.get(variable, 'eventValueStructure')
    && (variable.eventField.arrayType === 1)) {
      const iMatchValue = parseInt(variable.eventValueSelectedStructureMatchValue, 10);
      for (let iName = 1; iName <= 3; iName += 1) {
        const name = `name${iName}`;
        for (let iMatch = 0; iMatch < 3; iMatch += 1) {
          const buffer = Buffer.alloc(50);
          buffer[0] = 1;
          let iBuf = 4;
          buffer.writeUInt32LE(name.length, iBuf);
          iBuf += 4;
          buffer.write(name, iBuf, iBuf + name.length);
          iBuf += name.length;
          let value = 0;
          if ((iMatch === iMatchValue) && (name === variable.eventValueSelectedStructureName)) {
            if (variable.format === 'bool') {
              value = variable.value ? 1 : 0;
            } else {
              ({ value } = variable);
            }
          }
          switch (variable.eventValueStructureMembers[1].memberFormat) {
            case 'float':
              buffer.writeFloatLE(value, iBuf);
              iBuf += 4;
              break;
            case 'double':
              buffer.writeDoubleLE(value, iBuf);
              iBuf += 8;
              break;
            case 'int8':
              buffer.writeInt8(value, iBuf);
              iBuf += 1;
              break;
            case 'int16':
              buffer.writeInt16LE(value, iBuf);
              iBuf += 2;
              break;
            case 'int32':
              buffer.writeInt32LE(value, iBuf);
              iBuf += 4;
              break;
            case 'int64':
              buffer.writeInt32LE(value % 0x100000000, iBuf);
              buffer.writeInt32LE(Math.floor(value / 0x100000000), iBuf + 4);
              iBuf += 8;
              break;
            case 'uint8':
            case 'bool':
              buffer.writeUInt8(value, iBuf);
              iBuf += 1;
              break;
            case 'uint16':
              buffer.writeUInt16LE(value, iBuf);
              iBuf += 2;
              break;
            case 'uint32':
              buffer.writeUInt32LE(value, iBuf);
              iBuf += 4;
              break;
            case 'uint64':
              buffer.writeUInt32LE(value, iBuf);
              buffer.writeUInt32LE(0, iBuf + 4);
              iBuf += 8;
              break;
            default:
          }
          buffer.writeUInt32LE(iMatch, iBuf);
          iBuf += 4;
          variable.eventField.value.push({ buffer: buffer.slice(0, iBuf) });
        }
      }
    }
  });
}

setEventVariableStructureArrayMembers();
buildEventVariableStructureArrayBuffers();

const server = new OPCUAServer({
  port: 4334,
  nodeset_filename: [
    opcua.nodesets.standard_nodeset_file,
    opcua.nodesets.di_nodeset_filename,
  ],
});

server.initialize(() => {
  const { addressSpace } = server.engine;
  const rootFolder = addressSpace.findNode('RootFolder');

  const thisMachine = addressSpace.getNamespace(2).addFolder(rootFolder.objects, {
    browseName: testMachine.info.name,
    nodeId: `s=${testMachine.info.name}`,
  });
  testMachine.variables.forEach((variable) => {
    if (!_.get(variable, 'machineConnected', false)) {
      const dataType = _.get(sparkToOpcuaTypes, variable.format, 'Int16');
      const isArray = _.get(variable, 'array', false);

      let accessLevel = opcua.makeAccessLevelFlag('CurrentRead');
      if (_.get(variable, 'access') === 'write') {
        accessLevel = opcua.makeAccessLevelFlag('CurrentWrite');
      }

      const value = new Variant({
        dataType,
        arrayType: isArray ? VariantArrayType.Array : VariantArrayType.Scalar,
        value: variable.value,
      });
      addressSpace.getNamespace(2).addVariable({
        organizedBy: thisMachine,
        browseName: variable.name,
        minimumSamplingInterval: 500,
        dataType,
        isArray,
        accessLevel,
        userAccessLevel: accessLevel,
        description: variable.description,
        nodeId: `s=${variable.name},${isArray ? 'A' : 'S'}`,
        value,
      });
    }
  });

  server.start(() => {
  });
});

describe('Spark HPL OPC-UA', () => {
  let sparkHplOpcua;

  it('successfully create a new opcua hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplOpcua = new SparkHplOpcua.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplOpcua.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplOpcua.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('before a successfull start the connection status should be false', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(false);
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplOpcua.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(6000);

  it('spark hpl opcua should produce data in req/res mode', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && (_.get(variable, 'type', 'Monitored') !== 'Event Value')
       && (_.get(variable, 'access', 'read') === 'read')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === readVariables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('after a successful connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('a destination variable should be set if it exists', (done) => {
    db.on('data', (data) => {
      if (data.variable === 'destinationVariable') {
        data[data.variable].should.equal(1);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
  });

  it('stop should succeed', (done) => {
    sparkHplOpcua.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplOpcua.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      // delay to allow subscriptions to be created before they are terminated
      setTimeout(() => done(), 10);
      return undefined;
    });
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplOpcua.updateModel({
      enable: false,
      scheme: 'pub/sub',
      opcuaHost: os.hostname(),
      opcuaPort: 4334,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl opcua should produce data when pub/sub mode enabled', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && (_.get(variable, 'type', 'Monitored') !== 'Event Value')
       && (_.get(variable, 'access', 'read') === 'read')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === readVariables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });

    sparkHplOpcua.updateModel({
      enable: true,
      scheme: 'pub/sub',
      opcuaHost: os.hostname(),
      opcuaPort: 4334,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed`, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplOpcua.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });


  it('writing variable with invalid format should fail', (done) => {
    const value = { variable: 'writeInvalid' };
    value[value.variable] = 0;
    sparkHplOpcua.writeData(value, (err) => {
      if (!err) throw new Error('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('writing a non-existent variable should fail without an error', (done) => {
    const value = { variable: 'undefinedVariable' };
    value[value.variable] = 0;
    sparkHplOpcua.writeData(value, () => done());
  });

  it('writing a machine connected variable should fail without an error', (done) => {
    const value = { variable: 'machineConnected' };
    value[value.variable] = 0;
    sparkHplOpcua.writeData(value, () => done());
  });

  it('stop should succeed', (done) => {
    sparkHplOpcua.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new opcua hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplOpcua = new SparkHplOpcua.hpl(log.child({
      machine: noNodeIdMachine.info.name,
    }), noNodeIdMachine, noNodeIdMachine.settings.model,
    sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });
});
