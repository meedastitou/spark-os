var path = require('path');
var fs = require('fs');
var EventEmitter = require("events").EventEmitter;
var pkg = require(path.join(__dirname, 'package.json'));
var chokidar = require('chokidar');
var _ = require("lodash");
var async = require("async");
var glob = require("glob");
var Ajv = require('ajv');
var ajv = Ajv({
    allErrors: true,
    unknownFormats: ['tabs']
});

//available hpl
var sparkHpl = {};

var schemas = {
    hpl: require(path.join(__dirname, 'schemas', 'hpl.json'))
};

var validateHpl = {
    hpl: ajv.compile(schemas.hpl)
};

var config = {
    info: {
        name: pkg.name,
        fullname: pkg.fullname,
        version: pkg.version,
        description: pkg.description,
    }
};

const machineDefPattern = '/**/*.json';

var log;
var db;
var conf;
var hpls = {};
var watcher;
var searchDirs = [];

var averageCounts = {};
let onChangeLastValue = {};
var downsampleCount = {};
let onChangeTimer = {};
let onChangeTimeoutFlag = {};
let onStateChangeIgnoreTrueTimer = {};
let onStateChangeIgnoreFalseTimer = {};
let writeReqListenerAdded = false;

var sparkMachineHpl = new EventEmitter();

function findMachines(searchDirs, done) {
    async.map(searchDirs, function(searchDir, cb) {
            glob(searchDir + machineDefPattern, {
                ignore: '/**/package.json'
            }, function(err, files) {
                return cb(err, files);
            });
        },
        function(err, result) {
            return done(err, _.flatten(result));
        });
}

function readJsonFile(file, done) {
    fs.readFile(file, 'utf8', function(err, data) {
        if (err) {
            return done(err);
        }

        var obj;
        try {
            obj = JSON.parse(data);
        } catch (err2) {
            err2.message = file + ': ' + err2.message;
            return done(err2);
        }

        done(null, obj);
    });
}

function readMachine(file, done) {
    readJsonFile(file, function(err, contents) {
        if (err) {
            return done(err);
        }

        //check the JSON is valid against the schema
        var valid = validateHpl.hpl(contents);
        if (!valid) {
            return done(ajv.errorsText(validateHpl.hpl.errors));
        } else {
            return done(null, contents);
        }
    });
}

function loadHpl(machine, done) {
    conf.get('machines:' + machine.info.name + ':settings:model', function(err, model) {

        var err2 = null;
        var hpl = null;
        try {
            //validate the machine against the schema
            var valid = validateHpl[machine.info.hpl](machine);
            if (!valid) {
                throw new Error(ajv.errorsText(validateHpl[machine.info.hpl].errors));
            }

            //create a new instance of the required hpl
            //and pass any existing model data
            hpl = new sparkHpl[machine.info.hpl].hpl(log.child({
                machine: machine.info.name
            }), machine, model, conf, db, alert.getAlerter(machine.info.name));
        } catch (e) {
            err2 = e;
            hpl = null;
        }

        return done(err2, hpl);
    });
}

