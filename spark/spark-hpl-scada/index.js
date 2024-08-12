/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const http = require('http');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplScada = function hplScada(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'database-value-not-found': {
      msg: `${machine.info.name}: Database Value Not Found`,
      description: 'Database value was not found in the request response.  Check that the database key and value are defined correctly.',
    },
    'data-array-not-found': {
      msg: `${machine.info.name}: Data Array Not Found`,
      description: 'Data array was not found in the request response. Check that the client URL, port, and path are defined correctly.',
    },
    'response-parse-error': {
      msg: `${machine.info.name}: Error Parsing Response`,
      description: x => `Error occurred while parsing the response. Error: ${x.errorMsg}`,
    },
    'database-error': {
      msg: `${machine.info.name}: Error Writing to Database`,
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
    'connection-error': {
      msg: `${machine.info.name}: Connection Error`,
      description: 'Failed to connect to the client URL. Verify that the client URL and port number are defined correctly.',
    },
  });

  // Private variables
  const that = this;
  let sendingActive = false;
  let timer = null;
  let resultsArray = [];
  let requestBlockedCounter = 0;
  let request = null;
  let disconnection = false;
  const requestOptions = {
    hostname: '127.0.0.1',
    port: 80,
    path: '/api/test/realtimedata',
  };

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  // helper function to convert a string formatted result into its correct 'format'
  function convertStringResult(format, resultString) {
    let result = null;
    if (resultString !== null) {
      switch (format) {
        case 'char':
          result = resultString;
          break;

        case 'int8':
        case 'int16':
        case 'int32':
        case 'int64':
        case 'uint8':
        case 'uint16':
        case 'uint32':
        case 'uint64':
          result = parseInt(resultString, 10);
          break;

        case 'float':
        case 'double':
          result = parseFloat(resultString);
          break;

        case 'bool':
          result = ((resultString === 'true') || (resultString === '1'));
          break;
        default:
      }
    }
    return result;
  }

  // helper function to update the values of the variables in the database
  function updateVariableValues(client, port, path, databaseKey,
    databaseValue, variables, saveToDb) {
    // update the request options
    requestOptions.hostname = client;
    requestOptions.port = port;
    requestOptions.path = path;

    // make sure we close out any exisiting request.
    if (request) {
      request.abort();
    }

    // make the request
    request = http.request(requestOptions, (res) => {
      res.setEncoding('utf8');
      disconnection = false;

      // incrementally capture the incoming response body
      let body = '';
      res.on('data', (d) => {
        body += d;
      });

      // the entire body of the response has been received
      res.on('end', () => {
        // try to parse the response and json
        try {
          const responseObj = JSON.parse(body);
          // find the data array
          const dataArray = responseObj.Data;
          if (dataArray !== undefined) {
            alert.clear('data-array-not-found');
            // find the record containing the specified database value
            let iRec;
            for (iRec = 0; iRec < dataArray.length; iRec += 1) {
              const recValue = dataArray[iRec][databaseKey];

              // if specified database value found, get the variable results
              if ((recValue !== undefined) && (recValue === databaseValue)) {
                for (let iVar = 0; iVar < variables.length; iVar += 1) {
                  const varValue = dataArray[iRec][variables[iVar].requestKey];

                  // if variable value found, add the value to the results array
                  if (varValue !== undefined) {
                    resultsArray.push(convertStringResult(variables[iVar].format, varValue));
                  } else {
                    // if no found, add a null to the results array
                    resultsArray.push(null);
                  }
                }

                // save result to database
                saveToDb();

                break;
              }
            }

            if (iRec >= dataArray.length) {
              alert.raise({ key: 'database-value-not-found' });
            } else {
              alert.clear('database-value-not-found');
            }
          } else {
            alert.raise({ key: 'data-array-not-found' });
          }

          alert.clear('response-parse-error');
        } catch (err) {
          alert.raise({ key: 'response-parse-error', errorMsg: err.message });
        }
      });
    });

    // failed to communicate with the client
    request.on('error', () => {
      // clearing all the alert raised for the previous cycle
      if (!disconnection) {
        alert.clearAll(() => {
          alert.raise({ key: 'connection-error' });
        });
      }
      disconnection = true;
    });

    // write data to request body
    request.write('');
    request.end();
  }

  // helper function to save array of collected results to the database
  function saveResultsToDb() {
    // process the array of results
    async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
      try {
        const variable = that.machine.variables[index];

        // if there wasn't a result
        if (dataItem === null) {
          // highlight that there was an error getting this variables data
          alert.raise({
            key: `read-fail-${variable.name}`,
            msg: `${that.machine.info.name}: Read Failed for Variable`,
            description: `Read failed for variable '${variable.name}'. Check that this variable is defined correctly in the machine.`,
          });
          // and just move onto next item
          return callback();
        }

        alert.clear(`read-fail-${variable.name}`);

        // othewise update the database
        that.dataCb(that.machine, variable, dataItem, (err, res) => {
          if (err) {
            alert.raise({ key: 'database-error', errorMsg: err.message });
          } else {
            alert.clear('database-error');
          }
          if (res) log.debug(res);
          // move onto next item once stored in db
          callback();
        });
      } catch (err) {
        callback();
      }

      return undefined;
    }, () => {
      sendingActive = false;
    });
  }

  function requestTimer() {
    // only start a new request if previous set has finished
    // (although allow for failed response by adding a counter )
    if ((sendingActive === false) || (requestBlockedCounter > 3)) {
      // reset storage and index for starting a new request set
      requestBlockedCounter = 0;
      resultsArray = [];

      // make a tcp request for first var in list (but only if request key exists)
      sendingActive = true;

      // get the MES data and save the result to the database
      updateVariableValues(that.machine.settings.model.clientURL,
        that.machine.settings.model.port,
        that.machine.settings.model.path,
        that.machine.settings.model.databaseKey,
        that.machine.settings.model.databaseValue, that.machine.variables, saveResultsToDb);
    } else {
      requestBlockedCounter += 1;
    }
  }

  function open(callback) {
    const requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    disconnection = false;
    // if using req/res mode then set up a repeat task to trigger the requests
    timer = setInterval(requestTimer, requestFrequencyMs);

    // trigger callback on succesful connection
    callback(null);
  }

  // Privileged methods
  this.start = function start(dataCb, configUpdateCb, done) {
    if (!that.machine) {
      return done('machine undefined');
    }

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
      log.debug(`${that.machine.info.name} Disabled`);
      return done(null);
    }

    open((err) => {
      if (err) {
        return done(err);
      }

      log.info('Started');
      return done(null);
    });

    return undefined;
  };

  this.stop = function stop(done) {
    if (!that.machine) {
      alert.clearAll(() => done('machine undefined'));
    }

    // stop the request timer task (if being used)
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    log.info('Stopped');
    alert.clearAll(() => done(null));
  };

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop((err) => {
      if (err) return done(err);
      that.start(that.dataCb, that.configUpdateCb, startErr => done(startErr));
      return undefined;
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
  hpl: hplScada,
  defaults,
  schema,
};
