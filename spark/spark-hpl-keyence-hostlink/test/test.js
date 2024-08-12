/* jshint esversion: 6 */
require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const net = require('net');
const pkg = require('../package.json');
const SparkHplKeyenceHostlink = require('../index.js');

const CLIENT_PORT = 8501;

let sparkHplKeyenceHostlink;
let writeError = '';

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
    hpl: 'keyence-hostlink',
  },
  settings: {
    model: {
      enable: true,
      interface: 'ethernet',
      ipAddress: os.hostname(),
      port: CLIENT_PORT,
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'int16Test',
    description: 'Int16 Test',
    format: 'int16',
    memoryArea: 'DM',
    address: 100,
    value: 1234,
  },
  {
    name: 'uint16Test',
    description: 'UInt16 Test',
    format: 'uint16',
    memoryArea: 'EM',
    address: 110,
    value: 2345,
  },
  {
    name: 'int32Test',
    description: 'Int32 Test',
    format: 'int32',
    memoryArea: 'DM',
    address: 160,
    value: 45678,
  },
  {
    name: 'uint32Test',
    description: 'UInt32 Test',
    format: 'uint32',
    memoryArea: 'EM',
    address: 140,
    value: 345678,
  },
  {
    name: 'int32Reg32Test',
    description: 'Int16 32 Bit Test',
    format: 'int32',
    memoryArea: 'TC',
    address: 200,
    value: 23456,
  },
  {
    name: 'uint32Reg32Test',
    description: 'UInt16 32 Bit Test',
    format: 'uint32',
    memoryArea: 'TC',
    address: 210,
    value: 23456,
  },
  {
    name: 'int16Reg32Test',
    description: 'Int16 32 Bit Register Test',
    format: 'int16',
    memoryArea: 'TC',
    address: 230,
    value: 45678,
  },
  {
    name: 'uint16Reg32Test',
    description: 'UInt16 32 Bit Register Test',
    format: 'uint16',
    memoryArea: 'TC',
    address: 240,
    value: 56789,
  },
  {
    name: 'int64Test',
    description: 'Int64 Test',
    format: 'int64',
    memoryArea: 'TC',
    address: 300,
    value: 234567,
  },
  {
    name: 'intBoolTest',
    description: 'Bool Test',
    format: 'bool',
    memoryArea: 'R',
    address: 400,
    value: true,
  },
  {
    name: 'intStringTest',
    description: 'String Test',
    format: 'char',
    memoryArea: 'FM',
    address: 500,
    value: '123',
  },
  {
    name: 'int16WriteTest',
    description: 'Int16 Write Test',
    format: 'int16',
    memoryArea: 'DM',
    address: 110,
    access: 'write',
    value: 2345,
  },
  {
    name: 'int32WriteTest',
    description: 'Int32 Write Test',
    format: 'int32',
    memoryArea: 'EM',
    address: 250,
    access: 'write',
    value: 123456,
  },
  {
    name: 'boolWriteTest',
    description: 'Bool Write Test',
    format: 'bool',
    memoryArea: 'B',
    address: 310,
    access: 'write',
    value: true,
  },
  {
    name: 'floatWriteTest',
    description: 'Float Write Test',
    format: 'float',
    memoryArea: 'ZF',
    address: 610,
    access: 'write',
    value: 34567.0,
  },
  {
    name: 'stringWriteTest',
    description: 'String Write Test',
    format: 'char',
    memoryArea: 'DM',
    address: 520,
    access: 'write',
    value: '1234',
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

function isDigit(char) {
  return (char >= '0') && (char <= '9');
}

function parseRequest(requestString) {
  const request = {
    command: requestString.substr(0, 2),
    memoryArea: '',
    address: 0,
    format: '',
    data: null,
  };
  let iCmd = 3;
  let iEndFormat = requestString.indexOf(' ', 3);
  if (iEndFormat === -1) iEndFormat = requestString.length;
  while (!isDigit(requestString.substr(iCmd, 1))) {
    iCmd += 1;
  }
  const iAddr = iCmd;
  request.memoryArea = requestString.substring(3, iAddr);
  while ((iCmd < iEndFormat) && (requestString.substr(iCmd, 1) !== '.')) {
    iCmd += 1;
  }
  request.address = parseInt(requestString.substring(iAddr, iCmd), 10);
  if (iCmd < iEndFormat) {
    request.format = requestString.substr(iCmd + 1, 1);
  }
  if (iEndFormat < requestString.length) {
    request.data = parseInt(requestString.substr(iEndFormat + 1), 10);
  }

  return request;
}

function getRequiredFormat(variable) {
  if ((variable.format === 'float')
   || (variable.format === 'double')
   || (variable.format === 'int64')
   || (variable.format === 'uint64')
   || (variable.format === 'char')) {
    return '';
  }

  let requiredFormat = '';
  switch (variable.memoryArea) {
    case 'DM':
    case 'EM':
    case 'FM':
    case 'ZF':
    case 'W':
    case 'TM':
    case 'Z':
    case 'AT':
    case 'CM':
    case 'VM':
    {
      if ((variable.format === 'int32') || (variable.format === 'uint32')) {
        if (variable.format === 'int32') {
          requiredFormat = 'L';
        } else {
          requiredFormat = 'D';
        }
      } else if ((variable.format === 'int16') || (variable.format === 'int8')) {
        requiredFormat = 'S';
      }
      break;
    }
    case 'TC':
    case 'CC':
    case 'TS':
    case 'CS':
    {
      if ((variable.format !== 'int32') && (variable.format !== 'uint32')) {
        if ((variable.format === 'int16') || (variable.format === 'int8')) {
          requiredFormat = 'S';
        } else {
          requiredFormat = 'U';
        }
      } else if (variable.format === 'int32') {
        requiredFormat = 'L';
      }
      break;
    }
    default:
  }

  return requiredFormat;
}

net.createServer((socket) => {
  socket.on('data', (data) => {
    const request = parseRequest(data.toString().trim());
    if (request.command === 'RD') {
      for (let iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
        const variable = testMachine.variables[iVar];
        if ((_.get(variable, 'access', 'read') === 'read')
        && (variable.memoryArea === request.memoryArea)
        && (variable.address === request.address)
        && (getRequiredFormat(variable) === request.format)) {
          if (variable.format === 'bool') {
            socket.write(`${variable.value ? '1' : '0'}\r\n`);
          } else {
            socket.write(`${variable.value}\r\n`);
          }
          break;
        }
      }
    } else if (request.command === 'WR') {
      for (let iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
        const variable = testMachine.variables[iVar];
        if ((_.get(variable, 'access', 'read') === 'write')
        && (variable.memoryArea === request.memoryArea)
        && (variable.address === request.address)
        && (getRequiredFormat(variable) === request.format)) {
          socket.write('OK\r\n');
          switch (variable.format) {
            case 'bool':
              db.emit('write', request.data === 1);
              break;
            case 'char':
              db.emit('write', request.data.toString());
              break;
            default:
              db.emit('write', request.data);
          }
          break;
        }
      }
    }
  });
}).listen(testMachine.settings.model.port);

function writeToSerialPort(data) {
  const dataTrimmed = data.trim();
  if (dataTrimmed === 'CQ') {
    sparkHplKeyenceHostlink.serialPort.writeToComputer('CF\r\n');
    return;
  }
  const request = parseRequest(dataTrimmed);
  if (request.command === 'RD') {
    for (let iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
      const variable = testMachine.variables[iVar];
      if ((_.get(variable, 'access', 'read') === 'read')
      && (variable.memoryArea === request.memoryArea)
      && (variable.address === request.address)
      && (getRequiredFormat(variable) === request.format)) {
        if (variable.format === 'bool') {
          sparkHplKeyenceHostlink.serialPort.writeToComputer(`${variable.value ? '1' : '0'}\r\n`);
        } else {
          sparkHplKeyenceHostlink.serialPort.writeToComputer(`${variable.value}\r\n`);
        }
        break;
      }
    }
  } else if (request.command === 'WR') {
    for (let iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
      const variable = testMachine.variables[iVar];
      if ((_.get(variable, 'access', 'read') === 'write')
      && (variable.memoryArea === request.memoryArea)
      && (variable.address === request.address)
      && (getRequiredFormat(variable) === request.format)) {
        if (writeError.length === 0) {
          sparkHplKeyenceHostlink.serialPort.writeToComputer('OK\r\n');
          switch (variable.format) {
            case 'bool':
              db.emit('write', request.data === 1);
              break;
            case 'char':
              db.emit('write', request.data.toString());
              break;
            default:
              db.emit('write', request.data);
          }
        } else if (writeError !== 'NO') {
          sparkHplKeyenceHostlink.serialPort.writeToComputer(`${writeError}\r\n`);
        }
        break;
      }
    }
  }
}

describe('Spark HPL Keyence Host Link', () => {
  it('successfully create a new Keyence Host Link hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplKeyenceHostlink = new SparkHplKeyenceHostlink.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplKeyenceHostlink.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplKeyenceHostlink.start(dataCb, 5, (err) => {
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
    sparkHplKeyenceHostlink.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl Keyence Host Link should produce data in Ethernet mode', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (_.get(variable, 'access', 'read') === 'read') {
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

  it('after a successful ethernet connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed in Ethernet mode`,
        (done) => {
          db.on('write', (data) => {
            data.should.equal(variable.value);
            db.removeAllListeners('write');
            return done();
          });
          const value = { variable: variable.name };
          value[variable.name] = variable.value;
          sparkHplKeyenceHostlink.writeData(value, (err) => {
            if (err) return done(err);
            return undefined;
          });
        });
    }
  });

  it('update model should succeed when changing to serial mode', (done) => {
    sparkHplKeyenceHostlink.updateModel({
      enable: true,
      interface: 'serial',
      device: '/dev/ttyUSB0',
      baudRate: '9600',
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
    setTimeout(() => {
      sparkHplKeyenceHostlink.serialPort.on('dataToDevice', writeToSerialPort);
      sparkHplKeyenceHostlink.serialPort.writeToComputer('CC\r\n');
    }, 100);
  });

  it('spark hpl Keyence Host Link should produce data in serial mode', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (_.get(variable, 'access', 'read') === 'read') {
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

  it('after a successful serial connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed in serial mode`,
        (done) => {
          db.on('write', (data) => {
            data.should.equal(variable.value);
            db.removeAllListeners('write');
            return done();
          });
          const value = { variable: variable.name };
          value[variable.name] = variable.value;
          sparkHplKeyenceHostlink.writeData(value, (err) => {
            if (err) return done(err);
            return undefined;
          });
        });
    }
  });

  it('an alert should be raised for a device number write error', (done) => {
    writeError = 'E0';
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('write-error');
      alert.msg.should.equal(`${testMachine.info.name}: Write Error`);
      alert.description.should.equal('An error occurred while trying to write to a variable: Device Number Error');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    let iVar = 0;
    for (iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
      if ((_.get(testMachine.variables[iVar], 'access') === 'write')) break;
    }
    if (iVar < testMachine.variables.length) {
      const variable = testMachine.variables[iVar];
      const value = { variable: variable.name };
      value[variable.name] = variable.value;
      sparkHplKeyenceHostlink.writeData(value, (err) => {
        if (err) return done(err);
        return undefined;
      });
    }
  });

  it('an alert should be raised for a command write error', (done) => {
    writeError = 'E1';
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('write-error');
      alert.msg.should.equal(`${testMachine.info.name}: Write Error`);
      alert.description.should.equal('An error occurred while trying to write to a variable: Command Error');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    let iVar = 0;
    for (iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
      if ((_.get(testMachine.variables[iVar], 'access') === 'write')) break;
    }
    if (iVar < testMachine.variables.length) {
      const variable = testMachine.variables[iVar];
      const value = { variable: variable.name };
      value[variable.name] = variable.value;
      sparkHplKeyenceHostlink.writeData(value, (err) => {
        if (err) return done(err);
        return undefined;
      });
    }
  });

  it('an alert should be raised for a write protected write error', (done) => {
    writeError = 'E4';
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('write-error');
      alert.msg.should.equal(`${testMachine.info.name}: Write Error`);
      alert.description.should.equal('An error occurred while trying to write to a variable: Write Protected');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    let iVar = 0;
    for (iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
      if ((_.get(testMachine.variables[iVar], 'access') === 'write')) break;
    }
    if (iVar < testMachine.variables.length) {
      const variable = testMachine.variables[iVar];
      const value = { variable: variable.name };
      value[variable.name] = variable.value;
      sparkHplKeyenceHostlink.writeData(value, (err) => {
        if (err) return done(err);
        return undefined;
      });
    }
  });

  it('an alert should be raised if no response to a write', (done) => {
    writeError = 'NO';
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('write-error');
      alert.msg.should.equal(`${testMachine.info.name}: Write Error`);
      alert.description.should.equal('An error occurred while trying to write to a variable: No response from PLC');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    let iVar = 0;
    for (iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
      if ((_.get(testMachine.variables[iVar], 'access') === 'write')) break;
    }
    if (iVar < testMachine.variables.length) {
      const variable = testMachine.variables[iVar];
      const value = { variable: variable.name };
      value[variable.name] = variable.value;
      sparkHplKeyenceHostlink.writeData(value, (err) => {
        if (err) return done(err);
        return undefined;
      });
    }
  }).timeout(3000);

  it('an alert should be raised if attempting to write to read variable', (done) => {
    writeError = '';
    let variableName;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`variable-not-writable-error-${variableName}`);
      alert.msg.should.equal(`${testMachine.info.name}: Error Writing Variable`);
      alert.description.should.equal(`Error writing ${variableName}. Variable does not exist or is not writable`);
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    let iVar = 0;
    for (iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
      if ((_.get(testMachine.variables[iVar], 'access', 'read') === 'read')) break;
    }
    if (iVar < testMachine.variables.length) {
      const variable = testMachine.variables[iVar];
      variableName = variable.name;
      const value = { variable: variable.name };
      value[variable.name] = variable.value;
      sparkHplKeyenceHostlink.writeData(value, (err) => {
        if (err) return done(err);
        return undefined;
      });
    }
  });


  it('stop should succeeds', (done) => {
    sparkHplKeyenceHostlink.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('start should raise an alert if no response to initialization command', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('connection-error');
      alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
      alert.description.should.equal('Not able to open connection. Please verify the configuration');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplKeyenceHostlink.start(dataCb, configUpdateCb, () => {
    });
  }).timeout(3000);
});