function startHplDataCb(machine, variable, value, done) {

    var isArray = false;
    if (variable.hasOwnProperty('array')) {
        if ((variable.array) && _.isArray(value)) {
            isArray = true;
        }
    }

    // pre-check on change to allow the property to have been added, but have been set to false
    let hasOnChangeEnabled = false;
    let hasOnChangeDelta = false;
    let hasOnChangeTimeoutEnable = false;
    let onChangeTimeoutValue = null;
    let hasOnChangeTimeoutConditionalEnable = false;
    let onChangeTimeoutConditionalValue = null;
    let hasOnStateChangeTimerEnable = 'disable';
    let onStateChangeIgnoreTimer = 0;

    if (variable.hasOwnProperty('onChange'))  {
        hasOnChangeEnabled = variable.onChange;
        if((variable.onChangeDelta !== undefined) && !isArray && _.isInteger(value)){
            hasOnChangeDelta = true;
        }
        if (_.get(variable, 'onChangeTimeoutEnable', false)) {
            hasOnChangeTimeoutEnable = true;
            onChangeTimeoutValue = _.get(variable, 'onChangeTimeoutValue', 0);
            hasOnChangeTimeoutConditionalEnable = _.get(variable, 'onChangeTimeoutConditionalEnable', false);
            let onChangeTimeoutConditionalValueString = _.get( variable, 'onChangeTimeoutConditionalValue', '');
            // convert the string conditional value to the type of the variable value
            switch (typeof value) {
              case 'number':
                onChangeTimeoutConditionalValue = parseFloat(onChangeTimeoutConditionalValueString);
                break;
              case 'boolean':
                onChangeTimeoutConditionalValue = (onChangeTimeoutConditionalValueString.toLowerCase().trim() === 'true');
                break;
              default:
                onChangeTimeoutConditionalValue = onChangeTimeoutConditionalValueString;
            }
        }
        hasOnStateChangeTimerEnable = _.get(variable, 'onStateChangeIgnoreTimerEnable', 'disable');
        if (hasOnStateChangeTimerEnable !== 'disable') {
            onStateChangeIgnoreTimer = _.get(variable, 'onStateChangeIgnoreTimer', 0);
        }
    }

    /* check if variable should only be written 'on change' */
    if ( hasOnChangeEnabled === true) {
        // initialize stores if not set
        if (!_.has(onChangeLastValue, machine.info.name)) {
            onChangeLastValue[machine.info.name] = {};
        }
        if (!_.has(onChangeLastValue[machine.info.name], variable.name)) {
            onChangeLastValue[machine.info.name][variable.name] = undefined;
        }
        if (!_.has(onChangeTimer, machine.info.name)) {
            onChangeTimer[machine.info.name] = {};
        }
        if (!_.has(onChangeTimer[machine.info.name], variable.name)) {
            onChangeTimer[machine.info.name][variable.name] = null;
        }
        if (!_.has(onChangeTimeoutFlag, machine.info.name)) {
            onChangeTimeoutFlag[machine.info.name] = {};
        }
        if (!_.has(onChangeTimeoutFlag[machine.info.name], variable.name)) {
            onChangeTimeoutFlag[machine.info.name][variable.name] = false;
        }
        if (!_.has(onStateChangeIgnoreTrueTimer, machine.info.name)) {
            onStateChangeIgnoreTrueTimer[machine.info.name] = {};
        }
        if (!_.has(onStateChangeIgnoreTrueTimer[machine.info.name], variable.name)) {
            onStateChangeIgnoreTrueTimer[machine.info.name][variable.name] = null;
        }
        if (!_.has(onStateChangeIgnoreFalseTimer, machine.info.name)) {
            onStateChangeIgnoreFalseTimer[machine.info.name] = {};
        }
        if (!_.has(onStateChangeIgnoreFalseTimer[machine.info.name], variable.name)) {
            onStateChangeIgnoreFalseTimer[machine.info.name][variable.name] = null;
        }

        // if currently ignoring this boolean state, don't write to the database
        if (value) {
            if (onStateChangeIgnoreTrueTimer[machine.info.name][variable.name]) {
                if (done) { return done(null); } else { return;}
            }
        } else if (onStateChangeIgnoreFalseTimer[machine.info.name][variable.name]) {
            if (done) { return done(null); } else { return;}
        }

        // if the variable has changed in value
        if (!_.isEqual(onChangeLastValue[machine.info.name][variable.name], value)) {
            if ((hasOnChangeDelta)&&(onChangeLastValue[machine.info.name][variable.name] != undefined)) {
                if(Math.abs(onChangeLastValue[machine.info.name][variable.name] - value) >= variable.onChangeDelta){
                    //update the last change if it is greater than the threshold value
                    onChangeLastValue[machine.info.name][variable.name] = value;
                    onChangeTimeoutFlag[machine.info.name][variable.name] = false;
                }
                else{
                    // write the value to db if 'onChangeTimer' is triggered, irrespective of change in the value
                    if (onChangeTimeoutFlag[machine.info.name][variable.name]) {
                        // if there is no on change timer condition or it is met, write to the database
                        if (!hasOnChangeTimeoutConditionalEnable || (onChangeTimeoutConditionalValue === value)) {
                          onChangeLastValue[machine.info.name][variable.name] = value;
                          onChangeTimeoutFlag[machine.info.name][variable.name] = false;
                        }
                        // if the on change timer condition is not met, don't write to the database
                        else {
                          if (done) { return done(null); } else { return;}
                        }
                    }
                    else {
                        // no change greater than threshold and no on change timeout, so don't write the new value to the db
                        if (done) { return done(null); } else { return;}
                    }
                }
            }
            else{
                //  update the last change value, and we will proceed to write to db
                onChangeLastValue[machine.info.name][variable.name] = value;
                onChangeTimeoutFlag[machine.info.name][variable.name] = false;
            }
        } else {
            // write the value to db if 'onChangeTimer' is triggered, irrespective of change in the value
            if (onChangeTimeoutFlag[machine.info.name][variable.name]) {
                // if there is no on change timer condition or it is met, write to the database
                if (!hasOnChangeTimeoutConditionalEnable || (onChangeTimeoutConditionalValue === value)) {
                  onChangeTimeoutFlag[machine.info.name][variable.name] = false;
                }
                // if the on change timer condition is not met, don't write to the database
                else {
                  if (done) { return done(null); } else { return;}
                }
            }
            else {
                // no change and no on change timeout, so don't write the new value to the db
                if (done) { return done(null); } else { return;}
            }
        }

        // if ingoring state changes, start the true or false timer to ingore
        if (hasOnStateChangeTimerEnable !== 'disable') {
            if (value) {
                if (hasOnStateChangeTimerEnable !== 'enable for false') {
                  onStateChangeIgnoreTrueTimer[machine.info.name][variable.name] = setTimeout(() => {
                      onStateChangeIgnoreTrueTimer[machine.info.name][variable.name] = null;
                  }, onStateChangeIgnoreTimer * 1000);
                }
            } else {
              if (hasOnStateChangeTimerEnable !== 'enable for true') {
                onStateChangeIgnoreFalseTimer[machine.info.name][variable.name] = setTimeout(() => {
                    onStateChangeIgnoreFalseTimer[machine.info.name][variable.name] = null;
                }, onStateChangeIgnoreTimer * 1000);
              }
            }
        }

        // if on change timeout enabled, restart the timer since writing to the database
        if (hasOnChangeTimeoutEnable) {
            if (onChangeTimer[machine.info.name][variable.name]) {
              clearTimeout(onChangeTimer);
            }
            onChangeTimer[machine.info.name][variable.name] = setTimeout(function resetOnChangeTimeoutFlag() {
                onChangeTimer[machine.info.name][variable.name] = null;
                onChangeTimeoutFlag[machine.info.name][variable.name] = true;
            }, onChangeTimeoutValue * 1000);
        }
    }
    /* check if variable should only be written over an 'averaging period' */
    else if ((variable.hasOwnProperty('averageLength')) && (isArray === false)) {
        // initialize store if not set
        if (!averageCounts.hasOwnProperty(machine.info.name)) {
            averageCounts[machine.info.name] = {};
        }
        if (!averageCounts[machine.info.name].hasOwnProperty(variable.name)) {
            averageCounts[machine.info.name][variable.name] = {};
            averageCounts[machine.info.name][variable.name].accumulator = 0;
            averageCounts[machine.info.name][variable.name].counter = 0;
        }

        // update average count and accumulator
        averageCounts[machine.info.name][variable.name].counter++;
        averageCounts[machine.info.name][variable.name].accumulator += parseFloat(value);

        // if we have the right amount of data to average
        if (averageCounts[machine.info.name][variable.name].counter >= variable.averageLength) {

            // perform the average calculation
            value = averageCounts[machine.info.name][variable.name].accumulator / variable.averageLength;
            // round to an integer if an integer is expected, and we will proceed to write to db
            if ((variable.format !== 'float') && (variable.format !== 'double')) {
                value = Math.round(value);
            }
            // reset the count and accumulator
            averageCounts[machine.info.name][variable.name].accumulator = 0;
            averageCounts[machine.info.name][variable.name].counter = 0;
        } else {
            // not ready yet, so don't write the new value to the db
            if (done) { return done(null); } else { return;}
        }
    }
    /* check if variable should only be written over a 'downsample period' */
    else if (variable.hasOwnProperty('downsampleSize')) {
        // initialize store if not set
        if (!downsampleCount.hasOwnProperty(machine.info.name)) {
            downsampleCount[machine.info.name] = {};
        }
        if (!downsampleCount[machine.info.name].hasOwnProperty(variable.name)) {
            downsampleCount[machine.info.name][variable.name] = 0;
        }

        // update the counter
        downsampleCount[machine.info.name][variable.name]++;
        // if we have the skipped the right amount of data
        if (downsampleCount[machine.info.name][variable.name] >= variable.downsampleSize) {
            // reset the counter, and we will proceed to write to db
            downsampleCount[machine.info.name][variable.name] = 0;
        } else {
            // not ready yet, so don't write the new value to the db
            if (done) { return done(null); } else { return;}
        }
    }
    /* check if variable should only be written when outside upper and lower thresholds */
    else if ((variable.hasOwnProperty('thresholdLower')) && (variable.hasOwnProperty('thresholdUpper')) && (isArray === false)) {

        // test to see if source value is within bounds
        if((value >= variable.thresholdLower) && (value <= variable.thresholdUpper)) {
            // yes, so don't write the new value to the db
            if (done) { return done(null); } else { return;}
        }
    }

    /* check if there is a mid string property we need to process*/
    if(variable.hasOwnProperty('midString')) {
        let midStringValue;
        if(isArray) {
            midStringValue = [];
            for(let i = 0; i<value.length; i+=1) {
                let x = value[i];
                if(_.isString(x)) {
                    let valLength = x.length;
                    let start = (variable.midString.start <= 0 )? 1: variable.midString.start;
                    if(start > valLength) {
                        midStringValue.push(x);
                        log.warn('start position of the Mid String property is invalid ',variable.midString, );
                    }
                    else{
                        let length = (variable.midString.length <= 0 || ((start + variable.midString.length -1) > valLength) )? (valLength-start+1): variable.midString.length;
                        x = x.substr(start -1, length);
                        midStringValue.push(x);
                    }
                }
                else{
                    midStringValue.push(x);
                }
            }
            value = midStringValue;
            log.debug({
                value: value
            });
        }
        else{
            if(_.isString(value)) {
                let valLength = value.length;
                let start = (variable.midString.start <= 0 )? 1: variable.midString.start;
                if(start > valLength) {
                    log.warn('start position of the Mid String property is invalid ',variable.midString);
                    log.debug({
                        value: value
                    });
                }
                else{
                    let length = (variable.midString.length <= 0 || ((start + variable.midString.length -1) > valLength) )? (valLength-start+1): variable.midString.length;
                    value = value.substr(start -1, length);
                    log.debug({
                        value: value
                    });
                }
            }
        }
    }
    /* check if there is a string replacement property we need to process*/
    if(variable.hasOwnProperty('stringReplace')) {
      let replacePatternType = _.get(variable, 'stringReplace.replacePatternType', 'no replacement');
      if (replacePatternType === 'string') {
        // replace ALL instances, not just first and allow for special characters
        value = value.toString().split(_.get(variable, 'stringReplace.replacePatternString', '')).join(_.get(variable, 'stringReplace.replacementString', ''));
      }
      else if (replacePatternType === 'regex') {
        value = value.toString().replace(RegExp(_.get(variable, 'stringReplace.replacePatternRegex', ''), 'g'), _.get(variable, 'stringReplace.replacementString', ''));
      }
    }

    /* check if there is a transform equation that we need to process */
    if (variable.hasOwnProperty('transformEq')) {
        if (variable.transformEq.length > 0) {
            var transformedEqValue;
            var x;
            try {
                if (isArray) {
                    transformedEqValue = [];
                    for(var i=0; i<value.length; i++) {
                        x = value[i];
                        /* jshint -W061 */
                        transformedEqValue.push(eval(variable.transformEq));
                        /* jshint +W061 */
                    }
                } else {
                    x = value;
                    /* jshint -W061 */
                    transformedEqValue = eval(variable.transformEq);
                    /* jshint +W061 */
                }
            } catch (e) {
                log.warn("Failed processing transform equation", variable.transformEq, e);
                transformedEqValue = value;
            }
            value = transformedEqValue;
        }
    }

    /* check if there is a transform map that we need to process */
    if (variable.hasOwnProperty('transformMap')) {
        log.debug({
            transformMap: variable.transformMap,
            value: value
        });
        if (Object.keys(variable.transformMap).length > 0) {
            var transformedMapValue;
            try {
                if (isArray) {
                    transformedMapValue = [];
                    for(var j=0; j<value.length; j++) {
                        if (variable.transformMap.hasOwnProperty(value[j])) {
                            if (_.isString(value[j])) {
                                transformedMapValue.push(variable.transformMap[value[j]]);
                            } else {
                                transformedMapValue.push(variable.transformMap[value[j].toString()]);
                            }
                        } else {
                            if(variable.transformMap.hasOwnProperty('else')) {
                                value = variable.transformMap.else;
                            }
                            //The value is missing in the transformMap, don't do any transform
                            if (outputFormat === 'char') {
                                transformedMapValue.push(value[j].toString());
                            } else {
                                transformedMapValue.push(value[j]);
                            }
                        }
                    }
                } else {
                    if (variable.transformMap.hasOwnProperty(value)) {
                        if (_.isString(value)) {
                            transformedMapValue = variable.transformMap[value];
                        } else {
                            transformedMapValue = variable.transformMap[value.toString()];
                        }
                    } else {
                        if(variable.transformMap.hasOwnProperty('else')) {
                            value = variable.transformMap.else;
                        }
                        //The value is missing in the transformMap, don't do any transform
                        if (outputFormat === 'char') {
                            transformedMapValue = value.toString();
                        } else {
                            transformedMapValue = value;
                        }
                    }
                }
            } catch (e) {
                log.warn("Failed processing transform map", variable.transformMap, e);
                transformedMapValue = value;
            }
            value = transformedMapValue;
            log.debug({
                value: value
            });
        }
    }

    var outputFormat = variable.format;
    if (variable.hasOwnProperty('outputFormat')) {
        outputFormat = variable.outputFormat;
        let formattedValue;
        if(variable.format == 'char' && outputFormat != 'char') {
            if (outputFormat == 'float' || outputFormat == 'double') {
                if (isArray) {
                    formattedValue = [];
                    for (let j = 0; j < value.length; j++) {
                        formattedValue.push(parseFloat(value[j]));
                    }
                }
                else{
                    formattedValue = parseFloat(value);
                }
                value = formattedValue;
            }
            else {
                if (isArray) {
                    formattedValue = [];
                    if(outputFormat == 'bool') {
                        for (let j = 0; j < value.length; j++) {
                            formattedValue.push(parseInt(value[j],10));
                        }
                    }
                    else {
                        for (let j = 0; j < value.length; j++) {
                            formattedValue.push(((value[j] > 0)?true: false));
                        }
                    }
                }
                else {
                    formattedValue = parseInt(value,10);
                    if(outputFormat == 'bool') {
                        formattedValue = (value > 0)? true: false;
                    }
                }
                value = formattedValue;
            }
        }
        else if(variable.format != 'char' && outputFormat == 'char') {
            // To update the non-char format to char format
            let formattedValue;
            if (isArray) {
                formattedValue = [];
                for (let j = 0; j < value.length; j++) {
                    formattedValue.push(value[j].toString());
                }
            }
            else {
                formattedValue = value.toString();
            }
            value = formattedValue;
        }
    }

    /* check if there is a array variable need to be reversed */
    if (variable.hasOwnProperty('reverseArray') && (isArray === true)) {
        if (variable.reverseArray) {
            value = _.reverse(value);
        }
    }

    /* create the data object */
    var data = {
        machine: machine.info.name,
        variable: variable.name,
        access: variable.access || 'read'
    };
    data[variable.name] = value;

    /* write the data to the database */
    db.add(data, function(err, res) {
        if (done) {
            return done(err, res);
        } else {
            if (err) log.error(err);
            if (res) log.debug(res);
        }
    });
}

