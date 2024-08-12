/* jshint esversion: 6 */
require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const net = require('net');
const pkg = require('../package.json');
const SparkHplEthernetIP = require('../index.js');

const CLIENT_PORT = 44818;
const MAX_RESP_DATA_BYTES = 100;

const CMD_INDEX = 0;
const RESPONSE_ERROR_CODE_INDEX = 8;
const CONNECTION_ERROR_CODE_INDEX = 42;
const SERVICE_CODE_INDEX = 46;
const ATTRIBUTE_ID_INDEX = 53;
const ATTRIBUTE_DATA_INDEX = 50;
const VARIABLE_PATH_LEN_INDEX = 47;
const VARIABLE_DATA_TYPE_INDEX = 50;
const VARIABLE_DATA_INDEX = 52;

const REGISTER_CMD = 0x65;
const CONNECT_CMD = 0x6F;
const READ_CMD = 0x70;
const SERVICE_CODE_READ_ATTRIBUTE = 0x0E;
const ONE_BYTE_INDEX_CODE = 0x28;
const TWO_BYTE_INDEX_CODE = 0x29;

let sparkHplEthernetIP;
let forceResponseError = false;

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});


const testMachine1 = {
  info: {
    name: 'test-machine 1',
    fullname: 'Test machine 1',
    version: '1.0.0',
    description: 'Test Machine 1',
    hpl: 'ethernetip',
  },
  settings: {
    model: {
      enable: false,
      hostName: os.hostname(),
      port: CLIENT_PORT,
      mode: 'Omron',
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'vendorIdAttributeTest',
    description: 'Vendor ID Test',
    format: 'uint16',
    requestType: 'vendor ID',
    value: 0x002F,
  },
  {
    name: 'deviceTypeAttributeTest',
    description: 'Device Type Test',
    format: 'uint16',
    requestType: 'device type',
    value: 0x000C,
  },
  {
    name: 'productCodeAttributeTest',
    description: 'Product Code Test',
    format: 'uint16',
    requestType: 'product code',
    value: 0x067D,
  },
  {
    name: 'serialNumberAttributeTest',
    description: 'Serial Number Test',
    format: 'uint16',
    requestType: 'serial number',
    value: 1234,
  },
  {
    name: 'statusAttributeTest',
    description: 'Status Test',
    format: 'uint16',
    requestType: 'status',
    value: 0x555,
  },
  {
    name: 'revisionAttributeTest',
    description: 'Revision Test',
    format: 'uint16',
    requestType: 'revision',
    value: [2, 3],
  },
  {
    name: 'productNameAttributeTest',
    description: 'Product Name Test',
    format: 'char',
    requestType: 'product name',
    value: 'NJ501-1300',
  },
  {
    name: 'int8Test',
    description: 'Int8 Test',
    format: 'int8',
    requestType: 'variable',
    controllerVariable: 'varA.memB',
    value: 123,
  },
  {
    name: 'int8ArrayTest',
    description: 'Int8 Array Test',
    format: 'int8',
    requestType: 'variable',
    controllerVariable: 'varA.memB1',
    array: true,
    value: [12, 23, 34],
  },
  {
    name: 'int16Test',
    description: 'Int16 Test',
    format: 'int16',
    requestType: 'variable',
    controllerVariable: 'varA[1].memC[2,300]',
    value: 2345,
  },
  {
    name: 'int16ArrayTest',
    description: 'Int16 Array Test',
    format: 'int16',
    requestType: 'variable',
    controllerVariable: 'varA.memC1',
    array: true,
    value: [123, 234, 456],
  },
  {
    name: 'int32Test',
    description: 'Int32 Test',
    format: 'int32',
    requestType: 'variable',
    controllerVariable: 'varA.memD',
    value: 23456,
  },
  {
    name: 'int32ArrayTest',
    description: 'Int32 Array Test',
    format: 'int32',
    requestType: 'variable',
    controllerVariable: 'varA.memD1',
    array: true,
    value: [12345, 23456, 34567, 45678],
  },
  {
    name: 'int64Test',
    description: 'Int64 Test',
    format: 'int64',
    requestType: 'variable',
    controllerVariable: 'varA.memE',
    value: 2345678,
  },
  {
    name: 'int64ArrayTest',
    description: 'Int64 Array Test',
    format: 'int64',
    requestType: 'variable',
    controllerVariable: 'varA.memE1',
    array: true,
    value: [1234567, 2345678, 3456789],
  },
  {
    name: 'uint8Test',
    description: 'UInt8 Test',
    format: 'uint8',
    requestType: 'variable',
    controllerVariable: 'varB.memB',
    value: 234,
  },
  {
    name: 'uint8ArrayTest',
    description: 'UInt8 Array Test',
    format: 'uint8',
    requestType: 'variable',
    controllerVariable: 'varB.memB1',
    array: true,
    value: [23, 34, 45],
  },
  {
    name: 'uint16Test',
    description: 'UInt16 Test',
    format: 'uint16',
    requestType: 'variable',
    controllerVariable: 'varB[1].memC[2,300]',
    value: 3456,
  },
  {
    name: 'uint16ArrayTest',
    description: 'UInt16 Array Test',
    format: 'uint16',
    requestType: 'variable',
    controllerVariable: 'varB.memC1',
    array: true,
    value: [234, 345, 567],
  },
  {
    name: 'uint32Test',
    description: 'UInt32 Test',
    format: 'uint32',
    requestType: 'variable',
    controllerVariable: 'varB.memD',
    value: 34567,
  },
  {
    name: 'uint32ArrayTest',
    description: 'UInt32 Array Test',
    format: 'uint32',
    requestType: 'variable',
    controllerVariable: 'varB.memD1',
    array: true,
    value: [23456, 34567, 45678, 56789],
  },
  {
    name: 'uint64Test',
    description: 'UInt64 Test',
    format: 'uint64',
    requestType: 'variable',
    controllerVariable: 'varB.memE',
    value: 3456789,
  },
  {
    name: 'uint64ArrayTest',
    description: 'UInt64 Array Test',
    format: 'uint64',
    requestType: 'variable',
    controllerVariable: 'varB.memE1',
    array: true,
    value: [2345678, 3456789, 4567890],
  },
  {
    name: 'boolTest',
    description: 'Bool Test',
    format: 'bool',
    requestType: 'variable',
    controllerVariable: 'varC',
    value: true,
  },
  {
    name: 'boolArrayTest',
    description: 'Bool Array Test',
    format: 'bool',
    requestType: 'variable',
    controllerVariable: 'varC.memA',
    array: true,
    value: [true, false, true],
  },
  {
    name: 'floatTest',
    description: 'Float Test',
    format: 'float',
    requestType: 'variable',
    controllerVariable: 'varD[1].memA',
    value: 23456.0,
  },
  {
    name: 'floatArrayTest',
    description: 'Float Array Test',
    format: 'float',
    requestType: 'variable',
    controllerVariable: 'varD[1].memB',
    array: true,
    value: [1234.0, 2345.0, 4567.0],
  },
  {
    name: 'doubleTest',
    description: 'Double Test',
    format: 'double',
    requestType: 'variable',
    controllerVariable: 'varD[1].memC',
    value: 234567.0,
  },
  {
    name: 'doubleArrayTest',
    description: 'Double Array Test',
    format: 'double',
    requestType: 'variable',
    controllerVariable: 'varD[1].memD',
    array: true,
    value: [12345.0, 23456.0, 45678.0],
  },
  {
    name: 'stringTest',
    description: 'String Test',
    format: 'char',
    requestType: 'variable',
    controllerVariable: 'varE',
    value: 'ABCD',
  }],
};

