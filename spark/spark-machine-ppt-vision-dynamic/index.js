/*jshint esversion: 6 */
var path = require('path');
var EventEmitter = require("events").EventEmitter;
var config = require(path.join(__dirname, 'config.json'));
var pkg = require(path.join(__dirname, 'package.json'));
var async = require('async');
var _ = require('lodash');
var net = require('net');
var camelCase = require('camelcase');

var info = {
    name: pkg.name,
    fullname: pkg.fullname,
    version: pkg.version,
    description: pkg.description
};
config.info = info;

var log;
var db;
var conf;
var alert = null;
var firstStart = true;

var server = null;
var serverSocket = null;

var deliverEntireResultVariable = {
    "name": "CombinedResult",
    "description": "CombinedResult",
    "format": "char",
    "array": true
};

function processPublishedDataCombined(dataString) {

    // split the incoming data into an array assuming comma seperated values
    var csvList = dataString.split(',');
    if (csvList.length < 2) {
        return;
    }

    var combinedResultArray = [];
    for (var i = 0; i < csvList.length; i += 2) {

        var data = {
            name: csvList[i],
            value: csvList[i + 1]
        };

        combinedResultArray.push(data);

    }

    if (combinedResultArray.length) {

        var combinedResultsData = {
            machine: config.info.name,
            variable: "CombinedResult",
            CombinedResult: combinedResultArray
        };

        db.add(combinedResultsData, dbAddResult);
    }

}

function processPublishedData(dataString) {

    var variables = config.variables;

    // split the incoming data into an array assuming comma seperated values
    var csvList = dataString.split(',');

    // first check if there are any variables configured yet
    if (config.variables.length === 0) {

        log.info("Create initial variable list");
        // no variables, we need to parse the data to create them
        parseDataAndCreateVariables(csvList);

    } else {
        // we have variables, check they match with the current data we have been given
        if (checkNewDataMatchesCurrentVariables(csvList)) {

            // if they match, parse and write data to db

            // loop through the stored variable list
            for (var i in variables) {
                var variable = variables[i];

                var data = {
                    machine: config.info.name,
                    variable: variable.name
                };

                // store the data based on TYPE
                var value = convertType(variable.format, csvList[(i*2)+1]);

                data[variable.name] = value;
                db.add(data, dbAddResult);
            }

        } else {
            log.info("Variable change detected, update variable list");

            // else clear variable data, and do as if no variables above
            config.variables = [];
            parseDataAndCreateVariables(csvList);
        }
    }
}

function checkNewDataMatchesCurrentVariables(csvList) {

    // do an initial check to see if the csvList is 2* variable length
    if( csvList.length !== 2 * config.variables.length ) {
        // if its not, then return false straight away
        return false;
    }
    // loop through the stored variable list
    for (var i in config.variables) {
        var expectedVariableName = config.variables[i].name;

        // extract the name we have received
        var variableNameInNewData = csvList[i*2];
        // convert name to camel case (this also removes spaces)
        variableNameInNewData = camelCase(variableNameInNewData);
        // then enforce our naming convention for variables
        variableNameInNewData = variableNameInNewData.replace(/[^a-zA-Z0-9-_]/g, "");

        // now compare to see if we have this variable already (the stored variable name has already been processed as above)
        if (expectedVariableName !== variableNameInNewData) {
            // return false as soon as we get one failed match
            return false;
        }
    }
    return true;
}

