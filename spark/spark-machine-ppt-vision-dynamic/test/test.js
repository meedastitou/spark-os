var pkg = require('../package.json');
var module = require('../index.js');
var bunyan = require('bunyan');
var log = bunyan.createLogger({
    name: pkg.name,
    level: 'DEBUG',
    src: true
});

var conf = {};

modules = {
    'spark-config': {
        exports: {
            get: function(key) {
                return conf[key];
            },
            set: function(key, value, callback) {
              callback();
            },
            listeners: function(){
                return {
                    indexOf: function(){
                        return 1;
                    }
                };
            }
        }
    },
    'spark-alert': {
        exports: {
            getAlerter: function(moduleName) {
                return {clearAll: function(cb) { return cb();}, preLoad: function() {}, clear: function() {}};
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
            }
        }
    },
    'spark-hardware-detect': {
        exports: {
            getCurrentHardware: function(){
                return [];
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
    });
}, 5000);