function writeReqListener(key, done) {
    db.get(key, function(err, value) {
        if (err) {
            log.error({
                err: err,
                key: key
            }, 'Error fetching variable for ' + key.machine);
            return;
        } else if (_.has(hpls, value.machine)) {
            var hpl = hpls[value.machine];
            if (typeof hpl.writeData === 'function') {
                hpl.writeData(value, function(err) {
                    return;
                });
            } else {
                log.error({err: "HPL " + hpl.machine.info.name + " lacks writeData function"});
            }
        }
    });
}

function startHplConfigUpdateCb(machine, done) {
    //save the machine config
    conf.set('machines:' + machine.info.name, machine, function(err) {
        return done(err);
    });
}

function startHpl(hpl, done) {
    hpl.start(startHplDataCb, startHplConfigUpdateCb,
        function(err) {
            log.debug("Started: " + hpl.machine.info.name);

            //save the machine config
            conf.set('machines:' + hpl.machine.info.name, hpl.machine, function(err) {
                return done(err, hpl);
            });
        });
}

function stopHpl(hpl, done) {
    // stop any on change timers for this machine
    if (_.has(onChangeTimer, hpl.machine.info.name)) {
      _.forOwn(onChangeTimer[hpl.machine.info.name], (timer, variable) => {
        if (timer) {
          clearTimer(timer);
          onChangeTimer[hpl.machine.info.name][variable] = null;
        }
      });
    }
    hpl.stop(function(err) {
        log.debug("Stopped: " + hpl.machine.info.name);
        return done(err);
    });
}

