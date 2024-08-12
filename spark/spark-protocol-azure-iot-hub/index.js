/*jshint esversion: 6 */

var path = require('path');
var EventEmitter = require("events").EventEmitter;
var config = require(path.join(__dirname, 'config.json'));
var pkg = require(path.join(__dirname, 'package.json'));
var http = require('http');
var async = require('async');
var _ = require('lodash');
var fs = require('fs');
var os = require('os');

var iothub = require('azure-iothub');
var clientFromConnectionString = require('azure-iot-device-mqtt').clientFromConnectionString;
var Message = require('azure-iot-device').Message;

var info = {
    name: pkg.name,
    fullname: pkg.fullname,
    version: pkg.version,
    description: pkg.description
};
config.info = info;

var sparkAzureCloudClient = new EventEmitter();
var log;
var db;
var conf;
var alert = null;
var running = false;
var sparkHostname = os.hostname();
var machineList = {};
var azureClient = null;


function simpleStringify (object){
    var simpleObject = {};
    for (var prop in object ){
        if (!object.hasOwnProperty(prop)){
//console.log('>>>!object.hasOwnProperty(prop)');
            continue;
        }
        if (typeof(object[prop]) == 'object'){
//console.log('>>>typeof(object[prop]) == object');
            continue;
        }
        if (typeof(object[prop]) == 'function'){
//console.log('>>>typeof(object[prop]) == function');
            continue;
        }
        simpleObject[prop] = object[prop];
    }
    return JSON.stringify(simpleObject); // returns cleaned up JSON
}

function initializeAzure() {
    var clientConnectionString = '';

    // do the following steps one after another using async
    async.series([
        // create the device under the Iot hub, or get its device key if it already exists.
        function(cb) {
            var registryConnectionString = 'HostName=' + config.settings.model.azureHub +
                '.azure-devices.net;SharedAccessKeyName=iothubowner;SharedAccessKey=' + config.settings.model.azureHubAccessKey;
            log.info("registryConnectionString: ", registryConnectionString);

            // get the registry
            var registry = iothub.Registry.fromConnectionString(registryConnectionString);

            // device name will be set to the unique hostname of this spark device
            var device = new iothub.Device(null);
            device.deviceId = sparkHostname;

            // attempt to create the device
//console.log('>>>> registry.create');
            registry.create(device, function(err, deviceInfo, res) {
//console.log('>>>> registry.create callback');

                // if error it is either due to device already existing or network of configuration issue
                if (err) {
//console.log('>>>> err = ' + err);
                    if (typeof err === 'object') {
                        err = simpleStringify(err);
                    }
                    if (err.includes('ETIMEDOUT')) {
//console.log('>>>> timeout - short circuit return');
                        return cb(err);
                    }

                    // do a get to see if error was due to existing device`
                    registry.get(device.deviceId, function(err, deviceInfo, res) {

                        // if this returns an error then we have a connectivity or configuration error
                        if (err) {
                            return cb(err);
                        }
                        // otherwise we now have a useable device to create a client connection with
                        log.info("Device " + sparkHostname + " already exists.");
                        clientConnectionString = 'HostName=' + config.settings.model.azureHub +
                            '.azure-devices.net;DeviceId=' + deviceInfo.deviceId +
                            ';SharedAccessKey=' + deviceInfo.authentication.symmetricKey.primaryKey;
                        cb(null);
                    });
                } else {
                    // we now have created a useable device to create a client connection with
                    log.info("Created device: " + sparkHostname);
                    clientConnectionString = 'HostName=' + config.settings.model.azureHub +
                        '.azure-devices.net;DeviceId=' + deviceInfo.deviceId +
                        ';SharedAccessKey=' + deviceInfo.authentication.symmetricKey.primaryKey;
                    cb(null);
                }
            });
        },

        function(cb) {
            // now, connect to the device
            log.info("clientFromConnectionString: clientConnectionString: ", clientConnectionString);
            azureClient = clientFromConnectionString(clientConnectionString);

            azureClient.open(function(err) {
                if (err) {
                    return cb(err);
                }
                log.info("Client Connected");

                // TODO could send initial meta data about all machines on this device (as per aws-iot protocol)
                // for example see this example https://github.com/Azure/azure-iot-sdk-node/blob/master/device/samples/remote_monitoring.js

                azureClient.on('message', function(msg) {
                    //log.info('Id: ' + msg.messageId + ' Body: ' + msg.data);
                });

                azureClient.on('error', function(err) {
                    // raise alert
                    alert.raise({ key: 'client-error', errorMsg: err.message });
                });

                azureClient.on('disconnect', function() {
                    log.info("Client Disconnected");
                });

                cb(null);
            });

        }
    ],

    function(err, result) {

        // once all async task are completed check for error
        if (err) {
            alert.raise({ key: 'initialization-error', errorMsg: err.message });
        } else {
            // if we get here there have been no initialization issues, so clear alert just in case it was raised
            alert.clear('initialization-error');

            // listen for data being added to the database
            db.on('added', databaseListener);

            running = true;
            log.info("Azure initialized");
        }
    });
}


