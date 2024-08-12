var pkg = require('../package.json');
var module = require('../index.js');
var bunyan = require('bunyan');

function reqSerializer(req) {
    return {
        method: req.method,
        url: req.url,
        headers: req.headers
    };
}

function resSerializer(res) {
    return {
        statusCode: res.statusCode,
        header: res._header
    };
}

//setup bunyan logging
var log = bunyan.createLogger({
    name: pkg.name,
    level: 'DEBUG',
    src: true,
    serializers: {
        err: bunyan.stdSerializers.err,
        req: reqSerializer,
        res: resSerializer
    }
});

var conf = {
    HTTP_PORT: '8081',
    HTTP_HOSTNAME: '0.0.0.0',
    NODE_ENV: process.env.NODE_ENV
};

modules = {
    'spark-config': {
        exports: {
            set: function(key, value, done) {
                log.debug(key, value);
                if (done) return done(null);
            },
            get: function(key) {
                return conf[key];
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

setTimeout(function() {
    module.stop(function(err) {
        if (err) {
            console.log(err);
        }
    });
}, 10000);
