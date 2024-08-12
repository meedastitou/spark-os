/*jshint esversion: 6 */
var path = require('path');
var EventEmitter = require("events").EventEmitter;
var config = require(path.join(__dirname, 'config.json'));
var pkg = require(path.join(__dirname, 'package.json'));
var async = require('async');
var _ = require('lodash');
var http = require('http');
var DOMParser = require('xmldom').DOMParser;

var info = {
    name: pkg.name,
    fullname: pkg.fullname,
    version: pkg.version,
    description: pkg.description
};
config.info = info;

const INIT_FORCE_CREATE_VAR_TIME = 60 * 1000; // 1 minute

var probeOptions = {
    hostname: '127.0.0.1',
    port: 5000,
    path: '/probe'
};

var currentOptions = {
    hostname: '127.0.0.1',
    port: 5000,
    path: '/current'
};

var log;
var db;
var conf;
var alert = null;
var firstStart = true;

var variableList = [];
var recreateVariableListFlag = false;
var requestTimer = null;

var mtconnect = new EventEmitter();
var probeReq = null;
var currentReq = null;
let forceInitCreateVariableListFlag = false;

function onSetListener(key) {
    // check if anything in the model changes
    var re = new RegExp('machines:' + pkg.name + ':settings:model:*');
    if (re.test(key)) {
        conf.get('machines:' + pkg.name + ':settings:model', function(err, model) {
            log.debug('machines:' + pkg.name + ':settings:model', model);

            if (!_.isEqual(model, config.settings.model)) {
                // if any of the setting have changed
                log.debug('machines:' + pkg.name + ':settings:model changed from', config.settings.model, 'to', model);

                // update our local copy
                config.settings.model = model;

                // request a restart
                mtconnect.emit('restartRequest', info.name);
            }
        });
    }
}

// return true if more than one unique device name
function MoreThanOneUniqueDevice(deviceList) {
    if (deviceList.length < 2) return false;

    var firstDeviceName = deviceList[0].getAttribute('name');
    for (var deviceListIndex = 0; deviceListIndex < deviceList.length; deviceListIndex++) {
        if (deviceList[deviceListIndex].getAttribute('name') !== firstDeviceName) return true;
    }

    return false;
}

function FindNameInVariableList(nameToCheck) {
    // iterate through our variable list to look for a match.
    // return the index of the match, or variableList.length for no match.
    for (var variableIndex = 0; variableIndex < variableList.length; variableIndex++) {

        if (nameToCheck === variableList[variableIndex].name) {
            return variableIndex;
        }

    } // for (var variableIndex = 0; variableIndex < variableList.length; variableIndex++) {

    return -1;

}
function parseProbeXMLAndCreateVariableList(xmlString) {
    var probeDoc = new DOMParser().parseFromString(xmlString);

    // get a list of all devices
    var deviceList = probeDoc.documentElement.getElementsByTagName('Device');
    var multipleDevices = MoreThanOneUniqueDevice(deviceList);
    for (var deviceListIndex = 0; deviceListIndex < deviceList.length; deviceListIndex++) {
        // if more than one device, get the device name to prepend to the names
        var deviceName = '';
        if (multipleDevices) {
            deviceName = deviceList[deviceListIndex].getAttribute('name');
            if (deviceName !== '') deviceName = deviceName + '-';
        }

        var dataItemList = deviceList[deviceListIndex].getElementsByTagName('DataItem');

        for (var dataItemListIndex = 0; dataItemListIndex < dataItemList.length; dataItemListIndex++) {
            var category = dataItemList[dataItemListIndex].getAttribute('category');
            if ((category === 'SAMPLE') || (category === 'EVENT')) {
                var name = dataItemList[dataItemListIndex].getAttribute('name');
                var units = dataItemList[dataItemListIndex].getAttribute('units');
                if (units !== '') units = '-' + units;
                if (name !== '') {
                    // assemble the new variables
                    name = deviceName + name;
                    var newVariable = {
                        "name": name,
                        "description": name + units,
                        "format": 'unknown',
                        "value": 'unknown',
                        "databaseUpdateFlag": false
                    };

                    // add variable to list only if it is not already present
                    if (FindNameInVariableList(name) < 0) {
                        variableList.push(newVariable);
                    }
                }
            }
        }
    }

    log.debug('variableList created from probe response:' + JSON.stringify(variableList));

}

function RequestProbeError(err) {
    requestTimer = setTimeout(requestProbe, 5000); // try again to connect to the agent in 5 seconds.
    alert.raise({ key: 'connection-error', errorMsg: err.message });
}

