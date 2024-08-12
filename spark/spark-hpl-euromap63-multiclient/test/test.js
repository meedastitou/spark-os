/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
// const ftpClient = require('ftp');
const pkg = require('../package.json');
const SparkHplEuromap63 = require('../index.js');

const FTP_PORT = 8080;

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
    hpl: 'euromap63-multiclient',
  },
  settings: {
    model: {
      enable: true,
      connectionMode: 'WebDAV client',
      ftpIp: '127.0.0.1',
      ftpPort: FTP_PORT,
      webdavUrl: '192.168.0.1',
      webdavUrlHTTPS: false,
      serverMachineNameList: 'folder-1:test-machine',
      ftpUsername: 'anonymous',
      ftpPassword: 'anonymous@',
      sessionNumber: 0,
      cyclicType: 'time',
      cyclicTime: 15,
      cyclicShotCount: 1,
      deliverEntireResponse: false,
      timestampFields: 'Count,Date,Time',
      useFiledateForTimestampDate: false,
      utcOffset: 0,
    },
  },
  variables: [
    {
      name: 'Date',
      description: 'Date',
      format: 'char',
      reportName: 'DATE',
      value: '20170920',
    },
    {
      name: 'Time',
      description: 'Time',
      format: 'char',
      reportName: 'TIME',
      value: '18:49:17',
    },
    {
      name: 'Count',
      description: 'Count',
      format: 'uint32',
      reportName: 'COUNT',
      value: 18402,
    },
    {
      name: 'act-tim-cyc-first',
      description: 'act-tim-cyc-first',
      format: 'float',
      reportName: 'ActTimCyc',
      value: 29.0,
    },
    {
      name: 'act-vol-csh',
      description: 'act-vol-csh',
      format: 'int8',
      reportName: 'ActVolCsh[1,1]',
      value: 10,
    },
    {
      name: 'act-tim-fill',
      description: 'act-tim-fill',
      format: 'uint8',
      reportName: 'ActTimFill[1]',
      value: 1,
    },
    {
      name: 'act-tim-plst',
      description: 'act-tim-plst',
      format: 'int16',
      reportName: 'ActTimPlst[1]',
      value: 13,
    },
    {
      name: 'act-prs-mach-spec-max',
      description: 'act-prs-mach-spec-max',
      format: 'uint16',
      reportName: 'ActPrsMachSpecMax',
      value: 1195,
    },
    {
      name: 'act-prs-xfr-spec',
      description: 'act-prs-xfr-spec',
      format: 'uint32',
      reportName: 'ActPrsXfrSpec[1]',
      value: 1194,
    },
    {
      name: 'act-vol-xfr',
      description: 'act-vol-xfr',
      format: 'bool',
      reportName: 'ActVolXfr[1]',
      value: true,
    },
    {
      name: 'act-tim-cyc-second',
      description: 'act-tim-cyc-second',
      format: 'double',
      reportName: 'ActTimCyc',
      value: 29.0,
    },
    {
      name: 'alarmCode',
      description: 'Alarm Code',
      format: 'uint16',
      alarmCode: true,
      value: 7956,
    },
    {
      name: 'alarmCodeArray',
      description: 'Alarm Code Array',
      format: 'uint16',
      alarmCode: true,
      array: true,
      value: [6169, 7956],
    },
    {
      name: 'alarmCodeActivated',
      description: 'Alarm Code Activated',
      format: 'uint16',
      alarmCodeChanged: 'Activated',
      value: 7956,
    },
    {
      name: 'alarmCodeDeactivated',
      description: 'Alarm Code Deactivated',
      format: 'uint16',
      alarmCodeChanged: 'Deactivated',
      value: 6169,
    },
    {
      name: 'write-char',
      description: 'Write Char',
      format: 'char',
      reportName: 'WriteChar',
      access: 'write',
      value: 'ABCD',
    },
    {
      name: 'write-number',
      description: 'Write Number',
      format: 'int16',
      reportName: 'WriteNumber',
      access: 'write',
      value: 12345,
    },
    {
      name: 'write-bool',
      description: 'Write Bool',
      format: 'bool',
      reportName: 'WriteBool',
      access: 'write',
      value: true,
    },
  ],
};
const testMachine2 = {
  info: {
    name: 'test-machine',
    fullname: 'Test machine',
    version: '1.0.0',
    description: 'Test Machine',
    hpl: 'euromap63-multiclient',
  },
  settings: {
    model: {
      enable: true,
      connectionMode: 'WebDAV client',
      ftpIp: '127.0.0.1',
      ftpPort: FTP_PORT,
      webdavUrl: 'localhost',
      serverMachineNameList: 'folder-1:test-machine',
      ftpUsername: 'anonymous',
      ftpPassword: 'anonymous@',
      sessionNumber: 0,
      cyclicType: 'time',
      cyclicTime: 15,
      cyclicShotCount: 1,
      deliverEntireResponse: false,
      timestampFields: 'Count,Date,Time',
      useFiledateForTimestampDate: true,
      utcOffset: 0,
    },
  },
  variables: [
    {
      name: 'alarmCodeArray',
      description: 'Alarm Code Array',
      format: 'uint16',
      alarmCode: true,
      array: true,
      value: [6169, 7956],
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

const sparkConfig = new EventEmitter();
sparkConfig.set = function set(key, value, done) {
  if (done) return done(null);
  return undefined;
};

describe('Spark HPL Euromap63 - Multiclient', () => {
  let sparkHplEuromap63;

  it('successfully create a new Modbus HPL', (done) => {
    /* eslint new-cap: ['error', { 'newIsCap': false }] */
    sparkHplEuromap63 = new SparkHplEuromap63.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    const serverMachineNameArray = testMachine.settings.model.serverMachineNameList.split(',');
    for (let index = 0; index < serverMachineNameArray.length; index += 1) {
      const serverMachineName = serverMachineNameArray[index].split(':');
      sparkHplEuromap63.tester.prototype.setVariables(serverMachineName[0], testMachine.variables);
    }
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplEuromap63.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplEuromap63.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplEuromap63.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('webdav mode should produced valid report data', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if ((_.get(variable, 'access', 'read') === 'read')
      && !_.get(variable, 'alarmCode', false)
      && (_.get(variable, 'alarmCodeChanged', 'None') === 'None')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (_.get(variable, 'access', 'read') === 'read') {
          if (variable.name === data.variable) {
            if (gotDataForVar.indexOf(data.variable) === -1) {
              const recievedData = data[variable.name];
              const comparedValue = recievedData.data;
              comparedValue.should.eql(variable.value);
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
  }).timeout(25000);

  it('webdav mode should produced valid alarm code data', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if ((_.get(variable, 'access', 'read') === 'read')
      && (_.get(variable, 'alarmCode', false))) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (_.get(variable, 'access', 'read') === 'read') {
          if (variable.name === data.variable) {
            if (gotDataForVar.indexOf(data.variable) === -1) {
              const recievedData = data[variable.name];
              const comparedValue = recievedData.data;
              comparedValue.should.eql(variable.value);
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
  }).timeout(10000);


  it('stop should succeed', (done) => {
    sparkHplEuromap63.stop((err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(8000);

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplEuromap63.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('webdav mode should produced valid report data', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine2.variables.forEach((variable) => {
      if ((_.get(variable, 'access', 'read') === 'read')
        && (_.get(variable, 'alarmCodeChanged', 'None') === 'None')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (_.get(variable, 'access', 'read') === 'read') {
          if (variable.name === data.variable) {
            if (gotDataForVar.indexOf(data.variable) === -1) {
              const recievedData = data[variable.name];
              const comparedValue = recievedData.data;
              comparedValue.should.eql(variable.value);
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
  }).timeout(25000);
  it('stop should succeed', (done) => {
    sparkHplEuromap63.stop((err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(8000);

  it('Successful Execution with Valid Inputs and useFiledateForTimestampDate, Delivering Entire Response Enabled', (done) => {
    testMachine.settings.model.deliverEntireResponse = true;
    testMachine.settings.model.useFiledateForTimestampDate = true;
    sparkConfig.set('testMachine:settings.model:useFiledateForTimestampDate', true);
    sparkConfig.set('testMachine:settings.model:deliverEntireResponse', true);
    sparkHplEuromap63 = new SparkHplEuromap63.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    sparkHplEuromap63.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });
  it('webdav mode should produced valid report data', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if ((_.get(variable, 'access', 'read') === 'read')
        && !_.get(variable, 'alarmCode', false)
        && (_.get(variable, 'alarmCodeChanged', 'None') === 'None')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (_.get(variable, 'access', 'read') === 'read') {
          const combinedResult = data[data.variable];
          const modifiedData = combinedResult.data;

          modifiedData.forEach((jsonObject) => {
            Object.entries(jsonObject).forEach(([key, value]) => {
              if (variable.name === key) {
                if (gotDataForVar.indexOf(key) === -1) {
                  value.should.eql(variable.value);
                  gotDataForVar.push(key);
                }
              }
            });
          });
          if (gotDataForVar.length === readVariables.length) {
            db.removeAllListeners('data');
            return done();
          }
        }
        return undefined;
      });
    });
  }).timeout(25000);

  it('webdav mode should produced valid alarm code data', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if ((_.get(variable, 'access', 'read') === 'read')
        && (_.get(variable, 'alarmCode', false))) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (_.get(variable, 'access', 'read') === 'read') {
          const combinedResult = data[data.variable];
          const modifiedData = combinedResult.data;
          modifiedData.forEach((jsonObject) => {
            Object.entries(jsonObject).forEach(([key, value]) => {
              if (variable.name === key) {
                if (gotDataForVar.indexOf(key) === -1) {
                  const val = String(value);
                  if (val.includes(',')) {
                    const newArray = JSON.parse(val);
                    const resultString = newArray.join(',');
                    if (String(resultString) === String(variable.value)) {
                      gotDataForVar.push(key);
                    }
                  } else {
                    value.should.eql(variable.value);
                    gotDataForVar.push(key);
                  }
                }
              }
            });
          });
          if (gotDataForVar.length === readVariables.length) {
            db.removeAllListeners('data');
            return done();
          }
        }
        return undefined;
      });
    });
  }).timeout(10000);

  it('stop should succeed', (done) => {
    sparkHplEuromap63.stop((err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(8000);

  it('start should succeed when passed valid inputs', (done) => {
    testMachine.settings.model.deliverEntireResponse = true;
    sparkConfig.set('testMachine:settings.model:deliverEntireResponse', true);
    sparkHplEuromap63 = new SparkHplEuromap63.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    sparkHplEuromap63.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });
  it('update model to enable the dummy hpl should succeed', (done) => {
    sparkHplEuromap63.updateModel({ enable: false }, (err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(25000);
  it('stop should succeed', (done) => {
    sparkHplEuromap63.stop((err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(8000);

  it('Verify Successful Execution of Start with Valid Inputs and HTTPS Enabled', (done) => {
    testMachine.settings.model.webdavUrlHTTPS = true;
    sparkHplEuromap63 = new SparkHplEuromap63.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());

    sparkHplEuromap63.start(dataCb, configUpdateCb, (err) => {
      if (err) return done();
      return done();
    });
  });
  it('stop should succeed', (done) => {
    sparkHplEuromap63.stop((err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(8000);

  it('Error Handling: Invalid Inputs Trigger Error During Start Operation', (done) => {
    testMachine.settings.model.serverMachineNameList = '';
    sparkConfig.set('testMachine:settings.model:serverMachineNameList', '');
    sparkHplEuromap63 = new SparkHplEuromap63.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());

    sparkHplEuromap63.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });
  it('stop should succeed', (done) => {
    sparkHplEuromap63.stop((err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(8000);
  it('Test Success for Start Operation with Valid Inputs and Updated Machine List', (done) => {
    testMachine.settings.model.serverMachineNameList = 'folder-1:test-machine:test-machine3';
    sparkHplEuromap63 = new SparkHplEuromap63.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());

    sparkHplEuromap63.start(dataCb, configUpdateCb, (err) => {
      if (err) return done();
      return undefined;
    });
  });
  it('stop should succeed', (done) => {
    sparkHplEuromap63.stop((err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(8000);


  it('Successful Restart of Machine with Valid Inputs', (done) => {
    sparkHplEuromap63 = new SparkHplEuromap63.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());

    sparkHplEuromap63.start(dataCb, configUpdateCb, (err) => {
      if (err) return done();
      return undefined;
    });
  });
  it('stop should succeed', (done) => {
    sparkHplEuromap63.stop((err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(8000);
});
