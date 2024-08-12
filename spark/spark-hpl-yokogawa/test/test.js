/* jshint esversion: 6 */
require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const net = require('net');
const dgram = require('dgram');
const pkg = require('../package.json');
const SparkHplYokogawa = require('../index.js');

const TCP_PORT = 12289;
const UDP_PORT = 12291;
const BIT_READ_COMMAND = 0x01;
const BIT_WRITE_COMMAND = 0x02;
const WORD_READ_COMMAND = 0x11;
const WORD_WRITE_COMMAND = 0x12;
const DEVICE_TYPE_I_ATTRIBUTE = 0x0009;
const DEVICE_TYPE_D_ATTRIBUTE = 0x0004;
const ETX = '\u0003';
const CR = '\u000D';

let sparkHplYokogawa;
let messageFormat = 'ASCII';
let usingChecksum = false;
let usingCR = false;

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
    hpl: 'yokogawa',
  },
  settings: {
    model: {
      enable: true,
      ipAddress: os.hostname(),
      interface: 'Ethernet (TCP)',
      messageFormat: 'ASCII',
      port: 'Port A',
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      requestFrequency: 1,
    },
  },
  // Note: All variables MUST have unique request keys!
  variables: [{
    name: 'uint8Test',
    description: 'UInt8 Test',
    format: 'uint8',
    requestKey: 'WRDD0001,01',
    value: 123,
  }, {
    name: 'uint16Test',
    description: 'UInt16 Test',
    format: 'uint16',
    requestKey: 'WRDD0002,01',
    value: 1234,
  }, {
    name: 'uint32Test',
    description: 'UInt32 Test',
    format: 'uint32',
    requestKey: 'WRDD0003,02',
    value: 123456,
  }, {
    name: 'int8Test',
    description: 'Int8 Test',
    format: 'int8',
    requestKey: 'WRDD0004,01',
    value: 34,
  }, {
    name: 'int16Test',
    description: 'Int16 Test',
    format: 'int16',
    requestKey: 'WRDD0005,01',
    value: 2345,
  }, {
    name: 'int32Test',
    description: 'Int32 Test',
    format: 'int32',
    requestKey: 'WRDD0006,02',
    value: 234567,
  }, {
    name: 'bitTest',
    description: 'Bit Test',
    format: 'bool',
    requestKey: 'BRDI0007,01',
    value: true,
  }, {
    name: 'uint8ArrayTest',
    description: 'UInt8 Array Test',
    format: 'uint8',
    requestKey: 'WRDD0008,03',
    array: true,
    value: [12, 34, 45],
  }, {
    name: 'uint16ArrayTest',
    description: 'UInt16 Array Test',
    format: 'uint16',
    requestKey: 'WRDD0009,03',
    array: true,
    value: [123, 234, 345],
  }, {
    name: 'uint32ArrayTest',
    description: 'UInt32 Array Test',
    format: 'uint32',
    requestKey: 'WRDD0010,06',
    array: true,
    value: [1234, 2345, 3456],
  }, {
    name: 'int8ArrayTest',
    description: 'Int8 Array Test',
    format: 'int8',
    requestKey: 'WRDD0011,03',
    array: true,
    value: [23, 45, 67],
  }, {
    name: 'int16ArrayTest',
    description: 'Int16 Array Test',
    format: 'int16',
    requestKey: 'WRDD0012,03',
    array: true,
    value: [234, 345, 456],
  }, {
    name: 'int32ArrayTest',
    description: 'Int32 Array Test',
    format: 'int32',
    requestKey: 'WRDD0013,06',
    array: true,
    value: [12345, 23456, 34567],
  }, {
    name: 'bitArrayTest',
    description: 'Bit Array Test',
    format: 'bool',
    requestKey: 'BRDI0014,03',
    array: true,
    value: [true, false, true],
  }, {
    name: 'writeIntWordTest',
    description: 'Write Int Test',
    format: 'int16',
    requestKey: 'WWRD0009,01',
    access: 'write',
    value: 1234,
  }, {
    name: 'writeIntWordNegTest',
    description: 'Write Int Negative Test',
    format: 'int16',
    requestKey: 'WWRD0010,01',
    access: 'write',
    value: -1234,
  }, {
    name: 'writeFloatWordTest',
    description: 'Write Float Test',
    format: 'float',
    requestKey: 'WWRD0012,02',
    access: 'write',
    value: 12345.0,
  }, {
    name: 'writeFloatWordNegTest',
    description: 'Write Float Negative Test',
    format: 'float',
    requestKey: 'WWRD0016,02',
    access: 'write',
    value: -12345.0,
  }, {
    name: 'writeBoolWordTest',
    description: 'Write Bool Word Test',
    format: 'bool',
    requestKey: 'WWRD0020,01',
    access: 'write',
    value: true,
  }, {
    name: 'writeStringWordTest',
    description: 'Write String Word Test',
    format: 'char',
    requestKey: 'WWRD0022,01',
    access: 'write',
    value: 'AB',
  }, {
    name: 'writeBoolBitTest',
    description: 'Write Bool Bit Test',
    format: 'bool',
    requestKey: 'BWRI00004,01',
    access: 'write',
    value: true,
  }, {
    name: 'writeIntBitTest',
    description: 'Write Int Bit Test',
    format: 'int8',
    requestKey: 'BWRI00006,04',
    access: 'write',
    value: 10,
  }, {
    name: 'writeFloatBitTest',
    description: 'Write Float Bit Test',
    format: 'float',
    requestKey: 'BWRI00008,08',
    access: 'write',
    value: 21,
  }, {
    name: 'writeStringBitTest',
    description: 'Write String Bit Test',
    format: 'char',
    requestKey: 'BWRI00010,16',
    access: 'write',
    value: 'CD',
  }, {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
  }],
};

