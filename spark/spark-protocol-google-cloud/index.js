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

var info = {
    name: pkg.name,
    fullname: pkg.fullname,
    version: pkg.version,
    description: pkg.description
};
config.info = info;

var sparkGoogleCloudClient = new EventEmitter();
var log;
var db;
var conf;
var alert = null;
var running = false;
var messageArrayBigTable = [];
var messageArrayDataStore = [];
var keyFile = null;
var datastore = null;
var bigtable = null;
var pubsub = null;
var table = null;
var hostname = os.hostname();
var machineList = {};

sparkGoogleCloudClient.start = function(modules, done) {

    log = modules['spark-logging'].exports.getLogger(pkg.name);
    db = modules['spark-db'].exports;
    conf = modules['spark-config'].exports;
    alert = modules['spark-alert'].exports.getAlerter(pkg.name);

    alert.preLoad({
      'send-error': {
        msg: 'Google Cloud: Unable to communicate to Google Cloud service',
        description: x => `Protocol is not able to write to the Google Cloud service. Error: ${x.errorMsg}`
      },
      'initialization-error' : {
        msg: 'Google Cloud: Initialization Error',
        description: x => `Google Cloud is not able to initialize correctly. Error: ${x.errorMsg}`
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
            },
            function(cb) {
                // check if the key file exists
                keyFile = config.settings.model.keyFilePath + '/keyfile.json';
                fs.access(keyFile, fs.F_OK, cb);
            },
            function(cb) {

                if (config.settings.model.database === 'Datastore') {
                    datastore = require('@google-cloud/datastore')({
                        projectId: config.settings.model.projectId,
                        keyFilename: keyFile,
                    });

                    cb(null);
                } else if (config.settings.model.database === 'Pub/Sub') {

                    pubsub = require('@google-cloud/pubsub')({
                        projectId: config.settings.model.projectId,
                        keyFilename: keyFile,
                    });

                    //  add a topic object to each machine in the machine list object
                    async.forEachOfSeries(machineList, function(machine, machinekey, cbMachine) {

                        createTopicForMachine(machinekey,  function(err, topic) {
                            if (err) {
                                return cbMachine(err);
                            }
                            // store the topic in the machine object
                            machineList[machinekey].topic = topic;
                            // and the publisher
                            machineList[machinekey].publisher = topic.publisher({batching: {maxMessages: config.settings.model.packetQueueSize}});
                            cbMachine();
                        });
                    }, function(err) {
                        if (err) {
                            return cb(err);
                        }
                        cb(null);
                    });

                } else if (config.settings.model.database === 'Bigtable') {
                    bigtable = require('@google-cloud/bigtable')({
                        projectId: config.settings.model.projectId,
                        keyFilename: keyFile,
                        zone: config.settings.model.zone,
                        cluster: config.settings.model.cluster
                    });

                    // create or get the table (including adding the required family) as cannot rely on it being created already
                    var instance = bigtable.instance('my-instance');
                    table = instance.table(config.settings.model.table);
                    table.exists(function(err, tableExists) {
                        if (err) {
                            return cb(err);
                        }

                        // if the table doesn't exist yet
                        if (!tableExists) {
                            // attempt to create it and its family
                            instance.createTable(config.settings.model.table, {
                                families: ['cf1']
                            }, function(err, newTable, apiResponse) {
                                if (err) {
                                    return cb(err);
                                }
                                table = newTable;
                                cb(null);
                            });
                        } else {
                            // if table does exist, check the family exists within the table
                            var family = table.family('cf1');
                            family.exists(function(err, familyExists) {
                                if (err) {
                                    return cb(err);
                                }

                                // if the family does not exist yet
                                if (!familyExists) {
                                    table.createFamily('cf1', function(err, family, apiResponse) {
                                        if (err) {
                                            return cb(err);
                                        }
                                        cb(null);
                                    });
                                } else {
                                    // nothing else to do, continue...
                                    cb(null);
                                }
                            });
                        }
                    });
                }
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

            // listen for data being added to the database
            db.on('added', databaseListener);

            running = true;
            log.info("Started", pkg.name);
            return done(null, config.info);
        });
};


sparkGoogleCloudClient.stop = function(done) {
    // need to cancel the listen event that causes the http posts
    db.removeListener('added', databaseListener);
    // and the config change listener
    conf.removeListener('set', onSetListener);
    // reset pointer to datastore etc
    datastore = null;
    bigtable = null;
    pubsub = null;
    machineList = {};
    running = false;
    messageArrayBigTable = [];
    messageArrayDataStore = [];

    alert.clearAll(function(){
        return done(null);
    });
};

function onSetListener(key) {

    //check if anything in the model changes
    var reGoogleCloudClientChanges = new RegExp('protocols:' + pkg.name + ':settings:model:*');
    // check if any machine's enable or publish state has changed
    var reMachineChanges = new RegExp('^machines:.*:settings:model:enable$|^machines:.*:settings:model:publishDisabled$');
    // check if any machine's variables have changed
    var reMachineVariableChanges = new RegExp('^machines:.*:variables$');

    if (reGoogleCloudClientChanges.test(key)) {
        conf.get('protocols:' + pkg.name + ':settings:model', function(err, model) {
            log.debug('protocols:' + pkg.name + ':settings:model', model);

            if (!_.isEqual(model, config.settings.model)) {
                //the enable key has changed
                log.debug('protocols:' + pkg.name + ':settings:model changed from', config.settings.model, 'to', model);

                config.settings.model = model;

                //request a restart
                sparkGoogleCloudClient.emit('restartRequest', info.name);
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
                    machineList[machineName] = {variables: _.keyBy(machine.variables, 'name')};

                    if (config.settings.model.database === 'Pub/Sub') {
                        // create a new topic for this machine too
                        createTopicForMachine(machineName, function(err, topic){
                            if (err) {
                                log.error(err.message);
                                return;
                            }
                            // store the topic in the machine object
                            machineList[machineName].topic = topic;
                            // and the publisher
                            machineList[machineName].publisher = topic.publisher({batching: {maxMessages: config.settings.model.packetQueueSize}});
                        });
                    }

                } else if (((!machineEnabled) || (!publishingEnabled)) && (machineExists)) { // else if machine has just been disabled and exists in the queue

                    log.info("Removing Machine: " + machineName);

                    // delete the entry from the queue object
                    delete machineList[machineName];

                } else if ((machineEnabled) && (publishingEnabled) && (machineExists)) {
                    // if we see an enabled machine that already exists, the variables may have changed

                    // before deleting see if the variable list has actually changed (can get double enables - so this debounces)
                    var updatedList = { variables: _.keyBy(machine.variables, 'name')};

                    // if the variables have changed
                    if (_.isEqual(machineList[machineName], updatedList) === false) {

                        log.info("Updating Machine: " + machineName);

                        // delete the old entry and re-create with the updated list
                        delete machineList[machineName];
                        machineList[machineName] = updatedList;

                        if (config.settings.model.database === 'Pub/Sub') {
                            // re-create the topic for this machine too
                            createTopicForMachine(machineName, function(err, topic){
                                if (err) {
                                    log.error(err.message);
                                    return;
                                }
                                // store the topic in the machine object
                                machineList[machineName].topic = topic;
                                // and the publisher
                                machineList[machineName].publisher = topic.publisher({batching: {maxMessages: config.settings.model.packetQueueSize}});
                            });
                        }
                    }
                }
            });
        }
    }
}

