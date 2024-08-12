/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplADC = require('../index.js');

const TEMP_RESPONSE = 'temp\r\n'
                      + 'Z1B Z1M Z1T Z2B Z2M Z2T DPT CJT PR1 '
                      + 'SH1 PR2 SH2 RET RHT RAWDP DEW  I1  I2  I3\r\n'
                      + '72, 79, 70, 66, 68, 84, 70, 69, 91, 69, 89, 69, '
                      + '69, 68,  410,-22 465 338 470  1533  1550\r\n';
const VON_RESPONSE = '138,151, 71, 69, 82, 91, 71, 71,163, 71,166, 71, 71, '
                     + '68,  277,-26 204 276 275 1085 372 105 9 0 0 0 0\r\n';
const VERBOSE_ON_RESPONSE = 'von\r\nVerbose ON\r\n';
const WRITE_TEST_NAME = 'writeTest';
const WRITE_TEST_VALUE = 75;
const WRITE_TEST_CMD = 'PT1';
const WRITE_TEST_RESP = `${WRITE_TEST_CMD}=${WRITE_TEST_VALUE}`;
const READ_TEST_NAME = 'intTest';

let sparkHplADC;
let verboseTimer = null;
let verboseOn = false;

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
    hpl: 'adc',
  },
  settings: {
    model: {
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '38400',
      parity: 'none',
      requestFrequency: 2,
    },
  },
  variables: [{
    name: 'intTest',
    description: 'Int Test',
    format: 'int16',
    type: 'General Command',
    commandName: 'TEMPINT',
    value: 123,
  }, {
    name: 'floatTest',
    description: 'Float Test',
    format: 'float',
    type: 'General Command',
    commandName: 'TEMPFLOAT',
    value: 234,
  }, {
    name: 'stringTest',
    description: 'String Test',
    format: 'char',
    type: 'General Command',
    commandName: 'TEMPSTRING',
    value: '25 C',
  }, {
    name: 'bitTest',
    description: 'Bit Test',
    format: 'bool',
    type: 'General Command',
    commandName: 'TEMPBOOL',
    value: true,
  }, {
    name: 'tempZ1BTest',
    description: 'Temp Z1B Test',
    format: 'float',
    type: 'Temperature Request',
    temperatureDescriptor: 'Z1B',
    value: 72,
  }, {
    name: 'tempDewTest',
    description: 'Temp Dew Test',
    format: 'float',
    type: 'Temperature Request',
    temperatureDescriptor: 'DEW',
    value: -22,
  }, {
    name: 'temp1PeriodicTest',
    description: 'Temp 1 Periodic Test',
    format: 'float',
    type: 'Periodic Temperature Value',
    temperatureIndex: 0,
    value: 138,
  }, {
    name: 'temp5PeriodicTest',
    description: 'Temp 5 Periodic Test',
    format: 'float',
    type: 'Periodic Temperature Value',
    temperatureIndex: 4,
    value: 82,
  }, {
    name: WRITE_TEST_NAME,
    description: 'Write Test',
    format: 'int16',
    type: 'General Command',
    commandName: WRITE_TEST_CMD,
    access: 'write',
    value: WRITE_TEST_VALUE,
  }, {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
  }],
};

const invalidMachineNoCommandName = {
  info: {
    name: 'invalid-machine-no-command-name',
    fullname: 'Invalid machine - no command name',
    version: '1.0.0',
    description: 'Invalid machine - no command name',
    hpl: 'adc',
  },
  settings: {
    model: {
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '38400',
      parity: 'none',
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'no-command-name-test',
    description: 'No Command Name Test',
    format: 'int16',
    type: 'General Command',
  }],
};

const invalidMachineNoTemperatureDescriptor = {
  info: {
    name: 'invalid-machine-no-temperature-descriptor',
    fullname: 'Invalid machine - no temperature descriptor',
    version: '1.0.0',
    description: 'Invalid machine - no temperature descriptor',
    hpl: 'adc',
  },
  settings: {
    model: {
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '38400',
      parity: 'none',
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'no-temperature-descriptor-test',
    description: 'No Temperature Descriptor Test',
    format: 'int16',
    type: 'Temperature Request',
  }],
};

const invalidMachineNoTemperatureIndex = {
  info: {
    name: 'invalid-machine-no-temperature-index',
    fullname: 'Invalid machine - no temperature index',
    version: '1.0.0',
    description: 'Invalid machine - no temperature index',
    hpl: 'adc',
  },
  settings: {
    model: {
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '38400',
      parity: 'none',
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'no-temperature-index-test',
    description: 'No Temperature Index Test',
    format: 'int16',
    type: 'Periodic Temperature Value',
  }],
};

const invalidMachineOnlyGeneralWritable = {
  info: {
    name: 'invalid-machine-only-general-writable',
    fullname: 'Invalid machine - only general writable',
    version: '1.0.0',
    description: 'Invalid machine - only general writable',
    hpl: 'adc',
  },
  settings: {
    model: {
      enable: true,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '38400',
      parity: 'none',
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'only-general-writable-test',
    description: 'Only General Writable Test',
    format: 'int16',
    type: 'Temperature Request',
    access: 'write',
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

function writeToSerialPortReqRes(data) {
  const dataTrimmed = data.trim();
  switch (dataTrimmed) {
    case 'von':
      verboseOn = true;
      sparkHplADC.serialPort.writeToComputer(VERBOSE_ON_RESPONSE);
      break;
    case 'voff':
      break;
    case 'temp':
      sparkHplADC.serialPort.writeToComputer(TEMP_RESPONSE);
      break;
    case WRITE_TEST_RESP:
      db.emit('write', WRITE_TEST_VALUE);
      break;
    default:
      testMachine.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false)
          && (_.get(variable, 'access', 'read') === 'read')) {
          if (variable.commandName === dataTrimmed) {
            sparkHplADC.serialPort.writeToComputer(`${dataTrimmed}\r\n${variable.value}\r\n`);
          }
        }
      });
  }
}