const testMachine2 = {
  info: {
    name: 'test-machine 2',
    fullname: 'Test machine 2',
    version: '1.0.0',
    description: 'Test Machine 2',
    hpl: 'ethernetip',
  },
  settings: {
    model: {
      enable: true,
      hostName: os.hostname(),
      port: CLIENT_PORT,
      mode: 'Standard',
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'serialNumberAttributeTest',
    description: 'Serial Number Test',
    format: 'uint16',
    requestType: 'serial number',
    value: 2345,
  },
  {
    name: 'statusAttributeTest',
    description: 'Status Test',
    format: 'uint16',
    requestType: 'status',
    value: 0x550,
  },
  {
    name: 'revisionAttributeTest',
    description: 'Revision Test',
    format: 'uint16',
    requestType: 'revision',
    value: [1, 2],
  },
  {
    name: 'productNameAttributeTest',
    description: 'Product Name Test',
    format: 'char',
    requestType: 'product name',
    value: 'NJ501-1400',
  },
  {
    name: 'int16Test',
    description: 'Int16 Test',
    format: 'int16',
    requestType: 'variable',
    controllerVariable: 'varA.memB',
    value: 12345,
  },
  {
    name: 'int32Test',
    description: 'Int32 Test',
    format: 'int32',
    requestType: 'variable',
    controllerVariable: 'varB.memA',
    programScope: true,
    programName: 'prog1',
    value: 23456,
  }],
};

