/* jshint esversion: 6 */
const { EventEmitter } = require('events');

const async = require('async');
const _ = require('lodash');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const config = require('./config.json');
const pkg = require('./package.json');

const app = express();

const sparkGrafana = new EventEmitter();
sparkGrafana.app = app;

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};
config.info = info;

let log;
let db;
let conf;
let server = null;
let alert = null;
let bStarted = false;
let running = false;
const machineList = {};
const machineVarDataCache = {};

app.use(bodyParser.json());
app.use(cors({
  origin: '*',
  methods: 'POST',
  allowedHeaders: 'accept, content-type',
}));

app.all('/', (req, res) => {
  res.send('Success');
  res.end();
});

app.all('/search', (req, res) => {
  const result = [];
  const filterVariables = _.get(config.settings.model, 'filterVariables', false);

  _.forEach(machineList, (variables, machineName) => {
    _.forEach(variables.variables, (variable, variableName) => {
      if (!filterVariables || !_.get(variable, 'allowFiltering', false)) {
        result.push(`${machineName}:${variableName}`);
      }
    });
  });

  res.json(result);
  res.end();
});

app.all('/query', (req, res) => {
  const tsResult = [];
  const now = Date.now();
  async.forEachSeries(req.body.targets, (target, cb) => {
    if (target.type === 'timeserie') {
      const targetSplit = target.target.split(':');
      if (targetSplit.length === 2) {
        const [machineName, variableName] = targetSplit;
        db.getLatest(machineName, variableName, (err, result) => {
          if (err) {
            alert.raise({ key: 'db-read-error', message: err.message });
          } else {
            let value = null;
            // double check the data in the result is actually valid
            // (db of values may have emptied for this device, and so may get back an empty object)
            if (_.isNil(result) || _.isNil(_.get(result, 'createdAt'))) {
              value = _.get(machineVarDataCache, [machineName, variableName], null);
            } else {
              value = _.get(result, _.get(result, 'variable'));

              // store the last value sent for each variable in a data cache object
              _.set(machineVarDataCache, [machineName, variableName], value);
            }
            if (value !== null) {
              if (_.isArray(value)) {
                const datapoints = [];
                for (let iVal = 0; iVal < value.length; iVal += 1) {
                  datapoints.push([value[iVal], now]);
                }
                tsResult.push({ target: target.target, datapoints });
              } else {
                tsResult.push({ target: target.target, datapoints: [[value, now]] });
              }
            }
          }
          cb();
        });
      }
    }
  }, () => {
    res.json(tsResult);
    res.end();
  });
});

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
        sparkGrafana.emit('restartRequest', info.name);
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
        const machineExists = _.has(machineList, machineName);

        // if the machine has just been enabled and it is not in the queue
        if ((machineEnabled) && (publishingEnabled) && (!machineExists)) {
          log.info(`Adding Machine: ${machineName}`);

          // store the machine's variable information as a key list (from input array)
          // don't need to store variable info, currently just need to have created an
          // object of machineName in the machineList (but may be handy in the future)
          machineList[machineName] = {
            variables: _.keyBy(machine.variables, 'name'),
          };
        } else if (((!machineEnabled) || (!publishingEnabled)) && (machineExists)) {
          // else if machine has just been disabled and exists in the queue
          log.info(`Removing Machine: ${machineName}`);

          // delete the entry from the queue object
          delete machineList[machineName];

          // and also remove the variable data cache entry for this machine
          _.unset(machineVarDataCache, machineName);
        } else if ((machineEnabled) && (publishingEnabled) && (machineExists)) {
          // if we see an enabled machine that already exists, the variables may have changed

          // before deleting see if the variable list has actually changed
          // (can get double enables - so this debounces)
          const updatedList = {
            variables: _.keyBy(machine.variables, 'name'),
          };

          // if the variables have changed
          if (_.isEqual(machineList[machineName], updatedList) === false) {
            log.info(`Updating Machine: ${machineName}`);

            // delete the old entry and re-create with the updated list
            delete machineList[machineName];

            // and also remove the variable data cache entry for this machine
            _.unset(machineVarDataCache, machineName);

            machineList[machineName] = updatedList;
          }
        }
      });
    }
  }
}

sparkGrafana.start = function start(modules, done) {
  if (bStarted) {
    return done(new Error('already started'));
  }

  log = modules['spark-logging'].exports.getLogger(pkg.name);
  db = modules['spark-db'].exports;
  conf = modules['spark-config'].exports;
  alert = modules['spark-alert'].exports.getAlerter(pkg.name);

  alert.preLoad({
    'db-read-error': {
      msg: 'OPC-UA: Error reading from database',
      description: x => `Error: ${x.message}`,
    },
  });

  // do the following steps one after another using async
  async.series([
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
        bStarted = true;
        return done(null, config.info);
      }

      // get a list of machines from the config
      conf.get('machines', (err, machines) => {
        if (err) {
          cb(err);
          return;
        }
        //  add each enabled machine in the array to the local machineList
        _.forOwn(machines, (machine) => {
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
              machineList[machineName] = {
                variables: _.keyBy(machine.variables, 'name'),
              };
            }
          }
        });
        cb(null);
      });

      return undefined;
    },
  ],
  (err) => {
    // once all async task are completed, check for error
    if (err) {
      return done(err);
    }

    // beginning listeing
    server = app.listen(config.settings.model.grafanaPort);
    // disable the keep alive timer
    server.keepAliveTimeout = 0;

    bStarted = true;
    running = true;
    log.info('Started', pkg.name);
    return done(null, config.info);
  });

  return undefined;
};


sparkGrafana.stop = function stop(done) {
  if (!bStarted) {
    return done(new Error('not started'));
  }

  if (server) server.close();

  log.info('Stopped', pkg.name);
  bStarted = false;
  running = false;
  alert.clearAll(() => done(null));

  return undefined;
};

sparkGrafana.require = function require() {
  return ['spark-logging',
    'spark-db',
    'spark-alert',
    'spark-config',
  ];
};

module.exports = sparkGrafana;
