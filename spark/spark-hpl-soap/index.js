/* jshint esversion: 6 */

const _ = require('lodash');
const async = require('async');
let soap = require('soap');

if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line global-require
  soap = require('./test/soapTestServer');
}
const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplSoap = function hplSoap(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'client-error': {
      msg: `${machine.info.name}: Error From Client`,
      description: x => `An error was received from the client. Error: ${x.errorMsg}`,
    },
    'database-error': {
      msg: `${machine.info.name}: Error Writing to Database`,
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
    'request-key-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: 'All MES table query variables require a request key',
    },
    'production-info-type-error': {
      msg: `${machine.info.name}: Variable Error`,
      description: 'All production info list variables require a production info type',
    },
  });

  const that = this;
  let sendingActive = false;
  let timer = null;
  let resultsArray = [];
  let requestBlockedCounter = 0;
  let getDataArgs = null;
  const manufacturingSiteName = 'manufacturing-site';
  const manufacturingSiteIDName = 'manufacturing-site-id';
  const getDataOp = 'HDVEGetData';
  const getDataMachineBasedOp = 'HDVEGetDataMachineBased';
  const getRunningOrdersOp = 'HDVEGetRunningOrders';

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

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

  // helper function to get the first position and end position (actually first character
  // of next string or header length) in the header of a string value
  function getColsFromHeader(header, headerValue) {
    const startEndCols = [];

    if (typeof headerValue !== 'undefined') {
      let iBestMatch = -1;


      let iStart = 0;
      const headerLen = header.length;


      const valueLen = headerValue.length;
      // search for the header value in the header until reach end of header
      while ((iStart + valueLen) <= headerLen) {
        // find the next match in the header
        const iMatch = header.indexOf(headerValue, iStart);
        if (iMatch === -1) break;

        // if this match is delimited by spaces or the ends of the header, we're done
        if (((iMatch === 0) || (header[iMatch - 1] === ' '))
            && (((iMatch + valueLen) >= headerLen) || (header[iMatch + valueLen] === ' '))) {
          iBestMatch = iMatch;
          break;
        }

        // if match not delimited, save it anyway if it's the first match
        if (iStart === 0) iBestMatch = iMatch;
        iStart = iMatch + valueLen;
      }

      // if any match found, find the end column a the next non-blank or end of header
      if (iBestMatch !== -1) {
        let iEndMatch = iBestMatch + valueLen;
        while ((iEndMatch < headerLen) && (header[iEndMatch] === ' ')) iEndMatch += 1;
        startEndCols.push(iBestMatch);
        startEndCols.push(iEndMatch);
      }
    }

    return startEndCols;
  }

  // helper function to update the values of the variables in the database
  function updateVariableValues(client, databaseKey, databaseValue, variables, saveToDb) {
    soap.createClient(client, (err, soapClient) => {
      // clear the results arrray to startEndCols
      resultsArray = [];

      if (err) {
        alert.raise({ key: 'client-error', errorMsg: err.message });
        updateConnectionStatus(false);
        return;
      }

      alert.clear('client-error');
      updateConnectionStatus(true);

      // if getting production list info only
      if (_.get(that.machine.settings.model, 'getOnlyProductionListInfo', false)) {
        // request the data
        soapClient.HDVEGetCurrentProductionInformationList(getDataArgs, (getErr, result) => {
          const results = _.get(result, 'HDVEGetCurrentProductionInformationListResult.CurrentProductionInfo', null);
          if ((results === null) || (results.length === 0)) return;

          for (let iVar = 0; iVar < variables.length; iVar += 1) {
            // 2 special cases: manufacturing site and manufacturing site ID
            // - get from the machine definition
            if (variables[iVar].name === manufacturingSiteName) {
              resultsArray.push(convertStringResult(variables[iVar].format,
                that.machine.settings.model.manufacturingSite));
            } else if (variables[iVar].name === manufacturingSiteIDName) {
              resultsArray.push(convertStringResult(variables[iVar].format,
                that.machine.settings.model.manufacturingSiteID));
            } else {
              switch (variables[iVar].productionInfoType) {
                case 'Order Number':
                  resultsArray.push(convertStringResult(variables[iVar].format,
                    _.get(results[0], 'ORDER_NUMBER', null)));
                  break;
                case 'Part Number':
                  resultsArray.push(convertStringResult(variables[iVar].format,
                    _.get(results[0], 'PART_NUMBER', null)));
                  break;
                case 'Tool Number':
                  resultsArray.push(convertStringResult(variables[iVar].format,
                    _.get(results[0], 'TOOL_NUMBER', null)));
                  break;
                default:
                  resultsArray.push(null);
              }
            }
          }

          // save results to database
          saveToDb();
        });
      } else { // it querying table values
        // get the correct data function, based on the query operation
        let getDataFunction; let
          getDataFunctionResult;
        switch (_.get(that.machine.settings.model, 'queryOperation', getDataOp)) {
          case getDataMachineBasedOp:
            getDataFunction = soapClient.HDVEGetDataMachineBased;
            getDataFunctionResult = 'HDVEGetDataMachineBasedResult';
            break;
          case getRunningOrdersOp:
            getDataFunction = soapClient.HDVEGetRunningOrders;
            getDataFunctionResult = 'HDVEGetRunningOrdersResult';
            break;
          default:
            getDataFunction = soapClient.HDVEGetData;
            getDataFunctionResult = 'HDVEGetDataResult';
            break;
        }

        // request the data
        getDataFunction(getDataArgs, (getErr, result) => {
          if (result[getDataFunctionResult] === undefined) return;

          // get raw data lines split on carriange return, line feed
          const rawDataLines = result[getDataFunctionResult].split('\r\n');
          if (rawDataLines.length < 2) return;

          // get the start and end columns of the database key in the header
          let startEndCols = getColsFromHeader(rawDataLines[0], databaseKey);
          if (startEndCols.length !== 2) return;

          // find the first row that contains the database value on the key column
          let iKeyRow;
          for (iKeyRow = 1; iKeyRow < rawDataLines.length; iKeyRow += 1) {
            if (rawDataLines[iKeyRow].substring(startEndCols[0], startEndCols[1]).trim()
               === databaseValue) break;
          }
          if (iKeyRow >= rawDataLines.length) return;

          // for each variable, find its columns from the column header and
          // get it value from the key row
          for (let iVar = 0; iVar < variables.length; iVar += 1) {
            // 2 special cases: manufacturing site and manufacturing site ID
            // - get from the machine definition
            if (variables[iVar].name === manufacturingSiteName) {
              resultsArray.push(convertStringResult(variables[iVar].format,
                that.machine.settings.model.manufacturingSite));
            } else if (variables[iVar].name === manufacturingSiteIDName) {
              resultsArray.push(convertStringResult(variables[iVar].format,
                that.machine.settings.model.manufacturingSiteID));
            } else {
              startEndCols = getColsFromHeader(rawDataLines[0], variables[iVar].requestKey);
              // if variable value found, add the value to the results array
              if (startEndCols.length === 2) {
                resultsArray.push(convertStringResult(variables[iVar].format,
                  rawDataLines[iKeyRow].substring(startEndCols[0], startEndCols[1]).trim()));
              } else { // if no found, add a empty string to the results array
                resultsArray.push(null);
              }
            }
          }

          // save results to database
          saveToDb();
        });
      }
    });
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
            msg: 'SOAP: Read Failed for Variable',
            description: `Read failed for variable '${variable.name}'. Check that this variable is defined correctly in the machine.`,
          });
          // and just move onto next item
          return callback();
        }

        alert.clear(`read-fail-${variable.name}`);

        // othewise update the database
        that.dataCb(that.machine, variable, dataItem, (err) => {
          if (err) {
            alert.raise({ key: 'database-error', errorMsg: err.message });
          } else {
            alert.clear('database-error');
          }
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
    if ((sendingActive === false) || (requestBlockedCounter > 10)) {
      // reset storage and index for starting a new request set
      requestBlockedCounter = 0;
      resultsArray = [];

      // make a tcp request for first var in list (but only if request key exists)
      sendingActive = true;

      // get the MES data and save the result to the database
      updateVariableValues(that.machine.settings.model.clientURL,
        that.machine.settings.model.databaseKey,
        that.machine.settings.model.databaseValue, that.machine.variables, saveResultsToDb);
    } else {
      requestBlockedCounter += 1;
    }
  }

  // helper function for v-link protocol mode to convert the format into number of words to read
  function open(callback) {
    const requestFrequencyMs = that.machine.settings.model.requestFrequency * 60000;

    // if using req/res mode then set up a repeat task to trigger the requests
    timer = setInterval(requestTimer, requestFrequencyMs);

    // if an alias is set, set the arguments for the get data function call
    if (_.get(that.machine.settings.model, 'useAlias', false)) {
      const alias = _.get(that.machine.settings.model, 'alias', null);
      if (alias !== null) {
        getDataArgs = { alias };
      }
    } else {
      getDataArgs = null;
    }

    // if getting production list info only, set the machine argument
    if (_.get(that.machine.settings.model, 'getOnlyProductionListInfo', false)) {
      const infoMachine = _.get(that.machine.settings.model, 'machine', '');
      if (getDataArgs === null) {
        getDataArgs = { machine: infoMachine };
      } else {
        getDataArgs.machine = infoMachine;
      }
    }

    // tests to see if manufacturing site and manufacturing site ID variables
    // are within the variable list already
    const manufacturingSiteIndex = that.machine.variables.findIndex(
      element => element.name === manufacturingSiteName,
    );
    const manufacturingSiteIDIndex = that.machine.variables.findIndex(
      element => element.name === manufacturingSiteIDName,
    );

    // if manufacturing site is not there, add it
    if (manufacturingSiteIndex === -1) {
      const manufacturingSiteVar = {
        name: manufacturingSiteName,
        description: 'Manufacturing Site',
        format: 'char',
      };

      that.machine.variables.push(manufacturingSiteVar);
    }

    // if manufacturing site ID is not there, add it
    if (manufacturingSiteIDIndex === -1) {
      const manufacturingSiteIDVar = {
        name: manufacturingSiteIDName,
        description: 'Manufacturing Site ID',
        format: 'char',
      };

      that.machine.variables.push(manufacturingSiteIDVar);
    }

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

    // make sure all MES table query variables have a request key and
    // all production info list variables have a production info type
    for (let iVar = 0; iVar < that.machine.variables.length; iVar += 1) {
      const variable = that.machine.variables[iVar];
      if ((variable.name !== manufacturingSiteName)
              && (variable.name !== manufacturingSiteIDName)) {
        if (_.get(that.machine.settings.model, 'getOnlyProductionListInfo', false)) {
          if (!_.has(variable, 'productionInfoType')) {
            alert.raise({ key: 'production-info-type-error' });
            return done(new Error('All production info list variables require a production info type'));
          }
        } else if (!_.has(variable, 'requestKey')) {
          alert.raise({ key: 'request-key-error' });
          return done(new Error('All MES table query variables require a request key'));
        }
      }
    }
    alert.clear('request-key-error');
    alert.clear('production-info-type-error');

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
    updateConnectionStatus(false);
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
  hpl: hplSoap,
  defaults,
  schema,
};
