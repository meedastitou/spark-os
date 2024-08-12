var path = require('path');
var pkg = require(path.join(__dirname, 'package.json'));
var bunyan = require('bunyan');
var bsyslog = require('@redisrupt/bunyan-syslog');

var info = {
    name: pkg.name,
    fullname: pkg.fullname,
    version: pkg.version,
    description: pkg.description
};

var logger;
var log;

var sparkLogging = {
    name: pkg.name
};

sparkLogging.start = function(modules, done) {

    conf = modules['spark-config'].exports;

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
    var bunyanOptions = {
        name: sparkLogging.name||pkg.name,
        level: conf.get('LOG_LEVEL'),
        src: conf.get('LOG_LEVEL') === 'debug' ? true : false,
        serializers: {
            err: bunyan.stdSerializers.err,
            req: reqSerializer,
            res: resSerializer
        },
        streams: []
    };

    if ((typeof conf.get('LOG_FILE') !== "undefined") && (conf.get('LOG_FILE').length !== 0)) {
        bunyanOptions.streams.push({
            path: conf.get('LOG_FILE')
        });
    }

    if ((typeof conf.get('LOG_SYSLOG') !== "undefined") && (conf.get('LOG_SYSLOG').length !== 0)) {
        bunyanOptions.streams.push({
            level: conf.get('LOG_LEVEL'),
            type: 'raw',
            stream: bsyslog.createBunyanStream({
                name: conf.get('LOG_SYSLOG'),
                type: 'sys'
            })
        });
    } else {
        bunyanOptions.streams.push({
            level: conf.get('LOG_LEVEL'),
            stream: process.stdout
        });
    }

    logger = bunyan.createLogger(bunyanOptions);

    log = sparkLogging.getLogger(pkg.name);
    log.info("Started",pkg.name);

    return done(null, info);
};

sparkLogging.stop = function(done) {
    log.info("Stopped",pkg.name);
    return done(null);
};

sparkLogging.require = function(){
    return ['spark-config'];
};

sparkLogging.getLogger = function(moduleName){
    return logger.child({module: moduleName});
};

module.exports = sparkLogging;
