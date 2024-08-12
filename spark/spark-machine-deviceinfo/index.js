/* jshint esversion: 6 */
const path = require('path');
const { EventEmitter } = require('events');

const async = require('async');
const _ = require('lodash');
const fs = require('fs');
const config = require('./config.json');
const pkg = require('./package.json');

let log;
let db;
let conf;
let alert;
let bFirstStart = true;
let bStarted = false;

let machinesEnabled = [];
let deviceInfoArray = [];
let userMachines = [];

let deviceInfo = new EventEmitter();

const sDeviceInfoVar = 'deviceinfo';

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
  hidden: true,
};
config.info = info;
config.settings = {
  model: {
    enable: true,
    publishDisabled: false,
  },
};

function walkSync(dir, type, _pathBase) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    files = [];
  }

  let filelist = [];
  const pathBase = _pathBase || type;
  files.forEach((file) => {
    const fullpath = path.join(dir, file);
    const fullpathBase = path.join(pathBase, file);

    if (fs.statSync(fullpath).isDirectory()) {
      if ((file !== 'node_modules') && (file !== 'test')) {
        filelist = _.concat(filelist, walkSync(fullpath, type, fullpathBase));
      }
    } else if ((/^.*\.json$/.test(file)) && (file !== 'package.json')) {
      filelist.push(path.basename(file, '.json'));
    }
  });
  return filelist;
}

function updateDeviceInfo(machineName, updateUserMachines, callback) {
  // get current index of machine or get next index if must add machine
  let iMachine = machinesEnabled.indexOf(machineName);
  if (iMachine === -1) {
    iMachine = machinesEnabled.length;
    machinesEnabled.push(machineName);
  }

  //  update the  list of user machines if necessary
  if (updateUserMachines) {
    userMachines = walkSync(conf.get('MACHINES_USER_DIR'), 'user');
  }


  // get the machine definition
  conf.get(`machines:${machineName}`, (err, machine) => {
    let deviceStore;
    if (machineName.startsWith('spark-machine')) {
      deviceStore = 'machine';
    } else {
      deviceStore = userMachines.includes(machine.info.name) ? 'user' : 'system';
    }

    deviceInfo = {
      deviceName: machine.info.fullname,
      deviceVersion: machine.info.version,
      deviceStore,
      numberOfAlerts: 0,
      alerts: [],
    };

    // add the device alias if one is set
    let deviceAlias = _.get(machine.info, 'genericNamespace', 'NONE');
    if (deviceAlias === 'NONE') {
      deviceAlias = _.get(machine.settings.model, 'genericNamespace', 'NONE');
    }
    if (deviceAlias !== 'NONE') {
      deviceInfo.deviceAlias = deviceAlias;
    }

    // add any alerts for this machine
    alert.getAlerts(machineName, (alertErr, alerts) => {
      if (!alertErr) {
        deviceInfo.numberOfAlerts = alerts.length;
        for (let iAlert = 0; iAlert < alerts.length; iAlert += 1) {
          deviceInfo.alerts.push(alerts[iAlert].msg);
        }
      }
      deviceInfoArray[iMachine] = deviceInfo;
      callback();
    });
  });
}

function deleteDeviceInfo(machineName) {
  const iMachine = machinesEnabled.indexOf(machineName);
  if (iMachine !== -1) {
    machinesEnabled.splice(iMachine, 1);
    deviceInfoArray.splice(iMachine, 1);
  }
}

function addDeviceInfoVar() {
  const deviceInfoVar = {
    machine: config.info.name,
    variable: sDeviceInfoVar,
  };
  deviceInfoVar[sDeviceInfoVar] = deviceInfoArray;
  db.add(deviceInfoVar, (err, res) => {
    if (err) {
      log.error(err);
    }
    if (res) log.debug(res);
  });
}

function onSetListener(key) {
  // if this machine is enabled, check if any machine's enable state has changed
  const reMachineChanges = new RegExp('^machines:.*:settings:model:enable$');
  if (reMachineChanges.test(key)) {
    // extract the machine name from the key
    const startIndex = key.indexOf(':') + 1;
    const endIndex = key.indexOf(':settings');
    const machineName = key.slice(startIndex, endIndex);

    // ingore changes to this machine
    if (machineName === config.info.name) return;

    // get the machines details
    conf.get(`machines:${machineName}:settings:model:enable`, (err, enabled) => {
      // if machine now enabled, add or update its device info
      if (enabled) {
        updateDeviceInfo(machineName, true, () => {
          addDeviceInfoVar();
        });
      } else {
        // if the machine was enabled and now is not, delete ifs  device info
        deleteDeviceInfo(machineName);
        addDeviceInfoVar();
      }
    });
  }
}

function onAlertChangeListener(machineName) {
  // ignore this alert if not from an enabled machine (e.g., the health monitor)
  if (!machinesEnabled.includes(machineName)) return;

  // update the device info variable to indlude the new alert
  updateDeviceInfo(machineName, true, () => {
    addDeviceInfoVar();
  });
}

function writeBackConfig(callback) {
  // if process has just started up
  if (bFirstStart === true) {
    bFirstStart = false;
    // write back config incase config json file had newer data than config database
    return conf.set(`machines:${pkg.name}`, config, callback);
  }
  // other
  return callback();
}

deviceInfo.start = function start(modules, done) {
  // return error if already started
  if (bStarted) return done(new Error('already started'));

  log = modules['spark-logging'].exports.getLogger(pkg.name);
  db = modules['spark-db'].exports;
  conf = modules['spark-config'].exports;
  alert = modules['spark-alert'].exports;

  // listen for changes to the config settings and akerts
  // but only add the listeners once
  if (conf.listeners('set').indexOf(onSetListener) === -1) {
    conf.on('set', onSetListener);
  }
  if (alert.listeners('raised').indexOf(onAlertChangeListener) === -1) {
    alert.on('raised', onAlertChangeListener);
  }
  if (alert.listeners('cleared').indexOf(onAlertChangeListener) === -1) {
    alert.on('cleared', onAlertChangeListener);
  }

  // write back the configuration, if necessary
  writeBackConfig((writeBackErr) => {
    if (writeBackErr) {
      return done(writeBackErr);
    }

    // get the list of user machines just once
    userMachines = walkSync(conf.get('MACHINES_USER_DIR'), 'user');

    // initiialize the arrays of enabled machines and device info objects
    machinesEnabled = [];
    deviceInfoArray = [];
    conf.get('machines', (getErr, machines) => {
      async.eachSeries(machines, (machine, callback) => {
        if (_.hasIn(machine, 'info.name') && (_.hasIn(config, 'info.name'))) {
          if (machine.info.name === config.info.name) {
            // ingore this machine
            callback();
          } else if (_.get(machine, 'settings.model.enable', false)) {
            updateDeviceInfo(machine.info.name, false, callback);
          } else {
            callback();
          }
        } else {
          callback();
        }
      }, () => {
        // add the initlal device info variable to the database
        addDeviceInfoVar();
      });
    });


    log.info('DeviceInfo-Started', pkg.name);
    bStarted = true;
    return done(null, config.info);
  });

  return undefined;
};

deviceInfo.stop = function stop(done) {
  // remove the listeners so that updates stop
  conf.removeListener('set', onSetListener);
  alert.removeListener('raised', onAlertChangeListener);
  alert.removeListener('cleared', onAlertChangeListener);

  log.info('Stopped', pkg.name);
  bStarted = false;
  return done(null);
};

deviceInfo.require = function require() {
  return ['spark-logging',
    'spark-db',
    'spark-config',
  ];
};

module.exports = deviceInfo;
