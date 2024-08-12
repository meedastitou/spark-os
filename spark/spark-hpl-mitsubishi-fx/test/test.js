/* jshint esversion: 6 */
// eslint-disable-next-line import/no-extraneous-dependencies
require('chai').should();
const { EventEmitter } = require('events');
// eslint-disable-next-line import/no-extraneous-dependencies
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplMitsubishi = require('../index.js');

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
    fullname: 'Test Machine',
    version: '1.0.0',
    description: 'Test Machine',
    hpl: 'mitsubishi-fx',
  },
  settings: {
    model: {
      enable: true,
      interface: 'serial',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      dataBits: '7 bit',
      stopBits: '1 bit',
      parity: 'none',
      format: 'Format 1',
      checksum: false,
      stationNumber: 0,
      hostName: '',
      port: '',
      mode: 'binary',
      frame: '1E',
      requestFrequency: 0.5,
      disconnectReportTime: 0,
      publishDisabled: false,
      connectionStatus: false,
    },
  },
  variables: [
    {
      name: 'int8Test',
      description: 'Int8 Test',
      memoryArea: 'D',
      address: '0010',
      format: 'int8',
      value: 123,
    },
    {
      name: 'int16Test',
      description: 'Int16 Test',
      memoryArea: 'D',
      address: '0100',
      format: 'int16',
      value: 1234,
    },
    {
      name: 'int32Test',
      description: 'Int32 Test',
      memoryArea: 'D',
      address: '0200',
      format: 'int32',
      value: 23456,
    },
    {
      name: 'uint8Test',
      description: 'UInt8 Test',
      memoryArea: 'D',
      address: '0012',
      format: 'uint8',
      value: 234,
    },
    {
      name: 'uint16Test',
      description: 'UInt16 Test',
      memoryArea: 'D',
      address: '0102',
      format: 'uint16',
      value: 2345,
    },
    {
      name: 'counterTest',
      description: 'Counter Test',
      memoryArea: 'CN',
      address: '210',
      format: 'uint32',
      value: 34567,
    },
    {
      name: 'boolTest',
      description: 'Bool Test',
      memoryArea: 'X',
      address: '0010',
      format: 'bool',
      value: true,
    },
    {
      name: 'writeTest',
      description: 'Write Test',
      memoryArea: 'D',
      address: '0300',
      format: 'int16',
      access: 'write',
      value: 234,
    },
    {
      name: 'machineConnected',
      description: 'Connection Test',
      format: 'bool',
      memoryArea: '',
      address: '',
      machineConnected: true,
      value: true,
    },
  ],
};

const STX = '\u0002';
const ETX = '\u0003';
const ENQ = '\u0005';
const LF = '\u000A';
const CR = '\u000D';
const BATCH_READ_BIT = 'BR';
const BATCH_READ_WORD = 'WR';
const SERIAL_READ_START = `${ENQ}00FF`;
const SERIAL_READ_RESPONSE_START = `${STX}00FF`;

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
      _.forOwn(preloadAlerts, (value, key) => {
        if (typeof preloadAlerts[key].description === 'function') {
          preloadAlerts[key].description('test');
        }
      });
      // preloadAlerts['connect-error'].description('test');
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

let sparkHplMitsubishi;
let addChecksum = false;
let addCrLf = false;
let highByteFirst = true;
let highWordFirst = true;

function calulateChecksumString(stringInput, iEnd) {
  const bufferInput = Buffer.from(stringInput);
  let checksum = 0;
  for (let iChar = 1; iChar < iEnd; iChar += 1) {
    checksum += bufferInput[iChar];
  }
  // eslint-disable-next-line no-bitwise
  checksum &= 0xff;
  return (`0${checksum.toString(16).toUpperCase()}`).slice(-2);
}