const invalidVariableMachine1 = {
  info: {
    name: 'invalid-machine-1',
    fullname: 'Invalid machine 1',
    version: '1.0.0',
    description: 'Invalid Machine 1',
    hpl: 'yokogawa',
  },
  settings: {
    model: {
      enable: true,
      ipAddress: os.hostname(),
      interface: 'serial',
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'noRequestKey',
    description: 'No Request Key Test',
    format: 'uint16',
    value: 123,
  }],
};

const invalidVariableMachine2 = {
  info: {
    name: 'invalid-machine-2',
    fullname: 'Invalid machine 2',
    version: '1.0.0',
    description: 'Invalid Machine 2',
    hpl: 'yokogawa',
  },
  settings: {
    model: {
      enable: true,
      ipAddress: os.hostname(),
      interface: 'Ethernet (TCP)',
      messageFormat: 'Binary',
      port: 'Port A',
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      requestFrequency: 1,
    },
  },
  // Note: All variables MUST have unique request keys!
  variables: [{
    name: 'unsupportedCommand',
    description: 'Unsupported Command Test',
    format: 'uint16',
    requestKey: 'WFL0002,01',
    value: 1234,
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

function parseRequestKey(requestKey) {
  const retObj = {
    command: null, deviceAttribute: null, address: null, count: null, bytesPerCount: 0,
  };

  // get the binary command, returning null if invalid
  switch (requestKey.substring(0, 3).toUpperCase()) {
    case 'BRD':
      retObj.command = BIT_READ_COMMAND;
      retObj.bytesPerCount = 1;
      break;
    case 'BWR':
      retObj.command = BIT_WRITE_COMMAND;
      retObj.bytesPerCount = 1;
      break;
    case 'WRD':
      retObj.command = WORD_READ_COMMAND;
      retObj.bytesPerCount = 2;
      break;
    case 'WWR':
      retObj.command = WORD_WRITE_COMMAND;
      retObj.bytesPerCount = 2;
      break;
    default:
      return retObj;
  }

  // get the binary device, returing null if invalid
  switch (requestKey.substring(3, 4).toUpperCase()) {
    case 'I':
      retObj.deviceAttribute = DEVICE_TYPE_I_ATTRIBUTE;
      break;
    case 'D':
      retObj.deviceAttribute = DEVICE_TYPE_D_ATTRIBUTE;
      break;
    default:
      return retObj;
  }

  // find the end of the address
  const iSep = requestKey.indexOf(',', 4);

  // get the address
  const address = parseInt(requestKey.substring(4, iSep), 10);
  if (Number.isNaN(address)) return retObj;
  retObj.address = address;

  // get the count
  const count = parseInt(requestKey.substring(iSep + 1), 10);
  if (Number.isNaN(count)) return retObj;
  retObj.count = count;

  return retObj;
}

const responseBuffer = Buffer.allocUnsafe(100);
function getResponse(data) {
  let response = null;
  testMachine.variables.forEach((variable) => {
    if (!_.get(variable, 'machineConnected', false)) {
      if (_.get(variable, 'access', 'read') === 'read') {
        if (messageFormat === 'ASCII') {
          if (data.slice(3, 5).toString() === 'RD') {
            if (variable.requestKey === data.slice(2).toString().trim()) {
              const iSep = variable.requestKey.indexOf(',');
              let count = parseInt(variable.requestKey.substr(iSep + 1), 10);
              let allValuesString = '';
              let valueArray = [];
              if (_.get(variable, 'array', false)) {
                valueArray = variable.value;
                count /= valueArray.length;
              } else {
                valueArray.push(variable.value);
              }
              for (let iValue = 0; iValue < valueArray.length; iValue += 1) {
                if (variable.requestKey.substr(0, 3) === 'BRD') {
                  allValuesString = `${allValuesString}${valueArray[iValue] ? '1' : '0'}`;
                } else {
                  let valueString = (`000000000000000${valueArray[iValue].toString(16)}`).substr(-4 * count);
                  if (count === 2) {
                    // reverse word order
                    valueString = `${valueString.substr(4, 4)}${valueString.substr(0, 4)}`;
                  }
                  allValuesString = `${allValuesString}${valueString}`;
                }
              }
              response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}OK${allValuesString}\r\n`;
            }
          }
        } else {
          const command = data.readUInt8(0);
          if ((command === BIT_READ_COMMAND) || (command === WORD_READ_COMMAND)) {
            const parsedRequestKey = parseRequestKey(variable.requestKey);
            if ((parsedRequestKey.command === command)
             && (parsedRequestKey.deviceAttribute === data.readUInt16BE(4))
             && (parsedRequestKey.address === data.readUInt32BE(6))) {
              let valueArray = [];
              if (_.get(variable, 'array', false)) {
                valueArray = variable.value;
                parsedRequestKey.count /= valueArray.length;
              } else {
                valueArray.push(variable.value);
              }
              responseBuffer.writeUInt8(parsedRequestKey.command + 0x80, 0);
              responseBuffer.writeUInt8(0, 1);
              let responseBufferLen = 4;
              for (let iValue = 0; iValue < valueArray.length; iValue += 1) {
                if (parsedRequestKey.command === BIT_READ_COMMAND) {
                  responseBuffer.writeUInt16BE(valueArray.length, 2);
                  responseBuffer.writeUInt8(valueArray[iValue] ? 1 : 0, responseBufferLen);
                  responseBufferLen += 1;
                } else if (parsedRequestKey.count === 1) {
                  responseBuffer.writeUInt16BE(2 * valueArray.length, 2);
                  responseBuffer.writeUInt16BE(valueArray[iValue], responseBufferLen);
                  responseBufferLen += 2;
                } else {
                  responseBuffer.writeUInt16BE(4 * valueArray.length, 2);
                  // reverse word order
                  const revBuffer = Buffer.allocUnsafe(4);
                  revBuffer.writeUInt32BE(valueArray[iValue], 0);
                  const tempWord = revBuffer.readUInt16BE(0);
                  revBuffer.writeUInt16BE(revBuffer.readUInt16BE(2), 0);
                  revBuffer.writeUInt16BE(tempWord, 2);
                  responseBuffer.writeUInt32BE(revBuffer.readUInt32BE(0), responseBufferLen);
                  responseBufferLen += 4;
                }
              }
              response = responseBuffer.slice(0, responseBufferLen);
            }
          }
        }
      } else if (messageFormat === 'ASCII') { // ascii write access
        const dataString = data.toString();
        if (dataString.substring(3, 5) === 'WR') {
          if (dataString.substring(2).startsWith(variable.requestKey)) {
            let iSep = dataString.indexOf(',');
            const count = parseInt(dataString.substring(iSep + 1), 10);
            iSep = dataString.indexOf(',', iSep + 1);

            if (dataString.substring(2, 3) === 'W') { // word write
              switch (variable.format) {
                case 'bool':
                  if (dataString.substring(iSep + (4 * count), iSep + 1 + (4 * count))
                   === (variable.value ? '1' : '0')) {
                    response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}OK\r\n`;
                  } else {
                    response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}ER01\r\n`;
                  }
                  break;
                case 'char': {
                  const charBuf = Buffer.allocUnsafe(6);
                  charBuf.write(variable.value);
                  if (parseInt(dataString.substring(iSep + 1, iSep + 1 + (4 * count)), 16)
                   === charBuf.readUIntBE(0, variable.value.length)) {
                    response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}OK\r\n`;
                  } else {
                    response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}ER01\r\n`;
                  }
                  break;
                }
                default:
                  if (variable.value < 0) {
                    let subFrom = 1;
                    for (let iWord = 0; iWord < count; iWord += 1) {
                      subFrom *= 0x10000;
                    }
                    if ((subFrom - parseInt(dataString.substring(iSep + 1,
                      iSep + 1 + (4 * count)), 16)) === -variable.value) {
                      response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}OK\r\n`;
                    } else {
                      response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}ER01\r\n`;
                    }
                  } else if (parseInt(dataString.substring(iSep + 1, iSep + 1 + (4 * count)), 16)
                     === variable.value) {
                    response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}OK\r\n`;
                  } else {
                    response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}ER01\r\n`;
                  }
              }
            } else { // bit write
              switch (variable.format) {
                case 'bool':
                  if (dataString.substring(iSep + 1, iSep + 2) === (variable.value ? '1' : '0')) {
                    response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}OK\r\n`;
                  } else {
                    response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}ER01\r\n`;
                  }
                  break;
                case 'char': {
                  const charBuf = Buffer.allocUnsafe(6);
                  charBuf.write(variable.value);
                  if (parseInt(dataString.substring(iSep + 1, iSep + 1 + count), 2)
                   === charBuf.readUIntBE(0, variable.value.length)) {
                    response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}OK\r\n`;
                  } else {
                    response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}ER01\r\n`;
                  }
                  break;
                }
                default:
                  if (parseInt(dataString.substring(iSep + 1, iSep + 1 + count), 2)
                   === variable.value) {
                    response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}OK\r\n`;
                  } else {
                    response = `0${testMachine.settings.model.yokogawaCPUNumber.toString()}ER01\r\n`;
                  }
              }
            }
          }
        }
      } else { // binary write access
        const command = data.readUInt8(0);
        if ((command === BIT_WRITE_COMMAND) || (command === WORD_WRITE_COMMAND)) {
          const parsedRequestKey = parseRequestKey(variable.requestKey);
          if ((parsedRequestKey.command === command)
           && (parsedRequestKey.deviceAttribute === data.readUInt16BE(4))
           && (parsedRequestKey.address === data.readUInt32BE(6))) {
            responseBuffer.writeUInt8(parsedRequestKey.command + 0x80, 0);
            responseBuffer.writeUInt8(0, 1);
            let responseBufferLen = 4;
            if (parsedRequestKey.command === WORD_WRITE_COMMAND) {
              switch (variable.format) {
                case 'bool':
                  if (data.readUInt16BE(12) === (variable.value ? 1 : 0)) {
                    responseBuffer.writeUInt16BE(0, 2);
                  } else {
                    responseBuffer.writeUInt32BE(0x0201, 2);
                    responseBufferLen = 6;
                  }
                  break;
                case 'char':
                  if (data.toString('ascii', 12, 12 + (2 * parsedRequestKey.count))
                   === variable.value) {
                    responseBuffer.writeUInt16BE(0, 2);
                  } else {
                    responseBuffer.writeUInt32BE(0x0201, 2);
                    responseBufferLen = 6;
                  }
                  break;
                default:
                  if (variable.value < 0) {
                    let subFrom = 1;
                    for (let iWord = 0; iWord < parsedRequestKey.count; iWord += 1) {
                      subFrom *= 0x10000;
                    }
                    if ((subFrom - data.readUIntBE(12, 2 * parsedRequestKey.count))
                   === -variable.value) {
                      responseBuffer.writeUInt16BE(0, 2);
                    } else {
                      responseBuffer.writeUInt32BE(0x0201, 2);
                      responseBufferLen = 6;
                    }
                  } else if (data.readUIntBE(12, 2 * parsedRequestKey.count) === variable.value) {
                    responseBuffer.writeUInt16BE(0, 2);
                  } else {
                    responseBuffer.writeUInt32BE(0x0201, 2);
                    responseBufferLen = 6;
                  }
              }
            } else {
              switch (variable.format) {
                case 'bool':
                  if (data.readUInt8(12) === (variable.value ? 1 : 0)) {
                    responseBuffer.writeUInt16BE(0, 2);
                  } else {
                    responseBuffer.writeUInt32BE(0x0201, 2);
                    responseBufferLen = 6;
                  }
                  break;
                case 'char': {
                  let charBits = 0;
                  for (let iBit = 0; iBit < parsedRequestKey.count; iBit += 1) {
                    charBits *= 2;
                    if (data.readUInt8(12 + iBit) === 1) {
                      charBits += 1;
                    }
                  }
                  const stringBuf = Buffer.from(variable.value);
                  if (stringBuf.readUIntBE(0, variable.value.length) === charBits) {
                    responseBuffer.writeUInt16BE(0, 2);
                  } else {
                    responseBuffer.writeUInt32BE(0x0201, 2);
                    responseBufferLen = 6;
                  }
                  break;
                }
                default: {
                  let bits = 0;
                  for (let iBit = 0; iBit < parsedRequestKey.count; iBit += 1) {
                    bits *= 2;
                    if (data.readUInt8(12 + iBit) === 1) {
                      bits += 1;
                    }
                  }
                  if (bits === variable.value) {
                    responseBuffer.writeUInt16BE(0, 2);
                  } else {
                    responseBuffer.writeUInt32BE(0x0201, 2);
                    responseBufferLen = 6;
                  }
                }
              }
            }
            response = responseBuffer.slice(0, responseBufferLen);
          }
        }
      }
    }
  });

  return response;
}

