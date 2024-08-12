/* jshint esversion: 6 */
/* eslint no-bitwise: ["error", { "allow": ["^=", "~"] }] */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplDirectNET = require('../index.js');

const ACK = 0x06;
const ENQ_START = 0x4E;
const EOT = 0x04;
const SOH = 0x01;
const STX = 0x02;
const ETX = 0x03;
const READ_CODE = 0x30;
const WRITE_CODE = 0x38;
const INPUT_DATA_TYPE = 0x32;
const OUTPUT_DATA_TYPE = 0x33;

let sparkHplDirectNET;

const REQ_ACK = Buffer.from([ENQ_START, 0x22, ACK]);
const REQ_EOT = Buffer.from([EOT]);
const RECV_ACK = Buffer.from([ACK]);
const REQ_ACK_ERROR = Buffer.from([ENQ_START, 0x22, 0]);
const REQ_ERROR = Buffer.from([0]);
const respBuf = Buffer.allocUnsafe(100);

let mode = 'ASCII';
let iWriteVariable = 0;
let forceReadWriteACKError = false;
let forceBadChecksum = false;
let forceReadSTXError = false;
let forceReadACKError = false;
let forceReadEOTError = false;
let forceReadTimeoutError = false;
let forceWriteENQACKError = false;
let forceWriteEOTACKError = false;

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
    hpl: 'directnet',
  },
  settings: {
    model: {
      enable: true,
      device: '/dev/ttyUSB0',
      slaveAddress: 2,
      baudRate: '9600',
      parity: 'none',
      mode: 'ASCII',
      requestFrequency: 0.1,
      disconnectReportTime: 0,
      publishDisabled: false,
    },
  },
  // Note: All variables MUST have unique request keys!
  variables: [{
    name: 'int8Test',
    description: 'Int8 Test',
    format: 'int8',
    address: '0000',
    type: 'Memory',
    bytePos: 'LSB',
    value: 123,
  },
  {
    name: 'uint8Test',
    description: 'UInt8 Test',
    format: 'uint8',
    address: '0001',
    type: 'Memory',
    bytePos: 'LSB',
    value: 234,
  },
  {
    name: 'int16Test',
    description: 'Int16 Test',
    format: 'int16',
    address: '0002',
    type: 'Memory',
    bytePos: 'LSB',
    value: 1234,
  },
  {
    name: 'unt16Test',
    description: 'UInt16 Test',
    format: 'uint16',
    address: '0004',
    type: 'Memory',
    bytePos: 'LSB',
    value: 2345,
  },
  {
    name: 'charTest',
    description: 'Char Test',
    format: 'char',
    address: '0010',
    type: 'Memory',
    bytePos: 'LSB',
    value: 'A\u0000',
  },
  {
    name: 'boolTest',
    description: 'Bool Test',
    format: 'bool',
    address: '0012',
    type: 'Memory',
    bytePos: 'LSB',
    value: true,
  },
  {
    name: 'bitTest',
    description: 'Bit Test',
    format: 'bool',
    address: '0014.10',
    type: 'Memory',
    bytePos: 'LSB',
    value: true,
  },
  {
    name: 'bitMSBTest',
    description: 'Bit MSB Test',
    format: 'bool',
    address: '0015.0',
    type: 'Memory',
    bytePos: 'MSB',
    value: true,
  },
  {
    name: 'bitIntTest',
    description: 'Bit Int Test',
    format: 'int8',
    address: '0016.0',
    type: 'Memory',
    bytePos: 'LSB',
    value: 1,
  },
  {
    name: 'bitCharTest',
    description: 'Bit Char Test',
    format: 'char',
    address: '0017.0',
    type: 'Memory',
    bytePos: 'LSB',
    value: '1',
  },
  {
    name: 'int16ArrayTest',
    description: 'Int16 Array Test',
    format: 'int16',
    address: '0020',
    type: 'Memory',
    bytePos: 'LSB',
    array: true,
    length: 2,
    value: [123, 456],
  },
  {
    name: 'int8InputTest',
    description: 'Int8 Input Test',
    format: 'int8',
    address: '40000',
    type: 'Input',
    bytePos: 'LSB',
    value: 123,
  },
  {
    name: 'uint8InputTest',
    description: 'UInt8 Input Test',
    format: 'uint8',
    address: '40000',
    type: 'Input',
    bytePos: 'MSB',
    value: 234,
  },
  {
    name: 'int16InputTest',
    description: 'Int16 Input Test',
    format: 'int16',
    address: '40400',
    type: 'Input',
    bytePos: 'LSB',
    value: 45,
  },
  {
    name: 'int16InputMSBTest',
    description: 'Int16 Input MSB Test',
    format: 'int16',
    address: '40400',
    type: 'Input',
    bytePos: 'MSB',
    value: 54,
  },
  {
    name: 'uint16InputTest',
    description: 'UInt16 Input Test',
    format: 'uint16',
    address: '41200',
    type: 'Input',
    bytePos: 'LSB',
    value: 65,
  },
  {
    name: 'uint16InputMSBTest',
    description: 'UInt16 Input MSB Test',
    format: 'uint16',
    address: '41200',
    type: 'Input',
    bytePos: 'MSB',
    value: 76,
  },
  {
    name: 'charInputTest',
    description: 'Char Input Test',
    format: 'char',
    address: '41201',
    type: 'Input',
    bytePos: 'LSB',
    value: 'B',
  },
  {
    name: 'boolInputTest',
    description: 'Bool Input Test',
    format: 'bool',
    address: '41202',
    type: 'Input',
    bytePos: 'LSB',
    value: true,
  },
  {
    name: 'int8OutputTest',
    description: 'Int8 Output Test',
    format: 'int8',
    address: '40500',
    type: 'Output',
    bytePos: 'LSB',
    value: 123,
  },
  {
    name: 'uint8OutputTest',
    description: 'UInt8 Output Test',
    format: 'uint8',
    address: '40500',
    type: 'Output',
    bytePos: 'MSB',
    value: 234,
  },
  {
    name: 'int16OuputTest',
    description: 'Int16 Output Test',
    format: 'int16',
    address: '41140',
    type: 'Output',
    bytePos: 'LSB',
    value: 45,
  },
  {
    name: 'uint16OutputTest',
    description: 'UInt16 Output Test',
    format: 'uint16',
    address: '41140',
    type: 'Output',
    bytePos: 'MSB',
    value: 65,
  },
  {
    name: 'int8WriteTest',
    description: 'Int8 Write Test',
    format: 'int8',
    access: 'write',
    address: '0000',
    type: 'Memory',
    bytePos: 'LSB',
    value: 123,
  },
  {
    name: 'int8WriteOutputTest',
    description: 'Int8 Output Write Test',
    format: 'int8',
    access: 'write',
    address: '40500',
    type: 'Output',
    bytePos: 'LSB',
    value: 34,
  },
  {
    name: 'uint8WriteTest',
    description: 'UInt8 Write Test',
    format: 'uint8',
    access: 'write',
    address: '0001',
    type: 'Memory',
    bytePos: 'LSB',
    value: 234,
  },
  {
    name: 'uint8WriteOutputTest',
    description: 'UInt8 Output Write Test',
    format: 'uint8',
    access: 'write',
    address: '40501',
    type: 'Output',
    bytePos: 'LSB',
    value: 45,
  },
  {
    name: 'int16WriteTest',
    description: 'Int16 Write Test',
    format: 'int16',
    access: 'write',
    address: '0002',
    type: 'Memory',
    bytePos: 'LSB',
    value: 56,
  },
  {
    name: 'int16WriteOutputTest',
    description: 'Int16 Output Write Test',
    format: 'int16',
    access: 'write',
    address: '40502',
    type: 'Output',
    bytePos: 'LSB',
    value: 67,
  },
  {
    name: 'uint16WriteTest',
    description: 'UInt16 Write Test',
    format: 'uint16',
    access: 'write',
    address: '0004',
    type: 'Memory',
    bytePos: 'LSB',
    value: 78,
  },
  {
    name: 'uint16WriteOutputTest',
    description: 'UInt16 Output Write Test',
    format: 'uint16',
    access: 'write',
    address: '40504',
    type: 'Output',
    bytePos: 'LSB',
    value: 89,
  },
  {
    name: 'boolWriteTest',
    description: 'Bool Write Test',
    format: 'bool',
    access: 'write',
    address: '0005',
    type: 'Memory',
    bytePos: 'LSB',
    value: true,
  },
  {
    name: 'boolWriteOutputTest',
    description: 'Bool Output Write Test',
    format: 'bool',
    access: 'write',
    address: '40505',
    type: 'Output',
    bytePos: 'LSB',
    value: false,
  },
  {
    name: 'charWriteTest',
    description: 'Char Write Test',
    format: 'char',
    access: 'write',
    address: '0006',
    type: 'Memory',
    bytePos: 'LSB',
    value: 'C',
  },
  {
    name: 'charWriteOutputTest',
    description: 'Char Output Write Test',
    format: 'char',
    access: 'write',
    address: '40506',
    type: 'Output',
    bytePos: 'LSB',
    value: 'D',
  },
  {
    name: 'machineConnected',
    description: 'Connection Test',
    format: 'bool',
    address: '0',
    type: 'Memory',
    bytePos: 'LSB',
    machineConnected: true,
    value: false,
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

function computeChecksum(buffer, iStart, iEnd) {
  let xorByte = buffer[iStart];
  for (let iBuf = iStart + 1; iBuf < iEnd; iBuf += 1) {
    xorByte ^= buffer[iBuf];
  }
  return forceBadChecksum ? ~xorByte : xorByte;
}

function readHexASCIIByte(buffer, index) {
  return 16 * (buffer[index] - 0x30) + (buffer[index + 1] - 0x30);
}

function readHexASCIIWord(buffer, index) {
  return 256 * readHexASCIIByte(buffer, index) + readHexASCIIByte(buffer, index + 2);
}

function writeHexASCIIByteToRespBuf(index, value) {
  respBuf[index] = Math.floor(value / 16) + 0x30;
  respBuf[index + 1] = (value % 16) + 0x30;
}


function writeHexASCIIWordToRespBuf(index, value) {
  writeHexASCIIByteToRespBuf(index, value % 256);
  writeHexASCIIByteToRespBuf(index + 2, Math.floor(value / 256));
}

function bufferReadResponse(variable) {
  respBuf[0] = forceReadACKError ? 0 : ACK;
  respBuf[1] = forceReadSTXError ? 0 : STX;
  let iBuf = 2;
  let nVals = 1;
  if (_.get(variable, 'array', false)) {
    nVals = _.get(variable, 'length', 1);
  }
  const numBytesPerLoc = variable.type === 'Memory' ? 2 : 1;
  if (mode === 'ASCII') {
    for (let iVal = 0; iVal < nVals; iVal += 1) {
      let value = (nVals === 1) ? variable.value : variable.value[iVal];
      if (variable.format === 'char') {
        value = value.charCodeAt(0);
      } else if (variable.format === 'bool') {
        value = value ? 0x101 : 0;
      }
      writeHexASCIIWordToRespBuf(iBuf, value);
      iBuf += 2 * numBytesPerLoc;
    }
    respBuf[iBuf] = ETX;
    writeHexASCIIByteToRespBuf(iBuf + 1, computeChecksum(respBuf, 2, iBuf));
    return respBuf.slice(0, iBuf + 3);
  }

  for (let iVal = 0; iVal < nVals; iVal += 1) {
    let value = (nVals === 1) ? variable.value : variable.value[iVal];
    if (variable.format === 'char') {
      value = value.charCodeAt(0);
    } else if (variable.format === 'bool') {
      value = value ? 0x101 : 0;
    }
    respBuf.writeUInt16LE(value, iBuf);
    iBuf += numBytesPerLoc;
  }
  respBuf[iBuf] = ETX;
  respBuf[iBuf + 1] = computeChecksum(respBuf, 2, iBuf);
  return respBuf.slice(0, iBuf + 2);
}

function computeAddress(variable) {
  const vMemAddress = parseInt(variable.address, 8);
  let address;
  const useMSB = _.get(variable, 'bytePos', 'LSB') === 'MSB';
  switch (variable.type) {
    case 'Memory':
      address = vMemAddress + 1;
      break;
    case 'Input':
      if ((vMemAddress >= 0o40000) && (vMemAddress <= 0o40077)) {
        address = (2 * (vMemAddress - 0o40000)) + 1;
        if (useMSB) address += 1;
      } else if ((vMemAddress >= 0o40400) && (vMemAddress <= 0o40423)) {
        // if V-memory address 40400 to 40423 octal DirectNET address is 101 to 128 hex,
        // alternating between LSB and MSB
        address = (2 * (vMemAddress - 0o40400)) + 0x101;
        if (useMSB) address += 1;
      } else if ((vMemAddress >= 0o41200) && (vMemAddress <= 0o41234)) {
        // if V-memory address 41200 to 41234 octal DirectNET address is 181 to 128 hex,
        // alternating between LSB and MSB
        address = (2 * (vMemAddress - 0o41200)) + 0x181;
        if (useMSB) address += 1;
      }
      break;
    case 'Output':
      if ((vMemAddress >= 0o40500) && (vMemAddress <= 0o41117)) {
        address = (2 * (vMemAddress - 0o40500)) + 0x101;
        if (useMSB) address += 1;
      } else if ((vMemAddress >= 0o41140) && (vMemAddress <= 0o41147)) {
        // if V-memory address 40400 to 40423 octal DirectNET address is 101 to 128 hex,
        // alternating between LSB and MSB
        address = (2 * (vMemAddress - 0o41140)) + 0x321;
        if (useMSB) address += 1;
      }
      break;
    default:
      break;
  }

  return address;
}

function writeValueCorrect(data) {
  const variable = testMachine.variables[iWriteVariable];
  let value = 0;
  if (mode === 'ASCII') {
    const nASCIIBytes = Math.floor((data.length - 4) / 2);
    for (let iBuf = (2 * nASCIIBytes) - 1; iBuf > 0; iBuf -= 2) {
      value = (256 * value) + readHexASCIIByte(data, iBuf);
    }
  } else {
    value = data.readUIntLE(1, data.length - 3);
  }
  if (variable.format === 'char') {
    value = String.fromCharCode(value);
  } else if (variable.format === 'bool') {
    value = value !== 0;
  }

  return value === variable.value;
}

function checksumCorrect(data) {
  if (mode === 'ASCII') {
    return computeChecksum(data, 1, data.length - 3) === readHexASCIIByte(data, data.length - 2);
  }

  return computeChecksum(data, 1, data.length - 2) === data[data.length - 1];
}

function writeToSerialPort(data) {
  if (forceReadTimeoutError) return;

  switch (data[0]) {
    case ENQ_START:
      if (forceReadWriteACKError) {
        sparkHplDirectNET.serialPort.writeToComputer(REQ_ACK_ERROR);
      } else {
        sparkHplDirectNET.serialPort.writeToComputer(REQ_ACK);
      }
      break;
    case SOH: {
      let dataType = 'Memory';
      if (data[4] === INPUT_DATA_TYPE) {
        dataType = 'Input';
      } else if (data[4] === OUTPUT_DATA_TYPE) {
        dataType = 'Output';
      }
      if (data[3] === READ_CODE) {
        for (let iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
          const variable = testMachine.variables[iVar];
          if (!_.get(variable, 'machineConnected', false)
           && _.isEqual(_.get(variable, 'access', 'read'), 'read')) {
            if ((variable.type === dataType)
             && (computeAddress(variable) === readHexASCIIWord(data, 5))) {
              sparkHplDirectNET.serialPort.writeToComputer(bufferReadResponse(variable));
              break;
            }
          }
        }
      } else if (data[3] === WRITE_CODE) {
        iWriteVariable = 0;
        for (let iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
          const variable = testMachine.variables[iVar];
          if (!_.get(variable, 'machineConnected', false)
           && _.isEqual(_.get(variable, 'access', 'read'), 'write')) {
            if ((variable.type === dataType)
             && (computeAddress(variable) === readHexASCIIWord(data, 5))) {
              iWriteVariable = iVar;
              break;
            }
          }
        }

        if (forceWriteENQACKError) {
          sparkHplDirectNET.serialPort.writeToComputer(REQ_ERROR);
        } else {
          sparkHplDirectNET.serialPort.writeToComputer(RECV_ACK);
        }
      }
      break;
    }
    case ACK:
      if (forceReadEOTError) {
        sparkHplDirectNET.serialPort.writeToComputer(REQ_ERROR);
      } else {
        sparkHplDirectNET.serialPort.writeToComputer(REQ_EOT);
      }
      break;
    case STX: {
      if (checksumCorrect(data) && writeValueCorrect(data)) {
        if (forceWriteEOTACKError) {
          sparkHplDirectNET.serialPort.writeToComputer(REQ_ERROR);
        } else {
          sparkHplDirectNET.serialPort.writeToComputer(RECV_ACK);
        }
      }
      break;
    }
    default:
      break;
  }
}

describe('Spark HPL DirectNET', () => {
  it('successfully create a new DirectNET hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplDirectNET = new SparkHplDirectNET.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplDirectNET.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplDirectNET.start(dataCb, 5, (err) => {
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
    sparkHplDirectNET.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl DirectNET should produce data in ASCII mode', (done) => {
    sparkHplDirectNET.serialPort.on('dataToDevice', writeToSerialPort);
    const gotDataForVar = [];
    const variableReadArray = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && _.isEqual(_.get(variable, 'access', 'read'), 'read')) {
        variableReadArray.push(variable);
      }
    });
    db.on('data', (data) => {
      variableReadArray.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
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
  });

  it('after a successful connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access', 'read') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed in ASCII mode`, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplDirectNET.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });

  it('stop should succeed', (done) => {
    sparkHplDirectNET.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed with model disabled', (done) => {
    mode = 'HEX';
    sparkHplDirectNET.updateModel({
      enable: false,
      device: '/dev/ttyUSB0',
      slaveAddress: 2,
      baudRate: '9600',
      parity: 'none',
      mode: 'ASCII',
      requestFrequency: 0.1,
      disconnectReportTime: 0,
      publishDisabled: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('stop should succeed', (done) => {
    sparkHplDirectNET.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed when changing to hex mode', (done) => {
    mode = 'HEX';
    sparkHplDirectNET.updateModel({
      enable: true,
      device: '/dev/ttyUSB0',
      slaveAddress: 2,
      baudRate: '9600',
      parity: 'none',
      mode: 'HEX',
      requestFrequency: 0.1,
      disconnectReportTime: 0,
      publishDisabled: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl DirectNET should produce data in hex mode', (done) => {
    sparkHplDirectNET.serialPort.on('dataToDevice', writeToSerialPort);
    const gotDataForVar = [];
    const variableReadArray = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && _.isEqual(_.get(variable, 'access', 'read'), 'read')) {
        variableReadArray.push(variable);
      }
    });
    db.on('data', (data) => {
      variableReadArray.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
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
  });

  testMachine.variables.forEach((variable) => {
    if (_.get(variable, 'access', 'read') === 'write') {
      it(`writing variable with format ${variable.format} should succeed in hex mode`, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplDirectNET.writeData(value, (err) => {
          if (err) return done(err);
          return done();
        });
      });
    }
  });

  it('an alert should be raised if trying to write to a read variable', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.msg.should.equal(`${testMachine.info.name}: Error Writing Variable`);
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    let iVar;
    let variable;
    for (iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
      variable = testMachine.variables[iVar];
      if (_.get(variable, 'access', 'read') === 'read') break;
    }
    if (iVar < testMachine.variables.length) {
      const value = { variable: variable.name };
      value[variable.name] = variable.value;
      sparkHplDirectNET.writeData(value, (err) => {
        if (err) return done(err);
        return undefined;
      });
    }
  });

  it('an alert should be raised if the first write ACK is not sent', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.msg.should.equal(`${testMachine.info.name}: ACK Not Received Error`);
      sparkAlert.removeAllListeners('raise');
      forceWriteENQACKError = false;
      return done();
    });
    forceWriteENQACKError = true;
    let iVar;
    let variable;
    for (iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
      variable = testMachine.variables[iVar];
      if (_.get(variable, 'access', 'read') === 'write') break;
    }
    if (iVar < testMachine.variables.length) {
      const value = { variable: variable.name };
      value[variable.name] = variable.value;
      sparkHplDirectNET.writeData(value, (err) => {
        if (err) return done(err);
        return undefined;
      });
    }
  });

  it('an alert should be raised if the first write ACK is not sent', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.msg.should.equal(`${testMachine.info.name}: ACK Not Received Error`);
      sparkAlert.removeAllListeners('raise');
      forceWriteENQACKError = false;
      return done();
    });
    forceWriteENQACKError = true;
    let iVar;
    let variable;
    for (iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
      variable = testMachine.variables[iVar];
      if (_.get(variable, 'access', 'read') === 'write') break;
    }
    if (iVar < testMachine.variables.length) {
      const value = { variable: variable.name };
      value[variable.name] = variable.value;
      sparkHplDirectNET.writeData(value, (err) => {
        if (err) return done(err);
        return undefined;
      });
    }
  });

  it('an alert should be raised if the second write ACK is not sent', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('enq-ack-not-received-error');
      alert.msg.should.equal(`${testMachine.info.name}: Enquiry ACK Not Received Error`);
      alert.description.should.equal('An acknowledgement to an equiry was not received from the controller. Verify that the slave station address is correct.');
      sparkAlert.removeAllListeners('raise');
      forceReadWriteACKError = false;
      return done();
    });
    forceReadWriteACKError = true;
    let iVar;
    let variable;
    for (iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
      variable = testMachine.variables[iVar];
      if (_.get(variable, 'access', 'read') === 'write') break;
    }
    if (iVar < testMachine.variables.length) {
      const value = { variable: variable.name };
      value[variable.name] = variable.value;
      sparkHplDirectNET.writeData(value, (err) => {
        if (err) return done(err);
        return undefined;
      });
    }
  });

  it('an alert should be raised if the EOT write ACK is not sent', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.msg.should.equal(`${testMachine.info.name}: ACK Not Received Error`);
      sparkAlert.removeAllListeners('raise');
      forceWriteEOTACKError = false;
      return done();
    });
    forceWriteEOTACKError = true;
    let iVar;
    let variable;
    for (iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
      variable = testMachine.variables[iVar];
      if (_.get(variable, 'access', 'read') === 'write') break;
    }
    if (iVar < testMachine.variables.length) {
      const value = { variable: variable.name };
      value[variable.name] = variable.value;
      sparkHplDirectNET.writeData(value, (err) => {
        if (err) return done(err);
        return undefined;
      });
    }
  });

  it('an alert should be raised if the read ACK is not sent', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('enq-ack-not-received-error');
      alert.msg.should.equal(`${testMachine.info.name}: Enquiry ACK Not Received Error`);
      alert.description.should.equal('An acknowledgement to an equiry was not received from the controller. Verify that the slave station address is correct.');
      sparkAlert.removeAllListeners('raise');
      forceReadWriteACKError = false;
      return done();
    });

    forceReadWriteACKError = true;
  });

  it('an alert should be raised if the read checksum is incorrect', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('checksum-error');
      alert.msg.should.equal(`${testMachine.info.name}: Checksum Error`);
      alert.description.should.equal('A checksum error occurred while attempting to read a variable. Check the serial connection to the controller.');
      sparkAlert.removeAllListeners('raise');
      forceBadChecksum = false;
      return done();
    });

    forceBadChecksum = true;
  });

  it('an alert should be raised if the read STX is not sent', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('stx-not-received-error');
      alert.msg.should.equal(`${testMachine.info.name}: STX Not Received Error`);
      alert.description.should.equal('A start of text was not received from the controller. Check the serial connection to the controller.');
      sparkAlert.removeAllListeners('raise');
      forceReadSTXError = false;
      return done();
    });

    forceReadSTXError = true;
  });

  it('an alert should be raised if the read ACK is not sent', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.msg.should.equal(`${testMachine.info.name}: ACK Not Received Error`);
      sparkAlert.removeAllListeners('raise');
      forceReadACKError = false;
      return done();
    });

    forceReadACKError = true;
  });

  it('an alert should be raised if the read EOT is not sent', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('eot-not-received-error');
      alert.msg.should.equal(`${testMachine.info.name}: EOT Not Received Error`);
      alert.description.should.equal('An end of transmission was not received from the controller. Check the serial connection to the controller.');
      sparkAlert.removeAllListeners('raise');
      forceReadEOTError = false;
      return done();
    });

    forceReadEOTError = true;
  });

  it('an alert should be raised and connection variable set after an error caused', (done) => {
    forceReadTimeoutError = true;
    let alertRaised = false;
    let connectedVariableSet = false;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('read-timeout-error');
      alert.msg.should.equal(`${testMachine.info.name}: Variable Read Timeout Error`);
      alert.description.should.equal('A timeout occurred while attempting to read a variable. Check the serial connection to the controller.');
      alertRaised = true;
      sparkAlert.removeAllListeners('raise');
      if (connectedVariableSet) {
        forceReadTimeoutError = false;
        return done();
      }
      return undefined;
    });

    db.on('data', (data) => {
      if (data.variable === 'machineConnected') {
        data[data.variable].should.equal(false);
        connectedVariableSet = true;
        db.removeAllListeners('data');
        if (alertRaised) {
          forceReadTimeoutError = false;
          return done();
        }
      }
      return undefined;
    });
  });
});
