const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const http = require('http');
const _ = require('lodash');
const dummyMachineData = require('./machines/spark-machine-dummy-data.json');
const sparkRest = require('../src/index.js');
const pkg = require('../package.json');
const hplSchema = require('../../spark-machine-hpl/schemas/hpl.json');
const dummyHplDefaults = require('../../spark-hpl-dummy/defaults.json');

hplSchema.definitions.info.properties.hpl.enum = ['dummy', 'test'];

function getSchema(name) {
  // load the schema
  const schema = JSON.parse(fs.readFileSync(`../${name}/schema.json`, 'UTF-8'));

  // merge in the hpl definitions
  return _.merge({}, schema, {
    definitions: {
      hpl: hplSchema,
    },
  });
}

const conf = {
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
  LOG_FILE: process.env.LOG_FILE || 'test.log',
  HTTP_PORT: process.env.HTTP_PORT || 8081,
  MACHINES_SYSTEM_DIR: path.join(__dirname, 'machinedefs', 'system'),
  MACHINES_USER_DIR: path.join(__dirname, 'machinedefs', 'user'),
  LOG_STORE_DIR: path.join(__dirname, 'logs'),
  GET_SPARK_LOGS_SCRIPT: path.join(__dirname, 'get-spark-logs'),
  GEN_SELF_CERT_SCRIPT: path.join(__dirname, 'cert-test-script'),
  GEN_CSR_SCRIPT: path.join(__dirname, 'cert-test-script'),
  CSR_FILE: path.join(__dirname, 'cert-test-script'),
  CSR_KEY_FILE: path.join(__dirname, 'certificates/test-key.pem'),
  HAVE_CONNMAN: process.env.HAVE_CONNMAN === 'true',
  schemas: {
    hpl: hplSchema,
    dummy: getSchema('spark-hpl-dummy'),
    test: getSchema('spark-hpl-dummy'),
  },
  hardware: {},
  protocols: {
    'my-protocol': {
      info: {
        fullname: 'MyProtocol',
        description: 'My super special protocol',
        version: '0.0.1',
        name: 'my-protocol',
      },
      settings: {
        model: {
          enable: true,
        },
      },
    },
  },
  machines: {
    'spark-machine-dummy': _.merge({},
      dummyHplDefaults, {
        info: {
          name: 'spark-machine-dummy',
          fullname: 'Dummy Machine',
          version: '1.0.0',
          description: 'Spark Machine Definition for a fake device',
          hpl: 'dummy',
        },
        variables: [{
          name: 'temperature',
          description: 'Temperature',
          format: 'float',
          type: 'random',
        }, {
          name: 'pressure',
          description: 'Pressure',
          format: 'float',
          type: 'sine',
        }, {
          name: 'humidity',
          description: 'Humidity',
          format: 'float',
          type: 'cosine',
        }, {
          name: 'error',
          description: 'Error Code',
          format: 'uint16',
          outputFormat: 'char',
          type: 'error',
          transformMap: {
            0: 'success, from spark-machine-dummy',
            1: 'error, from spark-machine-dummy',
          },
        }],
      }),
  },
};

function reqSerializer(req) {
  return {
    method: req.method,
    url: req.url,
    headers: req.headers,
  };
}

function resSerializer(res) {
  return {
    statusCode: res.statusCode,
    // eslint-disable-next-line no-underscore-dangle
    header: res._header,
  };
}

// setup bunyan logging
const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  serializers: {
    err: bunyan.stdSerializers.err,
    req: reqSerializer,
    res: resSerializer,
  },
  streams: [{
    path: 'test.log',
  }],
});

const httpServer = http.createServer().listen(conf.HTTP_PORT, () => {
  log.info(`HTTP server listening on port ${httpServer.address().port}`);
});

const sparkdb = new EventEmitter();
sparkdb.db = {
  'spark-machine-dummy': dummyMachineData,
};
sparkdb.getAll = function getAll(key, done) {
  const data = _.get(sparkdb.db, key);
  return done(null, data);
};
sparkdb.getLatest = function getLatest(machine, variable, done) {
  this.getAll(machine, (err, res) => done(err, _.findLast(res, o => o.variable === variable)));
};

const sparkConfig = new EventEmitter();
sparkConfig.set = function set(key, value, done) {
  log.debug({ key, value }, 'conf.set');
  _.set(conf, key.split(':'), _.cloneDeep(value));
  sparkConfig.emit('set', key);
  if (done) return done(null);
  return undefined;
};
sparkConfig.get = function get(key, cb) {
  const value = _.cloneDeep(_.get(conf, key.split(':')));
  log.debug({ key, value }, 'conf.get');
  if (!cb) {
    return value;
  }
  if (_.isNil(value)) {
    return cb(new Error(`${key} does not exist`));
  }
  return cb(null, value);
};
sparkConfig.getFiltered = function getFiltered(key, cb) {
  return this.get(key, cb);
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
  'spark-protocol-http': {
    exports: {
      server: httpServer,
    },
  },
  'spark-config': {
    exports: sparkConfig,
  },
  'spark-alert': {
    exports: {
      getAlerts(done) {
        return done(null, []);
      },
      getAlertsCount(done) {
        return done(null, 0);
      },
    },
  },
};

sparkRest.require();

sparkRest.start(modules, (err, result) => {
  if (err) {
    log.error(err);
  }
  if (result) {
    log.debug(result);
    // console.log(JSON.stringify(conf, null, 2));
  }
});

module.exports = {
  httpServer,
  modules,
  conf,
};
