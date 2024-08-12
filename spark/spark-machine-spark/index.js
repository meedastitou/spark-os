/*jshint esversion: 6 */
const path = require('path');
const EventEmitter = require("events").EventEmitter;
const config = require(path.join(__dirname, 'config.json'));
const pkg = require(path.join(__dirname, 'package.json'));
const async = require('async');
const _ = require('lodash');
const fs = require('fs');

var log;
var db;
var conf;
var alert;
var hardwareDetect;
var bFirstStart = true;
var bStarted = false;
var connectivityStatusValue = true;
var disconnectReportTimer = null;

var machinesEnabled = [];
var machineAlerts = {};

var spark = new EventEmitter();

var sEnabledMachinesVar = 'enabled-machines';
var sConnectivityStatusVar = 'connectivity-status';
var sConnectivityAlertsVar = 'connectivity-alerts';
var sSparkKeyVar = 'spark-key';
var sSparkKeyFile = 'spark-key.json';

var info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description
};
config.info = info;

function onSetListener(key) {
  // check if anything in the model changes
  var bRestarting = false;
  var bWasEnabled = config.settings.model.enable;
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
        spark.emit('restartRequest', info.name);
        bRestarting = true;
      }
    });
  }

  // if this machine was not previously enabled, there's nothing to do, since either it's still not enabled or it will be intitialized when it is restarted
  if (!bWasEnabled) return;

  // if this machine is enabled, check if any machine's enable state has changed
  var reMachineChanges = new RegExp('^machines:.*:settings:model:enable$');
  if (reMachineChanges.test(key)) {
    // extract the machine name from the key
    var startIndex = key.indexOf(':') + 1;
    var endIndex = key.indexOf(':settings');
    var machineName = key.slice(startIndex, endIndex);

    // get the machines details
    conf.get('machines:' + machineName + ':settings:model:enable', function(err, enabled) {

      // find if the machine currently in enabled list
      var machineEnabledIndex = machinesEnabled.indexOf(machineName);

      // if machine now enabled
      var bEnabledMachinesUpdated = false;
      if (enabled)
      {
        // if machine  is not in the list, add it unless restarting, since it will be added then
        if ((machineEnabledIndex === -1) && !bRestarting)  {
          machinesEnabled.push(machineName);
          bEnabledMachinesUpdated = true;
        }
      }
      // if machine now disabled
      else {
        // if machine in the list, remove it
        if (machineEnabledIndex !== -1) {
          machinesEnabled.splice(machineEnabledIndex, 1);
          bEnabledMachinesUpdated = true;

          // remove any alerts for this machine
          for (var key in machineAlerts) {
            var machineAlertSplit = key.split(':');
            if (machineAlertSplit.length === 2) {
              if (machineAlertSplit[0] === machineName) {
                onClearedListener(machineName, machineAlertSplit[1]);
              }
            }
          }
        }
      }

      // if the enabled machines list was updated, write a new value for the variable
      if (bEnabledMachinesUpdated) {
        var enabledMachines = {
            machine: config.info.name,
            variable: sEnabledMachinesVar
        };
        enabledMachines[sEnabledMachinesVar] = machinesEnabled;
        db.add(enabledMachines, dbAddResult);
      }
    });
  }
}

function getAlertMsgsArray() {
  var alertMsgs = [];
  for (var key in machineAlerts) {
    alertMsgs.push(machineAlerts[key]);
  }
  return alertMsgs;
}

function dbAddResult(err, res) {
  if (err) {
    log.error(err);
  }
  if (res) log.debug(res);
}

function onRaisedListener(machine, alert) {
  // ignore this alert if not from an enabled machine (e.g., the health monitor)
  if (machinesEnabled.indexOf(machine) === -1) return;

  // create the array elements for the alert key and machine
  var alertKeyElem = machine + ":" + alert.key;   // NOTE: space after colon for message but not for key
  var alertMsgElem = machine + ": " + alert.msg;

  // ignore if alert already in the arrays, otherwise add the key and message to the arrays
  if (!machineAlerts.hasOwnProperty(alertKeyElem)) {
    machineAlerts[alertKeyElem] = alertMsgElem;

    // start a timer to possibly set the connectivity status variable to false
    if (disconnectReportTimer) clearTimeout(disconnectReportTimer);
    disconnectReportTimer = setTimeout(function() {
      disconnectReportTimer = null;

      // if connectivity status variable not set to false, and still at least one alert set it to false
      if (connectivityStatusValue && (Object.keys(machineAlerts).length !== 0)) {
        connectivityStatusValue = false;
        var connectivityStatus = {
            machine: config.info.name,
            variable: sConnectivityStatusVar
        };
        connectivityStatus[sConnectivityStatusVar] = false;
        db.add(connectivityStatus, dbAddResult);
      }
    }, _.has(config.settings.model, 'disconnectReportTime') ? 1000 * config.settings.model.disconnectReportTime : 0);

    // write a new value for the connectivity alerts variable
    var connectivityAlerts = {
        machine: config.info.name,
        variable: sConnectivityAlertsVar
    };
    connectivityAlerts[sConnectivityAlertsVar] = getAlertMsgsArray();
    db.add(connectivityAlerts, dbAddResult);
  }
}