sparkAzureCloudClient.start = function(modules, done) {

    log = modules['spark-logging'].exports.getLogger(pkg.name);
    db = modules['spark-db'].exports;
    conf = modules['spark-config'].exports;
    alert = modules['spark-alert'].exports.getAlerter(pkg.name);

    alert.preLoad({
        'send-error': {
            msg: 'Azure Cloud Client: Unable to communicate to Azure Cloud service',
              description: x => `Protocol is not able to write to the Azure Cloud service. Error: ${x.errorMsg}`
        },
        'initialization-error' : {
            msg: 'Azure Cloud Client: Initialization Error',
            description: x => `Azure Cloud Client is not able to initialize correctly. Error: ${x.errorMsg}`
        },
        'client-error' : {
            msg: 'Azure Cloud Client: Client Error',
            description: x => `Error raised by Azure Cloud Client. Error: ${x.errorMsg}`
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

                //  add each enabled machine in the array to the machineList
                for (var i in machines) {
                    var machine = machines[i];

                    // check its a valid machine (must have an info section)
                    if (machine.hasOwnProperty("info")) {

                        // also check if it is enabled and wants to be published
                        if ((machine.settings.model.enable === true) && (machine.settings.model.publishDisabled === false)) {

                            var machineName = machine.info.name;
                            log.info("Adding Machine: ", machineName);

                            // store the machine's variable information as a key list (from input array)
                            machineList[machineName] = {
                                variables: _.keyBy(machine.variables, 'name')
                            };
                        }
                    }
                }
                cb(null);
            });
        }
    ],

    function(err, result) {

        // once all async task are completed check for error
        if (err) {
            alert.raise({ key: 'initialization-error', errorMsg: err.message });
            // don't return error as this will cause a constant protocol reboot
            return done(null);
        }

        // trigger the azure connection processed
        setImmediate(initializeAzure);

        log.info("Started", pkg.name);
        return done(null, config.info);
    });
};


sparkAzureCloudClient.stop = function(done) {
    // need to cancel the listen event that causes the http posts
    db.removeListener('added', databaseListener);
    // reset pointer to datastore etc
    machineList = {};
    running = false;
    azureClient = null;

    alert.clearAll(function(){
        return done(null);
    });
};

function onSetListener(key) {

    //check if anything in the model changes
    var reAzureCloudClientChanges = new RegExp('protocols:' + pkg.name + ':settings:model:*');
    // check if any machine's enable or publish state has changed
    var reMachineChanges = new RegExp('^machines:.*:settings:model:enable$|^machines:.*:settings:model:publishDisabled$');
    // check if any machine's variables have changed
    var reMachineVariableChanges = new RegExp('^machines:.*:variables$');

    if (reAzureCloudClientChanges.test(key)) {
        conf.get('protocols:' + pkg.name + ':settings:model', function(err, model) {
            log.debug('protocols:' + pkg.name + ':settings:model', model);

            if (!_.isEqual(model, config.settings.model)) {
                //the enable key has changed
                log.debug('protocols:' + pkg.name + ':settings:model changed from', config.settings.model, 'to', model);

                config.settings.model = model;

                //request a restart
                sparkAzureCloudClient.emit('restartRequest', info.name);
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
            var machineName = key.slice(startIndex, endIndex);

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
                    machineList[machineName] = {
                        variables: _.keyBy(machine.variables, 'name')
                    };

                } else if (((!machineEnabled) || (!publishingEnabled)) && (machineExists)) { // else if machine has just been disabled and exists in the queue

                    log.info("Removing Machine: " + machineName);

                    // delete the entry from the queue object
                    delete machineList[machineName];
                } else if ((machineEnabled) && (publishingEnabled) && (machineExists)) {
                    // if we see an enabled machine that already exists, the variables may have changed

                    // before deleting see if the variable list has actually changed (can get double enables - so this debounces)
                    var updatedList = {
                        variables: _.keyBy(machine.variables, 'name')
                    };

                    // if the variables have changed
                    if (_.isEqual(machineList[machineName], updatedList) === false) {

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

    // get the new entry
    db.get(key, function(err, entry) {

        // check we have a variable list for this machine
        if (machineList.hasOwnProperty(entry.machine)) {

            // extract the required data from the returned entry
            var machineName = entry.machine;
            var variableName = entry.variable;
            var variableTimestamp = entry.createdAt;
            var variableValue;

            // first check if variableName exists in the list before calling (as may have been added before we have updated our internal list)
            if (machineList[machineName].variables[variableName] === undefined) {
                return;
            }

            variableValue = entry[variableName];

            // create the json payload
            var newData = {
                deviceId: sparkHostname,
                machine: machineName,
                variable: variableName,
                value: variableValue,
                timestamp: variableTimestamp
            };

            var iotDeviceMessage = new Message(JSON.stringify(newData));

            azureClient.sendEvent(iotDeviceMessage, function(err) {
                if (err) {
                    alert.raise({ key: 'send-error', errorMsg: err.message });
                } else {
                    alert.clear('send-error');
                }
            });
        }
    });
}

sparkAzureCloudClient.require = function() {
    return ['spark-logging',
        'spark-db',
        'spark-alert',
        'spark-config',
    ];
};

module.exports = sparkAzureCloudClient;