function requestProbe() {
    // send out the request for the mtconnect agent's 'probe' values.
    // use these to build our variable list that will in turn be used to
    // add the variables to the database after we receive current values.
    probeOptions.hostname = config.settings.model.ipAddress;
    probeOptions.port = config.settings.model.port;
    if (probeReq) {
      probeReq.abort(); // make sure we close out any exisiting request.
    }
    probeReq = http.request(probeOptions, function(res) {
        res.setEncoding('utf8');

        // incrementally capture the incoming response body
        var body = '';
        res.on('data', function(d) {
            body += d;
        });

        res.on('end', function() {
            // we've reached the end of the response.
            parseProbeXMLAndCreateVariableList(body);
            alert.clear('connection-error');
            requestCurrent();
        });
    });

    if (probeReq.listeners('error').indexOf(RequestProbeError) === -1) {
        probeReq.on('error', RequestProbeError);  // only allow a single listener
    }

    // write data to request body
    probeReq.write('');
    probeReq.end();
}

function GetVariableFormartFromValue(newValue) {
    var variableFormat = 'char';

    if ((newValue.toLowerCase() === 'true') || (newValue.toLowerCase() === 'false')) {
        variableFormat = 'bool';
    } else {
        var numberTestRegex = new RegExp("^[0-9.]*$");

        if (numberTestRegex.test(newValue)) {
            if (newValue.indexOf('.') !== -1) {
                variableFormat = 'float';
            } else {
                variableFormat = 'int32';
            }
        }
    }
    return variableFormat;
}

function RecreateDatabaseVariableList() {
    config.variables = [];

    // go through our variable list and add anything with a datatype (.format) to the database
    for (var variableIndex = 0; variableIndex < variableList.length; variableIndex++) {

        if (variableList[variableIndex].format !== 'unknown') {
            // assemble the new variables
            var newVariable = {
                "name": variableList[variableIndex].name,
                "description": variableList[variableIndex].description,
                "format": variableList[variableIndex].format
            };

            // add the new variable to config list
            config.variables.push(newVariable);
        }

    } // for (var variableIndex = 0; variableIndex < variableList.length; variableIndex++) {

    //  now update the config db store
    conf.set('machines:' + pkg.name + ':variables', config.variables, function(err, model) {
        if (err) {
            return done(err);
        }

        log.info("Updated variable list");
    });
}