function parseDataAndCreateVariables(csvList) {

    // data is expected to be in the form "var1Name,var1Data,var2Name,var2Data...." etc
    // so the comma sperated list should have an even number of entries if valid
    var length = (csvList.length % 2 === 0) ? csvList.length : csvList.length-1;

    for (var i = 0; i < length; i += 2) {
        var variableFormat;
        var expectedName = csvList[i].trim();
        var expectedValue = csvList[i+1].trim();

        // test if data for each variable is an int, float, string or bool
        if ((expectedValue.toLowerCase() === 'true') || (expectedValue.toLowerCase() === 'false')) {
            variableFormat = 'bool';
        } else {
            var numberTestRegex = new RegExp("^[0-9.]*$");

            if (numberTestRegex.test(expectedValue)) {
                if (expectedValue.indexOf('.') !== -1) {
                    variableFormat = 'float';
                } else {
                    variableFormat = 'int32';
                }
            } else {
                variableFormat = 'char';
            }
        }

        // before storing convert name to camel case (this also removes spaces)
        expectedName = camelCase(expectedName);
        // then enforce our naming convention for variables
        expectedName = expectedName.replace(/[^a-zA-Z0-9-_]/g, "");

        // assemble the new variables
        var newVariable = {
            "name": expectedName,
            "description": expectedName,
            "format": variableFormat
        };

        // add the new variable to config list
        config.variables.push(newVariable);
    }

    //  now update the config db store
    conf.set('machines:' + pkg.name + ':variables', config.variables, function(err, model) {
        if (err) {
            return done(err);
        }
    });
}

function convertType(format, resultAsString) {
    if( resultAsString !== null) {
        var result;
        switch( format) {
            case 'char':
            result = resultAsString;
            break;

            case 'int8':
            case 'int16':
            case 'int32':
            case 'int64':
            case 'uint8':
            case 'uint16':
            case 'uint32':
            case 'uint64':
            result = parseInt(resultAsString);
            break;

            case 'float':
            case 'double':
            result = parseFloat(resultAsString);
            break;

            case 'bool':
            result = ((resultAsString.toLowerCase() === 'true') || (resultAsString === '1'));
            break;

            default:
            result = null;
            break;
        }

        return result;
    } else {
        return null;
    }
}

function dbAddResult(err, res) {
    if (err) {
        alert.raise({ key: 'db-add-error', errorMsg: err.message });
    } else {
        alert.clear('db-add-error');
    }
    if (res) log.debug(res);
}

function updateConnectionStatus(connected) {
  conf.set('machines:' + pkg.name + ':settings:model:connectionStatus', connected, () => {});
}

var pptVisionDynamic = new EventEmitter();


function onSetListener(key) {
    // check if anything in the model changes
    var re = new RegExp('machines:' + pkg.name + ':settings:model:(?!connectionStatus)');
    if (re.test(key)) {
        conf.get('machines:' + pkg.name + ':settings:model', function(err, model) {
            log.debug('machines:' + pkg.name + ':settings:model', model);

            if (!_.isEqual(model, config.settings.model)) {
                // if any of the setting have changed
                log.debug('machines:' + pkg.name + ':settings:model changed from', config.settings.model, 'to', model);

                // update our local copy
                config.settings.model = model;

                // request a restart
                pptVisionDynamic.emit('restartRequest', info.name);
            }
        });
    }
}

function writeBackConfig( callback ) {

    // if process has just started up
    if( firstStart === true ) {
        firstStart = false;
        // write back config incase config json file had newer data than config database
        conf.set('machines:' + pkg.name, config, callback);
    } else {
        // other
        return callback();
    }
}


