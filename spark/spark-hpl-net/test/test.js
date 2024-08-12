/* jshint esversion: 6 */
require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const net = require('net');
const pkg = require('../package.json');
const SparkHplNet = require('../index.js');

const CLIENT_PORT = 10000;
const SERVER_PORT = 10001;

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
    hpl: 'net',
  },
  settings: {
    model: {
      enable: true,
      mode: 'req/res as client',
      ipAddress: os.hostname(),
      port: CLIENT_PORT,
      requestFrequency: 0.1,
      publishTerminator: '',
    },
  },
  variables: [{
    name: 'count',
    description: 'Count',
    format: 'int16',
    requestKey: 'count',
    csvPos: 0,
    value: 1234,
  },
  {
    name: 'temperature',
    description: 'Temperature',
    format: 'float',
    requestKey: 'temperature',
    csvPos: 1,
    value: 23.0,
  },
  {
    name: 'xmlTest',
    description: 'XML Test',
    format: 'char',
    requestKey: 'xmlTest',
    regex: '<.+>',
    value: '<ABC/>',
  },
  {
    name: 'boolTest',
    description: 'Bool Test',
    format: 'bool',
    requestKey: 'boolTest',
    csvPos: 3,
    value: true,
  },
  {
    name: 'arrayVariable',
    description: 'Array Variable',
    format: 'int8',
    requestKey: 'arrayVariable',
    array: true,
    regex: '\t.',
    value: [1, 2, 3],
  },
  {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
  }],
};

