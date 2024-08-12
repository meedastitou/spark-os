/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplVirtual = require('../index.js');

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
    hpl: 'virtual',
  },
  settings: {
    model: {
      enable: true,
      operation: 'normal',
    },
  },
  variables: [{
    name: 'normal-test',
    description: 'Normal Test',
    format: 'int16',
    operation: 'normal',
    srcVariables: [
      {
        srcMachine: 'srcMachine1',
        srcVariable: 'srcVariable1',
        successValue: 234,
      },
      {
        srcMachine: 'srcMachine1',
        srcVariable: 'srcVariable2',
      },
    ],
    value: 123,
  }, {
    name: 'summation-test',
    description: 'Summation Test',
    format: 'int16',
    operation: 'summation',
    srcVariables: [
      {
        srcMachine: 'srcMachine1',
        srcVariable: 'srcVariable1',
      },
      {
        srcMachine: 'srcMachine1',
        srcVariable: 'srcVariable2',
      },
    ],
    value: 357,
  }, {
    name: 'alarm-combination-test',
    description: 'Alarm Combination Test',
    format: 'int16',
    operation: 'alarm-combination',
    srcVariables: [
      {
        srcMachine: 'srcMachine1',
        srcVariable: 'srcVariable3',
        successValue: 1,
      },
      {
        srcMachine: 'srcMachine2',
        srcVariable: 'srcVariable1',
        successValue: 2,
      },
    ],
    value: 2,
  }, {
    name: 'persisent-counter-test',
    description: 'Persisent Counter Test',
    format: 'uint16',
    operation: 'persistent counter',
    srcVariables: [
      {
        srcMachine: 'srcMachine2',
        srcVariable: 'srcVariable2',
      },
    ],
    value: 21,
  }, {
    name: 'auto-alarm-update-test',
    description: 'Auto Alarm Update Test',
    format: 'uint16',
    operation: 'auto-alarm-update',
    changeTimeout: 0.01,
    changeTimeoutValue: 100,
    srcVariables: [
      {
        srcMachine: 'srcMachine1',
        srcVariable: 'srcVariable3',
        reportMyValue: true,
      },
      {
        srcMachine: 'srcMachine2',
        srcVariable: 'srcVariable1',
        reportMyValue: false,
        onChangeReport: 200,
      },
    ],
    value: true,
  }, {
    name: 'auto-alarm-update-increase-test',
    description: 'Auto Alarm Update Increase Test',
    format: 'uint16',
    operation: 'auto-alarm-update',
    srcVariables: [
      {
        srcMachine: 'srcMachine1',
        srcVariable: 'srcVariable4',
        reportMyValue: false,
        onChangeReport: 300,
        triggerOnChangeType: 'Increase',
      },
    ],
    value: 200,
  }, {
    name: 'auto-alarm-update-decrease-test',
    description: 'Auto Alarm Update Decrease Test',
    format: 'uint16',
    operation: 'auto-alarm-update',
    srcVariables: [
      {
        srcMachine: 'srcMachine1',
        srcVariable: 'srcVariable5',
        reportMyValue: false,
        onChangeReport: 400,
        triggerOnChangeType: 'Decrease',
      },
    ],
    value: 300,
  }, {
    name: 'array-element-test-1',
    description: 'Array Element Test 1',
    format: 'float',
    operation: 'array element',
    srcVariables: [
      {
        srcMachine: 'srcMachine3',
        srcVariable: 'srcVariable1',
        arrayIndex: 1,
      },
    ],
    value: 23456.0,
  }, {
    name: 'array-element-test-2',
    description: 'Array Element Test 2',
    format: 'float',
    operation: 'array element',
    convertNullToZero: true,
    srcVariables: [
      {
        srcMachine: 'srcMachine3',
        srcVariable: 'srcVariable2',
        arrayIndex: 0,
      },
    ],
    value: 0,
  }, {
    name: 'match-counter-test',
    description: 'Match Counter Test',
    format: 'int32',
    operation: 'match-counter',
    convertNullToZero: true,
    srcVariables: [
      {
        srcMachine: 'srcMachine2',
        srcVariable: 'srcVariable2',
        matchValue: 1234,
      },
      {
        srcMachine: 'srcMachine3',
        srcVariable: 'srcVariable3',
        matchValue: 11,
      },
    ],
    value: 1,
  }, {
    name: 'pass-through-test',
    description: 'Pass-Through Test',
    format: 'uint32',
    operation: 'pass-through',
    srcVariables: [
      {
        srcMachine: 'srcMachine4',
        srcVariable: 'srcVariable1',
      },
    ],
    destVariables: [
      {
        destMachine: 'destMachine',
        destVariable: 'destVariable1',
      },
    ],
    value: 123456,
  }, {
    name: 'level-1-status-indicator-test',
    description: 'Level 1 Status Indicator Test',
    format: 'uint8',
    operation: 'level 1 status indicator',
    changeTimeout: 0.01,
    srcVariables: [
      {
        srcMachine: 'srcMachine4',
        srcVariable: 'srcVariable2',
      },
      {
        srcMachine: 'srcMachine4',
        srcVariable: 'srcVariable3',
      },
    ],
    value: 0,
  }, {
    name: 'publish-on-trigger-test',
    description: 'Publish on Trigger Test',
    format: 'float',
    operation: 'publish variables on trigger',
    srcVariables: [
      {
        srcMachine: 'srcMachine5',
        srcVariable: 'srcVariable1',
        triggerOnChange: true,
      },
      {
        srcMachine: 'srcMachine6',
        srcVariable: 'srcVariable2',
      },
    ],
    value: 0,
  }, {
    name: 'publish-on-trigger-increase-test',
    description: 'Publish on Trigger Increase Test',
    format: 'float',
    operation: 'publish variables on trigger',
    srcVariables: [
      {
        srcMachine: 'srcMachine5',
        srcVariable: 'srcVariable2',
        triggerOnChange: true,
        triggerOnChangeType: 'Increase',
      },
      {
        srcMachine: 'srcMachine6',
        srcVariable: 'srcVariable3',
      },
    ],
    value: 0,
  }, {
    name: 'publish-on-trigger-decrease-test',
    description: 'Publish on Trigger Decrease Test',
    format: 'float',
    operation: 'publish variables on trigger',
    srcVariables: [
      {
        srcMachine: 'srcMachine5',
        srcVariable: 'srcVariable3',
        triggerOnChange: true,
        triggerOnChangeType: 'Decrease',
      },
      {
        srcMachine: 'srcMachine6',
        srcVariable: 'srcVariable4',
      },
    ],
    value: 0,
  }, {
    name: 'split-string-test',
    description: 'Split String Test',
    format: 'char',
    operation: 'split string',
    srcVariables: [
      {
        srcMachine: 'srcMachine7',
        srcVariable: 'srcVariable1',
        arrayIndex: 3,
        separator: ',',
      },
    ],
    value: 'comma',
  }, {
    name: 'bitmap-test',
    description: 'Bitmap Test',
    format: 'int16',
    operation: 'bitmap',
    defaultValue: 255,
    srcVariables: [
      {
        srcMachine: 'srcMachine8',
        srcVariable: 'srcVariable1',
        bitMask: 2,
        bitMatch: 2,
        successValue: 1,
      },
      {
        srcMachine: 'srcMachine8',
        srcVariable: 'srcVariable2',
        bitMask: 4,
        bitMatch: 4,
        successValue: 2,
      },
    ],
    value: 255,
  }],
};

