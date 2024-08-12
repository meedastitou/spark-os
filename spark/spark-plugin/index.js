var EventEmitter = require("events").EventEmitter;
var fs = require('fs');
var path = require('path');
var glob = require('glob');
var async = require('async');
var _ = require('lodash');
var pkg = require('./package.json');

sparkPlugin = new EventEmitter();

sparkPlugin.modules = {};
sparkPlugin.dir = path.join(__dirname, 'node_modules');
sparkPlugin.log = null;

var log = {
    debug: function() {
        if (sparkPlugin.log) {
            sparkPlugin.log.debug(arguments);
        }
    },
    info: function() {
        if (sparkPlugin.log) {
            sparkPlugin.log.info(arguments);
        }
    }
};

function findModules(prefix, done) {
    glob(path.join(sparkPlugin.dir, prefix, path.sep), {
        //ignore ourself
        ignore: path.join(sparkPlugin.dir, pkg.name, path.sep)
    }, function(err, modules) {
        log.debug(modules);
        return done(null, modules);
    });
}

function loadModule(module, done) {
    var err = null;
    var result = {
        path: module,
        module: path.basename(module),
        started: false
    };

    try {
        result.exports = require(module);
        log.info("Loaded module", module);
    } catch (e) {
        err = e;
        result = null;
    }

    if (!result) {
        log.info(err);
        return done(null);
    }

    var moduleApi = [
        'start',
        'stop',
        'require'
    ];

    for (var i=0; i<moduleApi.length; i++) {
        var api = moduleApi[i];

        if (!result.exports.hasOwnProperty(api)) {
            log.info("Warning: module " + result.module + "is missing " + api + " function, ignoring");
            result = null;
            break;
        }

        if (typeof result.exports[api] !== "function") {
            log.info("Warning: module " + result.module + "." + api + " is not a function, ignoring");
            result = null;
            break;
        }
    }

    return done(err, result);
}

sparkPlugin.loadModules = function(prefix, done) {
    findModules(prefix, function(err, modules) {
        if (err)
            return done(err);

        async.map(modules, function(module, callback) {
            loadModule(module, callback);
        }, function(err, results) {
            if (err) {
                return done(err);
            }

            //remove empty results
            results = results.filter(function(n) {
                return ((n !== undefined) && (n !== null));
            });

            sparkPlugin.modules = _.keyBy(results, 'module');

            var moduleNames = [];
            for (var i in results) {
                moduleNames.push(results[i].module);
            }

            return done(null, moduleNames);
        });
    });
};

function onRestartRequestListener(moduleName) {
    var module = sparkPlugin.modules[moduleName];

    log.info("Restart request by", module.module);

    //the module has requested to be restarted
    sparkPlugin.restartModule(module, function(err) {
        if (err) {
            log.info("Failed to restart", module.module, err);
        } else {
            log.info("Restarted", module.module);
        }
    });
}

sparkPlugin.startModule = function(moduleName, done) {
    var module = sparkPlugin.modules[moduleName];

    async.series([
        function(callback) {
            if (!module.started) {
                sparkPlugin.startModules(module.exports.require(), function(err, result) {
                    if (err) {
                        return callback(err);
                    }

                    return callback(null);
                });
            } else {
                return callback(null);
            }
        },
        function(callback) {
            try {
                if (!module.started) {
                    module.exports.start(sparkPlugin.modules, function(err, info) {
                        if (err) throw err;
                        module.info = info;
                        module.started = true;

                        //listen for restart requests
                        if (module.exports.on) {
                            //only add the listener once
                            if (module.exports.listeners('restartRequest').indexOf(onRestartRequestListener) === -1) {
                                module.exports.on('restartRequest', onRestartRequestListener);
                            }
                        }

                        log.info("Started", module.module);
                        return callback(null);
                    });
                } else {
                    return callback(null);
                }
            } catch (e) {
                return callback(e);
            }
        }
    ], function(err, results) {
        return done(err);
    });
};

sparkPlugin.startModules = function(moduleNames, done) {

    if (!_.isArray(moduleNames)) {
        return done(new Error('expect moduleNames to be an array of strings'));
    }

    if (moduleNames.length === 0) {
        //nothing to do
        return done(null);
    }

    async.eachSeries(moduleNames, function(moduleName, callback) {
        async.nextTick(function() {
            sparkPlugin.startModule(moduleName, callback);
        });
    }, function(err) {

        if (err) {
            return done(err);
        }

        return done(null);
    });
};

sparkPlugin.stopModule = function(module, done) {
    try {
        if (module.started) {
            module.exports.stop(function(err) {
                if (err) throw err;
                module.started = false;
                log.info("Stopped", module);
                return done(err);
            });
        } else {
            return done(null);
        }
    } catch (e) {
        return done(e);
    }
};

sparkPlugin.stopModules = function(done) {
    async.each(sparkPlugin.modules, function(module, callback) {
        sparkPlugin.stopModule(module, callback);
    }, function(err) {
        return done(err);
    });
};

sparkPlugin.restartModule = function(module, done) {
    sparkPlugin.stopModule(module, function(err) {
        if (err) {
            return done(err);
        }

        sparkPlugin.startModule(module.module, function(err) {
            if (err) {
                return done(err);
            }

            return done(null);
        });
    });
};

sparkPlugin.getModule = function(module) {
    return sparkPlugin.modules[module].exports;
};

sparkPlugin.getModules = function(module) {
    return sparkPlugin.modules;
};

module.exports = sparkPlugin;