function convertType(format, resultAsString) {
    if (resultAsString !== null) {
        var result;
        switch (format) {
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

function addVariablesToList(docElements, deviceName) {
    // iterate through each of these 'Samples' entries.
    for (docElementIndex = 0; docElementIndex < docElements.length; docElementIndex++) {

        var docElement = docElements[docElementIndex]; // get the individual sample entry we're going to examine.

        // iterate through each of the childNodes of this sample, since there may be several actual samples in the entry.
        for (var childNodeIndex = 0; childNodeIndex < docElement.childNodes.length; childNodeIndex++) {

            var childNode = docElement.childNodes[childNodeIndex]; // get the individual childNode to examine.

            // if the child node has an attributes field, we can examine it for a variable match.
            if (childNode.attributes !== null) {
                // iterate through each of its attribute fields to check for a variable name match.
                for (var attributeIndex = 0; attributeIndex < childNode.attributes.length; attributeIndex++) {

                    if (childNode.attributes[attributeIndex].name === 'name') {
                        var variableListIndex = FindNameInVariableList(deviceName + childNode.attributes[attributeIndex].value);
                        if (variableListIndex < 0) {
                            // this variable isn't in our list, so we need to recreate the list
                            log.info("Variable change detected, update variable list");

                            // else clear variable data, and do as if no variables above
                            config.variables = [];
                            variableList = [];
                            requestProbe();

                            // return false, must reinitialize variable list
                            return false;
                        } else if (childNode.childNodes.length > 0) {
                            var newValue = childNode.childNodes[0].nodeValue;
                            if (newValue !== "UNAVAILABLE") {
                                if (variableList[variableListIndex].format === 'unknown') {
                                    // we didn't have a datatype for this before.  set our flag to recreate the variable list.
                                    // do the actual recreate later in case there are multiple changes.
                                    variableList[variableListIndex].format = GetVariableFormartFromValue(newValue);
                                    recreateVariableListFlag = true;
                                }
                                variableList[variableListIndex].value = newValue;
                                variableList[variableListIndex].databaseUpdateFlag = true;
                            }
                        }

                    } // if (childNode.attributes[attributeIndex].name === 'name') {
                } // for (var attributeIndex = 0; attributeIndex < childNode.attributes.length; attributeIndex++) {
            } // if (childNode.attributes !== null) {
        } // for (var childNodeIndex = 0; childNodeIndex < docElement.childNodes.length; childNodeIndex++) {
    } // for (docElementIndex = 0; docElementIndex < docElements.length; docElementIndex++) {

    // return true, no need to reinitialize variable list
    return true;
}

function parseCurrentXML(xmlString) {
    // go through the response to the 'current' request and see if we have updated variables.
    var currentDoc = new DOMParser().parseFromString(xmlString);
    recreateVariableListFlag = forceInitCreateVariableListFlag;

    // get a list of all devices
    var deviceList = currentDoc.getElementsByTagName('DeviceStream');
    var multipleDevices = MoreThanOneUniqueDevice(deviceList);
    for (var deviceListIndex = 0; deviceListIndex < deviceList.length; deviceListIndex++) {
        // if more than one device, get the device name to prepend to the names
        var deviceName = '';
        if (multipleDevices) {
            deviceName = deviceList[deviceListIndex].getAttribute('name');
            if (deviceName !== '') deviceName = deviceName + '-';
        }

        // first, get all of the 'Samples' entries in the xml doc.  These will reflect the current values of variables.
        if (!addVariablesToList(deviceList[deviceListIndex].getElementsByTagName('Samples'), deviceName)) return;

        // next, get all of the 'Event' entries in the xml doc.  These will reflect the current values of variables.
        if (!addVariablesToList(deviceList[deviceListIndex].getElementsByTagName('Events'), deviceName)) return;
    }

    if (recreateVariableListFlag) {
        forceInitCreateVariableListFlag = false;
        RecreateDatabaseVariableList();
    }

    // finally, go through all of our variables and see if any need a database update
    for (var variableIndex = 0; variableIndex < variableList.length; variableIndex++) {

        if (variableList[variableIndex].databaseUpdateFlag) {
            var data = {
                machine: config.info.name,
                variable: variableList[variableIndex].name
            };
            // store the data based on TYPE
            var value = convertType(variableList[variableIndex].format, variableList[variableIndex].value);

            data[variableList[variableIndex].name] = value;
            db.add(data, dbAddResult);

            variableList[variableIndex].databaseUpdateFlag = false;
        }

    } // for (var variableIndex = 0; variableIndex < variableList.length; variableIndex++) {

}

function RequestCurrentError(err) {
    alert.raise({ key: 'connection-error', errorMsg: err.message});
}

function requestCurrent() {
    // send out the request for the mtconnect agents 'current' values.
    currentOptions.hostname = config.settings.model.ipAddress;
    currentOptions.port = config.settings.model.port;
    if (currentReq) {
      currentReq.abort(); // make sure we close out any exisiting request.
    }
    currentReq = http.request(currentOptions, function(res) {
        res.setEncoding('utf8');

        // incrementally capture the incoming response body
        var body = '';
        res.on('data', function(d) {
            body += d;
        });

        res.on('end', function() {
            // we've reached the end of the response.
            parseCurrentXML(body);
            alert.clear('connection-error');
        });
    });

    if (currentReq.listeners('error').indexOf(RequestCurrentError) === -1) {
        currentReq.on('error', RequestCurrentError);  // only allow a single listener
    }

    // write data to request body
    currentReq.write('');
    currentReq.end();

    requestTimer = setTimeout(requestCurrent, config.settings.model.requestFrequency * 1000);

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

mtconnect.start = function(modules, done) {

    log = modules['spark-logging'].exports.getLogger(pkg.name);
    db = modules['spark-db'].exports;
    conf = modules['spark-config'].exports;
    alert = modules['spark-alert'].exports.getAlerter(pkg.name);

    alert.preLoad({
        'connection-error': {
            msg: 'MTConnect: Connection Error',
            description: x => `Problem communicating with MTConnect Agent. Error: ${x.errorMsg}. Check ip and port of chosen agent.`
        },
        'db-add-error' : {
            msg: 'MTConnect: Database Add Error',
            description: x => `Error adding to the database. Error: ${x.errorMsg}`
        }
    });

    // if first start, force variables to be recreated after 2 minutes
    // this is in case OPC-UA missed the initial variable creation
    if (firstStart) {
        setTimeout(() => {
            forceInitCreateVariableListFlag = true;
        }, INIT_FORCE_CREATE_VAR_TIME);
    }

    //listen for changes to the config settings
    //but only add the listener once
    if (conf.listeners('set').indexOf(onSetListener) === -1) {
        log.debug('config.settings.model', config.settings.model);
        conf.on('set', onSetListener);
    }

    // read the current settings from the database model
    conf.get('machines:' + pkg.name + ':settings:model', function(err, model) {

        // if there is model data in the db, update to it (e.g. overwrite what was read from readonly file)
        if (model) {
            config.settings.model = model;
        }

        // save our config if necessary
        writeBackConfig( function(err) {
            if (err) {
                return done(err);
            }

            // check enable state before continuing
            if (!config.settings.model.enable) {
                log.info('MTConnect-Disabled');
                return done(null, config.info);
            } else {
                // if it has been a long time since the initial start, there is no need
                // to force the variable to be recreated
                forceInitCreateVariableListFlag = false;

                if (requestTimer) {
                    clearTimeout(requestTimer); // if we had a timer running, cancel it
                }
                requestProbe();
                log.info('MTConnect-Started', pkg.name);
                return done(null, config.info);
            }
        });
    });
};

mtconnect.stop = function(done) {

    if (requestTimer) {
        clearTimeout(requestTimer); // if we had a timer running, cancel it
    }
    log.info('Stopped', pkg.name);
    alert.clearAll(function(){
        return done(null);
    });
};

mtconnect.require = function() {
    return ['spark-logging',
        'spark-db',
        'spark-alert',
        'spark-config'
    ];
};

module.exports = mtconnect;