const stringTestMachine = {
  info: {
    name: 'string-test-machine',
    fullname: 'String Test machine',
    version: '1.0.0',
    description: 'String Test Machine',
    hpl: 'virtual',
  },
  settings: {
    model: {
      enable: true,
      operation: 'normal',
    },
  },
  variables: [{
    name: 'int-test',
    description: 'Int Test',
    format: 'int8',
    operation: 'summation',
    srcVariables: [
      {
        srcMachine: 'srcMachineStringTest',
        srcVariable: 'srcVariableInt',
      },
    ],
    value: 123,
  }, {
    name: 'float-test',
    description: 'Float Test',
    format: 'float',
    operation: 'summation',
    srcVariables: [
      {
        srcMachine: 'srcMachineStringTest',
        srcVariable: 'srcVariableFloat',
      },
    ],
    value: 456789.0,
  }],
};

const srcMachineData = [
  {
    machine: 'srcMachine1',
    variables: [
      {
        name: 'srcVariable1',
        format: 'int16',
        value: 123,
      },
      {
        name: 'srcVariable2',
        format: 'int16',
        value: 234,
      },
      {
        name: 'srcVariable3',
        format: 'bool',
        value: true,
      },
      {
        name: 'srcVariable4',
        format: 'int16',
        value: 345,
      },
      {
        name: 'srcVariable5',
        format: 'int16',
        value: 456,
      },
    ],
  },
  {
    machine: 'srcMachine2',
    variables: [
      {
        name: 'srcVariable1',
        format: 'bool',
        value: true,
      },
      {
        name: 'srcVariable2',
        format: 'uint16',
        value: 20,
      },
    ],
  },
  {
    machine: 'srcMachine3',
    variables: [
      {
        name: 'srcVariable1',
        format: 'float',
        value: [12345.0, 23456.0, 34567.0],
      },
      {
        name: 'srcVariable2',
        format: 'float',
        value: [],
      },
      {
        name: 'srcVariable3',
        format: 'int16',
        value: 10,
      },
    ],
  },
  {
    machine: 'srcMachine4',
    variables: [
      {
        name: 'srcVariable1',
        format: 'uint32',
        value: 123456,
      },
      {
        name: 'srcVariable2',
        format: 'uint8',
        value: 234,
      },
      {
        name: 'srcVariable3',
        format: 'int8',
        value: 123,
      },
    ],
  },
  {
    machine: 'srcMachine5',
    variables: [
      {
        name: 'srcVariable1',
        format: 'int16',
        value: 345,
      },
      {
        name: 'srcVariable2',
        format: 'int16',
        value: 456,
      },
      {
        name: 'srcVariable3',
        format: 'int16',
        value: 567,
      },
    ],
  },
  {
    machine: 'srcMachine6',
    variables: [
      {
        name: 'srcVariable1',
        format: 'float',
        value: 5678.0,
      },
      {
        name: 'srcVariable2',
        format: 'float',
        value: 6789.0,
      },
      {
        name: 'srcVariable3',
        format: 'float',
        value: 7890.0,
      },
      {
        name: 'srcVariable4',
        format: 'float',
        value: 8901.0,
      },
    ],
  },
  {
    machine: 'srcMachine7',
    variables: [
      {
        name: 'srcVariable1',
        format: 'char',
        value: 'This,is,a,comma,separated,string',
      },
    ],
  },
  {
    machine: 'srcMachine8',
    variables: [
      {
        name: 'srcVariable1',
        format: 'int16',
        value: 0,
      },
      {
        name: 'srcVariable2',
        format: 'int16',
        value: 0,
      },
    ],
  },
  {
    machine: 'srcMachineStringTest',
    variables: [
      {
        name: 'srcVariableInt',
        format: 'int8',
        value: '123',
      },
      {
        name: 'srcVariableFloat',
        format: 'float',
        value: '456789.0',
      },
    ],
  },
];

