/* jshint esversion: 6 */
/* eslint no-bitwise: ["error", { "allow": ["&"] }] */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const dataq = require('../index.js');
const pkg = require('../package.json');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const conf = {
  machines: {
    'spark-machine-dataq': {
      settings: {
        model: {
          enable: true,
          modelNum: 'DI-1110',
          anaInCh1Enable: true,
          anaInCh2Enable: true,
          anaInCh3Enable: true,
          anaInCh4Enable: true,
          anaInCh5Enable: true,
          anaInCh6Enable: true,
          anaInCh7Enable: true,
          anaInCh8Enable: true,
          digiInCh0Enable: true,
          digiInCh0Mode: 'Counter Reset',
          digiInCh1Enable: true,
          digiInCh2Enable: true,
          digiInCh2Mode: 'Rate',
          digiInCh3Enable: true,
          digiInCh3Mode: 'Counter',
          digiInCh4Enable: true,
          digiInCh5Enable: true,
          digiInCh6Enable: true,
          digiOutCh0Enable: true,
          digiOutCh1Enable: true,
          digiOutCh2Enable: true,
          digiOutCh3Enable: true,
        },
      },
    },
  },
};

const payload1Di1110 = Buffer.from([0x10, 0x11, 0x20, 0x22, 0x30, 0x33, 0x40, 0x44,
  0x50, 0x55, 0x60, 0x66, 0x70, 0x77, 0x80, 0x88,
  0x01, 0x56, 0x00, 0x40, 0x00, 0x20]);

const variables1Di1110 = [
  {
    name: 'analogCh1',
    value: 0x111,
  }, {
    name: 'analogCh2',
    value: 0x222,
  }, {
    name: 'analogCh3',
    value: 0x333,
  }, {
    name: 'analogCh4',
    value: 0x444,
  }, {
    name: 'analogCh5',
    value: 0x555,
  }, {
    name: 'analogCh6',
    value: 0x666,
  }, {
    name: 'analogCh7',
    value: 0x777,
  }, {
    name: 'analogCh8',
    value: -0x778,
  }, {
    name: 'digInputCh0',
    value: true,
  }, {
    name: 'digInputCh1',
    value: false,
  }, {
    name: 'digInputCh2',
    value: 7500,
  }, {
    name: 'digInputCh3',
    value: 0xA000,
  }, {
    name: 'digInputCh4',
    value: false,
  }, {
    name: 'digInputCh5',
    value: true,
  }, {
    name: 'digInputCh6',
    value: false,
  },
];

const payload2Di1110 = Buffer.from([0x10, 0x11, 0x20, 0x22, 0x30, 0x33, 0x40, 0x44,
  0x50, 0x55, 0x60, 0x66, 0x70, 0x77, 0x80, 0x88,
  0x01, 0x5A]);

const variables2Di1110 = [
  {
    name: 'analogCh1',
    value: 0x111,
  }, {
    name: 'analogCh2',
    value: 0x222,
  }, {
    name: 'analogCh3',
    value: 0x333,
  }, {
    name: 'analogCh4',
    value: 0x444,
  }, {
    name: 'analogCh5',
    value: 0x555,
  }, {
    name: 'analogCh6',
    value: 0x666,
  }, {
    name: 'analogCh7',
    value: 0x777,
  }, {
    name: 'analogCh8',
    value: -0x778,
  }, {
    name: 'digInputCh0',
    value: true,
  }, {
    name: 'digInputCh1',
    value: false,
  }, {
    name: 'digInputCh2',
    value: true,
  }, {
    name: 'digInputCh3',
    value: false,
  }, {
    name: 'digInputCh4',
    value: false,
  }, {
    name: 'digInputCh5',
    value: true,
  }, {
    name: 'digInputCh6',
    value: false,
  },
];

const payload1Di149 = Buffer.from([0x88, 0x91, 0x11, 0xA3, 0x99, 0xB3, 0x21, 0xC5,
  0xA9, 0xD5, 0x31, 0xE7, 0xB9, 0xF7, 0x41, 0x09,
  0x01, 0x0F, 0x01, 0xC1, 0x01, 0x41]);

