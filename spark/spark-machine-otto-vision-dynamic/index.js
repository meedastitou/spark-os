/* jshint esversion: 6 */
const { EventEmitter } = require('events');

const _ = require('lodash');
const net = require('net');
const camelCase = require('camelcase');
const xml2js = require('xml2js');
const pkg = require('./package.json');
const config = require('./config.json');

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};
config.info = info;

const deliverEntireResultVariable = {
  name: 'CombinedResult',
  description: 'CombinedResult',
  format: 'char',
  array: true,
};

let combinedVariableArray = [];
let duplicateCombinedVariableNamesArray = [];

let log;
let db;
let conf;
let firstStart = true;
let bStarted = false;
let alert = null;

let server = null;
let serverSocket = null;

let resultsArray = [];
let iTimestampVariable = -1;

let connectTimer = null;
const CONNECT_TIME_OUT = 60 * 1000;

// concatenated publish buffer size limited to 1 MB
const MAX_PUBLISH_BUFFER_SIZE = (1024 * 1024);
const PUBLISH_TERMINATOR = '<!--END-->';

let rawConcatBuffer = '';
let bufferOverrun = false;

const MAX_XML_PARSE_ERROR = 3;
let xmlParseErrorCount = 0;

let cavityCount = 1;

const ottoVisionDynamic = new EventEmitter();


function checkNewDataMatchesCurrentVariables(result) {
  // do an initial check to see if the number of Merkmal tags
  // is the same as the number of non-timestamp variables
  const nNonTimestampVariables = (iTimestampVariable === -1)
    ? config.variables.length : config.variables.length - 1;
  if (result.KernelData.OrderHeader[0].Merkmal.length !== nNonTimestampVariables) {
    // if its not, then return false straight away
    return false;
  }
  // loop through the stored variable list
  for (let iVar = 0; iVar < config.variables.length; iVar += 1) {
    const expectedVariableName = config.variables[iVar].name;

    // if not the timestamp variable, check its name
    if (iVar !== iTimestampVariable) {
      // extract the name we have received
      let variableNameInNewData = result.KernelData.OrderHeader[0].Merkmal[iVar].$.Bezeichnung;
      // convert name to camel case (this also removes spaces)
      variableNameInNewData = camelCase(variableNameInNewData);
      // then enforce our naming convention for variables
      variableNameInNewData = variableNameInNewData.replace(/[^a-zA-Z0-9-_]/g, '');

      // now compare to see if we have this variable already
      // (the stored variable name has already been processed as above)
      if (expectedVariableName !== variableNameInNewData) {
        // return false as soon as we get one failed match
        return false;
      }
    }
  }

  return true;
}

