/* jshint esversion: 6 */
const { EventEmitter } = require('events');
const _ = require('lodash');
const dhtSensorLib = require('node-dht-sensor');
const pkg = require('./package.json');
const config = require('./config.json');

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};
config.info = info;

const weatherSensor = new EventEmitter();

let log;
let db;
let conf;
let alert;

let firstStart = true;
let readingSensor = false;
let readTimer;

const combinedResultVariable = {
  name: 'CombinedResult',
  description: 'CombinedResult',
  format: 'char',
  array: true,
};

const temperatureVariable = {
  name: 'Temperature',
  description: 'DHT Sensor Temperature',
  format: 'float',
  access: 'read',
  array: false,
};

const humidityVariable = {
  name: 'Humidity',
  description: 'DHT Sensor Humidity',
  format: 'float',
  access: 'read',
  array: false,
};

function updateConnectionStatus(connected) {
  conf.set(`machines:${pkg.name}:settings:model:connectionStatus`, connected, () => {});
}

function dbAddResult(err, res) {
  if (err) {
    alert.raise({ key: 'db-add-error', errorMsg: err.message });
  } else {
    alert.clear('db-add-error');
  }
  if (res) log.debug(res);
}

function onSetListener(key) {
  // check if anything in the model changes
  const re = new RegExp(`machines:${pkg.name}:settings:model:(?!connectionStatus)`);
  if (re.test(key)) {
    conf.get(`machines:${pkg.name}:settings:model`, (err, model) => {
      log.debug(`machines:${pkg.name}:settings:model`, model);

      if (!_.isEqual(model, config.settings.model)) {
        // if any of the setting have changed
        log.debug(`machines:${pkg.name}:settings:model changed from`, config.settings.model, 'to', model);

        // update our local copy
        config.settings.model = model;

        // request a restart
        weatherSensor.emit('restartRequest', info.name);
      }
    });
  }
}

function createNewVariableListFromSettings() {
  const newVariables = [];

  if (!_.get(config.settings.model, 'deliverEntireResponse', false)) {
    newVariables.push(temperatureVariable);
    newVariables.push(humidityVariable);
  } else {
    newVariables.push(combinedResultVariable);
  }

  return newVariables;
}

function readTimerFunc() {
  // prevent interrupting long read with another read
  if (readingSensor) {
    return;
  }
  readingSensor = true;

  // console.log('------reading sensor');
  let sensorType = 22;
  if (config.settings.model.sensorType === 'DHT11') {
    sensorType = 11;
  }
  const { GPIOPin } = config.settings.model;

  dhtSensorLib.read(sensorType, GPIOPin, (err, temperatureValue, humidityValue) => {
    if (err) {
      // console.log('-----read err = ' + err);
      log.error(`-----read err = ${err}`);
    } else {
      let adjustedTemperatureValue = temperatureValue;
      let adjustedHumidityValue = humidityValue;
      if (_.get(config.settings.model, 'temperatureScale', 'Fahrenheit') === 'Fahrenheit') {
        adjustedTemperatureValue = (adjustedTemperatureValue * 9.0 / 5.0) + 32.0;
      }
      adjustedTemperatureValue += _.get(config.settings.model, 'temperatureOffset', 0);
      adjustedHumidityValue += _.get(config.settings.model, 'humidityOffset', 0);
      if (_.get(config.settings.model, 'deliverEntireResponse', false)) {
        const combinedResultArray = [];
        const now = new Date();
        const data = {
          Temperature: adjustedTemperatureValue,
          Humidity: adjustedHumidityValue,
          TemperatureScale: _.get(config.settings.model, 'temperatureScale', 'Fahrenheit'),
          timestamp: now.toISOString(),
        };
        combinedResultArray.push(data);
        // console.log('------combinedResultArray: ' + JSON.stringify(combinedResultArray));
        const combinedResultsData = {
          machine: config.info.name,
          variable: 'CombinedResult',
          CombinedResult: combinedResultArray,
        };
        db.add(combinedResultsData, dbAddResult);
      } else {
        // if (_.get(config.settings.model, "temperatureScale", "Fahrenheit") === "Fahrenheit") {
        //   console.log('------Temperature: ' + temperatureValue + 'F, ');
        // } else {
        //   console.log('------Temperature: ' + temperatureValue + 'C, ');
        // }
        // console.log('------Humidity: ' + humidityValue + '%');
        const temperatureData = {
          machine: config.info.name,
          variable: 'Temperature',
          Temperature: adjustedTemperatureValue,
        };
        db.add(temperatureData, dbAddResult);

        const humidityData = {
          machine: config.info.name,
          variable: 'Humidity',
          Humidity: adjustedHumidityValue,
        };
        db.add(humidityData, dbAddResult);
      }
    }
  });

  readingSensor = false;
}

function clearAlertsAndStop(callback) {
  alert.clearAll((err) => {
    if (err) {
      log.error(err);
    }

    log.info('Stopped');

    callback(null);
  });
}

function writeBackConfig(callback) {
  const newVariables = createNewVariableListFromSettings();

  // if process has just started up
  if (firstStart === true) {
    firstStart = false;
    // write back config in case config json file had newer data than config database
    config.variables = newVariables;
    conf.set(`machines:${pkg.name}`, config, callback);
  } else if (_.isEqual(newVariables, config.variables) === false) {
    // do variable lists match
    // if not
    config.variables = newVariables;
    // write back updated list to config variable database
    conf.set(`machines:${pkg.name}:variables`, config.variables, (err) => {
      if (err) {
        return callback(err);
      }
      return callback(null);
    });
  } else {
    callback();
  }
}

weatherSensor.start = function start(modules, done) {
  log = modules['spark-logging'].exports.getLogger(pkg.name);
  db = modules['spark-db'].exports;
  conf = modules['spark-config'].exports;
  alert = modules['spark-alert'].exports.getAlerter(pkg.name);

  readingSensor = false;

  // listen for changes to the enable key
  // but only add the listener once
  if (conf.listeners('set').indexOf(onSetListener) === -1) {
    log.debug('config.settings.model', config.settings.model);
    conf.on('set', onSetListener);
  }

  // preload alert messages that have known keys
  alert.preLoad({
    'initialization-error': {
      msg: 'DHT Sensor: Initialization Error',
      description: x => `DHT Sensor is not able to initialize correctly. Error: ${x.errorMsg}`,
    },
    'db-add-error': {
      msg: 'DHT Sensor: Database Add Error',
      description: x => `Error adding to the database. Error: ${x.errorMsg}`,
    },
  });

  updateConnectionStatus(false);

  // read the current settings from the database model
  conf.get(`machines:${pkg.name}:settings:model`, (err, model) => {
    // if there is model data in the db, update to it (e.g. overwrite what was read
    // from readonly file)
    if (model) {
      config.settings.model = model;
    }

    // save our config if necessary
    writeBackConfig((writeBackErr) => {
      if (writeBackErr) {
        return done(writeBackErr);
      }

      // check enable state before continuing
      if (!config.settings.model.enable) {
        log.info('Disabled');
        return done(null, config.info);
      }
      readTimer = setInterval(readTimerFunc, (config.settings.model.readFrequency * 1000));

      return done(null);
    });
  });
};

weatherSensor.stop = function stop(done) {
  // stop connection status monitoring  timer
  if (readTimer) {
    clearInterval(readTimer);
    readTimer = null;
  }

  clearAlertsAndStop(done);
};

weatherSensor.require = function require() {
  return ['spark-logging',
    'spark-db',
    'spark-alert',
    'spark-config',
  ];
};

module.exports = weatherSensor;