let serverSocketTCP;
net.createServer((socket) => {
  serverSocketTCP = socket;
  socket.on('data', (data) => {
    const response = getResponse(data);
    if (response) socket.write(response);
  });
}).listen(TCP_PORT);

const serverSocketUDP = dgram.createSocket('udp4');

serverSocketUDP.on('message', (message, remote) => {
  const response = getResponse(message);
  if (response) serverSocketUDP.send(response, remote.port, remote.address);
});

serverSocketUDP.bind(UDP_PORT, os.hostname());


function calculateChecksum(respString) {
  const respBuffer = Buffer.from(respString);

  let checksumTotal = 0;
  for (let iBuf = 1; iBuf < respBuffer.length; iBuf += 1) {
    checksumTotal += respBuffer[iBuf];
  }
  const checksumTotalHex = checksumTotal.toString(16).toUpperCase();

  return checksumTotalHex.substr(checksumTotalHex.length - 2);
}

function writeToSerialPort(data) {
  let endPos = data.indexOf(ETX);
  if (endPos !== -1) {
    if (usingChecksum) endPos -= 2;
    const header = data.substr(0, 5);
    let serialResponse = `${header}${getResponse(Buffer.from(data.substring(4, endPos))).trim().substr(2)}`;
    if (usingChecksum) {
      serialResponse = `${serialResponse}${calculateChecksum(serialResponse)}`;
    }
    serialResponse = `${serialResponse}${ETX}`;
    if (usingCR) {
      serialResponse = `${serialResponse}${CR}`;
    }
    sparkHplYokogawa.serialPort.writeToComputer(serialResponse);
  }
}