function removeHpl(hpl, done) {
    var machineName = hpl.machine.info.name;

    stopHpl(hpl, function(err) {
        if (err) return done(err);

        //remove the machine config
        conf.clear('machines:' + machineName, function(err) {

            //remove the machine from the list of hpl
            delete hpls[machineName];
            // reset any processing history
            delete averageCounts[machineName];
            delete onChangeLastValue[machineName];
            delete downsampleCount[machineName];

            log.debug("Removed", machineName);
            return done(err);
        });
    });
}

function removeHpls(done) {
    async.each(hpls, function(hpl, cb) {
        removeHpl(hpl, function(err) {
            if (err) {
                log.warn(hpl.machine.path + ' not valid, ' + err);
                return cb(null);
            }

            return cb(null);
        });
    }, function(err) {
        return done(err);
    });
}

function findMachineFromPath(filepath, done) {
    for (var machineName in hpls) {
        if (!hpls.hasOwnProperty(machineName)) continue;

        if (hpls[machineName].machine.path === filepath) {
            return done(machineName);
        }
    }
    return done(null);
}

function loadAndStartMachine(filepath, done) {
    readMachine(filepath, function(err, machine) {
        if (err) {
            log.warn(filepath + ' not valid, ' + err);
            return done(err);
        }

        var machineName = machine.info.name;

        //add the path to the machine definition
        machine.path = filepath;

        //machine names must uniquie
        if (hpls.hasOwnProperty(machineName)) {
            return done('duplicate machine found');
        }

        loadHpl(machine, function(err, hpl) {
            if (err) {
                log.warn(machine.path + ' not valid, ' + err);
                return done(err);
            }

            //save the hpl
            hpls[machineName] = hpl;

            startHpl(hpl, function(err) {
                return done(err, machineName);
            });
        });
    });
}

