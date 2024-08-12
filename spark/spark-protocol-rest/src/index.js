const assert = require('assert');
const _ = require('lodash');
const express = require('express');
const bodyParser = require('body-parser');
const uuid = require('uuid');
const typeis = require('type-is');
const cors = require('cors');
const Ajv = require('ajv');
const pkg = require('../package.json');

const ajv = Ajv({
  allErrors: true,
  unknownFormats: ['tabs'],
});

const routes = {};
routes.alerts = require('./routes/alerts');
routes.ble = require('./routes/ble');
routes.certs = require('./routes/certs');
routes.hardware = require('./routes/hardware');
routes.info = require('./routes/info');
routes.logs = require('./routes/logs');
routes.machinedefs = require('./routes/machinedefs');
routes.machines = require('./routes/machines');
routes.networks = require('./routes/networks');
routes.protocols = require('./routes/protocols');

// spark-protocol-rest is always enabled
const config = {
  settings: {
    model: {
      enable: true,
    },
  },
  info: {
    name: pkg.name,
    fullname: pkg.fullname,
    version: pkg.version,
    description: pkg.description,
  },
};

const sparkRest = {
  app: express(),
  router: express.Router(),
  log: null,
  db: null,
  conf: null,
  http: null,
  alert: null,
};

let alert;
let log;
let conf;
let http;
let db;
const { app } = sparkRest;

sparkRest.start = function start(modules, done) {
  sparkRest.log = modules['spark-logging'].exports.getLogger(pkg.name);
  sparkRest.db = modules['spark-db'].exports;
  sparkRest.conf = modules['spark-config'].exports;
  sparkRest.http = modules['spark-protocol-http'].exports;
  sparkRest.alert = modules['spark-alert'].exports;
  ({
    alert, log, conf, http, db,
  } = sparkRest);

  // Note: the REST API is always enabled and can't be disabled

  // read the schemas from the conf store
  conf.get('schemas', (err, result) => {
    app.schemas = result;
    assert(_.hasIn(app.schemas, 'hpl'));

    // setup an json schema validator for each schema
    Object.keys(app.schemas).forEach((i) => {
      _.set(app, ['validate', i], ajv.compile(app.schemas[i]));
    });
  });

  // save our config
  conf.set(`protocols:${pkg.name}`, config, (err) => {
    if (err) {
      return done(err);
    }

    app.log = log;
    app.alert = alert;
    app.conf = conf;
    app.db = db;

    // configure body-parser to parse json
    app.use(bodyParser.json());
    app.use((error, req, res, next) => {
      if (error instanceof SyntaxError) {
        res.status(400).jsonp({
          message: 'Syntax error',
        });
      } else {
        next();
      }
    });

    // handler for all received requests
    app.use((req, res, next) => {
      // add a request id
      req.req_id = uuid.v4();

      // include the request id in the response
      res.setHeader('X-Request-Id', req.req_id);

      // setup a child looged and include the request id
      req.log = log.child({
        req_id: req.req_id,
      });

      // log the received request
      req.log.debug({
        req,
        body: req.body,
      }, `--> ${req.method} ${req.url}`);

      // setup logging for the response
      res.on('finish', () => {
        let lvl = 'debug';
        if (res.statusCode >= 500) {
          lvl = 'error';
        }
        req.log[lvl]({
          res,
        }, `<-- ${res.statusCode} (${req.method} ${req.originalUrl})`);
      });

      // request must include a Content-Type header in posts
      if (req.method === 'POST') {
        if (!req.headers['content-type']) {
          return res.status(403).jsonp({
            message: 'Content-Type missing',
          });
        }
      }

      // only accept application/json
      if ((req.headers['content-type'])) {
        if (!typeis(req, ['json']) && typeis.hasBody(req)) {
          return res.status(415).jsonp({
            message: 'Unsupported Content-Type',
          });
        }
      }

      // request must include a user-agent header
      if (!req.headers['user-agent']) {
        return res.status(403).jsonp({
          message: 'User-Agent missing',
        });
      }

      return next();
    });

    // CORS support. See:
    // - http://en.wikipedia.org/wiki/Cross-origin_resource_sharing
    // - https://developer.mozilla.org/en-US/docs/Web/HTTP/Access_control_CORS
    const corsOptions = {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    };
    app.use(cors(corsOptions));

    // enable pre-flight request for all routes
    app.options('*', cors());

    // serve static content from the log store directory
    const logStoreDir = conf.get('LOG_STORE_DIR') || '/var/lib/spark/logs';
    app.use('/logs/files', express.static(logStoreDir));

    // setup the routes
    Object.keys(routes).forEach((r) => {
      app.use(`/${r}`, routes[r]);
    });

    // trap errors - this must be the last middleware
    app.use((req, res) => {
      req.log.debug(`Cannot ${req.method} ${req.url}`);
      return res.status(403).jsonp({
        message: `Cannot ${req.method} ${req.url}`,
      });
    });

    http.server.addListener('request', app);

    log.info('Started', pkg.name);
    return done(null, config.info);
  });
};

sparkRest.stop = function stop(done) {
  log.info('Stopped', pkg.name);
  return done(null);
};

sparkRest.require = function require() {
  return ['spark-logging',
    'spark-db',
    'spark-config',
    'spark-protocol-http',
    'spark-alert',
  ];
};

module.exports = sparkRest;
