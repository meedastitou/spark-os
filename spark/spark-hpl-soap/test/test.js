/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const pkg = require('../package.json');
const SparkHplSoap = require('../index.js');

const testManufacturingSiteName = 'SiteABC';
const testManufacturingSiteIDName = 'SiteABC-1';

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const testMachineProdInfoList = {
  info: {
    name: 'test-machine-prod-info-list',
    fullname: 'Test machine production info list',
    version: '1.0.0',
    description: 'Test Machine Production Info List',
    hpl: 'soap',
  },
  settings: {
    model: {
      enable: true,
      clientURL: '',
      useAlias: false,
      alias: '',
      getOnlyProductionListInfo: true,
      machine: '',
      manufacturingSite: testManufacturingSiteName,
      manufacturingSiteID: testManufacturingSiteIDName,
      requestFrequency: 0.01,
    },
  },
  variables: [{
    name: 'order-number',
    description: 'Order Number',
    format: 'char',
    productionInfoType: 'Order Number',
    value: '200219349135001',
  }, {
    name: 'part-number',
    description: 'Part Number',
    format: 'char',
    productionInfoType: 'Part Number',
    value: '2296724-4',
  }, {
    name: 'tool-number',
    description: 'Tool Number',
    format: 'char',
    productionInfoType: 'Tool Number',
    value: '1234',
  }],
};

const testMachineMESTable = {
  info: {
    name: 'test-machine-mes-table',
    fullname: 'Test machine MES table',
    version: '1.0.0',
    description: 'Test Machine MES Table',
    hpl: 'soap',
  },
  settings: {
    model: {
      enable: true,
      clientURL: '',
      useAlias: false,
      alias: '',
      getOnlyProductionListInfo: false,
      queryOperation: 'HDVEGetData',
      databaseKey: 'DBKEY',
      databaseValue: 'XXX',
      manufacturingSite: testManufacturingSiteName,
      manufacturingSiteID: testManufacturingSiteIDName,
      requestFrequency: 0.01,
    },
  },
  variables: [{
    name: 'stringTest',
    description: 'String Test',
    format: 'char',
    requestKey: 'STRINGTEST',
    value: '1-23456789',
  }, {
    name: 'uint8Test',
    description: 'UInt8 Test',
    format: 'uint8',
    requestKey: 'UINT8TEST',
    value: 123,
  }, {
    name: 'uint16Test',
    description: 'UInt16 Test',
    format: 'uint16',
    requestKey: 'UINT16TEST',
    value: 1234,
  }, {
    name: 'uint32Test',
    description: 'UInt32 Test',
    format: 'uint32',
    requestKey: 'UINT32TEST',
    value: 123456,
  }, {
    name: 'uint64Test',
    description: 'UInt64 Test',
    format: 'uint64',
    requestKey: 'UINT64TEST',
    value: 1234567,
  }, {
    name: 'int8Test',
    description: 'Int8 Test',
    format: 'int8',
    requestKey: 'INT8TEST',
    value: 34,
  }, {
    name: 'int16Test',
    description: 'Int16 Test',
    format: 'int16',
    requestKey: 'INT16TEST',
    value: 2345,
  }, {
    name: 'int32Test',
    description: 'Int32 Test',
    format: 'int32',
    requestKey: 'INT32TEST',
    value: 234567,
  }, {
    name: 'int64Test',
    description: 'Int64 Test',
    format: 'int64',
    requestKey: 'INT64TEST',
    value: 12345678,
  }, {
    name: 'bitTest',
    description: 'Bit Test',
    format: 'bool',
    requestKey: 'BITTEST',
    value: true,
  }, {
    name: 'floatTest',
    description: 'Float Test',
    format: 'float',
    requestKey: 'FLOATTEST',
    value: 1234567.0,
  }, {
    name: 'doubleTest',
    description: 'Double Test',
    format: 'double',
    requestKey: 'DOUBLETEST',
    value: 2345678.0,
  }],
};

