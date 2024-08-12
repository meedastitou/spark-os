/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplWebdav = require('../index.js');


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
    hpl: 'webdav',
  },
  settings: {
    model: {
      enable: true,
      webdavUrl: '',
      mode: 'Original',
      filename: 'test1.csv',
      username: 'anonymous',
      password: '',
      readFrequency: 0.1,
      separator: ',',
    },
  },
  variables: [
    {
      name: 'date',
      description: 'Date',
      format: 'char',
      rowPosition: 'Last',
      columnPosition: 'Match Name',
      matchName: 'Date',
      value: '20191110',
    },
    {
      name: 'time',
      description: 'Time',
      format: 'char',
      rowPosition: 'First after Header',
      columnPosition: 'Match Name',
      matchName: 'Time',
      value: '17:15:56',
    },
    {
      name: 'count',
      description: 'Count',
      format: 'uint32',
      rowPosition: 'Specific Row',
      columnPosition: 'Match Name',
      specificRow: 3,
      matchName: 'Good Count',
      value: 12346,
    },
    {
      name: 'temperature',
      description: 'Temperature',
      format: 'float',
      rowPosition: 'Last',
      columnPosition: 'Match Name',
      matchName: 'Temperature',
      value: 28.0,
    },
    {
      name: 'pressure',
      description: 'Pressure',
      format: 'double',
      rowPosition: 'Last',
      columnPosition: 'Specific Column',
      specificColumn: 5,
      value: 1232.0,
    },
    {
      name: 'ok',
      description: 'OK',
      format: 'bool',
      rowPosition: 'Last',
      columnPosition: 'Match Name',
      matchName: 'OK',
      value: true,
    },
    {
      name: 'header-variable',
      description: 'Header Variable',
      format: 'char',
      rowPosition: 'First',
      columnPosition: 'Specific Column',
      specificColumn: 4,
      value: 'Temperature',
    },
  ],
};

const testMachineReadAll = {
  info: {
    name: 'test-machine-read-all',
    fullname: 'Test machine read all',
    version: '1.0.0',
    description: 'Test Machine Read All',
    hpl: 'webdav',
  },
  settings: {
    model: {
      enable: true,
      webdavUrl: '',
      mode: 'Original',
      useBaseFilename: true,
      baseFilename: 'readall',
      username: 'anonymous',
      password: '',
      readFrequency: 0.1,
      separator: ',',
      deleteFileAfterRead: true,
    },
  },
  variables: [
    {
      name: 'pressure',
      description: 'Pressure',
      format: 'double',
      rowPosition: 'All New Rows at End',
      columnPosition: 'Specific Column',
      specificColumn: 5,
      value: [1234.0, 1235.0, 1233.0, 1236.0, 1237.0, 1232.0],
    },
  ],
};

