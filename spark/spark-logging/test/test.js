var pkg = require('../package.json');
var module = require('../index.js');

module.name = pkg.name;

var conf = {
    LOG_LEVEL: 'debug',
    LOG_SYSLOG: pkg.name
};

modules = {
    'spark-config': {
        exports: {
            get: function(key) {
                return conf[key];
            }
        }
    }
};

module.start(modules, function(err, result) {
    if (err) {
        console.log(err);
    }
    if (result) {
        console.log(result);
    }
});

log = module.getLogger('martin');

log.trace('TRACE');
log.debug('DEBUG');
log.warn('WARN');
log.error('ERROR');
log.fatal('FATAL');

module.stop(function(err) {
    if (err) {
        console.log(err);
    }
});
