const _ = require('lodash');
const fs = require('fs');
const rpi = require('node-raspi');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplDummy = function hplDummy(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'file-open-error': {
      msg: 'Dummy: File Open Error',
      description: x => `Error opening chosen file. Error: ${x.errorMsg}`,
    },
    'db-add-error': {
      msg: 'Dummy: Database Add Error',
      description: x => `Error adding to the database. Error: ${x.errorMsg}`,
    },
  });
  // Private variables
  const that = this;
  let timer = null;
  const sine = {};
  const cosine = {};
  const square = {};
  const onOff = {};
  const count = {};
  const dataFileRows = [];
  let iDataFileCurrentRow = 0;

  // public variables
  that.timerMultiplier = 1000;
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine, {
    settings: {
      model,
    },
  });

  function getRandom(min, max) {
    return (Math.random() * (max - min)) + min;
  }

  // Private methods
  // function stressCpu() {
  //   let result = 0;
  //   let stressCount = 0;
  //   while (stressCount < 50000) {
  //     result += Math.random() * Math.random();
  //     stressCount++;
  //   }
  //   stressCount = result; // meaningless assignment to eliminate silly warning.
  //   console.log('stressing CPU');
  //   setTimeout(stressCpu, 1);
  // }


  function readTimer() {
    const combinedResultArray = [];
    const variablesForCombinedResults = [];
    for (let i = 0; i < that.machine.variables.length; i += 1) {
      const variable = that.machine.variables[i];

      let value;
      switch (variable.type) {
        case 'random':
        {
          value = getRandom(variable.min || 0, variable.max || 100);
          break;
        }
        case 'sine':
        {
          if (!{}.hasOwnProperty.call(sine, variable.name)) {
            sine[variable.name] = 0;
          }
          value = Math.sin(sine[variable.name]);
          sine[variable.name] += Math.PI / 100;
          break;
        }
        case 'cosine':
        {
          if (!{}.hasOwnProperty.call(cosine, variable.name)) {
            cosine[variable.name] = 0;
          }
          value = Math.cos(cosine[variable.name]);
          cosine[variable.name] += Math.PI / 100;
          break;
        }
        case 'square':
        {
          if (!{}.hasOwnProperty.call(square, variable.name)) {
            square[variable.name] = 0;
            onOff[variable.name] = false;
          }
          // Check if varialbe's cycle time is greater than On_Cycle and is in the On state
          if ((square[variable.name] >= variable.on_cycle) && (onOff[variable.name] === true)) {
            value = variable.max;
            square[variable.name] = 0;
            onOff[variable.name] = false;

            // Checks if varialbe is in On state
          } else if (onOff[variable.name] === true) {
            value = variable.max;

            // Checks if variable's cycle time is greater than Off_Cycle and is in the Off state
          } else if ((square[variable.name] >= variable.off_cycle)
                  && (onOff[variable.name] === false)) {
            value = variable.min;
            square[variable.name] = 0;
            onOff[variable.name] = true;

          // Checks if variable is in Off state
          } else {
            value = variable.min;
          }
          square[variable.name] += that.machine.settings.model.updateRate;
          break;
        }
        case 'error':
        {
          // generate a random error, favour returning success
          const randNum = getRandom(0, 100);
          let error = false;
          if (randNum > 75) {
            error = true;
          }

          if (variable.format === 'bool') {
            value = error;
          } else if (variable.format === 'char') {
            value = error ? 'error' : 'success';
          } else {
            value = error ? 1 : 0;
          }
          break;
        }
        case 'count':
        {
          if (!{}.hasOwnProperty.call(count, variable.name)) {
            value = 0;
          } else {
            value = count[variable.name] + 1;
            if (value > variable.max) {
              value = 0;
            }
          }
          count[variable.name] = value;
          break;
        }
        case 'static':
        {
          if (!{}.hasOwnProperty.call(variable, 'staticvalue')) {
            value = 'static';
          } else {
            value = variable.staticvalue;
          }
          break;
        }
        case 'data':
        {
          if (dataFileRows.length > 0) {
            if (i < dataFileRows[iDataFileCurrentRow].length) {
              const dataFileValue = dataFileRows[iDataFileCurrentRow][i].trim();
              if (dataFileValue.length > 0) {
                // check if we should return a number
                if ((/^u?int[0-9]+$/.test(variable.format)) || (variable.format === 'float')) {
                  value = Number(dataFileValue);
                  if (Number.isNaN(value)) {
                    value = 0;
                  }
                } else if (variable.format === 'bool') {
                  value = dataFileValue.trim().toLowerCase() === 'true';
                } else {
                  value = dataFileValue;
                }
              }
            }
          }
          break;
        }
        case 'RPI-temperature':
        {
          value = rpi.getThrm();
          break;
        }
        case 'deliver-entire-response-results':
        {
          variablesForCombinedResults.push(i);
          break;
        }
        default:
        {
          break;
        }
      }

      if (value !== undefined) {
        // check if this should be an integer
        if (/^u?int[0-9]+$/.test(variable.format)) {
          value = Math.round(value);
        }

        // check if this should be an unisgned integer
        if (/^uint/.test(variable.format)) {
          if (value < 0) {
            value = 0;
          }
        }

        if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
          let data = {};
          data[variable.name] = value;
          combinedResultArray.push(data);
          if (_.has(variable, 'min')) {
            data = {};
            data.lowerLimit = variable.min;
            combinedResultArray.push(data);
          }
          if (_.has(variable, 'max')) {
            data = {};
            data.upperLimit = variable.max;
            combinedResultArray.push(data);
          }
        } else {
          that.dataCb(that.machine, variable, value, (err) => {
            if (err) {
              alert.raise({ key: 'db-add-error', errorMsg: err.message });
            } else {
              alert.clear('db-add-error');
            }
          });
        }
      }
    }

    if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
      // check if any variables need to be back-filled with this combined data
      if (variablesForCombinedResults.length) {
        for (let i = 0; i < variablesForCombinedResults.length; i += 1) {
          const variable = that.machine.variables[variablesForCombinedResults[i]];
          that.dataCb(that.machine, variable, combinedResultArray, (err) => {
            if (err) {
              alert.raise({ key: 'db-add-error', errorMsg: err.message });
            } else {
              alert.clear('db-add-error');
            }
          });
        }
      }
    }

    iDataFileCurrentRow += 1;
    if (iDataFileCurrentRow >= dataFileRows.length) iDataFileCurrentRow = 0;
  }

  // Privileged methods
  this.start = function start(dataCb, configUpdateCb, done) {
    // REMOVE THIS - ONLY PURPOSE IS TO MAX OUT THE PROCESS
    //    setTimeout(stressCpu, 10000);

    if (typeof dataCb !== 'function') {
      return done('dataCb not a function');
    }
    that.dataCb = dataCb;

    if (typeof configUpdateCb !== 'function') {
      return done('configUpdateCb not a function');
    }
    that.configUpdateCb = configUpdateCb;

    // check if the machine is enabled
    if (!that.machine.settings.model.enable) {
      log.debug(`${machine.info.name} Disabled`);
      return done(null);
    }

    // if any data file specified, read it
    if (that.machine.settings.model.dataFilePath.length > 0) {
      fs.readFile(that.machine.settings.model.dataFilePath, 'utf8', (err, data) => {
        if (err) {
          alert.raise({ key: 'file-open-error', errorMsg: err });
        } else {
          const lines = data.split('\n');
          for (let iLine = 0; iLine < lines.length - 1; iLine += 1) {
            dataFileRows.push(lines[iLine].split(','));
          }
        }
      });
    }
    iDataFileCurrentRow = 0;

    timer = setInterval(readTimer,
      that.machine.settings.model.updateRate * that.timerMultiplier);

    // get an immediate value without wating for the updateRate time to expire
    setImmediate(readTimer);

    log.debug('Started');
    return done(null);
  };

  this.stop = function stop(done) {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    // clear existing alerts
    alert.clearAll(() => {
      log.debug('Stopped');
      return done(null);
    });
  };

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop(() => {
      that.start(that.dataCb, that.configUpdateCb, err => done(err));
    });
  };

  this.updateModel = function updateModel(newModel, done) {
    log.debug('Updating');
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

module.exports = {
  hpl: hplDummy,
  defaults,
  schema,
};
