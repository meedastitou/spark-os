/*jshint esversion: 6 */

var path = require('path');
var EventEmitter = require("events").EventEmitter;
var config = require(path.join(__dirname, 'config.json'));
var pkg = require(path.join(__dirname, 'package.json'));
var fs = require('fs');
var disk = require('diskusage');
var async = require('async');
var _ = require('lodash');

var info = {
    name: pkg.name,
    fullname: pkg.fullname,
    version: pkg.version,
    description: pkg.description
};
config.info = info;

var sparkDataLogger = new EventEmitter();
var log;
var db;
var conf;
var alert = null;
var running = false;
var fileList = {};
var machineList = {};
var testDiskSpaceTimer = null;


sparkDataLogger.start = function(modules, done) {

    log = modules['spark-logging'].exports.getLogger(pkg.name);
    db = modules['spark-db'].exports;
    conf = modules['spark-config'].exports;
    alert = modules['spark-alert'].exports.getAlerter(pkg.name);

    alert.preLoad({
      'disk-space-low': {
        msg: 'Data Logger: Low Disk Space Warning',
        description: 'There is less than 20% disk space left on your chosen path. If this hits 10% your files will be closed.'
      },
      'disk-space-full': {
        msg: 'Data Logger: Disk Space Nearly Full',
        description: 'There is less than 10% disk space left on your chosen path. Files have been closed. You will need to free up disk space to continue.'
      },
      'initialization-error' : {
        msg: 'Data Logger: Initialization Error',
        description: x => `Data Logger is not able to initialize correctly. Error: ${x.errorMsg}`
      }
    });

    // do the following steps one after another using async
    async.series([
        function(cb) {
            //listen for changes to the config
            //but only add the listener once
            if (conf.listeners('set').indexOf(onSetListener) === -1) {
                log.debug('config.settings.model.enable', config.settings.model.enable);
                conf.on('set', onSetListener);
            }

            //check the config to see if we are disabled
            conf.get('protocols:' + pkg.name + ':settings:model', function(err, model) {
                // if no result, use our local config settings
                if (model)
                    config.settings.model = model;
                cb(null);
            });
        },
        function(cb) {
            // update config based on local config settings
            conf.set('protocols:' + pkg.name, config, cb);
        },
        function(cb) {

            // check enable state before continuing
            if (!config.settings.model.enable) {
                log.info('Disabled');
                // return early but with no error
                return done(null, config.info);
            }

            // get a list of machines from the config
            conf.get('machines', function(err, machines) {
                if (err) {
                    cb(err);
                    return;
                }

                //  add each enabled machine in the array to the local machineList
                for (var i in machines) {
                    var machine = machines[i];

                    // check its a valid machine (must have an info section)
                    if (machine.hasOwnProperty("info")) {

                        // also check if it is enabled and wants to be published
                        if ((machine.settings.model.enable === true) && ( machine.settings.model.publishDisabled === false )){

                            var machineName = machine.info.name;
                            log.info("Adding Machine: ", machineName);

                            // store the machine's variable information as a key list (from input array)
                            // don't need to store variable info, currently just need to have created an object of machineName in the machineList (but may be handy in the future)
                            machineList[machineName] = {variables: _.keyBy(machine.variables, 'name') };
                        }
                    }
                }
                cb(null);
            });
        },
        function(cb) {
            // check if file path given in config is actually valid
            fs.access(config.settings.model.filePath, fs.constants.R_OK | fs.constants.W_OK, cb);
        }
    ],
    function(err, result) {
        // once all async task are completed, check for error
        if (err) {
            // raise an initialization alert including the error message
            alert.raise({ key: 'initialization-error', errorMsg: err.message });
            // don't return error as this will cause a constant protocol reboot
            return done(null);
        }

        // if we get here there have been no initialization issues, so clear alert just in case it was raised
        alert.clear('initialization-error');

        //listen for data being added to the database
        db.on('added', databaseListener);

        // start a timer task to monitor disk space for the path being used
        testDiskSpaceTimer = setInterval(testDiskSpaceFunction, 10000);

        running = true;
        log.info("Started", pkg.name);
        return done(null, config.info);
    });
};


sparkDataLogger.stop = function(done) {

    running = false;

    // need to cancel the listen event that triggers on new machine data
    db.removeListener('added', databaseListener);
    // close all files
    closeAllFiles();
    fileList = {};
    // if disk check timer task exists disable it
    if( testDiskSpaceTimer !== null) {
        clearInterval(testDiskSpaceTimer);
        testDiskSpaceTimer = null;
    }
    // clear all alerts
    alert.clearAll(function(){
        return done(null);
    });
};