const attributeNames = [
  'none',
  'vendor ID',
  'device type',
  'product code',
  'revision',
  'status',
  'serial number',
  'product name',
];

const connectionEmitter = new EventEmitter();
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

function getVariableByAttribute(attribute) {
  for (let iVar = 0; iVar < testMachine1.variables.length; iVar += 1) {
    if (attributeNames[attribute] === testMachine1.variables[iVar].requestType) {
      return testMachine1.variables[iVar];
    }
  }
  return null;
}

function getVariableByControllerVariableName(name) {
  for (let iVar = 0; iVar < testMachine1.variables.length; iVar += 1) {
    if (name === testMachine1.variables[iVar].controllerVariable) {
      return testMachine1.variables[iVar];
    }
  }
  return null;
}

function getVariableValue(variable, index) {
  if (_.get(variable, 'array', false)) {
    return variable.value[index];
  }

  return variable.value;
}

function decodeVariableName(data) {
  let varName = '';
  let iPath = VARIABLE_PATH_LEN_INDEX + 2;
  const pathEnd = iPath + (2 * data[VARIABLE_PATH_LEN_INDEX]);
  while (iPath < pathEnd) {
    const segLen = data[iPath];
    if (varName.length !== 0) varName += '.';
    varName += data.toString('ascii', iPath + 1, iPath + segLen + 1);
    iPath += segLen + 1;
    if ((segLen % 2) !== 0) iPath += 1;
    if ((data[iPath] === ONE_BYTE_INDEX_CODE) || (data[iPath] === TWO_BYTE_INDEX_CODE)) {
      if (data[iPath] === ONE_BYTE_INDEX_CODE) {
        varName += `[${data[iPath + 1]}`;
        iPath += 2;
      } else {
        varName += `[${data.readUInt16LE(iPath + 2)}`;
        iPath += 4;
      }
      if ((data[iPath] === ONE_BYTE_INDEX_CODE) || (data[iPath] === TWO_BYTE_INDEX_CODE)) {
        if (data[iPath] === ONE_BYTE_INDEX_CODE) {
          varName += `,${data[iPath + 1]}`;
          iPath += 3;
        } else {
          varName += `,${data.readUInt16LE(iPath + 2)}`;
          iPath += 5;
        }
      } else {
        iPath += 1;
      }
      varName += ']';
    } else {
      iPath += 1;
    }
  }
  return varName;
}

