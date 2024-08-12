const os = require('os');
const { EventEmitter } = require('events');
const mqtt = require('mqtt');
const async = require('async');
const _ = require('lodash');
const pkg = require('./package.json');
const config = require('./config.json');

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};
config.info = info;

const sparkMqttClient = new EventEmitter();
let log;
let db;
let conf;
let alert = null;
let running = false;
let mqttClient = null;
let started = false;
const machineList = {};

function onSetListener(key) {
  // check if anything in the model changes
  const reSettingsChanges = new RegExp(`protocols:${pkg.name}:settings:model:*`);
  // check if any machine's enable or publish state has changed
  const reMachineChanges = new RegExp('^machines:.*:settings:model:enable$|^machines:.*:settings:model:publishDisabled$');
  // check if any machine's variables have changed
  const reMachineVariableChanges = new RegExp('^machines:.*:variables$');

  if (reSettingsChanges.test(key)) {
    conf.get(`protocols:${pkg.name}:settings:model`, (err, model) => {
      log.debug(`protocols:${pkg.name}:settings:model`, model);

      if (!_.isEqual(model, config.settings.model)) {
        // the enable key has changed
        log.debug(`protocols:${pkg.name}:settings:model changed from`, config.settings.model, 'to', model);

        config.settings.model = model;

        // request a restart
        sparkMqttClient.emit('restartRequest', info.name);
      }
    });
  }

  const machineEnableChanges = reMachineChanges.test(key);
  const variableChanges = reMachineVariableChanges.test(key);

  // if a machine has changed its enable state, or variables have changed
  if (machineEnableChanges || variableChanges) {
    // check we have already populated our list of machines and are fully up and running
    if (running === true) {
      // extract the machine name from the key
      const startIndex = key.indexOf(':') + 1;
      // end index will differ based on whether a machine or machine's variable has changed
      const endIndex = machineEnableChanges === true ? key.indexOf(':settings') : key.indexOf(':variables');
      const machineName = key.slice(startIndex, endIndex);

      // get the machines details
      conf.get(`machines:${machineName}`, (err, machine) => {
        const machineEnabled = machine.settings.model.enable;
        const publishingEnabled = !machine.settings.model.publishDisabled;

        // find if the machine already exists in the queue
        const machineExists = _.hasIn(machineList, machineName);

        // if the machine has just been enabled and it is not in the queue
        if ((machineEnabled) && (publishingEnabled) && (!machineExists)) {
          log.info(`Adding Machine: ${machineName}`);

          // store the machine's variable information as a key list (from input array)
          // don't need to store variable info, currently just need to have created an
          // object of machineName in the machineList (but may be handy in the future)
          machineList[machineName] = { variables: _.keyBy(machine.variables, 'name') };
        } else if (((!machineEnabled) || (!publishingEnabled)) && (machineExists)) {
          // else if machine has just been disabled and exists in the queue
          log.info(`Removing Machine: ${machineName}`);

          // delete the entry from the queue object
          delete machineList[machineName];
        } else if ((machineEnabled) && (publishingEnabled) && (machineExists)) {
          // if we see an enabled machine that already exists, the variables may have changed

          // before deleting see if the variable list has actually
          // changed (can get double enables - so this debounces)
          const updatedList = { variables: _.keyBy(machine.variables, 'name') };

          // if the variables have changed
          if (_.isEqual(machineList[machineName], updatedList) === false) {
            log.info(`Updating Machine: ${machineName}`);

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
  // get the new data for the key
  db.get(key, (dbErr, entry) => {
    // check we have a variable list for this machine
    if (_.hasIn(machineList, entry.machine)) {
      // first check if variableName exists in the list before
      // proceding (as may have been added before we have updated our internal list)
      if (machineList[entry.machine].variables[entry.variable] === undefined) {
        return;
      }

      const topic = `${os.hostname()}/${entry.machine}/${entry.variable}`;
      // log.debug({ topic, entry });
      mqttClient.publish(topic, JSON.stringify(entry), (mqttErr) => {
        if (mqttErr) {
          alert.raise({ key: 'send-error', errorMsg: mqttErr.message });
        } else {
          alert.clear('send-error');
        }
      });
    }
  });
}

sparkMqttClient.start = function start(modules, done) {
  if (started) {
    return done(new Error('already started'));
  }

  log = modules['spark-logging'].exports.getLogger(pkg.name);
  db = modules['spark-db'].exports;
  conf = modules['spark-config'].exports;
  alert = modules['spark-alert'].exports.getAlerter(pkg.name);

  alert.preLoad({
    'send-error': {
      msg: 'Mqtt Client: Unable to publish message to Mqtt broker',
      description: x => `Client is not able to publish to the Mqtt broker. Error: ${x.errorMsg}`,
    },
    'connection-error': {
      msg: 'Mqtt Client: Connection Error',
      description: x => `Client is not able to connect to Mqtt broker. Error: ${x.errorMsg}`,
    },
  });

  // do the following steps one after another using async
  return async.series([
    (cb) => {
      // listen for changes to the config
      // but only add the listener once
      if (conf.listeners('set').indexOf(onSetListener) === -1) {
        log.debug('config.settings.model.enable', config.settings.model.enable);
        conf.on('set', onSetListener);
      }

      // check the config to see if we are disabled
      conf.get(`protocols:${pkg.name}:settings:model`, (err, model) => {
        // if no result, use our local config settings
        if (model) config.settings.model = model;
        cb(null);
      });
    },
    (cb) => {
      // update config based on local config settings
      conf.set(`protocols:${pkg.name}`, config, cb);
    },
    (cb) => {
      // check enable state before continuing
      if (!config.settings.model.enable) {
        log.info('Disabled');
        // return early but with no error
        started = true;
        return done(null, config.info);
      }

      // get a list of machines from the config
      return conf.get('machines', (err, machines) => {
        if (err) {
          cb(err);
          return;
        }

        //  add each enabled machine in the array to the local machineList
        Object.keys(machines).forEach((i) => {
          const machine = machines[i];

          // check its a valid machine (must have an info section)
          if (_.has(machine, 'info')) {
            // also check if it is enabled and wants to be published
            if ((machine.settings.model.enable === true)
            && (machine.settings.model.publishDisabled === false)) {
              const machineName = machine.info.name;
              log.info('Adding Machine: ', machineName);

              // store the machine's variable information as a key list (from input array)
              // don't need to store variable info, currently just need to have created an
              // object of machineName in the machineList (but may be handy in the future)
              machineList[machineName] = { variables: _.keyBy(machine.variables, 'name') };
            }
          }
        });
        cb(null);
      });
    },
  ],
  (err) => {
    // once all async task are completed, check for error
    if (err) {
      return done(err);
    }

    let mqttBrokerUrl = `mqtt://${config.settings.model.mqttBrokerHostname}`;
    if (config.settings.model.mqttBrokerPort) {
      mqttBrokerUrl += `:${config.settings.model.mqttBrokerPort}`;
    }

    mqttClient = mqtt.connect(mqttBrokerUrl);

    mqttClient.on('connect', () => {
      log.debug('Connected to MQTT broker', mqttBrokerUrl);
      db.on('added', databaseListener);
      alert.clear('connection-error');
    });

    mqttClient.on('error', (mqttErr) => {
      alert.raise({ key: 'connection-error', errorMsg: mqttErr.message });
    });

    mqttClient.on('offline', () => {
      alert.raise({ key: 'connection-error', errorMsg: 'Broker appears offline. Check broker hostname is set correctly and is running.' });
    });

    started = true;
    running = true;
    log.info('Started', pkg.name);
    return done(null, config.info);
  });
};

function doCleanUp(done) {
  log.info('Stopped', pkg.name);
  started = false;
  running = false;
  mqttClient = null;
  alert.clearAll(() => done(null));
}

sparkMqttClient.stop = function stop(done) {
  if (!started) {
    return done(new Error('not started'));
  }

  // need to cancel the listen event that causes the publishes
  db.removeListener('added', databaseListener);

  if (mqttClient) {
    mqttClient.end();
  }
  return doCleanUp(done);
};

sparkMqttClient.require = function require() {
  return ['spark-logging',
    'spark-db',
    'spark-alert',
    'spark-config',
  ];
};

module.exports = sparkMqttClient;