function parseDataAndCreateVariables(result) {
  //  console.log('-------------------- result =');
  //  console.log(JSON.stringify(result));

  let checkForTimestampVariableFlag = false;

  // assume no timestamp variable to start
  iTimestampVariable = -1;

  // first, let's see how many cavities are being reported
  if ((_.has(result.KernelData.OrderHeader[0], '$'))
      && (_.has(result.KernelData.OrderHeader[0].$, 'Cavities'))) {
    cavityCount = result.KernelData.OrderHeader[0].$.Cavities;
  } else {
    cavityCount = 1;
  }

  // create the variable array
  for (let iMerkmal = 0;
    iMerkmal < result.KernelData.OrderHeader[0].Merkmal.length; iMerkmal += 1) {
    // convert name to camel case (this also removes spaces)
    let name = camelCase(result.KernelData.OrderHeader[0].Merkmal[iMerkmal].$.Bezeichnung);
    // remove any non legal characters
    name = name.replace(/[^a-zA-Z0-9-_]*/g, '');

    // add the new variable to config list
    if (config.settings.model.deliverEntireResponse !== true) {
      const variable = {
        name,
        description: result.KernelData.OrderHeader[0].Merkmal[iMerkmal].$.Bezeichnung,
        format: 'float',
        array: true,
      };

      config.variables.push(variable);
    } else {
      const lowerLimit = result.KernelData.OrderHeader[0].Merkmal[iMerkmal].$.UntereToleranz;
      const upperLimit = result.KernelData.OrderHeader[0].Merkmal[iMerkmal].$.ObereToleranz;
      const nominalValue = result.KernelData.OrderHeader[0].Merkmal[iMerkmal].$.Sollmasz;
      const engineeringUnits = result.KernelData.OrderHeader[0].Merkmal[iMerkmal].$.Einheit;
      const variable = {
        name,
        lowerLimit,
        upperLimit,
        nominalValue,
        engineeringUnits,
      };
      combinedVariableArray.push(variable);
      checkForTimestampVariableFlag = true;
    }
  }

  if (config.settings.model.deliverEntireResponse !== true) {
    if (config.variables.length > 0) {
      checkForTimestampVariableFlag = true;
    }
  }

  // create a timestamp variable if the first variable has a timestamp anywhere in the results
  if (checkForTimestampVariableFlag === true) {
    let firstVarName;

    if (config.settings.model.deliverEntireResponse !== true) {
      firstVarName = config.variables[0].name;
    } else {
      // eslint-disable-next-line prefer-destructuring
      firstVarName = combinedVariableArray[0].name;
      // in any reasonable language, this would be acceptable.  However,
      // eslint flags this as an error for "prefer-destructuring".  To
      // eliminate this error, the line would be written as:
      // [firstVarName] = combinedVariableArray;
    }

    if (_.has(result.KernelData, 'OrderData') && _.has(result.KernelData.OrderData[0], 'R')) {
      const orderDataArray = result.KernelData.OrderData[0].R;
      for (let iResult = 0; iResult < orderDataArray.length; iResult += 1) {
        if (camelCase(orderDataArray[iResult].$.N) === firstVarName) {
          if (orderDataArray[iResult].$.Timestamp !== undefined) {
            // add the timestamp variable to config list
            if (config.settings.model.deliverEntireResponse !== true) {
              // save the location in the variable array of the timestamp variable
              iTimestampVariable = config.variables.length;

              // create the timestamp variable
              const tsVariable = {
                name: 'timestamp',
                description: 'Timestamp Array',
                format: 'char',
                array: true,
              };

              config.variables.push(tsVariable);
            } else {
              // save the location in the variable array of the timestamp variable
              iTimestampVariable = combinedVariableArray.length;

              const variable = {
                name: 'timestamp',
              };
              combinedVariableArray.push(variable);
            }
            break;
          }
        }
      }
    }
  }

  if (config.settings.model.deliverEntireResponse !== true) {
    //  now update the config db store
    conf.set(`machines:${pkg.name}:variables`, config.variables, () => {
    });
  }
}

// helper function to get the index of a variable give its description, returns -1 if not found
function indexOfVariable(description) {
  if (config.settings.model.deliverEntireResponse !== true) {
    for (let iVar = 0; iVar < config.variables.length; iVar += 1) {
      if (config.variables[iVar].description === description) return iVar;
    }
  } else {
    // convert name to camel case (this also removes spaces)
    let name = camelCase(description);
    // remove any non legal characters
    name = name.replace(/[^a-zA-Z0-9-_]*/g, '');
    for (let iVar = 0; iVar < combinedVariableArray.length; iVar += 1) {
      if (combinedVariableArray[iVar].name === name) return iVar;
    }
  }

  return -1;
}


// helper function to fill the results array with arrays of results for all variables
function fillResultsArray(result) {
  // reset results array
  resultsArray = [];
  let iVar;

  // add the results for each variable to its array, in order
  const orderDataArray = result.KernelData.OrderData[0].R;
  for (let iResult = 0; iResult < orderDataArray.length; iResult += 1) {
    iVar = indexOfVariable(orderDataArray[iResult].$.N);
    if (iVar !== -1) {
      const cavityIndex = Number(_.get(orderDataArray[iResult].$, 'Cavity', 0));
      const loopResult = parseFloat(orderDataArray[iResult].$.R);
      if (resultsArray[iVar] === undefined) {
        // this is the first result for this variable
        resultsArray[iVar] = [];
      }
      if (cavityCount > 1) {
        if (resultsArray[iVar][cavityIndex] === undefined) {
          resultsArray[iVar][cavityIndex] = [];
        }
        resultsArray[iVar][cavityIndex].push(loopResult);
      } else {
        resultsArray[iVar].push(loopResult);
      }

      // if first variable and there is a timestamp array, add the timestamp, if it exists
      if ((iVar === 0) && (iTimestampVariable !== -1)) {
        const timestamp = orderDataArray[iResult].$.Timestamp;
        if (timestamp !== undefined) {
          if (resultsArray[iTimestampVariable] === undefined) {
            // this is the first result for this variable
            resultsArray[iTimestampVariable] = [];
          }
          if (cavityCount > 1) {
            if (resultsArray[iTimestampVariable][cavityIndex] === undefined) {
              // this is the first result for this variable
              resultsArray[iTimestampVariable][cavityIndex] = [];
            }
            resultsArray[iTimestampVariable][cavityIndex].push(timestamp);
          } else {
            resultsArray[iTimestampVariable].push(timestamp);
          }
        }
      }
    }
  }
}

