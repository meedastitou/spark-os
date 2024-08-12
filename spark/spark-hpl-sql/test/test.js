/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplSQL = require('../index.js');

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
    hpl: 'sql',
  },
  settings: {
    model: {
      enable: true,
      requestFrequency: 1,
      sqlServerName: 'testServer',
      sqlPort: '1433',
      sqlServerType: 'Microsoft SQL',
      sqlDatabaseName: 'SparkDb',
      sqlTableName: 'SparkData',
      username: 'user',
      password: 'pwd',
      disconnectReportTime: 0,
    },
  },
  variables: [{
    name: 'stringTest',
    description: 'String Test',
    format: 'char',
    column: 'column1',
    orderBy: 'column1',
    order: 'Ascending',
    value: 'ABCD',
  }, {
    name: 'intTest',
    description: 'Int Test',
    format: 'int16',
    column: 'column2',
    orderBy: 'column2',
    order: 'Descending',
    where: 'groupID = 2 AND itemID = 2',
    value: 123,
  }, {
    name: 'floatTest',
    description: 'Float Test',
    format: 'float',
    column: 'column3',
    orderBy: 'column2',
    order: 'Descending',
    where: 'groupID = 3 AND itemID = 4',
    value: 23456.0,
  }, {
    name: 'boolTest',
    description: 'Bool Test',
    format: 'bool',
    column: 'column7',
    orderBy: 'column2',
    order: 'Ascending',
    value: true,
  }, {
    name: 'fixedArrayTest',
    description: 'Fixed Array Test',
    format: 'float',
    column: 'column4',
    orderBy: 'column1',
    order: 'Descending',
    where: '(groupID = 4 OR groupID = 4) AND itemID = 1',
    array: true,
    length: 3,
    value: [1234.0, 2345.0, 3456.0],
  }, {
    name: 'openArrayTest',
    description: 'Open Array Test',
    format: 'float',
    column: 'column5',
    orderBy: 'column1',
    order: 'Descending',
    where: '(groupID = 5) AND (objectID = 3) AND (itemID = 2)',
    array: true,
    value: [3456.0, 4567.0, 5678.0, 6789.0],
  }, {
    name: 'intTestStringValue',
    description: 'Int Test String Value',
    format: 'int16',
    column: 'column6',
    orderBy: 'column2',
    order: 'Descending',
    where: 'groupID = 1 AND itemID = 3',
    value: 1234,
    stringConvertTest: true,
  }, {
    name: 'floatTestStringValue',
    description: 'Float Test String Value',
    format: 'float',
    column: 'column6',
    orderBy: 'column2',
    order: 'Descending',
    where: 'groupID = 2 AND itemID = 1',
    value: 234567.0,
    stringConvertTest: true,
  }, {
    name: 'boolTestStringValue',
    description: 'Bool String Value',
    format: 'bool',
    column: 'column6',
    orderBy: 'column2',
    order: 'Descending',
    value: true,
    stringConvertTest: true,
  }, {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
  }],
};

const reportAllUpdatedRecordsTestMachine = {
  info: {
    name: 'report-all-updated-test-machine',
    fullname: 'Test machine',
    version: '1.0.0',
    description: 'Test Machine',
    hpl: 'sql',
  },
  settings: {
    model: {
      enable: true,
      requestFrequency: 1,
      sqlServerName: 'testServer',
      sqlPort: '1433',
      sqlServerType: 'Microsoft SQL',
      sqlDatabaseName: 'SparkDb',
      sqlTableName: 'SparkData',
      username: 'user',
      password: 'pwd',
      reportAllUpdatedRecords: true,
      multirecordKeyField: 'column0',
      multirecordKeyFieldAsDateTimeString: false,
      deliverCombinedResult: false,
      reportUpdatedRecordDataAsArray: false,
      recordReportDwell: 0,
      disconnectReportTime: 0,
    },
  },
  variables: [{
    name: 'stringTest',
    description: 'String Test',
    format: 'char',
    column: 'column1',
    value: 'ABCD',
  }, {
    name: 'intTest',
    description: 'Int Test',
    format: 'int16',
    column: 'column2',
    value: 123,
  }, {
    name: 'floatTest',
    description: 'Float Test',
    format: 'float',
    column: 'column3',
    value: 23456.0,
  }, {
    name: 'boolTest',
    description: 'Bool Test',
    format: 'bool',
    column: 'column7',
    value: true,
  }, {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
  }],
};