function createTopicForMachine(machineName, callback) {

    var topicName = hostname + "." + machineName;
    var topic = pubsub.topic(topicName);

    // get the topic, creating it if necessary
    topic.get({ autoCreate: true }, callback);
}


function databaseListener(key) {

    // get the new entry
    db.get(key, function(err, entry) {

        // check we have a variable list for this machine
        if (machineList.hasOwnProperty(entry.machine)) {

            // extract the required data from the returned entry
            var machineName = entry.machine;
            var variableName = entry.variable;
            var variableId = entry._id;
            var variableTimestamp = entry.createdAt;

            var createdKey;
            var newData;
            var variableValue;

            // first check if variableName exists in the list before calling (as may have been added before we have updated our internal list)
            if (machineList[machineName].variables[variableName] === undefined) {
                return;
            }

            // for Google Cloud Datastore
            if (config.settings.model.database === 'Datastore') {

                variableValue = entry[variableName];

                // create the unique key
                var newKey = {
                    namespace: 'Spark',
                    path: [
                        'hostname',
                        hostname,
                        'machine',
                        machineName,
                        'variable',
                        variableName,
                        'id',
                        variableId
                    ]
                };

                // let datastore process the key
                createdKey = datastore.key(newKey);

                // and set the data
                newData = {
                    value: variableValue,
                    timestamp: variableTimestamp
                };

                // add key and data to message array
                messageArrayDataStore.push({
                    key: createdKey,
                    data: newData
                });

                // send when we have the correct number
                if (messageArrayDataStore.length >= config.settings.model.packetQueueSize) {

                    // change pointer to free up messageArrayDataStore for new messages
                    var messageArrayToSendDS = messageArrayDataStore;
                    messageArrayDataStore = [];

                    // send the messages, using the correct Google api
                    datastore.save(messageArrayToSendDS, function(err, apiResponse) {
                        if (err) {
                            alert.raise({ key: 'send-error', errorMsg: err.message });
                        } else {
                            alert.clear('send-error');
                        }
                    });
                }
            } else if (config.settings.model.database === 'Bigtable') { // for Google Cloud Bigtable

                var unixTimestamp = Date.parse(variableTimestamp);
                // create a bigtable style key
                createdKey = hostname + '#' + machineName + '#' + variableName + '#' + unixTimestamp;

                variableValue = entry[variableName];

                // By default whenever you insert new data, the server will capture a timestamp of when your data was inserted, we can overide this by giving one ourselves
                var timestamp = unixTimestamp * 1000;

                // set the data (inside the column family)
                newData = {
                    cf1: {}
                };

                newData.cf1[variableName] = {
                    value: variableValue,
                    timestamp: timestamp
                };

                // add key and data to message array
                messageArrayBigTable.push({
                    key: createdKey,
                    data: newData
                });

                // send when we have the correct number
                if (messageArrayBigTable.length >= config.settings.model.packetQueueSize) {

                    // change pointer to free up messageArrayBigTable for new messages
                    var messageArrayToSendBT = messageArrayBigTable;
                    messageArrayBigTable = [];

                    // send the messages, using the correct Google api
                    table.insert(messageArrayToSendBT, function(err) {
                        if (err) {
                            alert.raise({ key: 'send-error', errorMsg: err.message });
                        } else {
                            alert.clear('send-error');
                        }
                    });
                }
            } else if (config.settings.model.database === 'Pub/Sub') { // for Google Pub/Sub

                // first check we have a topic to publish this on
                if ((machineList[machineName].topic === undefined) || (machineList[machineName].topic === null)){
                    return;
                }

                variableValue = entry[variableName];

                // form the data payload
                newData = {
                    name: variableName,
                    value: variableValue,
                    timestamp: variableTimestamp
                };

                // stringify and place in a buffer (api change since 0.14.0)
                var newDataBuffer = Buffer.from(JSON.stringify(newData));

                machineList[machineName].publisher.publish(newDataBuffer, function(err, messageIds) {
                    if (err) {
                        alert.raise({ key: 'send-error', errorMsg: err.message });
                    } else {
                        alert.clear('send-error');
                    }
                });
            } else {
                log.error("Data ignored as unsuported Google protocol set: " + config.settings.model.database);
                return;
            }
        }
    });
}

sparkGoogleCloudClient.require = function() {
    return ['spark-logging',
        'spark-db',
        'spark-alert',
        'spark-config',
    ];
};

module.exports = sparkGoogleCloudClient;