const invalidMachine = {
  info: {
    name: 'invalid-machine',
    fullname: 'Invalid machine',
    version: '1.0.0',
    description: 'Invalid Machine',
    hpl: 'webdav',
  },
  settings: {
    model: {
      enable: true,
      webdavUrl: '',
      mode: 'Original',
      filename: 'invalidtest.csv',
      username: 'anonymous',
      password: '',
      readFrequency: 0.1,
      separator: ',',
    },
  },
  variables: [
    {
      name: 'invalid1',
      description: 'Invalid 1',
      format: 'int8',
      rowPosition: 'Specific Row',
      columnPosition: 'Match Name',
      specificRow: 10,
      matchName: 'Good Count',
      value: 123,
    },
    {
      name: 'invalid2',
      description: 'Invalid 2',
      format: 'int16',
      rowPosition: 'Last',
      columnPosition: 'Specific Column',
      specificColumn: 10,
      value: 12345,
    },
    {
      name: 'invalid3',
      description: 'Invalid 3',
      format: 'int64',
      rowPosition: 'Specific Row',
      columnPosition: 'Match Name',
      specificRow: 4,
      matchName: 'Good Count',
      value: 123456,
    },
    {
      name: 'invalid4',
      description: 'Invalid 4',
      format: 'float',
      rowPosition: 'Specific Row',
      columnPosition: 'Match Name',
      specificRow: 4,
      matchName: 'Temperature',
      value: 23.5,
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


describe('Spark HPL WebDAV', () => {
  let sparkHplWebDAV;

  it('successfully create a new WebDAV HPL', (done) => {
    /* eslint new-cap: ['error', { 'newIsCap': false }] */
    sparkHplWebDAV = new SparkHplWebdav.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplWebDAV.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplWebDAV.start(dataCb, 5, (err) => {
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
    sparkHplWebDAV.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('valid data should be read for all variables', (done) => {
    const gotDataForVar = [];
    db.on('data', (data) => {
      testMachine.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachine.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('after a successful directory read the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplWebDAV.updateModel({
      enable: false,
      webdavUrl: '',
      mode: 'Original',
      username: 'anonymous',
      password: '',
      filename: 'test1.csv',
      readFrequency: 0.1,
      separator: ',',
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed when using base filename', (done) => {
    sparkHplWebDAV.updateModel({
      enable: true,
      webdavUrl: '',
      mode: 'Original',
      useBaseFilename: true,
      baseFilename: 'test',
      username: 'anonymous',
      password: '',
      readFrequency: 0.1,
      separator: ',',
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('valid data should be read for all variables when using base filename', (done) => {
    const gotDataForVar = [];
    db.on('data', (data) => {
      testMachine.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachine.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('update model should succeed when deleting file after read', (done) => {
    sparkHplWebDAV.updateModel({
      enable: true,
      webdavUrl: '',
      mode: 'Original',
      filename: 'test1.csv',
      deleteFileAfterRead: true,
      username: 'anonymous',
      password: '',
      readFrequency: 0.1,
      separator: ',',
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('valid data should be read for all variables when deleting file after read', (done) => {
    const gotDataForVar = [];
    db.on('data', (data) => {
      testMachine.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachine.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('update model should succeed when deleting file after read using base filename', (done) => {
    sparkHplWebDAV.updateModel({
      enable: true,
      webdavUrl: '',
      mode: 'Original',
      useBaseFilename: true,
      baseFilename: 'test',
      deleteFileAfterRead: true,
      username: 'anonymous',
      password: '',
      readFrequency: 0.1,
      separator: ',',
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('valid data should be read for all variables when deleting file after read using base filename', (done) => {
    const gotDataForVar = [];
    db.on('data', (data) => {
      testMachine.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachine.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('update model should raise an alert if not files with base filename when not deleting', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'baseFilename');
      alert.key.should.equal('base-filename-not-found-error');
      alert.msg.should.equal(`${testMachine.info.name}: File With Base Filename Not Found`);
      alert.description.should.equal('No file with the base filename test could be found on the WebDAV server');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplWebDAV.updateModel({
      enable: true,
      webdavUrl: '',
      mode: 'Original',
      useBaseFilename: true,
      baseFilename: 'test',
      password: '',
      filename: 'invalid.csv',
      readFrequency: 0.1,
      separator: ',',
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('update model should raise an alert with an invalid filename', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'filename');
      alert.key.should.equal('file-not-found-error');
      alert.msg.should.equal(`${testMachine.info.name}: File Not Found`);
      alert.description.should.equal('The file invalid.csv could not be found on the WebDAV server');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    sparkHplWebDAV.updateModel({
      enable: true,
      webdavUrl: '',
      mode: 'Original',
      username: 'anonymous',
      password: '',
      filename: 'invalid.csv',
      readFrequency: 0.1,
      separator: ',',
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('stop should succeed', (done) => {
    sparkHplWebDAV.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new WebDAV HPL', (done) => {
    /* eslint new-cap: ['error', { 'newIsCap': false }] */
    sparkHplWebDAV = new SparkHplWebdav.hpl(log.child({
      machine: testMachineReadAll.info.name,
    }), testMachineReadAll, testMachineReadAll.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplWebDAV.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('valid data should be read for all variables when reading all rows at end file', (done) => {
    const gotDataForVar = [];
    const nValuesForVar = {};
    testMachineReadAll.variables.forEach((variable) => {
      nValuesForVar[variable.name] = 0;
    });
    db.on('data', (data) => {
      testMachineReadAll.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value[nValuesForVar[variable.name]]);
            nValuesForVar[variable.name] += 1;
            if (nValuesForVar[variable.name] >= 6) {
              gotDataForVar.push(data.variable);
              if (gotDataForVar.length === testMachineReadAll.variables.length) {
                db.removeAllListeners('data');
                return done();
              }
            }
          }
        }
        return undefined;
      });
    });
  });

  it('stop should succeed', (done) => {
    sparkHplWebDAV.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new WebDAV HPL', (done) => {
    /* eslint new-cap: ['error', { 'newIsCap': false }] */
    sparkHplWebDAV = new SparkHplWebdav.hpl(log.child({
      machine: invalidMachine.info.name,
    }), invalidMachine, invalidMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplWebDAV.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('an alert should be raised for each invalid variable', (done) => {
    let iAlert = 1;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`var-read-error-invalid${iAlert}`);
      alert.msg.should.equal(`${invalidMachine.info.name}: Error Reading Variable`);
      alert.description.should.equal(`Error in reading invalid${iAlert}. Please check the variable definition.`);
      if (iAlert >= 4) {
        sparkAlert.removeAllListeners('raise');
        return done();
      }
      iAlert += 1;
      return undefined;
    });
  });
});