function dbAddResult(err, res) {
  if (err) {
    alert.raise({ key: 'database-error', errorMsg: err.message });
  } else {
    alert.clear('database-error');
  }
  if (res) log.debug(res);
}

function processPublishedData(dataString) {
  const { variables } = config;

  // parse the XML
  const { parseString } = xml2js;
  try {
    parseString(dataString, (err, result) => {
      if (err) {
        // raise an XML parse error only if several consecutive errors
        xmlParseErrorCount += 1;
        if (xmlParseErrorCount >= MAX_XML_PARSE_ERROR) {
          alert.raise({ key: 'xml-parse-error', errorMsg: err.message });
        }
        return;
      }

      xmlParseErrorCount = 0;
      alert.clear('xml-parse-error');


      // make sure this is a normal XML file containing variables and values -
      // if not ignore it (e.g., could be just contain a JPG file)
      if (!_.has(result, 'KernelData.OrderHeader') || !_.has(result.KernelData.OrderHeader[0], 'Merkmal')) {
        return;
      }

      if (config.settings.model.deliverEntireResponse === true) {
        combinedVariableArray = [];
        parseDataAndCreateVariables(result);
        fillResultsArray(result);

        // loop through the stored variable list
        const combinedResultArray = [];
        const newDuplicateCombinedVariableNamesArray = [];
        for (let iVar = 0; iVar < combinedVariableArray.length; iVar += 1) {
          let duplicateNameFlag = false;
          for (let duplicateCheckIndex = 0;
            duplicateCheckIndex < combinedResultArray.length;
            duplicateCheckIndex += 1) {
            if (combinedResultArray[duplicateCheckIndex].name
                === combinedVariableArray[iVar].name) {
              combinedResultArray.splice(duplicateCheckIndex, 1);
              duplicateNameFlag = true;
              const duplicateName = combinedVariableArray[iVar].name;
              if (newDuplicateCombinedVariableNamesArray.indexOf(duplicateName) === -1) {
                newDuplicateCombinedVariableNamesArray.push(duplicateName);
                alert.raise({
                  key: `duplicate-variable-error-${duplicateName}`,
                  msg: `Otto Vision Dynamic: Duplicate Variable Ignored: ${duplicateName}`,
                  description: `The duplicate variable ${duplicateName} appeared in the XML data and will be ignored.`,
                });
              }
            }
          }
          if (duplicateNameFlag === false) {
            if (cavityCount > 1) {
              for (let cavityIndex = 0; cavityIndex < cavityCount; cavityIndex += 1) {
                const data = {
                  name: combinedVariableArray[iVar].name,
                };
                // only add in metadata that has actual values
                if (combinedVariableArray[iVar].lowerLimit !== null) {
                  data.lowerLimit = combinedVariableArray[iVar].lowerLimit;
                }
                if (combinedVariableArray[iVar].upperLimit !== null) {
                  data.upperLimit = combinedVariableArray[iVar].upperLimit;
                }
                if (combinedVariableArray[iVar].nominalValue !== null) {
                  data.nominalValue = combinedVariableArray[iVar].nominalValue;
                }
                if (combinedVariableArray[iVar].engineeringUnits !== null) {
                  data.engineeringUnits = combinedVariableArray[iVar].engineeringUnits;
                }
                data.cavity = cavityIndex;
                data.value = resultsArray[iVar][cavityIndex];
                // console.log('data = ' + JSON.stringify(data));
                combinedResultArray.push(data);
              }
            } else {
              const data = {
                name: combinedVariableArray[iVar].name,
              };
              // only add in metadata that has actual values
              if (combinedVariableArray[iVar].lowerLimit !== null) {
                data.lowerLimit = combinedVariableArray[iVar].lowerLimit;
              }
              if (combinedVariableArray[iVar].upperLimit !== null) {
                data.upperLimit = combinedVariableArray[iVar].upperLimit;
              }
              if (combinedVariableArray[iVar].nominalValue !== null) {
                data.nominalValue = combinedVariableArray[iVar].nominalValue;
              }
              if (combinedVariableArray[iVar].engineeringUnits !== null) {
                data.engineeringUnits = combinedVariableArray[iVar].engineeringUnits;
              }
              data.value = resultsArray[iVar];
              combinedResultArray.push(data);
            }
          }
        }

        // clear alerts for any duplicate names that have been removed
        for (let iDup = 0; iDup < duplicateCombinedVariableNamesArray.length; iDup += 1) {
          const duplicateName = duplicateCombinedVariableNamesArray[iDup];
          if (newDuplicateCombinedVariableNamesArray.indexOf(duplicateName) === -1) {
            alert.clear(`duplicate-variable-error-${duplicateName}`);
          }
        }

        // save current duplicate names for next time
        duplicateCombinedVariableNamesArray = newDuplicateCombinedVariableNamesArray;

        const combinedResultsData = {
          machine: config.info.name,
          variable: 'CombinedResult',
          CombinedResult: combinedResultArray,
        };

        // console.log('combinedResultsData = ' + JSON.stringify(combinedResultsData));


        db.add(combinedResultsData, dbAddResult);
      } else if (config.variables.length === 0) {
        // check if there are any variables configured yet
        log.info('Create initial variable list');
        // no variables, we need to parse the data to create them
        parseDataAndCreateVariables(result);
      } else if (checkNewDataMatchesCurrentVariables(result)) {
        // we have variables, check they match with the current data we have been given
        // get fill the results array with the results for all variables
        fillResultsArray(result);

        // loop through the stored variable list
        for (let iVar = 0; iVar < variables.length; iVar += 1) {
          const variable = variables[iVar];

          const data = {
            machine: config.info.name,
            variable: variable.name,
          };

          if (cavityCount > 1) {
            for (let cavityIndex = 0; cavityIndex < cavityCount; cavityIndex += 1) {
              const value = {
                cavity: cavityIndex,
                value: resultsArray[iVar][cavityIndex],
              };
              data[variable.name] = value;
              db.add(data, dbAddResult);
            }
          } else {
            data[variable.name] = resultsArray[iVar];
            db.add(data, dbAddResult);
          }
        }
      } else {
        log.info('Variable change detected, update variable list');

        // else clear variable data, and do as if no variables above
        config.variables = [];
        parseDataAndCreateVariables(result);
      }
    });
  } catch (error) {
    log.error('Error occurred parsing XML:', error);
  }
}