pptVisionDynamic.start = function(modules, done) {

    log = modules['spark-logging'].exports.getLogger(pkg.name);
    db = modules['spark-db'].exports;
    conf = modules['spark-config'].exports;
    alert = modules['spark-alert'].exports.getAlerter(pkg.name);

    alert.preLoad({
        'db-add-error' : {
            msg: 'PPT Vision Dynamic: Database Add Error',
            description: x => `Error adding to the database. Error: ${x.errorMsg}`
        },
        'server-error' : {
            msg: 'PPT Vision Dynamic: Server Error',
            description: x => `Error with underlying TCP server. Error: ${x.errorMsg}`
        },
        'no-client' : {
            msg: 'PPT Vision Dynamic: No Connected Client',
            description: 'There are currently no clients connected. Check the intended client is set to correct ip and port.'
        }
    });

    //listen for changes to the enable key
    //but only add the listener once
    if (conf.listeners('set').indexOf(onSetListener) === -1) {
        log.debug('config.settings.model.enable', config.settings.model.enable);
        conf.on('set', onSetListener);
    }

    updateConnectionStatus(false);

    // read the current settings from the database model
    conf.get('machines:' + pkg.name + ':settings:model', function(err, model) {

        // if there is model data in the db, update to it (e.g. overwrite what was read from readonly file)
        if (model) {
            config.settings.model = model;
        }

        if (config.settings.model.deliverEntireResponse === true) {
            if ((config.variables.length !== 1) || (!_.isEqual(config.variables[0], deliverEntireResultVariable))) {
                // if we're not already set up with the combined-response-variable, set it up and force a database updated
                config.variables = [deliverEntireResultVariable];
                firstStart = true;
            }
        } else {
            if ((config.variables.length === 1) && (_.isEqual(config.variables[0], deliverEntireResultVariable))) {
                // if we WERE set up with the combined-response-variable, clear it and force a database updated
                config.variables = [];
                firstStart = true;
            }
        }

        // save our config if necessary
        writeBackConfig( function(err) {
            if (err) {
                return done(err);
            }

            // check enable state before continuing
            if (!config.settings.model.enable) {
                log.info('Disabled');
                return done(null, config.info);
            } else {
                alert.raise({ key: 'no-client'});

                // create the server
                server = net.createServer(function(socket) {
                    // client succesfully connected our server
                    updateConnectionStatus(true);

                    // if we are already connected to a client, close it
                    if (serverSocket !== null) {
                        log.info('closing socket with client: ' + serverSocket.remoteAddress);
                        serverSocket.destroy();
                    }

                    alert.clear('no-client');
                    log.info('Connected to client: ' + socket.remoteAddress);

                    // store a reference to the socket (so we can destroy it if we need to close the server)
                    serverSocket = socket;

                    // subscribe to on 'data' events
                    socket.on('data', function(data) {
                        // got data from client, pass string version to process function
                        if (config.settings.model.deliverEntireResponse === true) {
                            processPublishedDataCombined(data.toString().trim());
                        } else {
                            processPublishedData(data.toString().trim());
                        }
                    });

                    // subscribe to on 'error' events
                    socket.on('error', (error) => {
                      // emit a disconnect back to the spark machine layer
                      log.info('Server error: ' + error.message);
                      socket.destroy();
                      serverSocket = null;
                      updateConnectionStatus(false);
                      // raise alert to notify client disconnects
                      alert.raise({ key: 'no-client'});
                    });

                    // subscribe to on 'end' events
                    socket.on('end', function() {
                        // emit a disconnect back to the spark machine layer
                        log.info('Client disconnected');
                        socket.destroy();
                        serverSocket = null;
                        updateConnectionStatus(false);
                        alert.raise({ key: 'no-client'});
                    });

                }).listen(config.settings.model.port);

                server.on('error', function(err){
                    alert.raise({ key: 'server-error', errorMsg: err.message });
                });
                // we do not wait for a client connection to declare 'start' a success
                log.info('Started', pkg.name);
                return done(null, config.info);
            }
        });
    });
};

pptVisionDynamic.stop = function(done) {

    if (server) {
        server.close(function() {
            // callback only trigger when all sockets have been destroyed
            log.info('Stopped', pkg.name);
            server = null;
            updateConnectionStatus(false);
            alert.clearAll(function(){
                return done(null);
            });
        });

        // if server has an active connection, the socket used must also be destoyed for the above close to be succesful
        if (serverSocket !== null) {
            serverSocket.destroy();
            serverSocket = null;
        }
    } else {
        alert.clearAll(function(){
            return done(null);
        });
    }
};

pptVisionDynamic.require = function() {
    return ['spark-logging',
        'spark-db',
        'spark-alert',
        'spark-config'
    ];
};

module.exports = pptVisionDynamic;
