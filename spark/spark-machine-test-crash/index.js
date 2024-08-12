var path = require('path');
var os = require('os');
var EventEmitter = require("events").EventEmitter;
var config = require(path.join(__dirname, 'config.json'));
var pkg = require(path.join(__dirname, 'package.json'));
var async = require('async');
var _ = require('lodash');
var SegfaultHandler = require('segfault-handler');

var info = {
    name: pkg.name,
    fullname: pkg.fullname,
    version: pkg.version,
    description: pkg.description
};
config.info = info;

var sparkMachineTestCrash = new EventEmitter();
var log;
var db;
var conf;
var firstStart = true;
var timer;
var started = false;

function segvTimer() {
    log.error("About to crash");
    SegfaultHandler.causeSegfault();
}

sparkMachineTestCrash.start = function(modules, done) {
    if (started) {
        return done(new Error('already started'));
    }

    log = modules['spark-logging'].exports.getLogger(pkg.name);
    conf = modules['spark-config'].exports;

    //listen for changes to the config
    //but only add the listener once
    if (conf.listeners('set').indexOf(onSetListener) === -1) {
        log.debug('config.settings.model.enable', config.settings.model.enable);
        conf.on('set', onSetListener);
    }

    // do the following steps one after another using async
    async.series([
            function(cb) {
                // read the current settings from the database model
                conf.get('machines:' + pkg.name + ':settings:model', function(err, model) {
                    // if there is model data in the db, update to it (e.g. overwrite what was read from readonly file)
                    if (model) {
                        config.settings.model = model;
                    }
                    cb(null);
                });
            },
            function(cb) {
                // if process has just started up
                if( firstStart === true ) {
                    firstStart = false;
                    // write back config incase config json file has newer data than config database
                    conf.set('machines:' + pkg.name, config, cb);
                } else {
                    // otherwise no need to update
                    return cb(null);
                }
            }        ],
        function(err, result) {
            // once all async task are completed, check for error
            if (err) {
                return done(err);
            }

            // check enable state before continuing
            if (!config.settings.model.enable) {
                started = true;
                log.info('Disabled');
                // return early but with no error
                return done(null, config.info);
            }

            timer = setInterval(segvTimer, config.settings.model.timer * 1000);
            started = true;
            log.info("Started", pkg.name);
            return done(null, config.info);
        });
};


sparkMachineTestCrash.stop = function(done) {
    if (!started) {
        return done(new Error('not started'));
    }

    // and the config change listener
    conf.removeListener('set', onSetListener);

    if (timer) {
        clearInterval(timer);
        timer = null;
    }

    log.info("Stopped", pkg.name);
    started = false;
    return done(null);
};

function onSetListener(key) {

    //check if anything in the model changes
    var reSettingsChanges = new RegExp('machines:' + pkg.name + ':settings:model:*');

    if (reSettingsChanges.test(key)) {
        conf.get('machines:' + pkg.name + ':settings:model', function(err, model) {
            log.debug('machines:' + pkg.name + ':settings:model', model);

            if (!_.isEqual(model, config.settings.model)) {
                //the enable key has changed
                log.debug('machines:' + pkg.name + ':settings:model changed from', config.settings.model, 'to', model);

                config.settings.model = model;

                //request a restart
                sparkMachineTestCrash.emit('restartRequest', info.name);
            }
        });
    }
}

sparkMachineTestCrash.require = function() {
    return ['spark-logging',
        'spark-config',
    ];
};

module.exports = sparkMachineTestCrash;