function getTestVariable(variable) {
  for (let iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
    if (testMachine.variables[iVar].name === variable) {
      return testMachine.variables[iVar];
    }
  }
  return null;
}

function setSourceMachineData(machine, variable, value) {
  for (let iMach = 0; iMach < srcMachineData.length; iMach += 1) {
    if (srcMachineData[iMach].machine === machine) {
      for (let iVar = 0; iVar < srcMachineData[iMach].variables.length; iVar += 1) {
        if (srcMachineData[iMach].variables[iVar].name === variable) {
          srcMachineData[iMach].variables[iVar].value = value;
          return;
        }
      }
    }
  }
}

function getSourceMachineVariable(machine, variable) {
  for (let iMach = 0; iMach < srcMachineData.length; iMach += 1) {
    if (srcMachineData[iMach].machine === machine) {
      for (let iVar = 0; iVar < srcMachineData[iMach].variables.length; iVar += 1) {
        if (srcMachineData[iMach].variables[iVar].name === variable) {
          return srcMachineData[iMach].variables[iVar];
        }
      }
    }
  }
  return null;
}

const db = new EventEmitter();

db.set = function set(data, callback) {
  this.emit('set', data);
  callback(null);
};

db.getLatest = function getLatest(machine, variable, callback) {
  for (let iMach = 0; iMach < srcMachineData.length; iMach += 1) {
    if (srcMachineData[iMach].machine === machine) {
      for (let iVar = 0; iVar < srcMachineData[iMach].variables.length; iVar += 1) {
        if (srcMachineData[iMach].variables[iVar].name === variable) {
          const data = {
            machine: srcMachineData[iMach].machine,
            variable: srcMachineData[iMach].variables[iVar].name,
          };
          data[data.variable] = srcMachineData[iMach].variables[iVar].value;
          return callback(null, data);
        }
      }
    }
  }
  return undefined;
};

