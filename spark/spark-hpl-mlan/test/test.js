/* jshint esversion: 6 */
require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const net = require('net');
const pkg = require('../package.json');
const SparkHplMLAN = require('../index.js');

const GET_PARAMETER_CMD_CODE = 69;
const CLIENT_PORT = 10000;
const RESPONSE_BUFFER_SIZE = 100;

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});


const testMachine = {
  info: {
    name: 'test-machine',
    fullname: 'Test machine',
    version: '1.0.0',
    description: 'Test Machine',
    hpl: 'net',
  },
  settings: {
    model: {
      enable: true,
      ipAddress: os.hostname(),
      port: CLIENT_PORT,
      controllerAddress: 1,
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'stringTest',
    description: 'String Test',
    format: 'char',
    commandCode: 20,
    byteOffset: 2,
    length: 11,
    value: '1-234567890',
  }, {
    name: 'uint8Test',
    description: 'UInt8 Test',
    format: 'uint8',
    commandCode: 21,
    byteOffset: 2,
    value: 123,
  }, {
    name: 'uint16Test',
    description: 'UInt16 Test',
    format: 'uint16',
    commandCode: 21,
    byteOffset: 3,
    value: 1234,
  }, {
    name: 'uint32Test',
    description: 'UInt32 Test',
    format: 'uint32',
    commandCode: 22,
    byteOffset: 2,
    value: 123456,
  }, {
    name: 'uint64Test',
    description: 'UInt64 Test',
    format: 'uint64',
    commandCode: 23,
    byteOffset: 2,
    value: 1234567,
  }, {
    name: 'int8Test',
    description: 'Int8 Test',
    format: 'int8',
    commandCode: 24,
    byteOffset: 2,
    value: 34,
  }, {
    name: 'int16Test',
    description: 'Int16 Test',
    format: 'int16',
    commandCode: 25,
    subcommandCode: 0,
    byteOffset: 2,
    value: 2345,
  }, {
    name: 'int32Test',
    description: 'Int32 Test',
    format: 'int32',
    commandCode: 25,
    subcommandCode: 1,
    byteOffset: 2,
    value: 234567,
  }, {
    name: 'int64Test',
    description: 'Int64 Test',
    format: 'int64',
    commandCode: 26,
    byteOffset: 2,
    value: 12345678,
  }, {
    name: 'bitTest',
    description: 'Bit Test',
    format: 'bool',
    commandCode: 27,
    byteOffset: 2,
    value: true,
  }, {
    name: 'floatTest',
    description: 'Float Test',
    format: 'float',
    commandCode: 28,
    subcommandCode: 0,
    byteOffset: 2,
    value: 1234567.0,
  }, {
    name: 'doubleTest',
    description: 'Double Test',
    format: 'double',
    commandCode: 28,
    subcommandCode: 0,
    byteOffset: 6,
    value: 2345678.0,
  }, {
    name: 'uint8ArrayTest',
    description: 'UInt8 Array Test',
    format: 'uint8',
    commandCode: 29,
    byteOffset: 2,
    array: true,
    length: 3,
    value: [12, 34, 56],
  }, {
    name: 'uint16ArrayTest',
    description: 'UInt16 Array Test',
    format: 'uint16',
    commandCode: 30,
    byteOffset: 2,
    array: true,
    length: 3,
    value: [1234, 3456, 4567],
  }, {
    name: 'uint32ArrayTest',
    description: 'UInt32 Array Test',
    format: 'uint32',
    commandCode: 31,
    byteOffset: 2,
    array: true,
    length: 3,
    value: [123456, 234567, 345678],
  }, {
    name: 'floatArrayTest',
    description: 'Float Array Test',
    format: 'float',
    commandCode: 32,
    byteOffset: 2,
    array: true,
    length: 3,
    value: [23456, 34567, 45678],
  }, {
    name: 'doubleArrayTest',
    description: 'Double Array Test',
    format: 'double',
    commandCode: 33,
    byteOffset: 2,
    array: true,
    length: 3,
    value: [23456.0, 34567.0, 45678.0],
  }, {
    name: 'getParameterTest',
    description: 'Get Parameter Test',
    format: 'uint16',
    commandCode: GET_PARAMETER_CMD_CODE,
    byteOffset: 2,
    parameterID: 'TST',
    value: 5678,
  }, {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
  }],
};