function concatPublishedData(newData, terminator) {
  // check we have enough room to append the new data to our buffer
  if (rawConcatBuffer.length + newData.length <= MAX_PUBLISH_BUFFER_SIZE) {
    // add the new data to the string buffer
    rawConcatBuffer += newData;

    // search for terminator at end of buffer
    const iTerminator = rawConcatBuffer.lastIndexOf(terminator);
    if (iTerminator !== -1) {
      // if terminator found, we must have the whole message: pass string to process function
      if (!bufferOverrun) {
        processPublishedData(rawConcatBuffer.substring(0, iTerminator));
        alert.clear('buffer-overrun-error');
      } else {
        bufferOverrun = false;
      }

      // and clear the buffer size ready for the next message
      rawConcatBuffer = '';
    }
  } else {
    // Publish buffer grown too large, deleting
    rawConcatBuffer = '';
    bufferOverrun = true;
    alert.raise({ key: 'buffer-overrun-error' });
  }
}

function updateConnectionStatus(connected) {
  conf.set(`machines:${pkg.name}:settings:model:connectionStatus`, connected, () => {});
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
        ottoVisionDynamic.emit('restartRequest', info.name);
      }
    });
  }
}

function writeBackConfig(callback) {
  // if process has just started up
  if (firstStart === true) {
    firstStart = false;
    // write back config incase config json file had newer data than config database
    conf.set(`machines:${pkg.name}`, config, callback);
    return undefined;
  }
  // other
  return callback();
}