const variables1Di149 = [
  {
    name: 'analogCh1',
    value: 0x111,
  }, {
    name: 'analogCh2',
    value: 0x222,
  }, {
    name: 'analogCh3',
    value: 0x333,
  }, {
    name: 'analogCh4',
    value: 0x444,
  }, {
    name: 'analogCh5',
    value: 0x555,
  }, {
    name: 'analogCh6',
    value: 0x666,
  }, {
    name: 'analogCh7',
    value: 0x777,
  }, {
    name: 'analogCh8',
    value: -0x778,
  }, {
    name: 'digInputCh0',
    value: true,
  }, {
    name: 'digInputCh1',
    value: false,
  }, {
    name: 'digInputCh2',
    value: 7500,
  }, {
    name: 'digInputCh3',
    value: 0x1000,
  },
];

const payload2Di149 = Buffer.from([0x88, 0x91, 0x11, 0xA3, 0x99, 0xB3, 0x21, 0xC5,
  0xA9, 0xD5, 0x31, 0xE7, 0xB9, 0xF7, 0x41, 0x09,
  0x01, 0x0B]);

const variables2Di149 = [
  {
    name: 'analogCh1',
    value: 0x111,
  }, {
    name: 'analogCh2',
    value: 0x222,
  }, {
    name: 'analogCh3',
    value: 0x333,
  }, {
    name: 'analogCh4',
    value: 0x444,
  }, {
    name: 'analogCh5',
    value: 0x555,
  }, {
    name: 'analogCh6',
    value: 0x666,
  }, {
    name: 'analogCh7',
    value: 0x777,
  }, {
    name: 'analogCh8',
    value: -0x778,
  }, {
    name: 'digInputCh0',
    value: true,
  }, {
    name: 'digInputCh1',
    value: false,
  }, {
    name: 'digInputCh2',
    value: true,
  }, {
    name: 'digInputCh3',
    value: false,
  },
];

const outputVariablesDi1110 = [
  'digInputCh0',
  'digInputCh1',
  'digInputCh2',
  'digInputCh3',
  'digInputCh4',
  'digInputCh5',
  'digInputCh6'];

const outputVariablesDi149 = [
  'digOutputCh0',
  'digOutputCh1',
  'digOutputCh2',
  'digOutputCh3'];

let outputValue = false;
let mask = 1;
let resetReceived = false;

const sparkConfig = new EventEmitter();
sparkConfig.bReturnEmpty = false;
sparkConfig.set = function set(key, value, done) {
  log.debug({ key, value }, 'conf.set');


  const path = key.split(':');
  let target = conf;

  let k;
  while (path.length > 1) {
    k = path.shift();
    if (!(k in target)) {
      target[k] = {};
    }
    target = target[k];
  }
  k = path.shift();
  target[k] = _.cloneDeep(value);

  log.debug(conf);

  sparkConfig.emit('set', key);

  if (done) return done(null);
  return undefined;
};

sparkConfig.get = function get(key, cb) {
  log.debug({ key }, 'conf.get');

  const path = key.split(':');
  let target = conf;

  let err = null;
  let k;
  while (path.length > 0) {
    k = path.shift();
    if (target && {}.hasOwnProperty.call(target, k)) {
      target = target[k];
    } else {
      err = 'undefined';
    }
  }

  const value = sparkConfig.bReturnEmpty ? {} : target;
  if (!cb) {
    return value;
  }
  return cb(err, value);
};

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

const sparkDb = new EventEmitter();
sparkDb.add = function add(data, done) {
  log.debug(data);
  sparkDb.emit('added', data);
  return done(null);
};
sparkDb.get = function add(key, done) {
  const split = key.split(':');
  if (split.length < 4) return done(Error('Invalid key'), null);
  const variableName = split[3];
  const value = {
    machine: 'spark-machine-dataq',
    variable: variableName,
  };
  value[variableName] = outputValue;
  return done(null, value);
};

const modules = {
  'spark-config': {
    exports: sparkConfig,
  },
  'spark-logging': {
    exports: {
      getLogger(moduleName) {
        return log.child({
          module: moduleName,
        });
      },
    },
  },
  'spark-db': {
    exports: sparkDb,
  },
  'spark-alert': {
    exports: sparkAlert,
  },
};

const outputWriter = new EventEmitter();

function writeToComputerAsBuffer(string) {
  dataq.serialPort.writeToComputer(Buffer.from(string));
}

