var path = require('path');
var pkg = require(path.join(__dirname, '..', 'package.json'));
var sparkSegv = require(path.join(__dirname, '..', 'index.js'));
var bunyan = require('bunyan');
var log = bunyan.createLogger({
    name: pkg.name,
    level: process.env.LOG_LEVEL || 'WARN',
    src: true
});

var conf = {
    machines: {
        'spark-machine-test-crash': {
            settings: {
                model: {
                    enable: true,
                    timer: 2
                }
            }
        }
    }
};

var modules = {
    'spark-logging': {
        exports: {
            getLogger: function(moduleName) {
                return log.child({
                    module: moduleName
                });
            }
        }
    },
    'spark-config': {
        exports: {
            set: function(key, value, done) {
                log.debug(key, value);
                if (done) return done(null);
            },
            get: function(key, cb) {
                var path = key.split(':');
                var target = conf;

                var err = null;
                while (path.length > 0) {
                    key = path.shift();
                    if (target && target.hasOwnProperty(key)) {
                        target = target[key];
                        continue;
                    }
                    err = 'undefined';
                }

                var value = target;

                if (!cb) {
                    return value;
                } else {
                    return cb(err, value);
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
    }
};

sparkSegv.start(modules, function(err, result) {
    console.log("Started", err, result);
});
