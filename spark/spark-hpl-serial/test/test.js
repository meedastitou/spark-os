/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplSerial = require('../index.js');

const STX = '\u0002';
const ETX = '\u0003';
const LF = '\u000A';
const CR = '\u000D';
const TEST_EQUIP_START_BYTE = 0xFF;
const TEST_EQUIP_SKIP_BYTE = 0xEE;
const TEST_EQUIP_BUF_LEN = 40;
const HEIDENHAIN_EQUIP_STRINGS = ['MAX           =   +    1.23\r\n',
  'MIN           =   +    4.56\r\n',
  'DIFF          =   +    7.89\r\n',
  'AVERAGE       =   +    10.1112\r\n',
  'STD.DEV.      =        13.1415\r\n',
  '+     16.17\r\n'];
const WF818_RESPONSE_STRING = `${STX}DA1.23${ETX}M`;
const KEYENCE_KV_CR_RESPONSE_STRING = 'CC\r\n';
const KEYENCE_KV_CQ_RESPONSE_STRING = 'CF\r\n';
const KEYENCE_KV_UINT16_RESPONSE_STRING = '123\r\n';
const KEYENCE_KV_FLOAT_RESPONSE_STRING = '123\r\n';
const KEYENCE_KV_BOOL_RESPONSE_STRING = '1\r\n';

let sparkHplSerial;
let usingChecksum = true;
let usingCrLf = true;
let highByteFirst = true;
let highWordFirst = true;

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
    hpl: 'serial',
  },
  settings: {
    model: {
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      protocol: 'SE-DUZ',
      pubSubProtocol: 'Normal',
      usingChecksum: true,
      usingCrLf: true,
      highByteFirst: true,
      highWordFirst: true,
      requestFrequency: 1,
    },
  },
  // Note: All variables MUST have unique, 4 character request keys!
  variables: [{
    name: 'uint8Test',
    description: 'UInt8 Test',
    format: 'uint8',
    requestKey: 'A000',
    csvPos: 0,
    value: 123,
  }, {
    name: 'uint16Test',
    description: 'UInt16 Test',
    format: 'uint16',
    requestKey: 'A002',
    csvPos: 1,
    value: 1234,
  }, {
    name: 'uint32Test',
    description: 'UInt32 Test',
    format: 'uint32',
    requestKey: 'A004',
    csvPos: 2,
    value: 123456,
  }, {
    name: 'int8Test',
    description: 'Int8 Test',
    format: 'int8',
    requestKey: 'A008',
    csvPos: 3,
    value: 34,
  }, {
    name: 'int16Test',
    description: 'Int16 Test',
    format: 'int16',
    requestKey: 'A010',
    csvPos: 4,
    value: 2345,
  }, {
    name: 'int32Test',
    description: 'Int32 Test',
    format: 'int32',
    requestKey: 'A012',
    csvPos: 5,
    value: 234567,
  }, {
    name: 'bitTest',
    description: 'Bit Test',
    format: 'bool',
    requestKey: 'A014',
    csvPos: 6,
    value: true,
  }, {
    name: 'floatTest',
    description: 'Float Test',
    format: 'float',
    requestKey: 'A016',
    csvPos: 7,
    value: 12345.0,
  }, {
    name: 'doubleTest',
    description: 'Double Test',
    format: 'double',
    requestKey: 'A020',
    csvPos: 8,
    value: 123456.0,
  }, {
    name: 'stringTest',
    description: 'String Test',
    format: 'char',
    requestKey: 'A024',
    length: 4,
    csvPos: 9,
    value: 'ABCD',
  }, {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
  }],
};