ottoVisionDynamic.start = function start(modules, done) {
  // return error if already started
  if (bStarted) return done(new Error('already started'));

  log = modules['spark-logging'].exports.getLogger(pkg.name);
  db = modules['spark-db'].exports;
  conf = modules['spark-config'].exports;
  alert = modules['spark-alert'].exports.getAlerter(pkg.name);

  // preload alert messages that have known keys
  alert.preLoad({
    'connect-error': {
      msg: 'Otto Vision Dynamic: Could not Connect to the Client',
      description: 'Could not connect to the client.  Check the connection to the vision system.',
    },
    'database-error': {
      msg: 'Otto Vision Dyanmic: Error Writing to Database',
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
    'xml-parse-error': {
      msg: 'Otto Vision Dynamic: Error Parsing XML',
      description: x => `An error occurred while parsing the XML data from the vision system. Error: ${x.errorMsg}`,
    },
    'buffer-overrun-error': {
      msg: 'Otto Vision Dynamic: XML Data Too Large',
      description: 'The XML data receieved from the vision system was too large to process.',
    },
  });

  xmlParseErrorCount = 0;

  updateConnectionStatus(false);

  // listen for changes to the enable key
  // but only add the listener once
  if (conf.listeners('set').indexOf(onSetListener) === -1) {
    log.debug('config.settings.model.enable', config.settings.model.enable);
    conf.on('set', onSetListener);
  }

  // read the current settings from the database model
  conf.get(`machines:${pkg.name}:settings:model`, (err, model) => {
    // if there is model data in the db, update to it (overwrite what was read from readonly file)
    if (model) {
      config.settings.model = model;
    }

    if (config.settings.model.deliverEntireResponse === true) {
      if ((config.variables.length !== 1)
          || (!_.isEqual(config.variables[0], deliverEntireResultVariable))) {
        // if we're not already set up with the combined-response-variable,
        // set it up and force a database updated
        config.variables = [deliverEntireResultVariable];
        firstStart = true;
      }
    } else if ((config.variables.length === 1)
               && (_.isEqual(config.variables[0], deliverEntireResultVariable))) {
      // if we WERE set up with the combined-response-variable,
      // clear it and force a database updated
      config.variables = [];
      firstStart = true;
    }

    // save our config if necessary
    writeBackConfig((writeErr) => {
      if (writeErr) {
        return done(writeErr);
      }

      // check enable state before continuing
      if (!config.settings.model.enable) {
        log.info('Disabled');
        return done(null, config.info);
      }
      // create a one-shot timer to check for a connection error
      connectTimer = setTimeout(() => {
        alert.raise({ key: 'connect-error' });
        connectTimer = null;
      }, CONNECT_TIME_OUT);

      // create the server
      server = net.createServer((socket) => {
        // client succesfully connected our server
        updateConnectionStatus(true);

        // clear the connection timer and any connection alert
        clearTimeout(connectTimer);
        connectTimer = null;
        alert.clear('connect-error');

        // if we are already connected to a client, close it
        if (serverSocket !== null) {
          log.info(`closing socket with client: ${serverSocket.remoteAddress}`);
          serverSocket.destroy();
        }

        log.info(`Connected to client: ${socket.remoteAddress}`);

        // set the encoding for a string so that can concatenate data to the end of current string
        socket.setEncoding('utf8');

        // store a reference to the socket (so we can destroy it if we need to close the server)
        serverSocket = socket;

        // subscribe to on 'data' events
        socket.on('data', (data) => {
          // got data from client
          // pass XML to function that concatenates XML until the terminator and then processes it
          concatPublishedData(data, PUBLISH_TERMINATOR);
        });

        // subscribe to on 'error' events
        socket.on('error', (error) => {
          // emit a disconnect back to the spark machine layer
          log.info(`Server error: ${error.message}`);
          socket.destroy();
          serverSocket = null;
          updateConnectionStatus(false);
          alert.raise({ key: 'connect-error' });
        });

        // subscribe to on 'end' events
        socket.on('end', () => {
          // emit a disconnect back to the spark machine layer
          log.info('Client disconnected');
          socket.destroy();
          serverSocket = null;
          updateConnectionStatus(false);
          alert.raise({ key: 'connect-error' });
        });
      }).listen(config.settings.model.port);

      // we do not wait for a client connection to declare 'start' a success
      log.info('Started', pkg.name);
      bStarted = true;
      return done(null, config.info);
    });
  });

  return undefined;
};

ottoVisionDynamic.stop = function stop(done) {
  // return error if not started
  // NOTE: This test removed because it causes a problem:
  //  spark-plugin stops machines that are already stopped
  // if (!bStarted) return done(new Error('not started'));

  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }

  if (server) {
    server.close(() => {
      // callback only trigger when all sockets have been destroyed
      log.info('Stopped', pkg.name);
      server = null;
      updateConnectionStatus(false);
      alert.clearAll(() => {
        bStarted = false;
        return done(null);
      });
    });
    // if server has an active connection,
    // the socket used must also be destoyed for the above close to be succesful
    if (serverSocket !== null) {
      serverSocket.destroy();
      serverSocket = null;
    }
  } else {
    alert.clearAll(() => {
      bStarted = false;
      return done(null);
    });
  }
};

ottoVisionDynamic.require = function require() {
  return ['spark-logging',
    'spark-db',
    'spark-config',
    'spark-alert',
  ];
};

module.exports = ottoVisionDynamic;