function writeToSerialPort(data) {
  if (data.startsWith(SERIAL_READ_START)) {
    if (data[6] === 'R') {
      let checksumOK = true;
      if (addChecksum) {
        const iEnd = addCrLf ? data.length - 4 : data.length - 2;

        if (addCrLf) {
          checksumOK = calulateChecksumString(data, iEnd) === data.substr(data.length - 4, 2);
        } else {
          checksumOK = calulateChecksumString(data, iEnd) === data.substr(data.length - 2, 2);
        }
      }
      if (checksumOK) {
        let memoryArea; let
          address;
        const memoryArea1 = data.substr(8, 1);
        if ((memoryArea1 === 'C') || (memoryArea1 === 'T')) {
          memoryArea = data.substr(8, 2);
          address = data.substr(10, 3);
        } else {
          memoryArea = memoryArea1;
          address = data.substr(9, 4);
        }
        let iVar;
        for (iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
          const variable = testMachine.variables[iVar];
          if (!_.get(variable, 'machineConnected', false)
           && (_.get(variable, 'access', 'read') === 'read')
           && (variable.memoryArea === memoryArea)
           && (variable.address === address)) {
            break;
          }
        }
        if (iVar < testMachine.variables.length) {
          const variable = testMachine.variables[iVar];
          let response = SERIAL_READ_RESPONSE_START;
          const command = data.substr(5, 2);
          if (command === BATCH_READ_WORD) {
            switch (variable.format) {
              case 'int32':
              case 'uint32': {
                let respVal = (`0000000${variable.value.toString(16)}`).slice(-8);
                if (highByteFirst) {
                  if (!highWordFirst) {
                    respVal = respVal[4] + respVal[5] + respVal[6] + respVal[7]
                         + respVal[0] + respVal[1] + respVal[2] + respVal[3];
                  }
                } else if (highWordFirst) {
                  respVal = respVal[2] + respVal[3] + respVal[0] + respVal[1]
                   + respVal[6] + respVal[7] + respVal[4] + respVal[5];
                } else {
                  respVal = respVal[6] + respVal[7] + respVal[4] + respVal[5]
                   + respVal[2] + respVal[3] + respVal[0] + respVal[1];
                }
                response += respVal;
              }
                break;
              default: {
                let respVal = (`000${variable.value.toString(16)}`).slice(-4);
                if (!highByteFirst) {
                  respVal = respVal[2] + respVal[3] + respVal[0] + respVal[1];
                }
                response += respVal;
              }
                break;
            }
          } else if (command === BATCH_READ_BIT) {
            response += variable.value ? '1' : '0';
          }

          response += ETX;
          if (addChecksum) {
            response += calulateChecksumString(response, response.length);
          }
          if (addCrLf) {
            response += CR + LF;
          }
          sparkHplMitsubishi.serialPort.writeToComputer(response);
        }
      }
    } else {
      // Note this workss ONLY in  no checksum, no CR/LF mode !
      db.emit('wrote', data.substr(15));
    }
  }
}