describe('Spark HPL Yokogawa', () => {
  it('successfully create a new Yokogawa hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplYokogawa = new SparkHplYokogawa.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplYokogawa.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplYokogawa.start(dataCb, 5, (err) => {
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
    sparkHplYokogawa.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl Yokogawa should produce data in TCP ASCII mode', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
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

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed in TCP ASCII mode`, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplYokogawa.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplYokogawa.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplYokogawa.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl Yokogawa should produce data when re-enabled in UDP ASCII mode', (done) => {
    sparkHplYokogawa.updateModel({
      enable: true,
      ipAddress: os.hostname(),
      interface: 'Ethernet (UDP)',
      messageFormat: 'ASCII',
      port: 'Port B',
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      const readVariables = [];
      const gotDataForVar = [];
      testMachine.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false)
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
      return undefined;
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed in UDP ASCII mode`, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplYokogawa.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplYokogawa.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl Yokogawa should produce data when re-enabled in TCP binary mode', (done) => {
    messageFormat = 'binary';
    sparkHplYokogawa.updateModel({
      enable: true,
      ipAddress: os.hostname(),
      interface: 'Ethernet (TCP)',
      messageFormat: 'Binary',
      port: 'Port A',
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      const readVariables = [];
      const gotDataForVar = [];
      testMachine.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false)
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
      return undefined;
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed in TCP binary mode`, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplYokogawa.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });

  it('spark hpl Yokogawa should produce data when re-enabled in UDP binary mode', (done) => {
    sparkHplYokogawa.updateModel({
      enable: true,
      ipAddress: os.hostname(),
      interface: 'Ethernet (UDP)',
      messageFormat: 'Binary',
      port: 'Port B',
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      const readVariables = [];
      const gotDataForVar = [];
      testMachine.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false)
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
      return undefined;
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed in UDP binary mode`, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplYokogawa.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });

  it('spark hpl Yokogawa should produce data when re-enabled in serial mode', (done) => {
    messageFormat = 'ASCII';
    sparkHplYokogawa.updateModel({
      enable: true,
      ipAddress: os.hostname(),
      interface: 'serial',
      device: '/dev/ttyS1',
      baudRate: '9600',
      usingChecksum: false,
      usingCR: false,
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      sparkHplYokogawa.serialPort.on('dataToDevice', writeToSerialPort);

      const readVariables = [];
      const gotDataForVar = [];
      testMachine.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false)
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
      return undefined;
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed in serial mode`, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplYokogawa.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplYokogawa.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl Yokogawa should produce data when re-enabled in serial mode with checksum and CR', (done) => {
    messageFormat = 'ASCII';
    sparkHplYokogawa.updateModel({
      enable: true,
      ipAddress: os.hostname(),
      interface: 'serial',
      device: '/dev/ttyS1',
      baudRate: '9600',
      usingChecksum: true,
      usingCR: true,
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      usingChecksum = true;
      usingCR = true;
      sparkHplYokogawa.serialPort.on('dataToDevice', writeToSerialPort);

      const readVariables = [];
      const gotDataForVar = [];
      testMachine.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false)
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
      return undefined;
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplYokogawa.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new yokogawa hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplYokogawa = new SparkHplYokogawa.hpl(log.child({
      machine: invalidVariableMachine1.info.name,
    }), invalidVariableMachine1, invalidVariableMachine1.settings.model,
    sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should generate an alert with missing variable request key', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'variableName');
      alert.key.should.equal('request-key-error');
      alert.msg.should.equal(`${invalidVariableMachine1.info.name}: Variable Error`);
      alert.description.should.equal('Variable noRequestKey does not have a request key');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkHplYokogawa.start(dataCb, configUpdateCb, (err) => {
      err.shold.equal('Error: All variables require a request key');
      return undefined;
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplYokogawa.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new yokogawa hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplYokogawa = new SparkHplYokogawa.hpl(log.child({
      machine: invalidVariableMachine2.info.name,
    }), invalidVariableMachine2, invalidVariableMachine2.settings.model,
    sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should generate an alert with unsupported variable request key command', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'variableName');
      alert.key.should.equal('invalid-command-error');
      alert.msg.should.equal(`${invalidVariableMachine2.info.name}: Variable Error`);
      alert.description.should.equal('The request key for variable unsupportedCommand contains an unsupported command');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkHplYokogawa.start(dataCb, configUpdateCb, (err) => {
      err.should.equal('A variable request key contains an unsupported command');
      return undefined;
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplYokogawa.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new Yokogawa hpl', (done) => {
    // change test machine to have inconsistent format and request key in binary mode
    messageFormat = 'Binary';
    testMachine.settings.model.messageFormat = messageFormat;
    testMachine.variables[0].format = 'uint32';
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplYokogawa = new SparkHplYokogawa.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplYokogawa.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('an alert should be raised if a variable format and request key inconsistent', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'variableName');
      alert.key.should.equal('data-null-error');
      alert.msg.should.equal(`${testMachine.info.name}: Variable Error`);
      alert.description.should.equal(`Failed to get the data for the variable ${testMachine.variables[0].name}`);
      sparkAlert.removeAllListeners('raise');
      return done();
    });
  });

  it('an alert should be raised and connection variables set false if the server is destroyed', (done) => {
    let alertRaised = false;
    let connectedVariableSet = false;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('connection-error');
      alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
      alert.description.should.equal('Not able to open connection. Please verify the configuration');
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

    serverSocketTCP.destroy();
  });
});