function loadAndStartMachines(filepaths, done) {
    async.eachSeries(filepaths, function(filepath, cb) {
        loadAndStartMachine(filepath, function(err, machineName) {
            if (err) {
                log.warn(filepath + ' not valid, ' + err);
                return cb(null);
            }

            return cb(null);
        });
    }, function(err) {
        return done(err);
    });
}

function startWatch() {
    //watch for changes to the search dirs
    watcher = chokidar.watch(_.map(searchDirs, function(item) {
        return item + machineDefPattern;
    }), {
        ignoreInitial: true
    });

    watcher
        .on('add', function(path) {
            log.debug('File added', path);
            loadAndStartMachine(path, function(err, machineName) {
                if (err) {
                    log.error(err);
                    return;
                }

                log.debug("Started new machine", machineName);
                return;
            });
        })
        .on('change', function(path) {
            log.debug('File changed', path);
            findMachineFromPath(path, function(machineName) {

                if (!machineName) {
                    //this is not an exiting hpl, so start a new one
                    loadAndStartMachine(path, function(err, machineName) {
                        if (err) {
                            log.error(err);
                            return;
                        }

                        log.debug("Started new machine", machineName);
                        return;
                    });
                    return;
                }

                stopHpl(hpls[machineName], function(err) {
                    if (err) {
                        log.error(err);
                        return;
                    }

                    //remove the machine from the list of hpl
                    delete hpls[machineName];
                    // reset any processing history
                    delete averageCounts[machineName];
                    delete onChangeLastValue[machineName];
                    delete downsampleCount[machineName];

                    //load and start the machine again
                    loadAndStartMachine(path, function(err) {
                        if (err) log.error(err);
                        log.debug("Reloaded", machineName);
                        return;
                    });
                });
            });
        })
        .on('unlink', function(path) {
            log.debug('File removed', path);

            findMachineFromPath(path, function(machineName) {
                if (!machineName) {
                    return;
                }

                removeHpl(hpls[machineName], function(err) {
                    if (err) {
                        log.error(err);
                        return;
                    }

                    return;
                });
            });
        })
        .on('ready', function() {
            log.debug("watching", watcher.getWatched());
        });
}