describe('Spark HPL Mitsubishi FX', () => {
  it('successfully create a new Mitsubishi FX machine', (done) => {
    // eslint-disable-next-line new-cap
    sparkHplMitsubishi = new SparkHplMitsubishi.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should error when datacb is not a function', (done) => {
    sparkHplMitsubishi.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplMitsubishi.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('before a successful start the connection status should be false', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(false);
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplMitsubishi.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl Mitsubishi FX should produce data in serial mode with no checksum or CR/LF', (done) => {
    sparkHplMitsubishi.serialPort.on('dataToDevice', writeToSerialPort);
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
    if (!_.get(variable, 'machineConnected', false)
     && (_.get(variable, 'access', 'read') === 'write')) {
      it(`writing variable ${variable.name} should succeed in serial mode`, (done) => {
        db.on('wrote', (data) => {
          const valueWritten = parseInt(data, 16);
          valueWritten.should.equal(variable.value);
          return done();
        });
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplMitsubishi.writeData(value, (err) => {
          if (err) return done(err);
          return undefined;
        });
      });
    }
  });

  it('stop should succeed', (done) => {
    sparkHplMitsubishi.stop((err) => {
      if (err) return done(err);
      setTimeout(() => done(),
        100);
      return undefined;
    });
  });

  it('spark hpl Mitsubishi FX should produce data in serial mode with checksum but no CR/LF', (done) => {
    addChecksum = true;
    sparkHplMitsubishi.updateModel({
      enable: true,
      interface: 'serial',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      dataBits: '7 bit',
      stopBits: '1 bit',
      parity: 'none',
      format: 'Format 1',
      checksum: true,
      stationNumber: 0,
      hostName: '',
      port: '',
      mode: 'binary',
      frame: '1E',
      requestFrequency: 0.5,
      highByteFirst: true,
      highWordFirst: true,
      disconnectReportTime: 0,
      publishDisabled: false,
      connectionStatus: false,
    }, (err) => {
      if (err) return done(err);
      sparkHplMitsubishi.serialPort.on('dataToDevice', writeToSerialPort);

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

  it('stop should succeed', (done) => {
    sparkHplMitsubishi.stop((err) => {
      if (err) return done(err);
      setTimeout(() => done(),
        100);
      return undefined;
    });
  });

  it('spark hpl Mitsubishi FX should produce data in serial mode with checksum and CR/LF', (done) => {
    addChecksum = true;
    addCrLf = true;
    sparkHplMitsubishi.updateModel({
      enable: true,
      interface: 'serial',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      dataBits: '7 bit',
      stopBits: '1 bit',
      parity: 'none',
      format: 'Format 4',
      checksum: true,
      stationNumber: 0,
      hostName: '',
      port: '',
      mode: 'binary',
      frame: '1E',
      requestFrequency: 0.5,
      highByteFirst: true,
      highWordFirst: true,
      disconnectReportTime: 0,
      publishDisabled: false,
      connectionStatus: false,
    }, (err) => {
      if (err) return done(err);
      sparkHplMitsubishi.serialPort.on('dataToDevice', writeToSerialPort);

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

  it('stop should succeed', (done) => {
    sparkHplMitsubishi.stop((err) => {
      if (err) return done(err);
      setTimeout(() => done(),
        100);
      return undefined;
    });
  });

  it('spark hpl Mitsubishi FX should produce data in serial mode with no checksum but CR/LF', (done) => {
    addChecksum = false;
    addCrLf = true;
    sparkHplMitsubishi.updateModel({
      enable: true,
      interface: 'serial',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      dataBits: '7 bit',
      stopBits: '1 bit',
      parity: 'none',
      format: 'Format 4',
      checksum: false,
      stationNumber: 0,
      hostName: '',
      port: '',
      mode: 'binary',
      frame: '1E',
      requestFrequency: 0.5,
      highByteFirst: true,
      highWordFirst: true,
      disconnectReportTime: 0,
      publishDisabled: false,
      connectionStatus: false,
    }, (err) => {
      if (err) return done(err);
      sparkHplMitsubishi.serialPort.on('dataToDevice', writeToSerialPort);

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

  it('stop should succeed', (done) => {
    sparkHplMitsubishi.stop((err) => {
      if (err) return done(err);
      setTimeout(() => done(),
        100);
      return undefined;
    });
  });

  it('spark hpl Mitsubishi FX should produce data in serial mode with low byte first, high word first', (done) => {
    addChecksum = true;
    addCrLf = false;
    highByteFirst = false;
    highWordFirst = true;
    sparkHplMitsubishi.updateModel({
      enable: true,
      interface: 'serial',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      dataBits: '7 bit',
      stopBits: '1 bit',
      parity: 'none',
      format: 'Format 1',
      checksum: true,
      stationNumber: 0,
      hostName: '',
      port: '',
      mode: 'binary',
      frame: '1E',
      requestFrequency: 0.5,
      highByteFirst: false,
      highWordFirst: true,
      disconnectReportTime: 0,
      publishDisabled: false,
      connectionStatus: false,
    }, (err) => {
      if (err) return done(err);
      sparkHplMitsubishi.serialPort.on('dataToDevice', writeToSerialPort);

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

  it('stop should succeed', (done) => {
    sparkHplMitsubishi.stop((err) => {
      if (err) return done(err);
      setTimeout(() => done(),
        100);
      return undefined;
    });
  });

  it('spark hpl Mitsubishi FX should produce data in serial mode with low byte first, low word first', (done) => {
    addChecksum = true;
    addCrLf = false;
    highByteFirst = false;
    highWordFirst = false;
    sparkHplMitsubishi.updateModel({
      enable: true,
      interface: 'serial',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      dataBits: '7 bit',
      stopBits: '1 bit',
      parity: 'none',
      format: 'Format 1',
      checksum: true,
      stationNumber: 0,
      hostName: '',
      port: '',
      mode: 'binary',
      frame: '1E',
      requestFrequency: 0.5,
      highByteFirst: false,
      highWordFirst: false,
      disconnectReportTime: 0,
      publishDisabled: false,
      connectionStatus: false,
    }, (err) => {
      if (err) return done(err);
      sparkHplMitsubishi.serialPort.on('dataToDevice', writeToSerialPort);

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

  it('stop should succeed', (done) => {
    sparkHplMitsubishi.stop((err) => {
      if (err) return done(err);
      setTimeout(() => done(),
        100);
      return undefined;
    });
  });

  it('spark hpl Mitsubishi FX should produce data in serial mode with high byte first, low word first', (done) => {
    addChecksum = true;
    addCrLf = false;
    highByteFirst = true;
    highWordFirst = false;
    sparkHplMitsubishi.updateModel({
      enable: true,
      interface: 'serial',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      dataBits: '7 bit',
      stopBits: '1 bit',
      parity: 'none',
      format: 'Format 1',
      checksum: true,
      stationNumber: 0,
      hostName: '',
      port: '',
      mode: 'binary',
      frame: '1E',
      requestFrequency: 0.5,
      highByteFirst: true,
      highWordFirst: false,
      disconnectReportTime: 0,
      publishDisabled: false,
      connectionStatus: false,
    }, (err) => {
      if (err) return done(err);
      sparkHplMitsubishi.serialPort.on('dataToDevice', writeToSerialPort);

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

  it('stop should succeed', (done) => {
    sparkHplMitsubishi.stop((err) => {
      if (err) return done(err);
      setTimeout(() => done(),
        100);
      return undefined;
    });
  });

  it('spark hpl Mitsubishi FX should produce data in Ethernet 1E mode', (done) => {
    addChecksum = false;
    addCrLf = false;
    highByteFirst = true;
    highWordFirst = true;
    sparkHplMitsubishi.tester.prototype.setVariables(testMachine.variables);
    sparkHplMitsubishi.updateModel({
      enable: true,
      interface: 'ethernet',
      checksum: false,
      stationNumber: 0,
      hostName: '',
      port: '',
      mode: 'binary',
      frame: '1E',
      requestFrequency: 0.5,
      highByteFirst: true,
      highWordFirst: true,
      disconnectReportTime: 0,
      publishDisabled: false,
      connectionStatus: false,
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
    if (!_.get(variable, 'machineConnected', false)
     && (_.get(variable, 'access', 'read') === 'write')) {
      it(`writing variable ${variable.name} should succeed in Ethernet mode`, (done) => {
        sparkHplMitsubishi.tester.prototype.emitter.on('wrote', (data) => {
          data.should.equal(variable.value);
          return done();
        });
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplMitsubishi.writeData(value, (err) => {
          if (err) return done(err);
          return undefined;
        });
      });
    }
  });

  it('spark hpl Mitsubishi FX should produce data in Ethernet 3E mode', (done) => {
    sparkHplMitsubishi.updateModel({
      enable: true,
      interface: 'ethernet',
      checksum: false,
      stationNumber: 0,
      hostName: '',
      port: '',
      mode: 'binary',
      frame: '3E',
      requestFrequency: 0.5,
      highByteFirst: true,
      highWordFirst: true,
      disconnectReportTime: 0,
      publishDisabled: false,
      connectionStatus: false,
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

  it('an alert should be raised if there is connection error', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'errorMsg', 'description');
      alert.msg.should.equal('Mitsubishi FX: Could not Connect to the Host');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplMitsubishi.tester.prototype.setConnectionError(Error('connection error'));
    sparkHplMitsubishi.updateModel({
      enable: true,
      interface: 'ethernet',
      checksum: false,
      stationNumber: 0,
      hostName: '',
      port: '',
      mode: 'binary',
      frame: '3E',
      requestFrequency: 0.5,
      highByteFirst: true,
      highWordFirst: true,
      disconnectReportTime: 0,
      publishDisabled: false,
      connectionStatus: false,
    }, () => {
    });
  });

  it('connection status variables should be set true when the connection succeeds', (done) => {
    sparkHplMitsubishi.tester.prototype.setConnectionError(null);
    db.on('data', (data) => {
      testMachine.variables.forEach((variable) => {
        if (_.get(variable, 'machineConnected', false) && (variable.name === data.variable)) {
          data[variable.name].should.equal(true);
          db.removeAllListeners('data');
          return done();
        }
        return undefined;
      });
    });
    sparkHplMitsubishi.updateModel({
      enable: true,
      interface: 'ethernet',
      checksum: false,
      stationNumber: 0,
      hostName: '',
      port: '',
      mode: 'binary',
      frame: '3E',
      requestFrequency: 0.5,
      highByteFirst: true,
      highWordFirst: true,
      disconnectReportTime: 0,
      publishDisabled: false,
      connectionStatus: false,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('connection status variables should be set false when disconnected', (done) => {
    sparkHplMitsubishi.tester.prototype.setConnectionError(null);
    db.on('data', (data) => {
      testMachine.variables.forEach((variable) => {
        if (_.get(variable, 'machineConnected', false) && (variable.name === data.variable)) {
          data[variable.name].should.equal(false);
          db.removeAllListeners('data');
          return done();
        }
        return undefined;
      });
    });
    sparkHplMitsubishi.stop(() => {
    });
  });
});