function onClearedListener(machine, alertKey) {
  // create the array element for the alert key
  var alertKeyElem = machine + ":" + alertKey;

  // if this alert is in our list of alerts
  if (machineAlerts.hasOwnProperty(alertKeyElem)) {
    // if there was one alert before, change connectivity status variable to true if it is now false
    if (!connectivityStatusValue && (Object.keys(machineAlerts).length === 1)) {

      connectivityStatusValue = true;
      var connectivityStatus = {
          machine: config.info.name,
          variable: sConnectivityStatusVar
      };
      connectivityStatus[sConnectivityStatusVar] = true;
      db.add(connectivityStatus, dbAddResult);
    }

    // remove the alert from our list
    delete machineAlerts[alertKeyElem];

    // write a new value for the connectivity alerts variable
    var connectivityAlerts = {
        machine: config.info.name,
        variable: sConnectivityAlertsVar
    };
    connectivityAlerts[sConnectivityAlertsVar] = getAlertMsgsArray();
    db.add(connectivityAlerts, dbAddResult);
  }
}


function findSparkKeyFile(dir) {

    // make sure the directory exists
    if (!fs.existsSync(dir)) return null;

    // get all files and subdirectories in this directory
    try {
      let fileList = fs.readdirSync(dir);
      for (let iFile = 0; iFile < fileList.length; ++iFile) {
          let file = fileList[iFile];
          // if found the spark key file, return its path
          let path = dir + '/' + file;
          if (file === sSparkKeyFile) {
              return path;
          }

          // if found a subdirectory, recursively search it
          let stat = fs.statSync(path);
          if (stat && stat.isDirectory()) {
              let fileInSubDir = findSparkKeyFile(path);
              if (fileInSubDir !== null) {
                return fileInSubDir;
              }
          }
      }
    }
    catch (err) {
      log.error('Error reading automounted directory:', err);
    }

    return null;
}

function readUsbKey() {

    let sparkKeyVar = {
        machine:config.info.name,
        variable: sSparkKeyVar
    };

    //  if the spark key file is in the media directory, try to read it
    let sparkKeyFilePath = findSparkKeyFile(hardwareDetect.mountDir);
    if (sparkKeyFilePath !== null) {
        fs.readFile(sparkKeyFilePath, 'utf8', (err, data) => {
            // if error reading spark-key.json file, clear the correponding spark-key variable
            if (err) {
                sparkKeyVar[sSparkKeyVar] = '';
            }
            // if successfully read spark-key.json, set the corresponding variable to its contents
            else {
                sparkKeyVar[sSparkKeyVar] = data;
            }

            db.add(sparkKeyVar, dbAddResult);
        });
    } else {
        // if spark-key.json file not found, clear the correponding spark-key variable
        sparkKeyVar[sSparkKeyVar] = '';

        db.add(sparkKeyVar, dbAddResult);
    }
}

function writeBackConfig( callback ) {

    // if process has just started up
    if( bFirstStart === true ) {
        bFirstStart = false;
        // write back config incase config json file had newer data than config database
        conf.set('machines:' + pkg.name, config, callback);
    } else {
        // other
        return callback();
    }
}