let serverSocket = null;
net.createServer((socket) => {
  serverSocket = socket;
  socket.on('data', (data) => {
    let respBuf;

    switch (data[CMD_INDEX]) {
      case REGISTER_CMD: {
        respBuf = Buffer.from(data);
        respBuf.writeUInt32LE(0, RESPONSE_ERROR_CODE_INDEX);
        // force one connection error
        forceResponseError = true;
        socket.write(respBuf);
        break;
      }
      case CONNECT_CMD: {
        respBuf = Buffer.from(data);
        if (forceResponseError) {
          respBuf.writeUInt32LE(1, RESPONSE_ERROR_CODE_INDEX);
          // after first force connection error, allow retry to work
          forceResponseError = false;
        } else {
          respBuf.writeUInt32LE(0, RESPONSE_ERROR_CODE_INDEX);
          connectionEmitter.emit('connected');
        }
        respBuf.writeUInt16LE(0, CONNECTION_ERROR_CODE_INDEX);
        socket.write(respBuf);
        break;
      }
      case READ_CMD: {
        if (data[SERVICE_CODE_INDEX] === SERVICE_CODE_READ_ATTRIBUTE) {
          switch (data[ATTRIBUTE_ID_INDEX]) {
            case 0x04: { // revision
              const revisionVariable = getVariableByAttribute(0x04);
              respBuf = Buffer.from(data);
              respBuf.writeUInt32LE(0, RESPONSE_ERROR_CODE_INDEX);
              respBuf.writeUInt8(revisionVariable.value[0], ATTRIBUTE_DATA_INDEX);
              respBuf.writeUInt8(revisionVariable.value[1], ATTRIBUTE_DATA_INDEX + 1);
              break;
            }
            case 0x07: { // product name
              const productNameVariable = getVariableByAttribute(0x07);
              respBuf = Buffer.allocUnsafe(ATTRIBUTE_DATA_INDEX + productNameVariable.value.length);
              data.copy(respBuf);
              respBuf.writeUInt32LE(0, RESPONSE_ERROR_CODE_INDEX);
              respBuf.writeUInt32LE(0, RESPONSE_ERROR_CODE_INDEX);
              respBuf.write(productNameVariable.value, ATTRIBUTE_DATA_INDEX);
              break;
            }
            default:
              respBuf = Buffer.from(data);
              respBuf.writeUInt32LE(0, RESPONSE_ERROR_CODE_INDEX);
              respBuf.writeUInt16LE(getVariableByAttribute(data[ATTRIBUTE_ID_INDEX]).value,
                ATTRIBUTE_DATA_INDEX);
          }
        } else {
          respBuf = Buffer.allocUnsafe(data.length + MAX_RESP_DATA_BYTES);
          data.copy(respBuf);
          if (forceResponseError) {
            respBuf.writeUInt32LE(1, RESPONSE_ERROR_CODE_INDEX);
          } else {
            respBuf.writeUInt32LE(0, RESPONSE_ERROR_CODE_INDEX);
          }
          respBuf[RESPONSE_ERROR_CODE_INDEX] = forceResponseError ? 1 : 0;
          const variable = getVariableByControllerVariableName(decodeVariableName(data));
          const numValues = _.get(variable, 'array', false) ? variable.value.length : 1;
          let iRespBuf = VARIABLE_DATA_INDEX;
          switch (variable.format) {
            case 'bool':
              respBuf[VARIABLE_DATA_TYPE_INDEX] = 0xC1;
              for (let iValue = 0; iValue < numValues; iValue += 1) {
                respBuf.writeInt16LE(getVariableValue(variable, iValue) ? 1 : 0, iRespBuf);
                iRespBuf += 2;
              }
              break;
            case 'int8':
              respBuf[VARIABLE_DATA_TYPE_INDEX] = 0xC2;
              for (let iValue = 0; iValue < numValues; iValue += 1) {
                respBuf.writeInt16LE(getVariableValue(variable, iValue), iRespBuf);
                iRespBuf += 2;
              }
              break;
            case 'int16':
              respBuf[VARIABLE_DATA_TYPE_INDEX] = 0xC3;
              for (let iValue = 0; iValue < numValues; iValue += 1) {
                respBuf.writeInt16LE(getVariableValue(variable, iValue), iRespBuf);
                iRespBuf += 2;
              }
              break;
            case 'int32':
              respBuf[VARIABLE_DATA_TYPE_INDEX] = 0xC4;
              for (let iValue = 0; iValue < numValues; iValue += 1) {
                respBuf.writeInt32LE(getVariableValue(variable, iValue), iRespBuf);
                iRespBuf += 4;
              }
              break;
            case 'int64':
              respBuf[VARIABLE_DATA_TYPE_INDEX] = 0xC5;
              for (let iValue = 0; iValue < numValues; iValue += 1) {
                const value = getVariableValue(variable, iValue);
                respBuf.writeInt32LE(value % 0x100000000, iRespBuf);
                respBuf.writeInt32LE(Math.floor(value / 0x100000000), iRespBuf + 4);
                iRespBuf += 8;
              }
              break;
            case 'uint8':
              respBuf[VARIABLE_DATA_TYPE_INDEX] = 0xC6;
              for (let iValue = 0; iValue < numValues; iValue += 1) {
                respBuf.writeUInt16LE(getVariableValue(variable, iValue), iRespBuf);
                iRespBuf += 2;
              }
              break;
            case 'uint16':
              respBuf[VARIABLE_DATA_TYPE_INDEX] = 0xC7;
              for (let iValue = 0; iValue < numValues; iValue += 1) {
                respBuf.writeUInt16LE(getVariableValue(variable, iValue), iRespBuf);
                iRespBuf += 2;
              }
              break;
            case 'uint32':
              respBuf[VARIABLE_DATA_TYPE_INDEX] = 0xC8;
              for (let iValue = 0; iValue < numValues; iValue += 1) {
                respBuf.writeUInt32LE(getVariableValue(variable, iValue), iRespBuf);
                iRespBuf += 4;
              }
              break;
            case 'uint64':
              respBuf[VARIABLE_DATA_TYPE_INDEX] = 0xC9;
              for (let iValue = 0; iValue < numValues; iValue += 1) {
                const value = getVariableValue(variable, iValue);
                respBuf.writeUInt32LE(value % 0x100000000, iRespBuf);
                respBuf.writeUInt32LE(Math.floor(value / 0x100000000), iRespBuf + 4);
                iRespBuf += 8;
              }
              break;
            case 'float':
              respBuf[VARIABLE_DATA_TYPE_INDEX] = 0xCA;
              for (let iValue = 0; iValue < numValues; iValue += 1) {
                respBuf.writeFloatLE(getVariableValue(variable, iValue), iRespBuf);
                iRespBuf += 4;
              }
              break;
            case 'double':
              respBuf[VARIABLE_DATA_TYPE_INDEX] = 0xCB;
              for (let iValue = 0; iValue < numValues; iValue += 1) {
                respBuf.writeDoubleLE(getVariableValue(variable, iValue), iRespBuf);
                iRespBuf += 8;
              }
              break;
            case 'char':
              respBuf[VARIABLE_DATA_TYPE_INDEX] = 0xD0;
              respBuf.write(variable.value, iRespBuf, variable.value.length);
              iRespBuf += variable.value.length;
              break;
            default:
          }
          respBuf = respBuf.slice(0, iRespBuf);
        }
        socket.write(respBuf);
        break;
      }
      default:
    }
  });
}).listen(testMachine1.settings.model.port);