const persistentCount = 20;

db.get = function get(key, callback) {
  const split = key.split(':');
  if (split[2] === 'persist') {
    const data = {
      machine: split[1],
      variable: split[3],
    };
    data[data.variable] = persistentCount;
    return callback(null, data);
  }

  db.getLatest(split[1], split[3], callback);
  return undefined;
};

db.add = function add(data, callback) {
  this.emit('add', data);
  return callback(null, null);
};

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

function conf() {
  this.get = function get(key, done) {
    const srcMachine = key.split(':')[1];
    for (let iSrc = 0; iSrc < srcMachineData.length; iSrc += 1) {
      if (srcMachineData[iSrc].machine === srcMachine) {
        return done(null, srcMachineData[iSrc].variables);
      }
    }
    return done(Error('source machine not found'), []);
  };
}
const config = new conf();

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

describe('Spark HPL Virtual', () => {
  let sparkHplVirtual;

  it('successfully create a new virtual HPL', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplVirtual = new SparkHplVirtual.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, config, db,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplVirtual.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplVirtual.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplVirtual.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      // give all source variables values to start
      for (let iMach = 0; iMach < srcMachineData.length; iMach += 1) {
        for (let iVar = 0; iVar < srcMachineData[iMach].variables.length; iVar += 1) {
          db.emit('added', `machine:${srcMachineData[iMach].machine}:read:${srcMachineData[iMach].variables[iVar].name}`);
        }
      }
      return done();
    });
  });

  it('normal operation should produce the correct value', (done) => {
    const variable = getTestVariable('normal-test');
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(variable.value);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the summation operation should produce the correct value', (done) => {
    const variable = getTestVariable('summation-test');
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(variable.value);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the alarm combination operation should produce the correct value', (done) => {
    const variable = getTestVariable('alarm-combination-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, false);
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(variable.value);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the alarm combination operation should produce 0 if no alarms remaining', (done) => {
    const variable = getTestVariable('alarm-combination-test');
    setSourceMachineData(variable.srcVariables[1].srcMachine,
      variable.srcVariables[1].srcVariable, false);
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(0);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[1].srcMachine}:read:${variable.srcVariables[1].srcVariable}`);
  });

  it('the persisent counter operation should produce the correct value', (done) => {
    const variable = getTestVariable('persisent-counter-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 21);
    let gotData = false;
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(variable.value);
        db.removeAllListeners('data');
        gotData = true;
      }
    });
    db.on('set', (data) => {
      data[data.variable].should.eql(variable.value);
      db.removeAllListeners('set');
      if (gotData) return done();
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the auto alarm update operation should produce the correct value', (done) => {
    const variable = getTestVariable('auto-alarm-update-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, true);
    let gotFirstData = false;
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        if (gotFirstData) {
          data[variable.name].should.eql(100);
          db.removeAllListeners('data');
          return done();
        }

        data[variable.name].should.eql(variable.value);
        gotFirstData = true;
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the auto alarm update operation should produce the correct on change report value', (done) => {
    const variable = getTestVariable('auto-alarm-update-test');
    setSourceMachineData(variable.srcVariables[1].srcMachine,
      variable.srcVariables[1].srcVariable, true);
    let gotFirstData = false;
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        if (gotFirstData) {
          data[variable.name].should.eql(100);
          db.removeAllListeners('data');
          return done();
        }

        data[variable.name].should.eql(200);
        gotFirstData = true;
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[1].srcMachine}:read:${variable.srcVariables[1].srcVariable}`);
  });

  it('the auto alarm update operation should produce the correct value when change type is increase', (done) => {
    const variable = getTestVariable('auto-alarm-update-increase-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 456);
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(300);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the auto alarm update operation operation should not trigger when change type is increase and variable does not increase', (done) => {
    const variable = getTestVariable('auto-alarm-update-increase-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 345);
    let triggered = false;
    db.on('data', () => {
      triggered = true;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
    setTimeout(() => {
      triggered.should.equal(false);
      db.removeAllListeners('data');
      return done();
    }, 100);
  });

  it('the auto alarm update operation should produce the correct value when change type is decrease', (done) => {
    const variable = getTestVariable('auto-alarm-update-decrease-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 234);
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(400);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the auto alarm update operation operation should not trigger when change type is decrease and variable does not decrease', (done) => {
    const variable = getTestVariable('auto-alarm-update-decrease-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 456);
    let triggered = false;
    db.on('data', () => {
      triggered = true;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
    setTimeout(() => {
      triggered.should.equal(false);
      db.removeAllListeners('data');
      return done();
    }, 100);
  });

  it('the array element operation should produce the correct value', (done) => {
    const variable = getTestVariable('array-element-test-1');
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(variable.value);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the array element operation should produce 0 for an empty array', (done) => {
    const variable = getTestVariable('array-element-test-2');
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(variable.value);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the match counter operation should produce the correct value', (done) => {
    const variable = getTestVariable('match-counter-test');
    setSourceMachineData(variable.srcVariables[1].srcMachine,
      variable.srcVariables[1].srcVariable, 11);
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(variable.value);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[1].srcMachine}:read:${variable.srcVariables[1].srcVariable}`);
  });

  it('the pass through operation should produce the correct value', (done) => {
    const variable = getTestVariable('pass-through-test');
    let addedDest = false;
    db.on('add', (data) => {
      data.machine.should.eql('destMachine');
      data.variable.should.eql('destVariable1');
      data.access.should.eql('write');
      data.destVariable1.should.eql(variable.value);
      db.removeAllListeners('add');
      addedDest = true;
    });
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(variable.value);
        db.removeAllListeners('data');
        if (addedDest) return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the level 1 status indicator operation should produce the correct value', (done) => {
    const variable = getTestVariable('level-1-status-indicator-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 235);
    let got1 = false;
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        if (got1) {
          data[variable.name].should.eql(0);
          db.removeAllListeners('data');
          return done();
        }
        data[variable.name].should.eql(1);
        got1 = true;
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the publish variables on trigger operation should produce the correct value', (done) => {
    const variable = getTestVariable('publish-on-trigger-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 456);
    const readVariables = [];
    const gotDataForVar = [];
    for (let iSrc = 0; iSrc < variable.srcVariables.length; iSrc += 1) {
      readVariables.push(getSourceMachineVariable(variable.srcVariables[iSrc].srcMachine,
        variable.srcVariables[iSrc].srcVariable));
    }
    db.on('data', (data) => {
      readVariables.forEach((readVariable) => {
        if (_.get(readVariable, 'access', 'read') === 'read') {
          if (readVariable.name === data.variable) {
            if (gotDataForVar.indexOf(data.variable) === -1) {
              data[readVariable.name].should.eql(readVariable.value);
              gotDataForVar.push(data.variable);
              if (gotDataForVar.length === readVariables.length) {
                db.removeAllListeners('data');
                return done();
              }
            }
          }
        }
        return undefined;
      });
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the publish variables on trigger operation should produce the correct value when change type is increase', (done) => {
    const variable = getTestVariable('publish-on-trigger-increase-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 567);
    const readVariables = [];
    const gotDataForVar = [];
    for (let iSrc = 0; iSrc < variable.srcVariables.length; iSrc += 1) {
      readVariables.push(getSourceMachineVariable(variable.srcVariables[iSrc].srcMachine,
        variable.srcVariables[iSrc].srcVariable));
    }
    db.on('data', (data) => {
      readVariables.forEach((readVariable) => {
        if (_.get(readVariable, 'access', 'read') === 'read') {
          if (readVariable.name === data.variable) {
            if (gotDataForVar.indexOf(data.variable) === -1) {
              data[readVariable.name].should.eql(readVariable.value);
              gotDataForVar.push(data.variable);
              if (gotDataForVar.length === readVariables.length) {
                db.removeAllListeners('data');
                return done();
              }
            }
          }
        }
        return undefined;
      });
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the publish variables on trigger operation should not trigger when change type is increase and variable does not increase', (done) => {
    const variable = getTestVariable('publish-on-trigger-increase-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 456);
    let triggered = false;
    db.on('data', () => {
      triggered = true;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
    setTimeout(() => {
      triggered.should.equal(false);
      db.removeAllListeners('data');
      return done();
    }, 100);
  });

  it('the publish variables on trigger operation should produce the correct value when change type is decrease', (done) => {
    const variable = getTestVariable('publish-on-trigger-decrease-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 467);
    const readVariables = [];
    const gotDataForVar = [];
    for (let iSrc = 0; iSrc < variable.srcVariables.length; iSrc += 1) {
      readVariables.push(getSourceMachineVariable(variable.srcVariables[iSrc].srcMachine,
        variable.srcVariables[iSrc].srcVariable));
    }
    db.on('data', (data) => {
      readVariables.forEach((readVariable) => {
        if (_.get(readVariable, 'access', 'read') === 'read') {
          if (readVariable.name === data.variable) {
            if (gotDataForVar.indexOf(data.variable) === -1) {
              data[readVariable.name].should.eql(readVariable.value);
              gotDataForVar.push(data.variable);
              if (gotDataForVar.length === readVariables.length) {
                db.removeAllListeners('data');
                return done();
              }
            }
          }
        }
        return undefined;
      });
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the publish variables on trigger operation should not trigger when change type is decrease and variable does not decrease', (done) => {
    const variable = getTestVariable('publish-on-trigger-decrease-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 756);
    let triggered = false;
    db.on('data', () => {
      triggered = true;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
    setTimeout(() => {
      triggered.should.equal(false);
      db.removeAllListeners('data');
      return done();
    }, 100);
  });

  it('the split operation should produce the correct value', (done) => {
    const variable = getTestVariable('split-string-test');
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(variable.value);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the bitmap operation should produce the correct value with 1 match', (done) => {
    const variable = getTestVariable('bitmap-test');
    setSourceMachineData(variable.srcVariables[1].srcMachine,
      variable.srcVariables[1].srcVariable, 4);
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(2);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[1].srcMachine}:read:${variable.srcVariables[1].srcVariable}`);
  });

  it('the bitmap operation should produce the correct value with 2 matches', (done) => {
    const variable = getTestVariable('bitmap-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 2);
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(1);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
  });

  it('the bitmap operation should produce the correct value with no matches', (done) => {
    const variable = getTestVariable('bitmap-test');
    setSourceMachineData(variable.srcVariables[0].srcMachine,
      variable.srcVariables[0].srcVariable, 0);
    setSourceMachineData(variable.srcVariables[1].srcMachine,
      variable.srcVariables[1].srcVariable, 0);
    db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
    db.on('data', (data) => {
      if (data.variable === variable.name) {
        data[variable.name].should.eql(variable.value);
        db.removeAllListeners('data');
        return done();
      }
      return undefined;
    });
    db.emit('added', `machine:${variable.srcVariables[1].srcMachine}:read:${variable.srcVariables[1].srcVariable}`);
  });

  it('update model should succeed when passed valid inputs', (done) => {
    sparkHplVirtual.updateModel({
      enable: true,
      operation: 'normal',
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new virtual HPL', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplVirtual = new SparkHplVirtual.hpl(log.child({
      machine: stringTestMachine.info.name,
    }), stringTestMachine, stringTestMachine.settings.model, config, db,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplVirtual.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      // give all source variables values to start
      for (let iMach = 0; iMach < srcMachineData.length; iMach += 1) {
        for (let iVar = 0; iVar < srcMachineData[iMach].variables.length; iVar += 1) {
          db.emit('added', `machine:${srcMachineData[iMach].machine}:read:${srcMachineData[iMach].variables[iVar].name}`);
        }
      }
      return done();
    });
  });

  stringTestMachine.variables.forEach((variable) => {
    it(`string conversion to type ${variable.format} should succeed`, (done) => {
      db.on('data', (data) => {
        if (data.variable === variable.name) {
          data[variable.name].should.eql(variable.value);
          db.removeAllListeners('data');
          return done();
        }
        return undefined;
      });
      db.emit('added', `machine:${variable.srcVariables[0].srcMachine}:read:${variable.srcVariables[0].srcVariable}`);
    });
  });
});