const invalidVariableMachine = {
  info: {
    name: 'invalid-variable-machine',
    fullname: 'Invalid variable machine',
    version: '1.0.0',
    description: 'Invalid Variable Machine',
    hpl: 'opcua',
  },
  settings: {
    model: {
      enable: true,
      mode: 'pub/sub as server',
      ipAddress: os.hostname(),
      port: SERVER_PORT,
      publishTerminator: '',
    },
  },
  variables: [{
    name: 'invalid',
    description: 'Invalid',
    format: 'int16',
    csvPos: 300,
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

const sparkAlert = new EventEmitter();
sparkAlert.getAlerter = function getAlerter() {
  return {
    clearAll(done) {
      return done(null);
    },
    preLoad() {},
    raise(data) {
      log.error({ data }, 'Raised alert');
      sparkAlert.emit('raise', data);
    },
    clear(key) {
      log.debug({ key }, 'Cleared alert');
    },
  };
};

let serverSocket;
net.createServer((socket) => {
  serverSocket = socket;
  socket.on('data', (data) => {
    const requestKey = data.toString();
    testMachine.variables.forEach((variable) => {
      if (variable.requestKey === requestKey) {
        socket.write(variable.value.toString());
      }
    });
  });
}).listen(testMachine.settings.model.port);

function initPubSubMode(newLinesForXml, done) {
  const readVariables = [];
  const gotDataForVar = [];
  let publishedData = '';
  testMachine.variables.forEach((variable) => {
    if (!_.get(variable, 'machineConnected', false)
     && (_.get(variable, 'access', 'read') === 'read')) {
      readVariables.push(variable);
      if (!_.get(variable, 'deliverEntireResponse', false)) {
        let stringValue = '';
        if (_.get(variable, 'array', false)) {
          variable.value.forEach((value) => {
            stringValue = `${stringValue}\t${value.toString()}`;
          });
        } else {
          stringValue = variable.value.toString();
        }
        if (publishedData.length !== 0) {
          publishedData = `${publishedData},${stringValue}`;
        } else {
          publishedData = stringValue;
        }
      }
    }
  });
  db.on('data', (data) => {
    readVariables.forEach((variable) => {
      if (variable.name === data.variable) {
        if (gotDataForVar.indexOf(data.variable) === -1) {
          gotDataForVar.push(data.variable);
          if (_.get(variable, 'deliverEntireResponse', false)) {
            const csvPos = _.get(variable, 'csvPos', 0);
            const splitPublishedData = publishedData.split(',');
            splitPublishedData.splice(0, csvPos);
            let jointedPublishedData = splitPublishedData.join();
            if (newLinesForXml) {
              const xmlEndRegEx = new RegExp('/>', 'g');
              jointedPublishedData = jointedPublishedData.replace(xmlEndRegEx, '/>\n');
            }
            data[variable.name].should.eql(jointedPublishedData);
          } else {
            data[variable.name].should.eql(variable.value);
          }
          if (gotDataForVar.length === readVariables.length) {
            db.removeAllListeners('data');
            return done();
          }
        }
      }
      return undefined;
    });
  });

  return publishedData;
}

const sparkConfig = new EventEmitter();
sparkConfig.set = function set(key, value, done) {
  if (done) return done(null);
  return undefined;
};

describe('Spark HPL Net', () => {
  let sparkHplNet;

  it('successfully create a new net hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplNet = new SparkHplNet.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplNet.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplNet.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplNet.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl net should produce data in req/res as client mode', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && (!_.get(variable, 'array', false))
       && (_.get(variable, 'access', 'read') === 'read')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            gotDataForVar.push(data.variable);
            data[variable.name].should.eql(variable.value);
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

  it('spark hpl net should produce data in combined data mode', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && (!_.get(variable, 'array', false))
       && (_.get(variable, 'access', 'read') === 'read')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      if (data.variable === 'CombinedResult') {
        const combinedResultArray = data[data.variable];
        for (let iCombVar = 0; iCombVar < combinedResultArray.length; iCombVar += 1) {
          readVariables.forEach((variable) => {
            if (_.get(variable, 'access', 'read') === 'read') {
              if (variable.name === combinedResultArray[iCombVar].name) {
                if (gotDataForVar.indexOf(variable.name) === -1) {
                  combinedResultArray[iCombVar].value.should.eql(variable.value);
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
        }
      }
    });
    sparkHplNet.updateModel({
      enable: true,
      mode: 'req/res as client',
      ipAddress: os.hostname(),
      port: CLIENT_PORT,
      publishTerminator: '',
      deliverEntireResponse: true,
      requestFrequency: 0.1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplNet.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplNet.updateModel({
      enable: false,
      mode: 'pub/sub as client',
      ipAddress: os.hostname(),
      port: testMachine.settings.model.port,
      deliverEntireResponse: false,
      publishTerminator: '',
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl net should produce data in pub/sub as client mode', (done) => {
    const publishedData = initPubSubMode(false, done);
    sparkHplNet.updateModel({
      enable: true,
      mode: 'pub/sub as client',
      ipAddress: os.hostname(),
      port: testMachine.settings.model.port,
      publishTerminator: '',
    }, (err) => {
      if (err) return done(err);
      serverSocket.write(publishedData);
      return undefined;
    });
  });

  it('spark hpl net should produce data in pub/sub as client mode with terminator', (done) => {
    const publishedData = initPubSubMode(false, done);
    sparkHplNet.updateModel({
      enable: true,
      mode: 'pub/sub as client',
      ipAddress: os.hostname(),
      port: testMachine.settings.model.port,
      publishTerminator: '\n',
    }, (err) => {
      if (err) return done(err);
      serverSocket.write(`${publishedData}\n`);
      return undefined;
    });
  });

  it('an alert should be raised and connection variables set false if the server is destroyed', (done) => {
    let alertRaised = false;
    let connectedVariableSet = false;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`${testMachine.info.name}connectivity-alert`);
      alert.msg.should.equal(testMachine.info.name);
      alert.description.should.equal('not able to open connection. please verify the connection configuration');
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

    serverSocket.destroy();
  });

  it('update model should raise an alert if client port is incorrect', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`${testMachine.info.name}connectivity-alert`);
      alert.msg.should.equal(testMachine.info.name);
      alert.description.should.equal('not able to open connection. please verify the connection configuration');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkHplNet.updateModel({
      enable: true,
      mode: 'req/res as client',
      ipAddress: os.hostname(),
      port: SERVER_PORT,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });

  it('update model should raise an alert if client is destroyed', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      if (alert.description !== 'waiting for the client to connect ...') {
        alert.key.should.equal(`${testMachine.info.name}connectivity-alert`);
        alert.msg.should.equal(testMachine.info.name);
        alert.description.should.equal('Client disconnected from the server');
        sparkAlert.removeAllListeners('raise');
        return done();
      }
      return undefined;
    });

    sparkHplNet.updateModel({
      enable: true,
      mode: 'pub/sub as server',
      ipAddress: os.hostname(),
      port: SERVER_PORT,
      publishTerminator: '',
    }, (err) => {
      if (err) return done(err);
      const client = net.createConnection(SERVER_PORT, os.hostname(), () => {
        setTimeout(() => {
          client.destroy();
        }, 100);
      });
      return undefined;
    });
  });

  it('spark hpl net should produce data in pub/sub as server mode', (done) => {
    const publishedData = initPubSubMode(false, done);
    sparkHplNet.updateModel({
      enable: true,
      mode: 'pub/sub as server',
      ipAddress: os.hostname(),
      port: SERVER_PORT,
      publishTerminator: '',
    }, (err) => {
      if (err) return done(err);
      const client = net.createConnection(SERVER_PORT, os.hostname(), () => {
        client.write(publishedData);
      });
      return undefined;
    });
  });

  it('spark hpl net should produce data in pub/sub as server mode with terminator', (done) => {
    const publishedData = initPubSubMode(true, done);
    sparkHplNet.updateModel({
      enable: true,
      mode: 'pub/sub as server',
      ipAddress: os.hostname(),
      port: SERVER_PORT,
      publishTerminator: '\n',
      newLinesForXml: true,
    }, (err) => {
      if (err) return done(err);
      const client = net.createConnection(SERVER_PORT, os.hostname(), () => {
        client.write(`${publishedData}\n`);
      });
      return undefined;
    });
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplNet.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplNet = new SparkHplNet.hpl(log.child({
      machine: invalidVariableMachine.info.name,
    }), invalidVariableMachine, invalidVariableMachine.settings.model,
    sparkConfig, null, sparkAlert.getAlerter());
    sparkHplNet.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('an invalid variable should raise an alert', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal(`${invalidVariableMachine.info.name}connectivity-alert`);
      alert.msg.should.equal(invalidVariableMachine.info.name);
      alert.description.should.equal(`Failed to get the data for the variable: ${invalidVariableMachine.variables[0].name}`);
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    const client = net.createConnection(SERVER_PORT, os.hostname(), () => {
      client.write('ABC');
    });
    return undefined;
  });

  it('update model should error in req/res mode if no request key', (done) => {
    sparkHplNet.updateModel({
      enable: true,
      mode: 'req/res as client',
      ipAddress: os.hostname(),
      port: CLIENT_PORT,
      requestFrequency: 0.1,
      publishTerminator: '',
    }, (err) => {
      if (!err) done('err not set');
      err.message.should.equal('All variables require a request key in req/res mode');
      return done();
    });
  });
});