const testEquipmentMachine = {
  info: {
    name: 'test-equipment-machine',
    fullname: 'Test equipment machine',
    version: '1.0.0',
    description: 'Test Equipment Machine',
    hpl: 'serial',
  },
  settings: {
    model: {
      enable: true,
      mode: 'pub/sub',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      pubSubProtocol: 'Test Equipment',
    },
  },
  // Note: All variables MUST have unique, 4 character request keys!
  variables: [{
    name: 'goodCount',
    description: 'Good Count',
    format: 'uint32',
    charOffset: 0,
    charLength: 6,
    value: 123456,
  }, {
    name: 'badCount',
    description: 'Bad Count',
    format: 'uint16',
    charOffset: 6,
    charLength: 5,
    value: 123,
  }, {
    name: 'skipVariable',
    description: 'Skip Variable',
    format: 'uint16',
    charOffset: 11,
    charLength: 5,
    value: -1,
  }],
};

const HeidenhainEquipmentMachine = {
  info: {
    name: 'HEIDENHAIN-equipment-machine',
    fullname: 'HEIDENHAIN equipment machine',
    version: '1.0.0',
    description: 'HEIDENHAIN Equipment Machine',
    hpl: 'serial',
  },
  settings: {
    model: {
      enable: true,
      mode: 'pub/sub',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      pubSubProtocol: 'HEIDENHAIN',
    },
  },
  // Note: All variables MUST have unique, 4 character request keys!
  variables: [{
    name: 'Max',
    description: 'Max',
    format: 'float',
    regex: 'MAX',
    value: 1.23,
  },
  {
    name: 'Average',
    description: 'Average',
    format: 'float',
    regex: 'AVERAGE',
    value: 10.1112,
  },
  {
    name: 'BlankLineVar',
    description: 'BlankLineVar',
    format: 'float',
    heidenhainKeywordMissingVariableFlag: true,
    value: 16.17,
  }],
};

const WF818TensionControllerMachine = {
  info: {
    name: 'WF818 Tension Controller Machine',
    fullname: 'WF818 Tension Controller Machine',
    version: '1.0.0',
    description: 'WF818 Tension Controller Machine',
    hpl: 'serial',
  },
  settings: {
    model: {
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      protocol: 'WF818 Tension Controller',
      requestFrequency: 1,
    },
  },
  // Note: All variables MUST have unique, 4 character request keys!
  variables: [{
    name: 'Variable1',
    description: 'Variable1',
    format: 'float',
    requestKey: '01DA',
    value: 1.23,
  }],
};

