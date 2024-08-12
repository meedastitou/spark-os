var path = require("path");
var pkg = require('../package.json');
var module = require('../index.js');
var bunyan = require('bunyan');
var log = bunyan.createLogger({
    name: pkg.name,
    level: 'DEBUG',
    src: true
});

var conf = {
    MACHINES_SYSTEM_DIR: path.join(process.cwd(), 'test/machines/system'),
    MACHINES_USER_DIR: path.join(process.cwd(), 'test/machines/user'),
    'machines:machine1-updated:settings:model': {
        enable: true,
        updateRate: 500
    }
};

modules = {
    'spark-config': {
        exports: {
            set: function(key, value, done) {
                log.debug({
                    key: key,
                    value: value
                });
                return done(null);
            },
            get: function(key, cb) {
                if (!cb) return conf[key];

                if (cb) {
                    return cb(null, conf[key]);
                }

            },
            clear: function(key, cb) {
                if (!cb) return;

                if (cb) {
                    return cb(null);
                }
            },
            listeners: function() {
                return {
                    indexOf: function() {
                        return 1;
                    }
                };
            },
            removeListener: function() {
                return;
            }
        }
    },
    'spark-logging': {
        exports: {
            getLogger: function(moduleName) {
                return log.child({
                    module: moduleName
                });
            }
        }
    },
    'spark-db': {
        exports: {
            add: function(data, done) {
                log.debug(data);
                return done(null);
            },
            addListener: function () {
                return;
            },
            removeListener: function () {
                return;
            }
        }
    },
    'spark-alert': {
        exports: {
            raise: function(alert) {
                log.debug(alert);
                return;
            },
            clear: function(key) {
                log.debug(key);
                return;
            }
        }
    }
};

module.start(modules, function(err, result) {
    if (err) log.error(err);
    log.debug({
        result: result
    });
});

setTimeout(function() {
    module.stop(function(err) {
        if (err) log.error(err);
        process.exit(0);
    });
}, 5000);