const invalidVariableMachine = {
  info: {
    name: 'invalid-variable-machine',
    fullname: 'Invalid variable machine',
    version: '1.0.0',
    description: 'Invalid Variable Machine',
    hpl: 'opcua',
  },
  settings: {
    model: {
      enable: true,
      ipAddress: os.hostname(),
      port: CLIENT_PORT,
      controllerAddress: 1,
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'invalid',
    description: 'Invalid',
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

let responseBuffer;
function bufferValue(value, variable, byteOffset, endOfData) {
  let newEndOfData = endOfData;
  switch (variable.format) {
    case 'uint8':
      responseBuffer.writeUInt8(value, byteOffset);
      if ((byteOffset + 1) > newEndOfData) newEndOfData = byteOffset + 1;
      break;
    case 'int8':
      responseBuffer.writeInt8(value, byteOffset);
      if ((byteOffset + 1) > newEndOfData) newEndOfData = byteOffset + 1;
      break;
    case 'uint16':
      responseBuffer.writeUInt16BE(value, byteOffset);
      if ((byteOffset + 2) > newEndOfData) newEndOfData = byteOffset + 2;
      break;
    case 'int16':
      responseBuffer.writeInt16BE(value, byteOffset);
      if ((byteOffset + 2) > newEndOfData) newEndOfData = byteOffset + 2;
      break;
    case 'uint32':
      responseBuffer.writeUInt32BE(value, byteOffset);
      if ((byteOffset + 4) > newEndOfData) newEndOfData = byteOffset + 4;
      break;
    case 'int32':
      responseBuffer.writeInt32BE(value, byteOffset);
      if ((byteOffset + 4) > newEndOfData) newEndOfData = byteOffset + 4;
      break;
    case 'uint64':
      responseBuffer.writeUInt32BE(value / 0x100000000, byteOffset);
      responseBuffer.writeUInt32BE(value % 0x100000000, byteOffset + 4);
      if ((byteOffset + 8) > newEndOfData) newEndOfData = byteOffset + 8;
      break;
    case 'int64':
      responseBuffer.writeInt32BE(value / 0x100000000, byteOffset);
      responseBuffer.writeInt32BE(value % 0x100000000, byteOffset + 4);
      if ((byteOffset + 8) > newEndOfData) newEndOfData = byteOffset + 8;
      break;
    case 'float':
      responseBuffer.writeFloatBE(value, byteOffset);
      if ((byteOffset + 4) > newEndOfData) newEndOfData = byteOffset + 4;
      break;
    case 'double':
      responseBuffer.writeDoubleBE(value, byteOffset);
      if ((byteOffset + 8) > newEndOfData) newEndOfData = byteOffset + 8;
      break;
    case 'bool':
      responseBuffer.writeUInt8(value ? 1 : 0, byteOffset);
      if ((byteOffset + 1) > newEndOfData) newEndOfData = byteOffset + 1;
      break;
    case 'char':
      responseBuffer.write(value, byteOffset, variable.length);
      if ((byteOffset + variable.length) > newEndOfData) {
        newEndOfData = byteOffset + variable.length;
      }
      break;
    default:
  }

  return newEndOfData;
}

let serverSocket;
let ignoreRequest = false;
net.createServer((socket) => {
  serverSocket = socket;
  socket.on('data', (data) => {
    if (!ignoreRequest) {
      if (data.readUInt8(0) === testMachine.settings.model.controllerAddress) {
        let checksum = 0;
        for (let iData = 0; iData < data.length; iData += 1) {
          checksum += data.readUInt8(iData);
        }
        checksum %= 0x100;
        if (checksum === 0xFF) {
          const commandCode = data.readUInt8(1);
          const subcommandCode = data.length === 4 ? data.readUInt8(2) : -1;
          responseBuffer = Buffer.alloc(RESPONSE_BUFFER_SIZE);
          responseBuffer.writeUInt8(testMachine.settings.model.controllerAddress, 0);
          responseBuffer.writeUInt8(commandCode, 1);
          let endOfData = 0;
          testMachine.variables.forEach((variable) => {
            const variableSubcommandCode = _.get(variable, 'subcommandCode', -1);
            if ((variable.commandCode === commandCode)
            && (variableSubcommandCode === subcommandCode)) {
              if (variable.array) {
                let { byteOffset } = variable;
                for (let iElem = 0; iElem < variable.length; iElem += 1) {
                  endOfData = bufferValue(variable.value[iElem], variable, byteOffset, endOfData);
                  switch (variable.format) {
                    case 'uint16':
                    case 'int16':
                      byteOffset += 2;
                      break;
                    case 'uint32':
                    case 'int32':
                    case 'float':
                      byteOffset += 4;
                      break;
                    case 'double':
                    case 'uint64':
                    case 'int64':
                      byteOffset += 8;
                      break;
                    default:
                      byteOffset += 1;
                  }
                }
              } else {
                endOfData = bufferValue(variable.value, variable, variable.byteOffset, endOfData);
              }
            }
          });
          let respChecksum = 0;
          for (let iBuf = 0; iBuf < endOfData; iBuf += 1) {
            respChecksum += responseBuffer.readUInt8(iBuf);
          }
          respChecksum = 0xFF - (respChecksum % 0x100);
          responseBuffer.writeUInt8(respChecksum, endOfData);
          socket.write(responseBuffer.slice(0, endOfData + 1));
        }
      }
    }
  });
}).listen(testMachine.settings.model.port);

describe('Spark HPL MLAN', () => {
  let sparkHplMLAN;

  it('successfully create a new net MLAN', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplMLAN = new SparkHplMLAN.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, null, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplMLAN.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplMLAN.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplMLAN.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl MLAN should produce data', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)) {
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
  }).timeout(4000);

  it('an alert should be raised and connection variables set false if the request is ignored', (done) => {
    let alertRaised = false;
    let connectedVariableSet = false;
    ignoreRequest = true;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('no-response-alert');
      alert.msg.should.equal(`${testMachine.info.name}: No Response from Equipment`);
      alert.description.should.equal('No response was received from the equiment after a data request');
      alertRaised = true;
      sparkAlert.removeAllListeners('raise');
      if (connectedVariableSet) return done();
      return undefined;
    });

    db.on('data', (data) => {
      if (data.variable === 'machineConnected') {
        data[data.variable].should.equal(false);
        connectedVariableSet = true;
        db.removeAllListeners('data');
        if (alertRaised) return done();
      }
      return undefined;
    });
  }).timeout(6000);

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplMLAN.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplMLAN.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed with machine enabled', (done) => {
    sparkHplMLAN.updateModel({
      enable: true,
      ipAddress: os.hostname(),
      port: CLIENT_PORT,
      controllerAddress: 1,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('an alert should be raised and connection variables set false if the server is destroyed', (done) => {
    let alertRaised = false;
    let connectedVariableSet = false;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('connectivity-alert');
      alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
      alert.description.should.equal('Unable to open connection. please verify the connection configuration');
      alertRaised = true;
      sparkAlert.removeAllListeners('raise');
      if (connectedVariableSet) return done();
      return undefined;
    });

    db.on('data', (data) => {
      if (data.variable === 'machineConnected') {
        data[data.variable].should.equal(false);
        connectedVariableSet = true;
        db.removeAllListeners('data');
        if (alertRaised) return done();
      }
      return undefined;
    });

    serverSocket.destroy();
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplMLAN.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new net MLAN', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplMLAN = new SparkHplMLAN.hpl(log.child({
      machine: invalidVariableMachine.info.name,
    }), invalidVariableMachine, invalidVariableMachine.settings.model,
    null, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error variables are invalid', (done) => {
    sparkHplMLAN.start(dataCb, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.message.should.equal('All variables require a command code');
      return done();
    });
  });
});