const KeyenceKVMachine = {
  info: {
    name: 'Keyence KV Machine',
    fullname: 'Keyence KV Machine',
    version: '1.0.0',
    description: 'Keyence KV Machine',
    hpl: 'serial',
  },
  settings: {
    model: {
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      protocol: 'Keyence KV',
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'VariableInt',
    description: 'VariableInt',
    format: 'uint16',
    requestKey: 'RD DM0',
    value: 123,
  }, {
    name: 'VariableFloat',
    description: 'VariableFloat',
    format: 'float',
    requestKey: 'RD DM1',
    value: 123.0,
  }, {
    name: 'VariableBool',
    description: 'bool',
    format: 'bool',
    requestKey: 'RD DM2',
    value: true,
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

function calculateChecksum(respString) {
  const respBuffer = Buffer.from(respString);

  let checksumTotal = 0;
  for (let iBuf = 1; iBuf < respBuffer.length; iBuf += 1) {
    checksumTotal += respBuffer[iBuf];
  }
  const checksumTotalHex = checksumTotal.toString(16).toUpperCase();

  return checksumTotalHex.substr(checksumTotalHex.length - 2);
}

function writeToSerialPortReqResSEDUZ(data) {
  const requestKey = data.slice(1, 5).toString();
  testMachine.variables.forEach((variable) => {
    if (!_.get(variable, 'machineConnected', false)) {
      if (variable.requestKey === requestKey) {
        sparkHplSerial.serialPort.writeToComputer(` ${variable.value.toString()}${ETX} `);
      }
    }
  });
}

function writeToSerialPortReqResVLINK(data) {
  const requestKey = data.slice(7, 11).toString();
  testMachine.variables.forEach((variable) => {
    if (!_.get(variable, 'machineConnected', false)) {
      if (variable.requestKey === requestKey) {
        let result;
        switch (variable.format) {
          case 'int32':
          case 'uint32':
            result = `0000000${variable.value.toString(16)}`.slice(-8);
            if (!highByteFirst) {
              result = `${result.substring(2, 4)}${result.substring(0, 2)}${result.substring(6, 8)}${result.substring(4, 6)}`;
            }
            if (!highWordFirst) {
              result = `${result.substring(4, 8)}${result.substring(0, 4)}`;
            }
            break;
          case 'bool':
            result = variable.value ? '0001' : '0000';
            if (!highByteFirst) {
              result = `${result.substring(2, 4)}${result.substring(0, 2)}`;
            }
            break;
          case 'float': {
            const resultBuffer = Buffer.allocUnsafe(4);
            resultBuffer.writeFloatBE(variable.value);
            result = resultBuffer.toString('hex');
            if (!highByteFirst) {
              result = `${result.substring(2, 4)}${result.substring(0, 2)}${result.substring(6, 8)}${result.substring(4, 6)}`;
            }
            if (!highWordFirst) {
              result = `${result.substring(4, 8)}${result.substring(0, 4)}`;
            }
            break;
          }
          case 'double': {
            const resultBuffer = Buffer.allocUnsafe(8);
            resultBuffer.writeDoubleBE(variable.value);
            result = resultBuffer.toString('hex');
            if (!highByteFirst) {
              result = `${result.substring(2, 4)}${result.substring(0, 2)}${result.substring(6, 8)}${result.substring(4, 6)}\
${result.substring(10, 12)}${result.substring(8, 10)}${result.substring(14, 16)}${result.substring(12, 14)}`;
            }
            if (!highWordFirst) {
              result = `${result.substring(12, 16)}${result.substring(8, 12)}${result.substring(4, 8)}${result.substring(0, 4)}`;
            }
            break;
          }
          case 'char': {
            const resultBuffer = Buffer.allocUnsafe(Math.ceil(variable.value.length));
            resultBuffer.write(variable.value);
            result = resultBuffer.swap16().toString('hex');
            break;
          }
          default:
            result = `000${variable.value.toString(16)}`.slice(-4);
            if (!highByteFirst) {
              result = `${result.substring(2, 4)}${result.substring(0, 2)}`;
            }
        }
        let response = `${STX}0100${result}${ETX}`;
        if (usingChecksum) response = `${response}${calculateChecksum(response)}`;
        if (usingCrLf) response = `${response}${CR}${LF}`;
        sparkHplSerial.serialPort.writeToComputer(response);
      }
    }
  });
}
function writeToSerialPortReqResYokogawa(data) {
  const requestKey = data.slice(6, 10).toString();
  testMachine.variables.forEach((variable) => {
    if (!_.get(variable, 'machineConnected', false)) {
      if (variable.requestKey === requestKey) {
        let result;
        switch (variable.format) {
          case 'int8':
          case 'uint8':
            result = variable.value.toString(16);
            break;
          case 'int32':
          case 'uint32':
            result = `0000000${variable.value.toString(16)}`.slice(-8);
            if (!highByteFirst) {
              result = `${result.substring(2, 4)}${result.substring(0, 2)}${result.substring(6, 8)}${result.substring(4, 6)}`;
            }
            if (!highWordFirst) {
              result = `${result.substring(4, 8)}${result.substring(0, 4)}`;
            }
            break;
          case 'bool':
            result = variable.value ? '1' : '0';
            break;
          case 'float':
          case 'double':
          case 'char':
            result = variable.value;
            break;
          default:
            result = `000${variable.value.toString(16)}`.slice(-4);
            if (!highByteFirst) {
              result = `${result.substring(2, 4)}${result.substring(0, 2)}`;
            }
        }
        let response = `${STX}0101OK${result}`;
        if (usingChecksum) response = `${response}${calculateChecksum(response.substr(1))}`;
        response = `${response}${ETX}`;
        if (usingCrLf) response = `${response}${CR}`;
        sparkHplSerial.serialPort.writeToComputer(response);
      }
    }
  });
}

function writeToSerialPortPubSubNormal() {
  let csvList = '';
  testMachine.variables.forEach((variable) => {
    if (!_.get(variable, 'machineConnected', false)) {
      if (csvList.length !== 0) csvList = `${csvList},`;
      csvList = `${csvList}${variable.value.toString()}`;
    }
  });
  csvList = `${csvList}\r`;
  sparkHplSerial.serialPort.writeToComputer(csvList);
}

function writeToSerialPortPubSubTestEquipment() {
  const dataBuffer = Buffer.alloc(TEST_EQUIP_BUF_LEN);
  dataBuffer[0] = TEST_EQUIP_START_BYTE;
  let dataLength = 0;
  testEquipmentMachine.variables.forEach((variable) => {
    let iDigit = variable.charOffset + variable.charLength;
    if ((iDigit + 1) > dataLength) dataLength = iDigit + 1;
    let { value } = variable;
    // if value is -1, insert a skip byte
    if (value === -1) {
      dataBuffer[iDigit] = TEST_EQUIP_SKIP_BYTE;
    } else {
      while (value !== 0) {
        dataBuffer[iDigit] = value % 10;
        value = Math.floor(value / 10);
        iDigit -= 1;
      }
    }
  });
  sparkHplSerial.serialPort.writeToComputer(dataBuffer.slice(0, dataLength));
}

function writeToSerialPortPubSubHeidenhainEquipment() {
  let dataBuffer = [];
  for (let index = 0; index < HEIDENHAIN_EQUIP_STRINGS.length; index += 1) {
    dataBuffer = Buffer.from(HEIDENHAIN_EQUIP_STRINGS[index]);
    sparkHplSerial.serialPort.writeToComputer(dataBuffer);
  }
}

function writeToSerialPortReqResWF818(data) {
  const requestKey = data.charAt(1) + data.charAt(3) + data.slice(5, 7).toString();
  WF818TensionControllerMachine.variables.forEach((variable) => {
    if (!_.get(variable, 'machineConnected', false)) {
      if (variable.requestKey === requestKey) {
        sparkHplSerial.serialPort.writeToComputer(WF818_RESPONSE_STRING);
      }
    }
  });
}

function writeToSerialPortReqResKeyenceKV(data) {
  // console.log(`requestKey = ${data}`);
  if (data.startsWith('CR')) {
    sparkHplSerial.serialPort.writeToComputer(KEYENCE_KV_CR_RESPONSE_STRING);
  } else if (data.startsWith('CQ')) {
    sparkHplSerial.serialPort.writeToComputer(KEYENCE_KV_CQ_RESPONSE_STRING);
  } else {
    KeyenceKVMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)) {
        // console.log(`variable.requestKey = ${variable.requestKey}`);
        if (data.startsWith(variable.requestKey)) {
          if (variable.format === 'uint16') {
            sparkHplSerial.serialPort.writeToComputer(KEYENCE_KV_UINT16_RESPONSE_STRING);
          } else if (variable.format === 'float') {
            sparkHplSerial.serialPort.writeToComputer(KEYENCE_KV_FLOAT_RESPONSE_STRING);
          } else if (variable.format === 'bool') {
            sparkHplSerial.serialPort.writeToComputer(KEYENCE_KV_BOOL_RESPONSE_STRING);
          }
        }
      }
    });
  }
}