function testDiskSpaceFunction() {

    disk.check(config.settings.model.filePath, function(err, info) {
    	if (err) {
    	    // shouldn't get this as have validated path already
    	} else {

            log.debug((info.free / info.total) + " percent free for path: " + config.settings.model.filePath);

            // if there is 10% or less disk space on this path
            if( (info.free / info.total) <= 0.10) {

                // raise a disk full alert
                alert.raise({ key: 'disk-space-full'});
                alert.clear('disk-space-low');

                // remove the database listener so no more file writes are attempted
                db.removeListener('added', databaseListener);

                // close all open files
                closeAllFiles();
                fileList = {};

                // stop this timer task, as alert has been raised
                clearInterval(testDiskSpaceTimer);

            }  // if there is only 20% or less disk space on this path
            else if ( (info.free / info.total) <= 0.20) {
                // just raise initial 'disk space low' alert
                alert.raise({ key: 'disk-space-low'});
            }
    	}
    });
}

function closeAllFiles() {

    // itterate through the list of open files and close them
    _.forEach(fileList, function(value, key) {
        fileList[key].end();
    });
}


function onSetListener(key) {

    //check if anything in the model changes
    var reDataLoggerChanges = new RegExp('protocols:' + pkg.name + ':settings:model:*');
    // check if any machine's enable or publish state has changed
    var reMachineChanges = new RegExp('^machines:.*:settings:model:enable$|^machines:.*:settings:model:publishDisabled$');
    // check if any machine's variables have changed
    var reMachineVariableChanges = new RegExp('^machines:.*:variables$');

    if (reDataLoggerChanges.test(key)) {
        conf.get('protocols:' + pkg.name + ':settings:model', function(err, model) {
            log.debug('protocols:' + pkg.name + ':settings:model',model);

            if (!_.isEqual(model,config.settings.model)) {
                //the enable key has changed
                log.debug('protocols:' + pkg.name + ':settings:model changed from',config.settings.model,'to',model);

                config.settings.model = model;

                //request a restart
                sparkDataLogger.emit('restartRequest',info.name);
            }
        });
    }

    var machineEnableChanges = reMachineChanges.test(key);
    var variableChanges = reMachineVariableChanges.test(key);

    // if a machine has changed its enable state, or variables have changed
    if (machineEnableChanges || variableChanges) {

        // check we have already populated our list of machines and are fully up and running
        if (running === true) {
            // extract the machine name from the key
            var startIndex = key.indexOf(':') + 1;
            // end index will differ based on whether a machine or machine's variable has changed
            var endIndex =  machineEnableChanges === true ? key.indexOf(':settings') : key.indexOf(':variables');
            var machineName = key.slice(startIndex,endIndex);

            // get the machines details
            conf.get('machines:' + machineName, function(err, machine) {

                var machineEnabled = machine.settings.model.enable;
                var publishingEnabled = !machine.settings.model.publishDisabled;

                // find if the machine already exists in the queue
                var machineExists = machineList.hasOwnProperty(machineName);

                // if the machine has just been enabled and it is not in the queue
                if ((machineEnabled) && (publishingEnabled) && (!machineExists)) {

                    log.info("Adding Machine: " + machineName);

                    // store the machine's variable information as a key list (from input array)
                    // don't need to store variable info, currently just need to have created an object of machineName in the machineList (but may be handy in the future)
                    machineList[machineName] = {variables: _.keyBy(machine.variables, 'name') };

                } else if (((!machineEnabled) || (!publishingEnabled)) && (machineExists)) { // else if machine has just been disabled and exists in the queue

                    log.info("Removing Machine: " + machineName);

                    // delete the entry from the queue object
                    delete machineList[machineName];
                } else if ((machineEnabled) && (publishingEnabled) && (machineExists)) {
                    // if we see an enabled machine that already exists, the variables may have changed

                    // before deleting see if the variable list has actually changed (can get double enables - so this debounces)
                    var updatedList = {variables: _.keyBy(machine.variables, 'name')};

                    // if the variables have changed
                    if( _.isEqual(machineList[machineName], updatedList) === false) {

                        log.info("Updating Machine: " + machineName);

                        // delete the old entry and re-create with the updated list
                        delete machineList[machineName];
                        machineList[machineName] = updatedList;
                    }
                }
            });
        }
    }
}

function databaseListener(key) {
    db.get(key, function(err, entry) {

        // check we have a variable list for this machine
        if(machineList.hasOwnProperty(entry.machine)){

            // extract the required data from the returned entry
            var machineName = entry.machine;
            var variableName = entry.variable;
            var variableTimestamp = entry.createdAt;

            // first check if variableName exists in the list before calling (as may have been added before we have updated our internal list)
            if( machineList[machineName].variables[variableName] === undefined ) {
                return;
            }

            // check if a file is already open for this machine
            if (!fileList.hasOwnProperty(machineName)) {
                // if not open it as an appendable stream, basing the filename on the machine name and the current unix time
                let fileName = machineName + '-' + Date.now() + '.log';
            	fileList[machineName] = fs.createWriteStream(config.settings.model.filePath + '/' + fileName, {flags: 'a' });
            }

            // write a new line to the correct file, each line contains the variable name, a colon seperator and then the value
            fileList[machineName].write(variableName + ";" + variableTimestamp + ";" + entry[variableName] + '\n');
        }
    });
}

sparkDataLogger.require = function() {
    return ['spark-logging',
        'spark-db',
        'spark-alert',
        'spark-config',
    ];
};

module.exports = sparkDataLogger;