spark.start = function(modules, done) {
  // return error if already started
  if (bStarted) return done(new Error('already started'));

  log = modules['spark-logging'].exports.getLogger(pkg.name);
  db = modules['spark-db'].exports;
  conf = modules['spark-config'].exports;
  alert = modules['spark-alert'].exports;
  hardwareDetect = modules['spark-hardware-detect'].exports;

  //listen for changes to the config settings
  //but only add the listener once
  if (conf.listeners('set').indexOf(onSetListener) === -1) {
    log.debug('config.settings.model', config.settings.model);
    conf.on('set', onSetListener);
  }

  //check if we are disabled
  conf.get('machines:' + pkg.name + ':settings:model', function(err, model) {

    if (model) {
      config.settings.model = model;
    }

    // write back the configuration, if necessary
    writeBackConfig( function(err) {
        if (err) {
            return done(err);
        }

        // check whethe enabled before continuing
        if (!config.settings.model.enable) {
          log.info('Spark-Disabled');
          return done(null, config.info);
        } else {
          // find all initially enabled machines
          conf.get('machines', function(err, machines) {
            machinesEnabled = [];
            for (var machine in machines) {
              if (machines[machine].hasOwnProperty('settings')) {
                if (machines[machine].settings.hasOwnProperty('model')) {
                  var model = machines[machine].settings.model;
                  if (model.hasOwnProperty('enable')) {
                    if (model.enable) {
                      machinesEnabled.push(machine);
                    }
                  }
                }
              }
            }

            // add the enabled machines, if any, to the array variable
            var enabledMachines = {
              machine: config.info.name,
              variable: sEnabledMachinesVar
            };
            enabledMachines[sEnabledMachinesVar] = machinesEnabled;
            db.add(enabledMachines, dbAddResult);

            // clear our list of alerts
            for (const key of Object.keys(machineAlerts)) {
              delete machineAlerts[key];
            }

            // get all inital connectivity alerts for each enabled machine
            async.timesSeries(machinesEnabled.length, function (iMachine, done) {
              var machine = machinesEnabled[iMachine];
              alert.getAlertsCount(machine, function(err, count) {
                if (!err && (count > 0)) {
                  alert.getAlerts(machine, function(err, alerts) {
                      if (!err) {
                        for (var iAlert = 0; iAlert < alerts.length; ++iAlert) {
                          machineAlerts[machine + ":" + alerts[iAlert].key] = machine + ": " + alerts[iAlert].msg; // NOTE: space after colon for message but NOT for key
                        }
                      }
                      done(null);
                  });
                }
                else {
                  done(null);
                }
              });
            }, function (err) {
              // add the machine alerts, if any, to the array variable
              var connectivityAlerts = {
                machine: config.info.name,
                variable: sConnectivityAlertsVar
              };
              connectivityAlerts[sConnectivityAlertsVar] = getAlertMsgsArray();
              db.add(connectivityAlerts, dbAddResult);

              // set the connectivity status variable true or false
              var connectivityStatus = {
                  machine: config.info.name,
                  variable: sConnectivityStatusVar
              };
              connectivityStatusValue = Object.keys(machineAlerts).length === 0;
              connectivityStatus[sConnectivityStatusVar] = connectivityStatusValue;
              db.add(connectivityStatus, dbAddResult);

              // initialize spark-key variable to contents of spark-key,json USB fiie, if any
              readUsbKey();
            });
          });

          // listen for changes to the alerts, but only add the listeners once
          if (alert.listeners('raised').indexOf(onRaisedListener) === -1) {
            alert.on('raised', onRaisedListener);
          }
          if (alert.listeners('cleared').indexOf(onClearedListener) === -1) {
            alert.on('cleared', onClearedListener);
          }

          // check for presence or absence of a usb key file when drives either mounted or unmounted
          if (hardwareDetect.listeners('mounted').indexOf(readUsbKey) === -1) {
            hardwareDetect.on('mounted', readUsbKey);
          }
          if (hardwareDetect.listeners('unmounted').indexOf(readUsbKey) === -1) {
            hardwareDetect.on('unmounted', readUsbKey);
          }

          log.info('Spark-Started', pkg.name);
          bStarted = true;
          return done(null, config.info);
        }
      });
  });
};

spark.stop = function(done) {
  // return error if not started
  // NOTE: This test removed because it causes a problem: spark-plugin stops machines that are already stopped
  // if (!bStarted) return done(new Error('not started'));

  // remove the alert listeners so that updates stop
  alert.removeListener('raised', onRaisedListener);
  alert.removeListener('cleared', onClearedListener);

  hardwareDetect.removeListener('mounted', readUsbKey);
  hardwareDetect.removeListener('unmounted', readUsbKey);

  log.info('Stopped', pkg.name);
  bStarted = false;
  return done(null);
};

spark.require = function() {
  return ['spark-logging',
    'spark-db',
    'spark-config'
  ];
};

module.exports = spark;