function loadMachines(done) {
    findMachines(searchDirs, function(err, paths) {
        if (err) {
            return done(err);
        }

        loadAndStartMachines(paths, function(err) {
            return done(err);
        });
    });
}

// help function returns true of any property had been added or changed in a new object compared to and old one
function propertyChangedOrAdded(oldObj, newObj) {
    var newObjKeys = _.keys(newObj);
    for (var iNewObjKey = 0; iNewObjKey < newObjKeys.length; iNewObjKey++) {
        var prop = newObjKeys[iNewObjKey];

        // return true if a new property added
        if (!_.has(oldObj, prop)) return true;

        // return true if a property changed
        if (!_.isEqual(oldObj[prop], newObj[prop])) return true;
    }

    return false;
}

function onSetListener(key) {
    // ignore connection status changes
    if (key.includes(':settings:model:connectionStatus')) return;

    //check if anythiing in the model changes for a machine
    var found = key.match(/^machines:(.*):settings:model:.*$/);
    if (!found) {
        return;
    }

    var machineName = found[1];
    if (!machineName) {
        return;
    }

    if (!hpls.hasOwnProperty(machineName)) {
        return;
    }

    conf.get('machines:' + machineName + ':settings:model', function(err, model) {
        //log.debug('machines:' + machineName + ':settings:model', model);

        if (propertyChangedOrAdded(hpls[machineName].machine.settings.model, model)) {
            //the model has changed
            log.debug('machines:' + machineName + ':settings:model changed from',
                hpls[machineName].machine.settings.model, 'to', model);

            hpls[machineName].updateModel(model, function(err) {
                if (err) {
                    log.error(err);
                    return;
                }

                // reset any processing history
                delete averageCounts[machineName];
                delete onChangeLastValue[machineName];
                delete downsampleCount[machineName];

                log.debug("Updated model for", machineName);
                return;
            });
        }
    });
}