const invalidMachine = {
  info: {
    name: 'invalid-machine',
    fullname: 'Invalid machine',
    version: '1.0.0',
    description: 'Test Machine',
    hpl: 'sql',
  },
  settings: {
    model: {
      enable: true,
      requestFrequency: 1,
      sqlServerName: 'testServer',
      sqlPort: '1433',
      sqlServerType: 'Microsoft SQL',
      sqlDatabaseName: 'SparkDb',
      sqlTableName: 'SparkData',
      username: 'user',
      password: 'pwd',
      disconnectReportTime: 0,
    },
  },
  variables: [{
    name: 'invalidWhereTest',
    description: 'Invalid Where Test',
    format: 'int16',
    column: 'column2',
    orderBy: 'column2',
    order: 'Descending',
    where: '((groupID = 2) AND itemID = 2',
    value: 123,
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

describe('Spark HPL SQL', () => {
  let sparkHplSQL;

  it('successfully create a new SQL HPL', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSQL = new SparkHplSQL.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    sparkHplSQL.mssqlTester.prototype.setData(false, testMachine.variables,
      testMachine.settings.model.sqlTableName);
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplSQL.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplSQL.start(dataCb, 5, (err) => {
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
    sparkHplSQL.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('mssql mode should produced valid data', (done) => {
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
    return undefined;
  });

  it('after a successful connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('an alert should be raised and connection variable set when queries are rejected', (done) => {
    let alertRaised = false;
    let connectedVariableSet = false;
    sparkHplSQL.mssqlTester.prototype.setReject(true);
    sparkAlert.on('raise', (alert) => {
      // console.log('-------sparkAlert.raise');
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('read-error');
      alert.msg.should.equal(`${testMachine.info.name}: Unable to read from SQL server`);
      alert.description.should.equal('Client is not able to read from the SQL server. Error: Invalid query');
      alertRaised = true;
      sparkAlert.removeAllListeners('raise');
      if (connectedVariableSet) return done();
      return undefined;
    });

    db.on('data', (data) => {
      // console.log('-------db.data');
      if (data.variable === 'machineConnected') {
        data[data.variable].should.equal(false);
        connectedVariableSet = true;
        db.removeAllListeners('data');
        if (alertRaised) return done();
      }
      return undefined;
    });
  });

  it('update model should succeed selecting mysql mode', (done) => {
    sparkHplSQL.mssqlTester.prototype.setReject(false);
    sparkHplSQL.mysqlTester.setData(true, testMachine.variables,
      testMachine.settings.model.sqlTableName);
    sparkHplSQL.updateModel({
      enable: true,
      requestFrequency: 1,
      sqlServerName: 'testServer',
      sqlPort: '1433',
      sqlServerType: 'MySQL',
      sqlDatabaseName: 'SparkDb',
      sqlTableName: 'SparkData',
      username: 'user',
      password: 'pwd',
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  it('mysql mode should produced valid data', (done) => {
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
    return undefined;
  });

  it('after a successful connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('stop should succeed', (done) => {
    sparkHplSQL.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('start should raise an alert when connection rejected in mysql mode', (done) => {
    sparkHplSQL.mysqlTester.setReject(true);
    sparkHplSQL.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      sparkAlert.on('raise', (alert) => {
        alert.should.be.instanceof(Object);
        alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
        alert.key.should.equal('connection-error');
        alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
        alert.description.should.equal('Client is not able to connect to SQL server. Error: Connection failed');
        sparkAlert.removeAllListeners('raise');
        return done();
      });
      return undefined;
    });
  });

  it('update model should raise an alert when connection rejected in mssql mode', (done) => {
    sparkHplSQL.mssqlTester.prototype.setReject(true);
    sparkHplSQL.updateModel({
      enable: true,
      requestFrequency: 1,
      sqlServerName: 'testServer',
      sqlPort: '1433',
      sqlServerType: 'Microsoft SQL',
      sqlDatabaseName: 'SparkDb',
      sqlTableName: 'SparkData',
      username: 'user',
      password: 'pwd',
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      sparkAlert.on('raise', (alert) => {
        alert.should.be.instanceof(Object);
        alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
        alert.key.should.equal('connection-error');
        alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
        alert.description.should.equal('Client is not able to connect to SQL server. Error: Connection failed');
        sparkAlert.removeAllListeners('raise');
        return done();
      });
      return undefined;
    });
  });

  it('successfully create a new SQL HPL (report all updated records)', (done) => {
    sparkHplSQL.mssqlTester.prototype.setReject(false);
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSQL = new SparkHplSQL.hpl(log.child({
      machine: reportAllUpdatedRecordsTestMachine.info.name,
    }), reportAllUpdatedRecordsTestMachine,
    reportAllUpdatedRecordsTestMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    sparkHplSQL.mssqlTester.prototype.setData(false, reportAllUpdatedRecordsTestMachine.variables,
      reportAllUpdatedRecordsTestMachine.settings.model.sqlTableName);

    sparkHplSQL.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('report-all-updated-records mode should produced valid data', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    reportAllUpdatedRecordsTestMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      // console.log(`data = ${JSON.stringify(data)}`);
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

  it('update model should succeed selecting keyfield = date/time string', (done) => {
    sparkHplSQL.mssqlTester.prototype.setReject(false);
    sparkHplSQL.mssqlTester.prototype.setData(false, reportAllUpdatedRecordsTestMachine.variables,
      reportAllUpdatedRecordsTestMachine.settings.model.sqlTableName);
    sparkHplSQL.updateModel({
      enable: true,
      requestFrequency: 1,
      sqlServerName: 'testServer',
      sqlPort: '1433',
      sqlServerType: 'Microsoft SQL',
      sqlDatabaseName: 'SparkDb',
      sqlTableName: 'SparkData',
      username: 'user',
      password: 'pwd',
      reportAllUpdatedRecords: true,
      multirecordKeyField: 'column0Date',
      multirecordKeyFieldAsDateTimeString: true,
      deliverCombinedResult: false,
      reportUpdatedRecordDataAsArray: false,
      recordReportDwell: 100,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  it('report-all-updated-records mode should produced valid data (keyfield = date/time string)', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    reportAllUpdatedRecordsTestMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      // console.log(`data = ${JSON.stringify(data)}`);
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

  it('update model should succeed selecting recordReportDwell mode', (done) => {
    sparkHplSQL.mssqlTester.prototype.setReject(false);
    sparkHplSQL.mssqlTester.prototype.setData(false, reportAllUpdatedRecordsTestMachine.variables,
      reportAllUpdatedRecordsTestMachine.settings.model.sqlTableName);
    sparkHplSQL.updateModel({
      enable: true,
      requestFrequency: 1,
      sqlServerName: 'testServer',
      sqlPort: '1433',
      sqlServerType: 'Microsoft SQL',
      sqlDatabaseName: 'SparkDb',
      sqlTableName: 'SparkData',
      username: 'user',
      password: 'pwd',
      reportAllUpdatedRecords: true,
      multirecordKeyField: 'column0',
      multirecordKeyFieldAsDateTimeString: false,
      deliverCombinedResult: false,
      reportUpdatedRecordDataAsArray: false,
      recordReportDwell: 100,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  it('report-all-updated-records mode should produced valid data (recordReportDwell mode)', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    reportAllUpdatedRecordsTestMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      // console.log(`data = ${JSON.stringify(data)}`);
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

  it('update model should succeed selecting recordReportDwell mode, keyfield = date/time string', (done) => {
    sparkHplSQL.mssqlTester.prototype.setReject(false);
    sparkHplSQL.mssqlTester.prototype.setData(false, reportAllUpdatedRecordsTestMachine.variables,
      reportAllUpdatedRecordsTestMachine.settings.model.sqlTableName);
    sparkHplSQL.updateModel({
      enable: true,
      requestFrequency: 1,
      sqlServerName: 'testServer',
      sqlPort: '1433',
      sqlServerType: 'Microsoft SQL',
      sqlDatabaseName: 'SparkDb',
      sqlTableName: 'SparkData',
      username: 'user',
      password: 'pwd',
      reportAllUpdatedRecords: true,
      multirecordKeyField: 'column0Date',
      multirecordKeyFieldAsDateTimeString: true,
      deliverCombinedResult: false,
      reportUpdatedRecordDataAsArray: false,
      recordReportDwell: 100,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  it('report-all-updated-records mode should produced valid data (recordReportDwell mode, keyfield = date/time string)', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    reportAllUpdatedRecordsTestMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      // console.log(`data = ${JSON.stringify(data)}`);
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

  it('update model should succeed selecting reportUpdatedRecordDataAsArray mode', (done) => {
    sparkHplSQL.mssqlTester.prototype.setReject(false);
    sparkHplSQL.mssqlTester.prototype.setData(false, reportAllUpdatedRecordsTestMachine.variables,
      reportAllUpdatedRecordsTestMachine.settings.model.sqlTableName);
    sparkHplSQL.updateModel({
      enable: true,
      requestFrequency: 1,
      sqlServerName: 'testServer',
      sqlPort: '1433',
      sqlServerType: 'Microsoft SQL',
      sqlDatabaseName: 'SparkDb',
      sqlTableName: 'SparkData',
      username: 'user',
      password: 'pwd',
      reportAllUpdatedRecords: true,
      multirecordKeyField: 'column0',
      multirecordKeyFieldAsDateTimeString: false,
      deliverCombinedResult: false,
      reportUpdatedRecordDataAsArray: true,
      recordReportDwell: 0,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  it('report-all-updated-records mode should produced valid data (reportUpdatedRecordDataAsArray mode)', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    reportAllUpdatedRecordsTestMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name][0].should.eql(variable.value);
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

  it('update model should succeed selecting reportUpdatedRecordDataAsArray mode (keyfield = date/time string)', (done) => {
    sparkHplSQL.mssqlTester.prototype.setReject(false);
    sparkHplSQL.mssqlTester.prototype.setData(false, reportAllUpdatedRecordsTestMachine.variables,
      reportAllUpdatedRecordsTestMachine.settings.model.sqlTableName);
    sparkHplSQL.updateModel({
      enable: true,
      requestFrequency: 1,
      sqlServerName: 'testServer',
      sqlPort: '1433',
      sqlServerType: 'Microsoft SQL',
      sqlDatabaseName: 'SparkDb',
      sqlTableName: 'SparkData',
      username: 'user',
      password: 'pwd',
      reportAllUpdatedRecords: true,
      multirecordKeyField: 'column0Date',
      multirecordKeyFieldAsDateTimeString: true,
      deliverCombinedResult: false,
      reportUpdatedRecordDataAsArray: true,
      recordReportDwell: 0,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  it('report-all-updated-records mode should produced valid data (reportUpdatedRecordDataAsArray mode, keyfield = date/time string)', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    reportAllUpdatedRecordsTestMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name][0].should.eql(variable.value);
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

  it('update model should succeed selecting deliverCombinedResult mode', (done) => {
    sparkHplSQL.mssqlTester.prototype.setReject(false);
    sparkHplSQL.mssqlTester.prototype.setData(false, reportAllUpdatedRecordsTestMachine.variables,
      reportAllUpdatedRecordsTestMachine.settings.model.sqlTableName);
    sparkHplSQL.updateModel({
      enable: true,
      requestFrequency: 1,
      sqlServerName: 'testServer',
      sqlPort: '1433',
      sqlServerType: 'Microsoft SQL',
      sqlDatabaseName: 'SparkDb',
      sqlTableName: 'SparkData',
      username: 'user',
      password: 'pwd',
      reportAllUpdatedRecords: true,
      multirecordKeyField: 'column0',
      multirecordKeyFieldAsDateTimeString: false,
      deliverCombinedResult: true,
      addTimestampField: true,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  it('report-all-updated-records mode should produced valid data (deliverCombinedResult mode)', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    reportAllUpdatedRecordsTestMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      // console.log(`data = ${JSON.stringify(data)}`);
      const valueObject = data.CombinedResult[0];
      const reportedVariableName = Object.keys(valueObject)[0];
      readVariables.forEach((variable) => {
        if (variable.name === reportedVariableName) {
          if (gotDataForVar.indexOf(reportedVariableName) === -1) {
            valueObject[reportedVariableName].should.eql(variable.value);
            gotDataForVar.push(reportedVariableName);
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

  it('update model should succeed selecting deliverCombinedResult mode (keyfield = date/time string)', (done) => {
    sparkHplSQL.mssqlTester.prototype.setReject(false);
    sparkHplSQL.mssqlTester.prototype.setData(false, reportAllUpdatedRecordsTestMachine.variables,
      reportAllUpdatedRecordsTestMachine.settings.model.sqlTableName);
    sparkHplSQL.updateModel({
      enable: true,
      requestFrequency: 1,
      sqlServerName: 'testServer',
      sqlPort: '1433',
      sqlServerType: 'Microsoft SQL',
      sqlDatabaseName: 'SparkDb',
      sqlTableName: 'SparkData',
      username: 'user',
      password: 'pwd',
      reportAllUpdatedRecords: true,
      multirecordKeyField: 'column0Date',
      multirecordKeyFieldAsDateTimeString: true,
      deliverCombinedResult: true,
      addTimestampField: true,
      disconnectReportTime: 0,
    }, (err) => {
      if (err) return done(err);
      return done(null);
    });
  });

  it('report-all-updated-records mode should produced valid data (deliverCombinedResult mode, keyfield = date/time string)', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    reportAllUpdatedRecordsTestMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      // console.log(`data = ${JSON.stringify(data)}`);
      const valueObject = data.CombinedResult[0];
      const reportedVariableName = Object.keys(valueObject)[0];
      readVariables.forEach((variable) => {
        if (variable.name === reportedVariableName) {
          if (gotDataForVar.indexOf(reportedVariableName) === -1) {
            valueObject[reportedVariableName].should.eql(variable.value);
            gotDataForVar.push(reportedVariableName);
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

  it('successfully create a new SQL HPL', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSQL = new SparkHplSQL.hpl(log.child({
      machine: invalidMachine.info.name,
    }), invalidMachine, invalidMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    sparkHplSQL.mssqlTester.prototype.setData(false, invalidMachine.variables,
      invalidMachine.settings.model.sqlTableName);
    return done();
  });

  it('start should error with an invalid variable', (done) => {
    sparkHplSQL.start(dataCb, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.message.should.equal('Invalid Where condition');
      return done();
    });
  });
});