function writeToSerialPort(data) {
  // check if reset received
  if (data.startsWith('reset 1') || (data.startsWith('R1'))) {
    resetReceived = true;
  } else if (data.startsWith('dout')) { // check if DI-1110 output command
    outputWriter.emit('written', parseInt(data.substr(5), 10));
    writeToComputerAsBuffer(data);
  } else if (data.startsWith('D')) { // check if DI-149 output command (not echoed)
    outputWriter.emit('written', parseInt(data.substr(1, 2), 16));
  } else if (!data.startsWith('start 0')) { // do not echo the start 0 command for the DI-1110
    writeToComputerAsBuffer(data);
  }
}

describe('DATAQ', () => {
  it('require should return array of requirements', (done) => {
    const requireList = dataq.require();
    requireList.should.be.instanceof(Array);
    Object.keys(modules).sort().should.eql(requireList.sort());
    return done();
  });

  it('start should succeed', (done) => {
    dataq.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-machine-dataq');
      return done();
    });
    setTimeout(() => {
      sparkConfig.get('machines:spark-machine-dataq:settings:model:connectionStatus').should.equal(false);
      dataq.serialPort.on('dataToDevice', writeToSerialPort);
      writeToComputerAsBuffer('stop\r');
    }, 1000);
  });

  it('after a successful start the connection status should be true', (done) => {
    sparkConfig.get('machines:spark-machine-dataq:settings:model:connectionStatus').should.equal(true);
    return done();
  });

  it('DATAQ should acquire the correct data in DI-1110 mode', (done) => {
    const gotDataForVar = [];
    sparkDb.on('added', (data) => {
      variables1Di1110.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === variables1Di1110.length) {
              sparkDb.removeAllListeners('added');
              setTimeout(() => {
                if (resetReceived) done();
              }, 10);
            }
          }
        }
        return undefined;
      });
    });
    for (let iSample = 0; iSample < 20; iSample += 1) {
      dataq.serialPort.writeToComputer(payload1Di1110);
    }
  });

  it('changing the configuration should emit a restart request', (done) => {
    dataq.on('restartRequest', () => {
      dataq.removeAllListeners('restartRequest');
      return done();
    });
    sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh2Mode', 'Normal');
    sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh3Mode', 'Normal');
  });

  it('stop should succeed ', (done) => {
    dataq.stop(() => done());
  });

  it('start should succeed', (done) => {
    dataq.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-machine-dataq');
      return done();
    });
    setTimeout(() => {
      dataq.serialPort.on('dataToDevice', writeToSerialPort);
      writeToComputerAsBuffer('stop\r');
    }, 100);
  });

  it('DATAQ should acquire the correct data with digital channels 2 & 3 normal', (done) => {
    const gotDataForVar = [];
    sparkDb.on('added', (data) => {
      variables2Di1110.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === variables2Di1110.length) {
              sparkDb.removeAllListeners('added');
              setTimeout(() => {
                if (resetReceived) done();
              }, 10);
            }
          }
        }
        return undefined;
      });
    });
    for (let iSample = 0; iSample < 20; iSample += 1) {
      dataq.serialPort.writeToComputer(payload2Di1110);
    }
  });

  it('stop should succeed ', (done) => {
    dataq.stop(() => {
      sparkConfig.set('machines:spark-machine-dataq:settings:model:modelNum', 'DI-149');
      sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh2Mode', 'Rate');
      sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh3Mode', 'Counter');
      sparkConfig.set('machines:spark-machine-dataq:settings:model:onChange', true);
      return done();
    });
  });

  it('start should succeed', (done) => {
    dataq.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-machine-dataq');
      return done();
    });
    setTimeout(() => {
      dataq.serialPort.on('dataToDevice', writeToSerialPort);
      writeToComputerAsBuffer('asc\r');
    }, 100);
  });

  it('DATAQ should acquire the correct data in DI-149 mode', (done) => {
    const gotDataForVar = [];
    sparkDb.on('added', (data) => {
      variables1Di149.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === variables1Di149.length) {
              sparkDb.removeAllListeners('added');
              setTimeout(() => {
                if (resetReceived) done();
              }, 100);
            }
          } else {
            return done(Error('Identical values published with on change set'));
          }
        }
        return undefined;
      });
    });
    resetReceived = false;
    for (let iSample = 0; iSample < 40; iSample += 1) {
      dataq.serialPort.writeToComputer(payload1Di149);
    }
  });

  it('stop should succeed ', (done) => {
    dataq.stop(() => {
      sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh2Mode', 'Normal');
      sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh3Mode', 'Normal');
      sparkConfig.set('machines:spark-machine-dataq:settings:model:onChange', false);
      return done();
    });
  });

  it('start should succeed', (done) => {
    dataq.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-machine-dataq');
      return done();
    });
    setTimeout(() => {
      dataq.serialPort.on('dataToDevice', writeToSerialPort);
      writeToComputerAsBuffer('asc\r');
    }, 100);
  });

  it('DATAQ should acquire the correct data with digital channels 2 & 3 normal', (done) => {
    const gotDataForVar = [];
    sparkDb.on('added', (data) => {
      variables2Di149.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === variables2Di149.length) {
              sparkDb.removeAllListeners('added');
              setTimeout(() => {
                if (resetReceived) done();
              }, 10);
            }
          }
        }
        return undefined;
      });
    });
    for (let iSample = 0; iSample < 20; iSample += 1) {
      dataq.serialPort.writeToComputer(payload2Di149);
    }
  });

  outputVariablesDi149.forEach((variable) => {
    it(`write of false to variable ${variable} should succeed in DI-149 mode`, (done) => {
      outputWriter.on('written', (value) => {
        const bitValue = (value & mask) !== 0;
        bitValue.should.equal(outputValue);
        mask *= 2;
        if (mask > 0x08) {
          mask = 1;
          outputValue = true;
        }
        outputWriter.removeAllListeners('written');
        return done();
      });
      sparkDb.emit('write-added', `machines:spark-machine-dataq:variables:${variable}`);
    });
  });

  outputVariablesDi149.forEach((variable) => {
    it(`write of true to variable ${variable} should succeed in DI-149 mode`, (done) => {
      outputWriter.on('written', (value) => {
        const bitValue = (value & mask) !== 0;
        bitValue.should.equal(outputValue);
        mask *= 2;
        if (mask > 0x08) {
          mask = 1;
          outputValue = false;
        }
        outputWriter.removeAllListeners('written');
        return done();
      });
      sparkDb.emit('write-added', `machines:spark-machine-dataq:variables:${variable}`);
    });
  });

  it('stop should succeed ', (done) => {
    dataq.stop(() => {
      sparkConfig.set('machines:spark-machine-dataq:settings:model:modelNum', 'DI-1110');
      sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh0OutConfig', true);
      sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh1OutConfig', true);
      sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh2OutConfig', true);
      sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh3OutConfig', true);
      sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh4OutConfig', true);
      sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh5OutConfig', true);
      sparkConfig.set('machines:spark-machine-dataq:settings:model:digiInCh6OutConfig', true);
      return done();
    });
  });

  it('start should succeed', (done) => {
    dataq.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-machine-dataq');
      return done();
    });
    setTimeout(() => {
      dataq.serialPort.on('dataToDevice', writeToSerialPort);
      writeToComputerAsBuffer('stop\r');
    }, 100);
  });

  outputVariablesDi1110.forEach((variable) => {
    it(`write of false to variable ${variable} should succeed in DI-1110 mode`, (done) => {
      outputWriter.on('written', (value) => {
        const bitValue = (value & mask) !== 0;
        bitValue.should.equal(outputValue);
        mask *= 2;
        if (mask > 0x40) {
          mask = 1;
          outputValue = true;
        }
        outputWriter.removeAllListeners('written');
        return done();
      });
      sparkDb.emit('write-added', `machines:spark-machine-dataq:variables:${variable}`);
    });
  });

  outputVariablesDi1110.forEach((variable) => {
    it(`write of true to variable ${variable} should succeed in DI-1110 mode`, (done) => {
      outputWriter.on('written', (value) => {
        const bitValue = (value & mask) !== 0;
        bitValue.should.equal(outputValue);
        mask *= 2;
        outputWriter.removeAllListeners('written');
        return done();
      });
      sparkDb.emit('write-added', `machines:spark-machine-dataq:variables:${variable}`);
    });
  });

  it('a buffer overflow alert should be raised if too much data is written', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('buffer-overflow');
      alert.msg.should.equal('DataQ: Buffer Overflow');
      alert.description.should.equal('Too much unprocessed data received. Clearing out buffer.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    dataq.serialPort.writeToComputer(Buffer.alloc(2048 * 3 + 1, 0x55));
  });
});