function loadSchemasAndValidators(done) {
    for (var key in sparkHpl) {
        if (!sparkHpl.hasOwnProperty(key)) {
            continue;
        }
        schemas[key] = _.merge({}, sparkHpl[key].schema, {
            definitions: {
                hpl: schemas.hpl
            }
        });

        validateHpl[key] = ajv.compile(schemas[key]);
    }

    conf.clear('schemas', function(err) {
        conf.set('schemas', schemas, function(err) {
            return done(err);
        });
    });
}

function findHpls(done) {
    //look for:
    // 1) node_modules/*-hpl-*
    // 2) ../*-hpl-*
    var pattern = path.join(__dirname, '{node_modules,..}', '*-hpl-*', path.sep);

    glob(pattern, function(err, hpls) {
        log.debug(hpls);
        return done(null, hpls);
    });
}

function requireHpl(hpl, done) {
    var err = null;
    var result = {
        path: hpl,
        name: path.basename(hpl).replace(/^.*-hpl-/,'')
    };

    try {
        result.exports = require(result.path);
        log.info("Loaded hpl", result.name);
    } catch (e) {
        err = e;
        result = null;
    }

    //TODO: check api is correct

    return done(err, result);
}

function requireHpls(done) {
    findHpls(function(err, hpls) {
        if (err) {
            return done(err);
        }

        async.map(hpls, function(hpl, cb) {
            requireHpl(hpl, cb);
        }, function(err, results) {
            if (err) {
                return done(err);
            }

            //remove empty results
            results = results.filter(function(n) {
                return ((n !== undefined) && (n !== null));
            });

            for (var i=0; i<results.length; i++) {

                //ignore duplicate hpl
                if (sparkHpl.hasOwnProperty(results[i].name)) {
                    continue;
                }

                sparkHpl[results[i].name] = results[i].exports;

                //add the hpl we found to the schema
                if (!('enum' in schemas.hpl.definitions.info.properties.hpl)) {
                    schemas.hpl.definitions.info.properties.hpl.enum = [];
                }
                schemas.hpl.definitions.info.properties.hpl.enum.push(results[i].name);
            }

            return done(null);
        });
    });
}