const invalidVariableMachine = {
  info: {
    name: 'invalid-variable-machine',
    fullname: 'Invalid variable machine',
    version: '1.0.0',
    description: 'Invalid Variable Machine',
    hpl: 'soap',
  },
  settings: {
    model: {
      enable: true,
      clientURL: '',
      useAlias: false,
      alias: '',
      getOnlyProductionListInfo: true,
      databaseKey: '',
      databaseValue: '',
      manufacturingSite: testManufacturingSiteName,
      manufacturingSiteID: testManufacturingSiteIDName,
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'invalid',
    description: 'Invalid',
    format: 'int16',
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

describe('Spark HPL SOAP', () => {
  let sparkHplSoap;

  it('successfully create a new net SOAP', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSoap = new SparkHplSoap.hpl(log.child({
      machine: testMachineProdInfoList.info.name,
    }), testMachineProdInfoList, testMachineProdInfoList.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplSoap.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplSoap.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('before a successfull start the connection status should be false', (done) => {
    sparkConfig.get(`machines:${testMachineProdInfoList.info.name}:settings:model:connectionStatus`).should.equal(false);
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplSoap.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl SOAP should produce data in production info list mode', (done) => {
    const gotDataForVar = [];
    db.on('data', (data) => {
      testMachineProdInfoList.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachineProdInfoList.variables.length) {
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
    sparkConfig.get(`machines:${testMachineProdInfoList.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplSoap.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplSoap.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new net SOAP', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSoap = new SparkHplSoap.hpl(log.child({
      machine: testMachineMESTable.info.name,
    }), testMachineMESTable, testMachineMESTable.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplSoap.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl SOAP should produce data in get data mode', (done) => {
    const gotDataForVar = [];
    db.on('data', (data) => {
      testMachineMESTable.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachineMESTable.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('update to get data machine based mode should succeeed', (done) => {
    sparkHplSoap.updateModel({
      enable: true,
      clientURL: '',
      useAlias: true,
      alias: 'harrisburg',
      getOnlyProductionListInfo: false,
      queryOperation: 'HDVEGetDataMachineBased',
      databaseKey: 'DBKEY',
      databaseValue: 'XXX',
      manufacturingSite: testManufacturingSiteName,
      manufacturingSiteID: testManufacturingSiteIDName,
      requestFrequency: 0.01,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl SOAP should produce data in get data machine based mode', (done) => {
    const gotDataForVar = [];
    db.on('data', (data) => {
      testMachineMESTable.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachineMESTable.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('update to get running orders mode should succeeed', (done) => {
    sparkHplSoap.updateModel({
      enable: true,
      clientURL: '',
      useAlias: true,
      alias: 'harrisburg',
      getOnlyProductionListInfo: false,
      queryOperation: 'HDVEGetRunningOrders',
      databaseKey: 'DBKEY',
      databaseValue: 'XXX',
      manufacturingSite: testManufacturingSiteName,
      manufacturingSiteID: testManufacturingSiteIDName,
      requestFrequency: 0.01,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });
  it('spark hpl SOAP should produce data in get running orders mode', (done) => {
    const gotDataForVar = [];
    db.on('data', (data) => {
      testMachineMESTable.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachineMESTable.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('successfully create a new SOAP hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSoap = new SparkHplSoap.hpl(log.child({
      machine: invalidVariableMachine.info.name,
    }), invalidVariableMachine,
    invalidVariableMachine.settings.model,
    sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error in production info list mode if a variable has no production info type',
    (done) => {
      sparkHplSoap.start(dataCb, configUpdateCb, (err) => {
        if (!err) done('err not set');
        err.message.should.equal('All production info list variables require a production info type');
        return done();
      });
    });

  it('update should error in get data mode if a variable has no request key',
    (done) => {
      sparkHplSoap.updateModel({
        enable: true,
        clientURL: '',
        useAlias: false,
        alias: '',
        getOnlyProductionListInfo: false,
        queryOperation: 'HDVEGetData',
        databaseKey: 'DBKEY',
        databaseValue: 'XXX',
        manufacturingSite: testManufacturingSiteName,
        manufacturingSiteID: testManufacturingSiteIDName,
        requestFrequency: 0.01,
      }, (err) => {
        if (!err) done('err not set');
        err.message.should.equal('All MES table query variables require a request key');
        return done();
      });
    });
});
