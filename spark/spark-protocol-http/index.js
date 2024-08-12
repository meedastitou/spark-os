var path = require('path');
var pkg = require(path.join(__dirname, 'package.json'));
var http = require('http');

//spark-protocol-http is always enabled
var config = {
    settings: {
        model: {
            enable: true
        }
    },
    info: {
        name: pkg.name,
        fullname: pkg.fullname,
        version: pkg.version,
        description: pkg.description
    }
};

var log;
var conf;

var sparkHttp = {
    server: null
};

sparkHttp.start = function(modules, done) {

    log = modules['spark-logging'].exports.getLogger(pkg.name);
    conf = modules['spark-config'].exports;

    config.http_port = conf.get('HTTP_PORT');
    config.http_hostname = conf.get('HTTP_HOSTNAME');

    //Note: the HTTP server is always enabled and can't be disabled
    //save our config
    conf.set('protocols:' + pkg.name, config, function(err) {
        if (err) {
            return done(err);
        }

        sparkHttp.server = http.createServer().listen(config.http_port, config.http_hostname, function() {
            log.info('HTTP server listening on port ' + config.http_hostname + ':' + config.http_port + ' in ' + conf.get('NODE_ENV') + ' mode ');
        });

        log.info("Started", pkg.name);
        return done(null, config.info);
    });
};

sparkHttp.stop = function(done) {
    if (sparkHttp.server) {
        sparkHttp.server.close(function(err) {
            if (err) log.error(err);
        });
    }

    log.info("Stopped", pkg.name);
    return done(null);
};

sparkHttp.require = function() {
    return ['spark-config',
        'spark-logging'
    ];
};

module.exports = sparkHttp;