describe('Spark HPL Serial', () => {
  it('successfully create a new serial hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSerial = new SparkHplSerial.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplSerial.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplSerial.start(dataCb, 5, (err) => {
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
    sparkHplSerial.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl serial should produce data in req/res SE-DUZ protocol', (done) => {
    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResSEDUZ);

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
  });

  it('after a successful connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplSerial.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplSerial.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl serial should produce data in req/res V-LINK protocol', (done) => {
    sparkHplSerial.updateModel({
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      protocol: 'V-LINK',
      v7port: 1,
      pubSubProtocol: 'Normal',
      usingChecksum: true,
      usingCrLf: true,
      highByteFirst: true,
      highWordFirst: true,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });

    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResVLINK);
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
  });

  it('spark hpl serial should produce data in req/res V-LINK protocol without checksum and CR/LF', (done) => {
    usingChecksum = false;
    usingCrLf = false;
    sparkHplSerial.updateModel({
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      protocol: 'V-LINK',
      v7port: 1,
      pubSubProtocol: 'Normal',
      usingChecksum: false,
      usingCrLf: false,
      highByteFirst: true,
      highWordFirst: true,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });

    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResVLINK);
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
  });

  it('spark hpl serial should produce data in req/res V-LINK protocol, low byte, low word first', (done) => {
    usingChecksum = true;
    usingCrLf = true;
    highByteFirst = false;
    highWordFirst = false;
    sparkHplSerial.updateModel({
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      protocol: 'V-LINK',
      v7port: 1,
      pubSubProtocol: 'Normal',
      usingChecksum: true,
      usingCrLf: true,
      highByteFirst: false,
      highWordFirst: false,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });

    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResVLINK);
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
  });

  it('spark hpl serial should produce data in req/res V-LINK protocol, low byte, high word first', (done) => {
    highByteFirst = false;
    highWordFirst = true;
    sparkHplSerial.updateModel({
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      protocol: 'V-LINK',
      v7port: 1,
      pubSubProtocol: 'Normal',
      usingChecksum: true,
      usingCrLf: true,
      highByteFirst: false,
      highWordFirst: true,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });

    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResVLINK);
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
  });

  it('spark hpl serial should produce data in req/res V-LINK protocol, high byte, low word first', (done) => {
    highByteFirst = true;
    highWordFirst = false;
    sparkHplSerial.updateModel({
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      protocol: 'V-LINK',
      v7port: 1,
      pubSubProtocol: 'Normal',
      usingChecksum: true,
      usingCrLf: true,
      highByteFirst: true,
      highWordFirst: false,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });

    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResVLINK);
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
  });

  it('spark hpl serial should produce data in req/res Yokogawa protocol', (done) => {
    usingChecksum = true;
    usingCrLf = true;
    highByteFirst = true;
    highWordFirst = true;
    sparkHplSerial.updateModel({
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      protocol: 'YOKOGAWA',
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      usingChecksum: true,
      usingCr: true,
      highByteFirst: true,
      highWordFirst: true,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });

    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResYokogawa);
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
  });

  it('spark hpl serial should produce data in req/res Yokogawa protocol without checksum and CR', (done) => {
    usingChecksum = false;
    usingCrLf = false;
    highByteFirst = true;
    highWordFirst = true;
    sparkHplSerial.updateModel({
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      protocol: 'YOKOGAWA',
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      usingChecksum: false,
      usingCr: false,
      highByteFirst: true,
      highWordFirst: true,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });

    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResYokogawa);
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
  });

  it('spark hpl serial should produce data in req/res Yokogawa protocol, low byte, low word first', (done) => {
    usingChecksum = true;
    usingCrLf = true;
    highByteFirst = false;
    highWordFirst = false;
    sparkHplSerial.updateModel({
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      protocol: 'YOKOGAWA',
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      usingChecksum: true,
      usingCr: true,
      highByteFirst: false,
      highWordFirst: false,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });

    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResYokogawa);
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
  });

  it('spark hpl serial should produce data in req/res Yokogawa protocol, low byte, high word first', (done) => {
    highByteFirst = false;
    highWordFirst = true;
    sparkHplSerial.updateModel({
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      protocol: 'YOKOGAWA',
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      usingChecksum: true,
      usingCr: true,
      highByteFirst: false,
      highWordFirst: true,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });

    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResYokogawa);
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
  });

  it('spark hpl serial should produce data in req/res Yokogawa protocol, high byte, low word first', (done) => {
    highByteFirst = true;
    highWordFirst = false;
    sparkHplSerial.updateModel({
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      protocol: 'YOKOGAWA',
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      usingChecksum: true,
      usingCr: true,
      highByteFirst: true,
      highWordFirst: false,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });

    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResYokogawa);
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
  });

  it('spark hpl serial should produce data in normal pub/sub mode', (done) => {
    sparkHplSerial.updateModel({
      enable: true,
      mode: 'pub/sub',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      pubSubProtocol: 'Normal',
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
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
    writeToSerialPortPubSubNormal();
  });

  it('an alert should be raised and connection variables set false if no reponse in req/res mode', (done) => {
    usingChecksum = true;
    usingCrLf = true;
    highByteFirst = true;
    highWordFirst = true;
    sparkHplSerial.updateModel({
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      parity: 'none',
      separator: ',',
      protocol: 'YOKOGAWA',
      yokogawaStationNumber: 1,
      yokogawaCPUNumber: 1,
      usingChecksum: true,
      usingCr: true,
      highByteFirst: true,
      highWordFirst: true,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
    let alertRaised = false;
    let connectedVariableSet = false;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('no-response-error');
      alert.msg.should.equal(`${testMachine.info.name} : No Response`);
      alert.description.should.equal('No response was received in req/res mode');
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
  }).timeout(4000);

  it('successfully create a new serial hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSerial = new SparkHplSerial.hpl(log.child({
      machine: testEquipmentMachine.info.name,
    }), testEquipmentMachine, testEquipmentMachine.settings.model,
    sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplSerial.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl serial should produce data in test equipment pub/sub mode', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testEquipmentMachine.variables.forEach((variable) => {
      // if value is -1, skip this variable, since it has skip bytes in its data
      if (variable.value !== -1) {
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
    writeToSerialPortPubSubTestEquipment();
  });

  it('successfully create a new HEIDENHAIN serial hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSerial = new SparkHplSerial.hpl(log.child({
      machine: HeidenhainEquipmentMachine.info.name,
    }), HeidenhainEquipmentMachine, HeidenhainEquipmentMachine.settings.model,
    sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplSerial.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl serial should produce data in HEIDENHAIN equipment pub/sub mode', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    HeidenhainEquipmentMachine.variables.forEach((variable) => {
      // if value is -1, skip this variable, since it has skip bytes in its data
      if (variable.value !== -1) {
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
    writeToSerialPortPubSubHeidenhainEquipment();
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplSerial.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new WF818TensionControllerMachine serial hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSerial = new SparkHplSerial.hpl(log.child({
      machine: WF818TensionControllerMachine.info.name,
    }), WF818TensionControllerMachine, WF818TensionControllerMachine.settings.model,
    sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplSerial.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl serial should produce data in WF818TensionControllerMachine req/res mode', (done) => {
    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResWF818);

    const readVariables = [];
    const gotDataForVar = [];
    WF818TensionControllerMachine.variables.forEach((variable) => {
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
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplSerial.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new Keyence KV serial hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSerial = new SparkHplSerial.hpl(log.child({
      machine: KeyenceKVMachine.info.name,
    }), KeyenceKVMachine, KeyenceKVMachine.settings.model,
    sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplSerial.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl serial should produce data in Keyence KV req/res mode', (done) => {
    sparkHplSerial.serialPort.on('dataToDevice', writeToSerialPortReqResKeyenceKV);

    const readVariables = [];
    const gotDataForVar = [];
    KeyenceKVMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            // console.log(`variable: ${variable.name} = ${data[variable.name]}`);
            // console.log(`variable: ${variable.name} should = ${variable.value}`);
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

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplSerial.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });
});