function turnVerboseOn() {
  verboseTimer = setInterval(() => {
    sparkHplADC.serialPort.writeToComputer(VON_RESPONSE);
  }, 1500);
}

describe('Spark HPL ADC', () => {
  it('successfully create a new ADC hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplADC = new SparkHplADC.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, null, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplADC.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplADC.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplADC.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl ADC should produce data for polled variables', (done) => {
    sparkHplADC.serialPort.on('dataToDevice', writeToSerialPortReqRes);

    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
        && (_.get(variable, 'access', 'read') === 'read')
        && (variable.type !== 'Periodic Temperature Value')) {
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

  it('spark hpl ADC should produce data for periodic temperature variables', (done) => {
    if (verboseOn) turnVerboseOn();

    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
        && (_.get(variable, 'access', 'read') === 'read')
        && (variable.type === 'Periodic Temperature Value')) {
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
              clearInterval(verboseTimer);
              return done();
            }
          }
        }
        return undefined;
      });
    });
  }).timeout(5000);

  it('write should succeed when writing to a writable variable', (done) => {
    const value = { variable: WRITE_TEST_NAME };
    value[WRITE_TEST_NAME] = WRITE_TEST_VALUE;
    sparkHplADC.writeData(value, (err) => {
      if (err) return done(err);
      return undefined;
    });
    db.on('write', (data) => {
      data.should.equal(WRITE_TEST_VALUE);
      db.removeAllListeners('write');
      return done();
    });
  });

  it('an alert should be raised when attempting to write to read-only variable', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`variable-not-writable-error-${READ_TEST_NAME}`);
      alert.msg.should.equal(`${testMachine.info.name}: Error Writing Variable`);
      alert.description.should.equal(`Error writing ${READ_TEST_NAME}. Variable does not exist or is not writable`);
      sparkAlert.removeAllListeners('raise');
      done();
      return undefined;
    });

    const value = { variable: READ_TEST_NAME };
    value[READ_TEST_NAME] = 0;
    sparkHplADC.writeData(value, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('an alert should be raised and connection variables set false if stop responding', (done) => {
    let alertRaised = false;
    let connectedVariableSet = false;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('no-response-error');
      alert.msg.should.equal(`${testMachine.info.name}: No Response`);
      alert.description.should.equal('No response or an invalid response to a command was received');
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

    sparkHplADC.serialPort.removeAllListeners('dataToDevice');
  }).timeout(10000);

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplADC.stop((err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(3000);

  it('update model should succeed with machine disabled', (done) => {
    sparkHplADC.updateModel({
      enable: false,
      mode: 'req/res',
      device: '/dev/ttyUSB0',
      baudRate: '38400',
      parity: 'none',
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplADC.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new ADC hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplADC = new SparkHplADC.hpl(log.child({
      machine: invalidMachineNoCommandName.info.name,
    }), invalidMachineNoCommandName, invalidMachineNoCommandName.settings.model,
    null, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when a general command variable has no command name', (done) => {
    sparkHplADC.start(dataCb, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.message.should.equal('All general command variables require a command name');
      return done();
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplADC.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new ADC hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplADC = new SparkHplADC.hpl(log.child({
      machine: invalidMachineNoTemperatureDescriptor.info.name,
    }), invalidMachineNoTemperatureDescriptor,
    invalidMachineNoTemperatureDescriptor.settings.model,
    null, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when a temperature request variable has no temperature descriptor',
    (done) => {
      sparkHplADC.start(dataCb, configUpdateCb, (err) => {
        if (!err) done('err not set');
        err.message.should.equal('All temperature request variables require a temperature descriptor');
        return done();
      });
    });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplADC.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new ADC hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplADC = new SparkHplADC.hpl(log.child({
      machine: invalidMachineNoTemperatureIndex.info.name,
    }), invalidMachineNoTemperatureIndex,
    invalidMachineNoTemperatureIndex.settings.model,
    null, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when a temperature request variable has no temperature index',
    (done) => {
      sparkHplADC.start(dataCb, configUpdateCb, (err) => {
        if (!err) done('err not set');
        err.message.should.equal('All periodic temperature value variables require a temperature index');
        return done();
      });
    });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplADC.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new ADC hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplADC = new SparkHplADC.hpl(log.child({
      machine: invalidMachineOnlyGeneralWritable.info.name,
    }), invalidMachineOnlyGeneralWritable,
    invalidMachineOnlyGeneralWritable.settings.model,
    null, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when a non-general command variable is writable',
    (done) => {
      sparkHplADC.start(dataCb, configUpdateCb, (err) => {
        if (!err) done('err not set');
        err.message.should.equal('Only general command variables are writable');
        return done();
      });
    });
});
