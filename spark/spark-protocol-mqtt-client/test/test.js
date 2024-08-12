require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
const _ = require('lodash');
const bunyan = require('bunyan');
const mosca = require('mosca');
const sparkMqttClient = require('../index.js');
const pkg = require('../package.json');

const log = bunyan.createLogger({
  name: pkg.name,
  level: process.env.LOG_LEVEL || 'WARN',
  src: true,
});


const moscaSettings = {
  port: 8883,
};
const mqttBroker = new mosca.Server(moscaSettings);
mqttBroker.on('ready', () => {
  log.debug('Mosca server is up and running');
});
mqttBroker.on('clientConnected', (client) => {
  log.debug('client connected', client.id);
});
mqttBroker.on('published', (packet, client) => {
  log.debug('published', {
    packet,
    client,
  });
});

const conf = {
  protocols: {
    'spark-protocol-mqtt-client': {
      settings: {
        model: {
          enable: true,
          mqttBrokerHostname: '127.0.0.1',
          mqttBrokerPort: 8883,
        },
      },
    },
  },
  machines: {
    'my-machine1': {
      info: {
        name: 'my-machine1',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
        },
      },
      variables: {
        temperature: {
          name: 'temperature',
        },
      },
    },
    'my-machine2': {
      info: {
        name: 'my-machine2',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
        },
      },
      variables: {
        pressure: {
          name: 'pressure',
        },
      },
    },
  },
};

const sparkdb = new EventEmitter();
sparkdb.db = {};
sparkdb.add = function add(key, value) {
  sparkdb.db[key] = value;
  sparkdb.emit('added', key);
};
sparkdb.get = function get(key, done) {
  return done(null, sparkdb.db[key]);
};

const modules = {
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
    exports: sparkdb,
  },
  'spark-alert': {
    exports: {
      getAlerter() {
        return {
          clearAll(cb) { return cb(); },
          preLoad() {},
          clear() {},
          raise() {},
        };
      },
    },
  },
  'spark-config': {
    exports: {
      set(key, value, done) {
        log.debug(key, value);
        if (done) return done(null);
        return undefined;
      },
      get(_key, cb) {
        let key = _key;
        const path = key.split(':');
        let target = conf;

        let err = null;
        while (path.length > 0) {
          key = path.shift();
          if (target && _.has(target, key)) {
            target = target[key];
          } else {
            err = 'undefined';
          }
        }

        const value = target;

        if (!cb) {
          return value;
        }
        return cb(err, value);
      },
      listeners() {
        return {
          indexOf() {
            return 1;
          },
        };
      },
      removeListener() {

      },
    },
  },
};

describe('Spark MQTT Client', function test() {
  // inrcrease default timeout of 2secs as stop can take
  // 2 seconds to complete if forced return is required
  this.timeout(2500);

  it('stop should error when not started', (done) => {
    sparkMqttClient.stop((err, result) => {
      if (result) throw new Error('result should not be set');
      if (!err) throw new Error('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkMqttClient.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.equal(pkg.name);
      return done();
    });
  });

  it('start should error when already started', (done) => {
    sparkMqttClient.start(modules, (err, result) => {
      if (result) throw new Error('result should not be set');
      if (!err) throw new Error('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('mqtt publish on add', (done) => {
    function mqttPubHandler(packet) {
      if (packet.topic === `${os.hostname()}/my-machine1/temperature`) {
        const data = JSON.parse(packet.payload.toString());
        data.should.contain.keys('machine', 'variable', 'temperature');
        data.machine.should.equal('my-machine1');
        data.variable.should.equal('temperature');
        data.temperature.should.equal(100);
        mqttBroker.removeListener('published', mqttPubHandler);
        return done();
      }
      return undefined;
    }

    mqttBroker.on('published', mqttPubHandler);
    sparkdb.add('my-machine1', {
      machine: 'my-machine1',
      variable: 'temperature',
      temperature: 100,
    });
  });

  it('mqtt publish on add', (done) => {
    function mqttPubHandler(packet) {
      if (packet.topic === `${os.hostname()}/my-machine2/pressure`) {
        const data = JSON.parse(packet.payload.toString());
        data.should.contain.keys('machine', 'variable', 'pressure');
        data.machine.should.equal('my-machine2');
        data.variable.should.equal('pressure');
        data.pressure.should.equal(200);
        mqttBroker.removeListener('published', mqttPubHandler);
        return done();
      }
      return undefined;
    }

    mqttBroker.on('published', mqttPubHandler);
    sparkdb.add('machine2', {
      machine: 'my-machine2',
      variable: 'pressure',
      pressure: 200,
    });
  });

  it('stop should succeed when started', (done) => {
    sparkMqttClient.stop((err) => {
      if (err) throw err;
      return done();
    });
  });

  it('start should succeed when passed valid inputs but pointing to an in-active broker', (done) => {
    // adjust port so that there is no mqtt broker available
    conf.protocols['spark-protocol-mqtt-client'].settings.model.mqttBrokerPort = 8884;
    sparkMqttClient.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.equal(pkg.name);
      return done();
    });
  });

  it('stop should succeed after started pointing to an in-active broke', (done) => {
    sparkMqttClient.stop((err) => {
      if (err) throw err;
      return done();
    });
  });
});