describe('Spark HPL Ethernet/IP', () => {
  it('successfully create a new Ethernet/IP hpl in Omron mode', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplEthernetIP = new SparkHplEthernetIP.hpl(log.child({
      machine: testMachine1.info.name,
    }), testMachine1, testMachine1.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplEthernetIP.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplEthernetIP.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('before a successfull start the connection status should be false in Omron mode', (done) => {
    sparkConfig.get(`machines:${testMachine1.info.name}:settings:model:connectionStatus`).should.equal(false);
    return done();
  });

  it('start should succeed with machine disabled', (done) => {
    sparkHplEthernetIP.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('stop should succeeds', (done) => {
    sparkHplEthernetIP.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed with machine enabled', (done) => {
    testMachine1.settings.model.enable = true;
    sparkHplEthernetIP.updateModel(testMachine1.settings.model, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('the connection should be successful after one retry', (done) => {
    connectionEmitter.on('connected', () => done());
  }).timeout(6000);

  it('spark Ethernet/IP hpl should produce data in Omron mode', (done) => {
    const gotDataForVar = [];
    db.on('data', (data) => {
      testMachine1.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachine1.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('after a successful connection the connection status should be true in Omron mode', (done) => {
    sparkConfig.get(`machines:${testMachine1.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('an alert should be raised if there is a response error', (done) => {
    forceResponseError = true;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.include('read-fail-');
      alert.msg.should.equal('Ethernet/IP: Read Failed for Variable');
      alert.description.should.include('Read failed for variable');
      sparkAlert.removeAllListeners('raise');
      // destroy socket to trigger end event
      serverSocket.destroy();
      return done();
    });
  });

  it('stop should succeeds', (done) => {
    sparkHplEthernetIP.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new Ethernet/IP hpl in standard mode', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplEthernetIP = new SparkHplEthernetIP.hpl(log.child({
      machine: testMachine2.info.name,
    }), testMachine2, testMachine2.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('before a successfull start the connection status should be false in standard mode', (done) => {
    sparkConfig.get(`machines:${testMachine2.info.name}:settings:model:connectionStatus`).should.equal(false);
    return done();
  });

  it('start should succeed with machine enabled', (done) => {
    sparkHplEthernetIP.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      sparkHplEthernetIP.tester.prototype.setVariables(testMachine2.variables);
      return done();
    });
  });

  it('spark Ethernet/IP hpl should produce data in standard mode', (done) => {
    const gotDataForVar = [];
    db.on('data', (data) => {
      testMachine2.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachine2.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('after a successful connection the connection status should be true in standard mode', (done) => {
    sparkConfig.get(`machines:${testMachine2.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('stop should succeeds', (done) => {
    sparkHplEthernetIP.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('start should raise an alert if the connection fails', (done) => {
    sparkHplEthernetIP.tester.prototype.setRejectConnection(true);
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('plc-connect-error');
      alert.msg.should.equal('Ethernet/IP: Failed to Connect to Controller');
      alert.description.should.equal('Failed to connect to the controller. Check the controller settings.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplEthernetIP.start(dataCb, configUpdateCb, () => {
    });
  });
});