sparkMachineHpl.start = function(modules, done) {
    log = modules['spark-logging'].exports.getLogger(pkg.name);
    db = modules['spark-db'].exports;
    conf = modules['spark-config'].exports;
    alert = modules['spark-alert'].exports;

    if (conf.get("MACHINES_SYSTEM_DIR")) {
        searchDirs.push(conf.get("MACHINES_SYSTEM_DIR"));
    }
    if (conf.get("MACHINES_USER_DIR")) {
        searchDirs.push(conf.get("MACHINES_USER_DIR"));
    }
    log.debug("Search directories", searchDirs);

    //listening to the write changes in the db
    if (!writeReqListenerAdded) {
        db.addListener('write-added', writeReqListener);
        writeReqListenerAdded = true;
    }

    //setup json schemas and validators
    requireHpls(function(err) {
        if (err) {
            return done(err);
        }

        loadSchemasAndValidators(function(err) {
            if (err) {
                return done(err);
            }

            loadMachines(function(err) {
                log.debug({
                    err: err,
                    hpls: hpls
                });

                //listen for changes to the config
                //but only add the listener once
                if (conf.listeners('set').indexOf(onSetListener) === -1) {
                    conf.on('set', onSetListener);
                }

                //start watching for file changes
                startWatch();

                log.info('Started', pkg.name);
                return done(null, config.info);
            });
        });
    });
};

sparkMachineHpl.stop = function(done) {
    //stop listening for changes to the config
    conf.removeListener('set', onSetListener);

    //stop lsitening to the write events in the db
    db.removeListener('write-added', writeReqListener);
    writeReqListenerAdded = false;

    //stop watching
    if (watcher) {
        watcher.close();
    }

    //stop all the hpls
    removeHpls(function(err) {
        log.info('Stopped', pkg.name);
        return done(null);
    });
};

sparkMachineHpl.require = function() {
    return ['spark-logging',
        'spark-db',
        'spark-config',
        'spark-alert'
    ];
};

module.exports = sparkMachineHpl;
