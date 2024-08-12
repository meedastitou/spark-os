/* jshint esversion: 6 */
/* eslint no-bitwise: ["error", { "allow": ["^=", "~"] }] */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const os = require('os');
const http = require('http');
const pkg = require('../package.json');
const SparkHplScada = require('../index.js');

const HTTP_PORT = 8080;

let sparkHplScada;

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
    hpl: 'sikora',
  },
  settings: {
    model: {
      enable: true,
      clientURL: os.hostname(),
      port: HTTP_PORT,
      path: '/test',
      databaseKey: 'dbKey',
      databaseValue: 'dbValue',
      requestFrequency: 0.01,
    },
  },
  // Note: All variables MUST have unique request keys!
  variables: [{
    name: 'int16Test',
    description: 'Int16 Test',
    format: 'int16',
    requestKey: 'int16Test',
    value: 2345,
  }, {
    name: 'floatTest',
    description: 'Float Test',
    format: 'float',
    requestKey: 'floatTest',
    value: 34567.0,
  }, {
    name: 'stringTest',
    description: 'String Test',
    format: 'char',
    requestKey: 'stringTest',
    value: 'ABC',
  }, {
    name: 'bitTest',
    description: 'Bit Test',
    format: 'bool',
    requestKey: 'bitTest',
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

let responseObj = { Data: [] };
function buildResponse() {
  const variableObj = {};
  variableObj[testMachine.settings.model.databaseKey] = testMachine.settings.model.databaseValue;
  testMachine.variables.forEach((variable) => {
    switch (variable.formatted) {
      case 'char':
        variableObj[variable.requestKey] = variable.value;
        break;
      case 'bool':
        variableObj[variable.requestKey] = variable.value ? '1' : '0';
        break;
      default:
        variableObj[variable.requestKey] = variable.value.toString();
    }
  });
  responseObj.Data.push(variableObj);
}

buildResponse();

const server = http.createServer((request, response) => {
  request.on('error', () => {
  }).on('data', () => {
  }).on('end', () => {
    response.write(JSON.stringify(responseObj));
    response.end();
  });
}).listen(HTTP_PORT);

describe('Spark HPL Sikora', () => {
  it('successfully create a new Sikora hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplScada = new SparkHplScada.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, null, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplScada.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplScada.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplScada.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl Sikora should produce data', (done) => {
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

  it('update model should succeed with machine disabled', (done) => {
    sparkHplScada.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed with machine enabled', (done) => {
    sparkHplScada.updateModel({
      enable: true,
      clientURL: os.hostname(),
      port: HTTP_PORT,
      path: '/test',
      databaseKey: 'dbKey',
      databaseValue: 'dbValue',
      requestFrequency: 0.01,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('an alert should be raised if a value is not returned for a variable', (done) => {
    delete responseObj.Data[0][testMachine.variables[0].requestKey];
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      const variableName = testMachine.variables[0].name;
      alert.key.should.equal(`read-fail-${variableName}`);
      alert.msg.should.equal(`${testMachine.info.name}: Read Failed for Variable`);
      alert.description.should.equal(`Read failed for variable '${variableName}'. Check that this variable is defined correctly in the machine.`);
      sparkAlert.removeAllListeners('raise');
      return done();
    });
  });

  it('an alert should be raised if the database value is not found', (done) => {
    responseObj.Data[0][testMachine.settings.model.databaseKey] = '';
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('database-value-not-found');
      alert.msg.should.equal(`${testMachine.info.name}: Database Value Not Found`);
      alert.description.should.equal('Database value was not found in the request response.  Check that the database key and value are defined correctly.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
  });

  it('an alert should be raised if the data array is not found', (done) => {
    delete responseObj.Data;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('data-array-not-found');
      alert.msg.should.equal(`${testMachine.info.name}: Data Array Not Found`);
      alert.description.should.equal('Data array was not found in the request response. Check that the client URL, port, and path are defined correctly.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
  });

  it('an alert should be raised if the response cannot be parsed to valid JSON', (done) => {
    responseObj = 'xxx';
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description', 'errorMsg');
      alert.key.should.equal('response-parse-error');
      alert.msg.should.equal(`${testMachine.info.name}: Error Parsing Response`);
      sparkAlert.removeAllListeners('raise');
      return done();
    });
  });

  it('an alert should be raised if the server connection is closed', (done) => {
    server.close();
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('connection-error');
      alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
      alert.description.should.equal('Failed to connect to the client URL. Verify that the client URL and port number are defined correctly.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
  });
});
