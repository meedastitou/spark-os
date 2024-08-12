/* jshint esversion: 6 */
require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const net = require('net');
// const async = require('async');
const pkg = require('../package.json');
const SparkHplSrtp = require('../index.js');

const SERVER_PORT = 18245;
const SEQUENCE_INDEX1 = 2;
const SEQUENCE_INDEX2 = 30;
const DATA_INDEX = 44;
const strBufferWrite = [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xd4,
  20, 0x0e, 0, 0, 0, 38, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 2, 1, 1, 0x7c, 1];

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
    description: 'Test machine',
    hpl: 'srtp',
  },
  settings: {
    model: {
      enable: true,
      hostName: os.hostname(),
      requestFrequency: 5,
    },
  },
  variables: [{
    name: 'count',
    description: 'Count',
    format: 'int16',
    memoryArea: '%AI',
    address: 1180,
    value: 1234,
    access: 'read',
  },
  {
    name: 'temperature',
    description: 'Temperature',
    format: 'float',
    memoryArea: '%T',
    address: 3205,
    value: 23.0,
    access: 'read',
  },
  {
    name: 'arrayVariable',
    description: 'Array Variable',
    format: 'uint16',
    memoryArea: '%AQ',
    address: 225,
    array: true,
    length: 3,
    value: [1, 2, 3, 4],
    access: 'read',
  },
  {
    name: 'readInt8',
    description: 'Read Int8',
    format: 'int8',
    memoryArea: '%I',
    address: 8704,
    value: 1,
    access: 'read',
  },
  {
    name: 'readInt16',
    description: 'Read Int16',
    format: 'int16',
    memoryArea: '%Q',
    address: 7890,
    value: 2,
    access: 'read',
  },
  {
    name: 'readInt32',
    description: 'Read Int32',
    format: 'int32',
    memoryArea: '%I',
    address: 1540,
    value: 3,
    access: 'read',
  },
  {
    name: 'readUint8',
    description: 'Read Uint8',
    format: 'uint8',
    memoryArea: '%SA',
    address: 1520,
    value: 5,
    access: 'read',
  },
  {
    name: 'readUint16',
    description: 'Read Uint16',
    format: 'uint16',
    memoryArea: '%SB',
    address: 874,
    value: 6,
    access: 'read',
  },
  {
    name: 'readUint32',
    description: 'Read Uint32',
    format: 'uint32',
    memoryArea: '%SC',
    address: 1201,
    value: 7,
    access: 'read',
  },
  {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
    access: 'read',
  },
  {
    name: 'readFloat',
    description: 'Read Float',
    format: 'float',
    memoryArea: '%G',
    address: 1785,
    value: 123.0,
    access: 'read',
  },
  {
    name: 'writeBool',
    description: 'Write boolean',
    format: 'bool',
    memoryArea: '%M',
    address: 700,
    value: true,
    access: 'write',
  },
  {
    name: 'writeUInt16',
    description: 'Write UInt16',
    format: 'uint16',
    memoryArea: '%R',
    address: 7892,
    value: 3,
    access: 'write',
  },
  {
    name: 'writeUInt32',
    description: 'Write UInt32',
    format: 'uint32',
    memoryArea: '%S',
    address: 7802,
    value: 345,
    access: 'write',
  },
  {
    name: 'writeUInt8',
    description: 'Write UInt8',
    format: 'uint8',
    memoryArea: '%S',
    address: 780,
    value: 3,
    access: 'write',
  },
  {
    name: 'writeFloat',
    description: 'Write Float',
    format: 'float',
    memoryArea: '%S',
    address: 782,
    value: 32.0,
    access: 'write',
  },
  {
    name: 'writeDouble',
    description: 'Write Double',
    format: 'double',
    memoryArea: '%S',
    address: 702,
    value: 30.00,
    access: 'write',
  },
  ],
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

const sparkAlert = new EventEmitter();
sparkAlert.getAlerter = function getAlerter() {
  return {
    clearAll(done) {
      return done(null);
    },
    preLoad() {},
    raise(data) {
      log.error({ data }, 'Raised alert');
      sparkAlert.emit('raise', data);
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

let serverSocket;
const server = net.createServer((socket) => {
  serverSocket = socket;
  log.debug(' client connected to the test server');
  socket.on('error', (error) => {
    log.error(` error on test server. ${error}`);
  });
  socket.on('data', (item) => {
    const request = {};
    request.address = item.readUInt16LE(44);
    request.sequence = item.readUInt16LE(2);

    testMachine.variables.some((variable) => {
      if (_.isEqual(request.address, (variable.address - 1))) {
        const buffer = Buffer.from(strBufferWrite);
        switch (variable.format) {
          case 'int8':
          case 'uint8':
            buffer.writeInt8(variable.value, DATA_INDEX);
            break;
          case 'int16':
          case 'uint16':
            buffer.writeInt16LE(variable.value, DATA_INDEX);
            break;
          case 'int32':
          case 'uint32':
            buffer.writeInt32LE(variable.value, DATA_INDEX);
            break;
          case 'float':
            buffer.writeFloatLE(variable.value, DATA_INDEX);
            break;
          case 'double':
            buffer.writeDoubleLE(variable.value, DATA_INDEX);
            break;
          case 'bool':
            buffer.writeInt8(((variable.value === true) ? 8 : 0), DATA_INDEX);
            break;
          default:
            break;
        }
        buffer[SEQUENCE_INDEX1] = request.sequence;
        buffer[SEQUENCE_INDEX2] = request.sequence;
        socket.write(buffer);
        return true;
      }
      return undefined;
    });
  });
}).listen(SERVER_PORT);

describe('Spark HPL SRTP ', () => {
  let sparkHplSrtp;

  it('successfully create a new srtp hpl', (done) => {
    /* eslint new-cap: ["error", {"newIsCap": false}] */
    sparkHplSrtp = new SparkHplSrtp.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplSrtp.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplSrtp.start(dataCb, 5, (err) => {
      if (!err) return done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('before a successfull start the connection status should be false', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(false);
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplSrtp.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl srtp should produce data', (done) => {
    const variableReadArray = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && (!_.get(variable, 'array', false))
       && (_.get(variable, 'access', 'read') === 'read')) {
        variableReadArray.push(variable);
      }
    });

    db.on('data', (data) => {
      variableReadArray.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.equal(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === variableReadArray.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  }).timeout(6000);

  it('after a successful connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('update model should succeed with machine enabled', (done) => {
    sparkHplSrtp.updateModel({
      enable: true,
      hostName: os.hostname(),
      requestFrequency: 7,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplSrtp.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplSrtp.start(dataCb, configUpdateCb, (err) => {
      if (err) {
        return done(err);
      }
      return done();
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed`, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplSrtp.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });

  it('writing a non-existent variable should fail without an error', (done) => {
    const value = { variable: 'undefinedVariable' };
    value[value.variable] = 0;
    sparkHplSrtp.writeData(value, () => done());
  });

  it('writing a machine connected variable should fail without an error', (done) => {
    const value = { variable: 'machineConnected' };
    value[value.variable] = 0;
    sparkHplSrtp.writeData(value, () => done());
  });

  it('an invalid variable should raise an alert', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'errorMsg');
      alert.key.should.equal('host-connect-error');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    serverSocket.end();
    server.close();
    const client = net.createServer(() => {
      client.write('ABC');
    });
    client.close();
    return undefined;
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplSrtp.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });
});
