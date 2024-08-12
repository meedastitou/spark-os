const bunyan = require('bunyan');
const pkg = require('../package.json');
const sparkDb = require('../index.js');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'DEBUG',
  src: true,
});

const conf = {};

const modules = {
  'spark-config': {
    exports: {
      get(key) {
        return conf[key];
      },
    },
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
};

sparkDb.on('expired', (key) => {
  log.debug('Expired', key);
});

sparkDb.on('write-expired', (key) => {
  log.debug('Write Expired', key);
});

sparkDb.on('added', (key) => {
  sparkDb.get(key, (err, value) => {
    log.debug('Added', key, value);
  });
});

sparkDb.on('write-added', (key) => {
  sparkDb.get(key, (err, value) => {
    log.debug('Write Added', key, value);
  });
});

sparkDb.start(modules, (err, result) => {
  if (err) {
    log.error(err);
  } else {
    log.debug(result);
  }
});
