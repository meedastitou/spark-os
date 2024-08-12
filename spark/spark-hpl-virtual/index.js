/* jshint esversion: 6 */
/* eslint no-bitwise: ["error", { "allow": ["&"] }] */
const _ = require('lodash');
const async = require('async');
const mssql = require('mssql');
const mysql = require('promise-mysql');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplVirtual = function hplVirtual(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;
  let variables = null;
  let varValues = null;
  let currAlarmMachine = {};
  let currAlarmVariable = {};
  let currMatchCount = {};
  let changeTimers = {};
  let alertTimers = {};
  let reconnectTimer = null;

  const sqlDbRequestDbIDs = [];
  const sqlDbRequest = {};
  const sqlDbConnectionPool = {};

  const RECONNECT_TIME = 10000; // 10 seconds

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine, {
    settings: {
      model,
    },
  });

  // helper function to convert a string formatted result into its correct 'format'
  function convertStringResult(format, resultString) {
    // don't convert unless it is string
    if (typeof resultString !== 'string') return resultString;

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

  // this function is called when a timeout occurs from a auto-alarm-update variable.operation.
  // the user is able to specify a value that is output if no other variables change within a
  // specified time.
  function autoAlarmUpdateChangeTimeout(variable) {
    changeTimers[variable.name] = null;
    that.dataCb(that.machine, variable, variable.changeTimeoutValue, () => {
    });
  }

  // this function is called when a timeout occurs from the level 1 status idicator operation
  // to set the variable to 0
  function statusIndicatorChangeTimeout(variable) {
    changeTimers[variable.name] = null;
    that.dataCb(that.machine, variable, 0, () => {
    });
  }

  // this function is called when a timeout occurs from a Variable-Alert variable.operation.
  // THe alert variable is set to true when its destination value is written, then a timer
  // is used to specify how long until returning to false.
  function variableUpdateAlertTimeout(variable, changedVariable) {
    // console.log('-----variableUpdateAlertTimeout: variable: ' +
    //              JSON.stringify(variable) + '    changedVariable: ' + changedVariable);
    alertTimers[changedVariable] = null;
    // console.log('-----setting variable: ' + variable.name + ' to FALSE');
    that.dataCb(that.machine, variable, false, () => {
    });
  }

  function databaseListener(key) {
    // find the machine name in the given key
    const changedMachine = key.split(':')[1];
    if (!(changedMachine in variables)) {
      // key is not for a srcMachine we are interested in
      return;
    }

    // get the value that was added the the database
    db.get(key, (getErr, entry) => {
      const changedVariable = entry.variable;

      // check if this is for a variable we are interested in
      if (!(changedVariable in variables[changedMachine])) {
        return;
      }

      // get previous value of this variable for persistent counter
      let previousVarVal = varValues[changedMachine][changedVariable];

      // if previous value is null, set the saved value to zero
      // (this is for variables that are not peristent counters)
      if (previousVarVal === null) {
        previousVarVal = 0.0;
        varValues[changedMachine][changedVariable] = 0.0;
      }

      // used to indicate the value to use to update varValue[][] at the end of the processing.
      let updatedVarValue = null;
      // cannot be updated DURING processing as other variable may need the previous varValue also.

      // loop through the (possible array, or possibly single entry) of each virtual variable
      // that is interested in this src machine's variable
      async.eachSeries(variables[changedMachine][changedVariable], (variable, cb1) => {
        if (variable.operation === 'summation') {
          let sum = 0;
          // loop through each source variable in this summation variable
          async.eachSeries(variable.srcVariables, (srcVariable, cb2) => {
            // if this is the source variable that changed, update the stored value
            if ((srcVariable.srcMachine === changedMachine)
              && (srcVariable.srcVariable === changedVariable)) {
              // if changed value is a valid number, save its value
              const changedValue = convertStringResult(variable.format, entry[entry.variable]);
              if (!Number.isNaN(changedValue)) {
                updatedVarValue = changedValue;
                sum += changedValue; // update the sum with the new variable's value
              }
            } else {
              // update the sum with this variable's previous value
              // (since it wasn't the one that changed here)
              sum += varValues[srcVariable.srcMachine][srcVariable.srcVariable];
            }
            cb2(null);
          }, (err) => {
            if (err) {
              log.error(err);
            }

            // write the sum to the database
            that.dataCb(that.machine, variable, sum, dbErr => cb1(dbErr));
          });
        } else if (variable.operation === 'alarm-combination') {
          // get the value of the changed variable as a boolean
          const entryValue = entry[entry.variable];
          const bValue = typeof entryValue === 'boolean' ? entry[entry.variable] : convertStringResult('bool', entry[entry.variable]);

          // update the value to store after processing
          updatedVarValue = bValue;

          let bFound = false;
          let successValue = 0;

          // if the alarm is currently set by this variable
          if ((currAlarmMachine[variable.name] === changedMachine)
            && (currAlarmVariable[variable.name] === changedVariable)) {
            // if the value is now false, find the next variable, if any, and use it for the alarm
            if (!bValue) {
              async.eachSeries(variable.srcVariables, (srcVariable, cb2) => {
                let valueToUseForCheck = varValues[srcVariable.srcMachine][srcVariable.srcVariable];
                if ((srcVariable.srcMachine === changedMachine)
                  && (srcVariable.srcVariable === changedVariable)) {
                  // can't use varValues[][] since it won't be actually changed
                  // until processing finishes
                  valueToUseForCheck = bValue;
                }
                if ((!bFound) && (valueToUseForCheck === true)) {
                  currAlarmMachine[variable.name] = srcVariable.srcMachine;
                  currAlarmVariable[variable.name] = srcVariable.srcVariable;
                  ({ successValue } = srcVariable);
                  bFound = true;
                }

                cb2(null);
              }, (err) => {
                if (err) {
                  log.error(err);
                }

                // if no new alarm value found, clear the alarm machine and variable
                if (!bFound) {
                  currAlarmMachine[variable.name] = null;
                  currAlarmVariable[variable.name] = null;
                }
                bFound = true; // ensure that we write to our virtual variable
              });
            }
          // if the alarm is not currently set by any variable
          } else if ((currAlarmMachine[variable.name] === null)
               && (currAlarmVariable[variable.name] === null)) {
            // if the value is true, update current alarm machine and variable and set
            // the output variable from the changed variable's success value
            if (bValue) {
              async.eachSeries(variable.srcVariables, (srcVariable, cb2) => {
                if ((srcVariable.srcMachine === changedMachine)
                  && (srcVariable.srcVariable === changedVariable)) {
                  ({ successValue } = srcVariable);
                  bFound = true;
                }

                cb2(null);
              }, (err) => {
                if (err) {
                  log.error(err);
                }

                // if new alarm value found update current alarm machine and
                // variable and write its successValue to the database
                if (bFound) {
                  currAlarmMachine[variable.name] = changedMachine;
                  currAlarmVariable[variable.name] = changedVariable;
                }
              });
            }
          }
          if (bFound) {
            that.dataCb(that.machine, variable, successValue, err => cb1(err));
          } else {
            return cb1(null);
          }
        } else if (variable.operation === 'persistent counter') {
          if (variable.srcVariables.length > 0) {
            const srcVariable = variable.srcVariables[0];

            // if this is the source variable that changed
            if ((srcVariable.srcMachine === changedMachine)
              && (srcVariable.srcVariable === changedVariable)) {
              // if changed value is a valid number, save its value
              const changedValue = convertStringResult(variable.format, entry[entry.variable]);
              if (!Number.isNaN(changedValue)) {
                // update the value to store after processing
                updatedVarValue = changedValue;

                // if not first value
                if (previousVarVal !== null) {
                  // get the current value of the peristent counter
                  db.get(`machine:${that.machine.info.name}:persist:${variable.name}`, (err, persistentCount) => {
                    let currPersistentCount = (persistentCount === null)
                      ? 0 : persistentCount[persistentCount.variable];
                    // if the counter increased, increase the peristent counter the same amount
                    if (changedValue >= previousVarVal) {
                      currPersistentCount += changedValue - previousVarVal;
                    } else {
                      // for now, simply add 1 to the persistent counter when
                      // we see a rollover (or reset)
                      currPersistentCount += 1;

                      /* previous methodlogy left in below for referenced
                      // if the counter decreased, increase the peristent counter by its
                      // total change
                      let totalChange = changedValue;
                      if (variable.hasOwnProperty('rolloverValue')
                       && (previousVarVal < variable.rolloverValue)) {
                        totalChange += (variable.rolloverValue - previousVarVal) - 1;
                      }

                      currPersistentCount[variable.name] += totalChange + 1;
                      */
                    }
                    // save the peristent counter to the database
                    that.dataCb(that.machine, variable, currPersistentCount, () => {
                      // create the data object and write the persisent count to persisent storage
                      const persistData = {
                        machine: that.machine.info.name,
                        variable: variable.name,
                        access: 'persist',
                      };
                      persistData[variable.name] = currPersistentCount;

                      // write the data to the destination machine and variable
                      db.set(persistData, () => {
                        // save the value of the variable this persisent counter
                        // depends on to the database
                        const sourceData = {
                          machine: that.machine.info.name,
                          variable: `${variable.name}:${srcVariable.srcVariable}`,
                          access: 'persist',
                        };
                        sourceData[sourceData.variable] = changedValue;

                        // write the data to the source machine and variable
                        db.set(sourceData, (error) => {
                          cb1(error);
                        });
                      });
                    });
                  });
                } else {
                  cb1(null);
                }
              } else {
                cb1(null);
              }
            } else {
              cb1(null);
            }
          } else {
            cb1(null);
          }
        } else if (variable.operation === 'auto-alarm-update') {
          // update the value to store after processing
          updatedVarValue = entry[entry.variable];
          // go through every one of our source variables
          async.eachSeries(variable.srcVariables, (srcVariable, cb2) => {
            // check if one of our source variables is the one that is reporting
            if ((srcVariable.srcMachine === changedMachine)
              && (srcVariable.srcVariable === changedVariable)) {
              // check whether the change is in the correct direction
              let requiredChange = false;
              switch (_.get(srcVariable, 'triggerOnChangeType', 'Any Change')) {
                case 'Increase':
                  if (updatedVarValue > varValues[changedMachine][changedVariable]) {
                    requiredChange = true;
                  }
                  break;
                case 'Decrease':
                  if (updatedVarValue < varValues[changedMachine][changedVariable]) {
                    requiredChange = true;
                  }
                  break;
                default:
                  if (updatedVarValue !== varValues[changedMachine][changedVariable]) {
                    requiredChange = true;
                  }
              }

              // check that it has actually changed as required
              if (requiredChange) {
                if (_.has(variable, 'changeTimeout') && _.has(variable, 'changeTimeoutValue')) {
                  // the user is able to specify a value that is output if no other
                  // variables change within a specified time.
                  // this timer function will be called when that timeout occurs
                  if (changeTimers[variable.name]) {
                    clearTimeout(changeTimers[variable.name]);
                    changeTimers[variable.name] = null;
                  }
                  changeTimers[variable.name] = setTimeout(autoAlarmUpdateChangeTimeout,
                    (variable.changeTimeout * 1000),
                    variable);
                }
                if (_.has(srcVariable, 'reportMyValue')) {
                  if (srcVariable.reportMyValue === true) {
                    // report this changed value as our output value
                    that.dataCb(that.machine, variable, entry[entry.variable], (err) => {
                      cb2(err);
                    });
                  } else {
                    // report the defined value as our output value
                    that.dataCb(that.machine, variable, srcVariable.onChangeReport, (err) => {
                      cb2(err);
                    });
                  }
                } else {
                  cb2(null);
                }
              } else {
                cb2(null);
              }
            } else {
              cb2(null);
            }
          }, (err) => {
            if (err) {
              log.error(err);
            }

            cb1(null);
          });
        } else if (variable.operation === 'array element') {
          // update the value to store after processing
          updatedVarValue = entry[entry.variable];

          if (variable.srcVariables.length > 0) {
            const srcVar = variable.srcVariables[0];

            // if this is the source variable that changed
            if ((srcVar.srcMachine === changedMachine)
              && (srcVar.srcVariable === changedVariable)) {
              let srcVarVal = updatedVarValue;
              // if this is an array, get it specified element
              const arrayLen = srcVarVal.length;
              if (arrayLen !== undefined) {
                if (arrayLen === 0) {
                  srcVarVal = null;
                } else {
                  let arrayIndex = _.get(srcVar, 'arrayIndex', 0);
                  if (arrayIndex >= arrayLen) arrayIndex = arrayLen - 1;
                  srcVarVal = srcVarVal[arrayIndex];
                }
              }

              // convert null to zero if necessary
              if (srcVarVal === null) {
                if (_.get(variable, 'convertNullToZero', false)) {
                  srcVarVal = 0;
                }
              }

              // save the array element to the database
              that.dataCb(that.machine, variable, srcVarVal, err => cb1(err));
            } else {
              cb1(null);
            }
          } else {
            cb1(null);
          }
        } else if (variable.operation === 'match-counter') {
          // update the value to store after processing
          updatedVarValue = entry[entry.variable];

          // go through every one of our source variables
          async.eachSeries(variable.srcVariables, (srcVariable, cb2) => {
            // check if one of our source variables is the one that is reporting
            if ((srcVariable.srcMachine === changedMachine)
              && (srcVariable.srcVariable === changedVariable)) {
              // check that it has actually changed
              if (entry[entry.variable] !== varValues[changedMachine][changedVariable]) {
                if (({}).hasOwnProperty.call(srcVariable, 'matchValue')) {
                  if (Number(srcVariable.matchValue) === updatedVarValue) {
                    currMatchCount[variable.name] += 1;
                    // save the peristent counter to the database
                    that.dataCb(that.machine, variable, currMatchCount[variable.name],
                      err => cb2(err));
                  }
                } else {
                  cb2(null);
                }
              } else {
                cb2(null);
              }
            } else {
              cb2(null);
            }
          }, (err) => {
            if (err) {
              log.error(err);
            }

            cb1(null);
          });
        } else if (variable.operation === 'pass-through') {
          // update the value to store after processing
          updatedVarValue = entry[entry.variable];

          if (variable.srcVariables.length > 0) {
            const srcVar0 = variable.srcVariables[0];

            // if this is the source variable that changed
            if ((srcVar0.srcMachine === changedMachine)
              && (srcVar0.srcVariable === changedVariable)) {
              const srcVar0Val = updatedVarValue;


              // go through every one of our destination variables
              async.eachSeries(variable.destVariables, (destVariable, cb2) => {
                // create the data object
                const data = {
                  machine: destVariable.destMachine,
                  variable: destVariable.destVariable,
                  access: 'write',
                };
                data[destVariable.destVariable] = srcVar0Val;

                // write the data to the destination machine and variable
                db.add(data, () => {
                  cb2(null);
                });
              });

              // save the value to the database also
              that.dataCb(that.machine, variable, srcVar0Val, err => cb1(err));
            } else {
              cb1(null);
            }
          } else {
            cb1(null);
          }
        } else if (variable.operation === 'level 1 status indicator') {
          // update the value to store after processing
          updatedVarValue = entry[entry.variable];

          // if valid variable definition and source variable actually changed,
          // set variable to 1 and start timer
          if ((variable.srcVariables.length > 0)
            && _.has(variable, 'changeTimeout')
            && (variable.changeTimeout > 0)
            && (varValues[changedMachine][changedVariable] !== null)
            && (updatedVarValue !== varValues[changedMachine][changedVariable])) {
            // this timer function will be called when that timeout occurs
            if (changeTimers[variable.name]) {
              clearTimeout(changeTimers[variable.name]);
              changeTimers[variable.name] = null;
            }
            changeTimers[variable.name] = setTimeout(statusIndicatorChangeTimeout,
              (variable.changeTimeout * 1000),
              variable);

            that.dataCb(that.machine, variable, 1, err => cb1(err));
          } else {
            cb1(null);
          }
        } else if (variable.operation === 'publish variables on trigger') {
          // update the value to store after processing
          updatedVarValue = entry[entry.variable];

          // check whether the changed variable is to trigger publishing
          let triggered = false;
          for (let iSrc = 0; iSrc < variable.srcVariables.length; iSrc += 1) {
            const srcVariable = variable.srcVariables[iSrc];
            if ((srcVariable.srcMachine === changedMachine)
              && (srcVariable.srcVariable === changedVariable)
              && _.get(srcVariable, 'triggerOnChange', false)) {
              switch (_.get(srcVariable, 'triggerOnChangeType', 'Any Change')) {
                case 'Increase':
                  if (updatedVarValue > varValues[changedMachine][changedVariable]) {
                    triggered = true;
                  }
                  break;
                case 'Decrease':
                  if (updatedVarValue < varValues[changedMachine][changedVariable]) {
                    triggered = true;
                  }
                  break;
                default:
                  if (updatedVarValue !== varValues[changedMachine][changedVariable]) {
                    triggered = true;
                  }
              }
              if (triggered) break;
            }
          }

          // if source variable triggered publishing, publish all source variables
          if (triggered) {
            async.eachSeries(variable.srcVariables, (srcVariable, cb2) => {
              // find the variable created for the source variable
              let found = false;
              let iVar;
              for (iVar = 0; iVar < that.machine.variables.length; iVar += 1) {
                if (that.machine.variables[iVar].name === srcVariable.srcVariable) {
                  found = true;
                  break;
                }
              }

              if (found) {
                // if this is the source variable  that changed, use its value
                if ((srcVariable.srcMachine === changedMachine)
                  && (srcVariable.srcVariable === changedVariable)) {
                  that.dataCb(that.machine, that.machine.variables[iVar],
                    entry[entry.variable], dbErr => cb2(dbErr));
                } else { // if this another source variable, retrieve if from the cached values
                  let cachedValue = varValues[srcVariable.srcMachine][srcVariable.srcVariable];
                  if (!cachedValue) cachedValue = 0;
                  that.dataCb(that.machine, that.machine.variables[iVar],
                    cachedValue, dbErr => cb2(dbErr));
                }
              } else {
                cb2(null);
              }
            }, (err) => {
              if (err) {
                log.error(err);
              }

              cb1(null);
            });
          }
        } else if (variable.operation === 'split string') {
          // update the value to store after processing
          updatedVarValue = entry[entry.variable];

          if (variable.srcVariables.length > 0) {
            const srcVar = variable.srcVariables[0];

            // if this is the source variable that changed
            if ((srcVar.srcMachine === changedMachine)
              && (srcVar.srcVariable === changedVariable)) {
              let splitValue = '';
              const separator = _.get(srcVar, 'separator', ',');
              const splitArray = updatedVarValue.toString().split(separator);
              const arrayIndex = _.get(srcVar, 'arrayIndex', 0);
              if (arrayIndex < splitArray.length) {
                splitValue = convertStringResult(variable.format, splitArray[arrayIndex]);
              }

              // save the array element to the database
              that.dataCb(that.machine, variable, splitValue, err => cb1(err));
            } else {
              cb1(null);
            }
          } else {
            cb1(null);
          }
        } else if (variable.operation === 'bitmap') {
          // update the value to store after processing
          updatedVarValue = entry[entry.variable];

          // go through every one of our source variables
          let matchFound = false;
          let successValue = 0;
          async.eachSeries(variable.srcVariables, (srcVariable, cb2) => {
            if (!matchFound) {
              const bitMaskString = _.get(srcVariable, 'bitMask', '0');
              const bitMatchString = _.get(srcVariable, 'bitMatch', bitMaskString);
              const bitMask = parseInt(bitMaskString, 16);
              const bitMatch = parseInt(bitMatchString, 16);

              // get the source  variable value from the changed variable or the cache
              let sourceVarVal = null;
              if ((srcVariable.srcMachine === changedMachine)
                && (srcVariable.srcVariable === changedVariable)) {
                sourceVarVal = updatedVarValue;
              } else {
                sourceVarVal = varValues[srcVariable.srcMachine][srcVariable.srcVariable];
              }

              // if the masked value equals match value, set the success value
              if ((sourceVarVal !== null) && ((sourceVarVal & bitMask) === bitMatch)) {
                successValue = _.get(srcVariable, 'successValue', 0);
                matchFound = true;
              }
            }
            cb2(null);
          }, (err) => {
            if (err) {
              log.error(err);
              cb1(null);
            } else if (matchFound) {
              // if a bit match found, set the variable to the success value
              that.dataCb(that.machine, variable, successValue, dbErr => cb1(dbErr));
            } else {
              // if no match found, set the variable to the default value
              that.dataCb(that.machine, variable,
                _.get(variable, 'defaultValue', 0), dbErr => cb1(dbErr));
            }
          });
        } else if (variable.operation === 'SQL-reference') {
          // loop through each source variable
          let result = false;
          async.eachSeries(variable.srcVariables, (srcVariable, cb2) => {
            // if this is the source variable that changed, check it against database
            if ((srcVariable.srcMachine === changedMachine)
              && (srcVariable.srcVariable === changedVariable)) {
              const changedValue = entry[entry.variable];
              let selectQuery = `select * FROM ${variable.sqlTableName}`;
              selectQuery = `${selectQuery} WHERE SQL ${variable.sqlColumnName}`;
              selectQuery = `${selectQuery} LIKE ${changedValue}`;

              // get name for this database
              const dbID = `${variable.sqlServerName}-${variable.sqlPort}-${variable.sqlDatabaseName}`;
              console.log(`---- ${dbID}: sending sql query: ${selectQuery}`);

              if (sqlDbRequest.includes(dbID)) {
                sqlDbRequest[dbID].query(selectQuery).then((varResult) => {
                  if (srcVariable.sqlDatabaseType === 'MySQL') {
                    if (varResult.length > 0) {
                      result = true;
                    }
                  } else if (varResult.recordset.length > 0) {
                    result = true;
                  }
                  cb2(null);
                });
              } else {
                cb2(null);
              }
            } else {
              cb2(null);
            }
          }, (err) => {
            if (err) {
              log.error(err);
            }

            // write the true/false result to the database
            that.dataCb(that.machine, variable, result, dbErr => cb1(dbErr));
          });
        } else if (variable.operation === 'Variable Update Alert') {
          // loop through each source variable in this summation variable
          // console.log('-----Variable Update Alert: changedMachine: ' +
          //              changedMachine + '    changedVariable: ' + changedVariable);
          async.eachSeries(variable.srcVariables, (srcVariable, cb2) => {
            // if this is the source variable that changed, update the stored value
            if ((srcVariable.srcMachine === changedMachine)
                && (srcVariable.srcVariable === changedVariable)) {
              // console.log('-----found matching source variable: srcVariable:' +
              //              JSON.stringify(srcVariable));
              if (alertTimers[changedVariable]) {
                // already have an active timer for this variable.
                // clear it and reset it for the new timeout.
                clearTimeout(alertTimers[changedVariable]);
                alertTimers[changedVariable] = null;
              }
              alertTimers[changedVariable] = setTimeout(variableUpdateAlertTimeout,
                (srcVariable.variableUpdateAlertTimeout * 1000),
                variable, changedVariable);
              // console.log('-----setting variable: ' + variable.name + ' to TRUE');
              that.dataCb(that.machine, variable, true, err => cb2(err));
            } else {
              cb2(null);
            }
          }, (err) => {
            if (err) {
              log.error(err);
            }

            cb1(err);
          });
        } else if (variable.operation !== 'no operation') {
          // update the value to store after processing
          updatedVarValue = entry[entry.variable];

          async.map(variable.srcVariables, (s, cb2) => {
            // if the db get was pertaining to this exact variable
            if ((changedMachine === s.srcMachine)
              && (changedVariable === s.srcVariable)) {
              return cb2(null, {
                src: s,
                value: entry,
                currentValue: true,
              });
            }

            // if this virtual variable also needs another source variable,
            // retrieve it via a db call
            db.getLatest(s.srcMachine, s.srcVariable, (err, x) => cb2(err, {
              src: s,
              value: x,
              currentValue: false,
            }));
            return undefined;
          }, (err, result) => {
            if (err) {
              log.error(err);
              return;
            }

            // we now have an array of 1 or more variable values required by this virtual variable

            // point to the first variable referenced by this virtual variable
            let outValue = result[0];
            // if it contains the optional 'successValue' key
            if ('successValue' in outValue.src) {
              // assume there is an array of values
              for (let m = 1; m < result.length; m += 1) {
                if (outValue.value[outValue.value.variable] === outValue.src.successValue) {
                  outValue = result[m];
                } else {
                  break;
                }
              }

              // if the error wasn't from this actual database trigger, then it was
              // or will be reported when that db trigger happens
              if (outValue.currentValue === false) {
                cb1(null);
                return;
              }
            }

            // now we are writing the value that came in originaly, tagging it against the
            // virtual machine and the current virtual variable being dealt with
            that.dataCb(that.machine, variable, updatedVarValue, cbErr => cb1(cbErr));
          });
        }
        return undefined;
      }, (err) => {
        if (err) {
          log.error(err);
        }
      });
      if (updatedVarValue !== null) {
        varValues[changedMachine][changedVariable] = updatedVarValue;
      }
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function disconnectFromSql(dbHost, dbPort, isMySQL, dbName) {
    // get name for this database
    const dbID = `${dbHost}-${dbPort}-${dbName}`;
    if (!sqlDbRequestDbIDs.includes(dbID)) {
      return; // does not exist - no need to disconnect
    }

    if (isMySQL) {
      if (sqlDbConnectionPool[dbID]) {
        sqlDbConnectionPool[dbID].end();
      }
    } else if (sqlDbConnectionPool[dbID]) {
      sqlDbConnectionPool[dbID].close();
    }
    delete sqlDbConnectionPool[dbID];
    delete sqlDbRequest[dbID];
    const index = sqlDbRequestDbIDs.indexOf(dbID);
    if (index > -1) {
      sqlDbRequestDbIDs.splice(index, 1); // 2nd parameter means remove one item only
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function disconnectReconnectToSql(dbHost, dbPort, isMySQL, dbName, dbUsername, dbPassword) {
    // get name for this database
    const dbID = `${dbHost}-${dbPort}-${dbName}`;
    if (!sqlDbRequestDbIDs.includes(dbID)) {
      return; // does not exist - no need to disconnect
    }

    if (reconnectTimer === null) {
      disconnectFromSql(dbHost, dbPort, isMySQL, dbName);

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        // eslint-disable-next-line no-use-before-define
        connectToSql(dbHost, dbPort, isMySQL, dbName, dbUsername, dbPassword);
      }, RECONNECT_TIME);
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function connectToSql(dbHost, dbPort, isMySQL, dbName, dbUsername, dbPassword) {
    // get unique name for this database
    const dbID = `${dbHost}-dbPort-${dbName}`;
    if (sqlDbRequestDbIDs.includes(dbID)) {
      return; // already exists - no need to create
    }

    // create the MS SQL configuration
    const sqlConfig = {
      port: dbPort,
      database: dbName,
      user: dbUsername,
      password: dbPassword,
    };

    // create a connection to the SQL database
    if (isMySQL) {
      sqlConfig.host = dbHost;
      sqlDbConnectionPool[dbID] = mysql.createPool(sqlConfig);
      sqlDbConnectionPool[dbID].getConnection().then((conn) => {
        sqlDbRequest[dbID] = conn;
        sqlDbRequestDbIDs.push(dbID);
        console.log(`--- created mySQL: ${dbID}`);
      }).catch((err) => {
        alert.raise({ key: 'connection-error', errorMsg: err.message });
        disconnectReconnectToSql(dbHost, dbPort, isMySQL, dbName, dbUsername, dbPassword);
      });
    } else {
      sqlConfig.server = dbHost;
      sqlDbConnectionPool[dbID] = new mssql.ConnectionPool(sqlConfig);
      sqlDbConnectionPool[dbID].connect().then(() => {
        sqlDbRequest[dbID] = new mssql.Request(sqlDbConnectionPool);
        sqlDbRequestDbIDs.push(dbID);
        console.log(`--- created msSQL: ${dbID}`);
      }).catch((err) => {
        alert.raise({ key: 'connection-error', errorMsg: err.message });
        disconnectReconnectToSql(dbHost, dbPort, isMySQL, dbName, dbUsername, dbPassword);
      });
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

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
      log.debug(`${machine.info.name} Disabled`);
      return done(null);
    }


    // organise the variables array into a tree for efficient searching
    // tree is organised as variables.srcMachine.srcVariable
    variables = {};
    varValues = {};
    currAlarmMachine = {};
    currAlarmVariable = {};
    currMatchCount = {};
    changeTimers = {};
    alertTimers = {};

    function updateVarValues(srcMachine, srcVariable, entry) {
      varValues[srcMachine][srcVariable] = (entry === null) ? null : entry[entry.variable];
    }

    for (let iVar = 0; iVar < that.machine.variables.length; iVar += 1) {
      const variable = that.machine.variables[iVar];

      // for each of the source variables in the array
      if (_.has(variable, 'srcVariables')) {
        for (let iSrcVar = 0; iSrcVar < variable.srcVariables.length; iSrcVar += 1) {
          const { srcMachine } = variable.srcVariables[iSrcVar];
          const { srcVariable } = variable.srcVariables[iSrcVar];

          // create objects for this source machine if not created yet
          if (!(srcMachine in variables)) {
            variables[srcMachine] = {};
            varValues[srcMachine] = {};
          }

          // create an array for this source variable if not created yet for this
          // source machine, also an inital value of null (set to zero above)
          if (!(srcVariable in variables[srcMachine])) {
            variables[srcMachine][srcVariable] = [];

            // if the current value of this source variable has not yet been
            // initialized to a non-null value
            if (!(srcVariable in varValues[srcMachine])
             || (varValues[srcMachine][srcVariable] === null)) {
              // initialize the current value of this source machine and variable,
              // getting from persistent storage if stored there (null if not)
              db.get(`machine:${that.machine.info.name}:persist:${variable.name}:${srcVariable}`, (err, entry) => {
                updateVarValues(srcMachine, srcVariable, entry);
              });
            }
          }

          // add the current variable object into the correct place in the tree
          variables[srcMachine][srcVariable].push(variable);
        }
      }

      // initialize the current alarm machine and variable for each ouput
      // variable to null since none yet
      currAlarmMachine[variable.name] = null;
      currAlarmVariable[variable.name] = null;

      currMatchCount[variable.name] = 0;
    }

    // add variables for the 'publish variables on trigger' source variables
    const newVariables = [];
    async.forEach(that.machine.variables, (variable, cb1) => {
      const variableOperation = _.get(variable, 'operation', 'normal');
      if (variableOperation === 'publish variables on trigger') {
        // for each of the source variables in the array, add a variable if does not exist
        async.forEach(variable.srcVariables, (srcVar, cb2) => {
          const { srcMachine } = srcVar;
          const { srcVariable } = srcVar;
          let exists = false;
          for (let iVar = 0; iVar < that.machine.variables.length; iVar += 1) {
            if (that.machine.variables[iVar].name === srcVariable) {
              exists = true;
              break;
            }
          }
          if (!exists) {
            // try to copy this variable from the source machine
            conf.get(`machines:${srcMachine}:variables`, (err, srcMachineVariables) => {
              if (!err) {
                for (let iSrcVar = 0; iSrcVar < srcMachineVariables.length; iSrcVar += 1) {
                  if (srcMachineVariables[iSrcVar].name === srcVariable) {
                    // make sure filtering is turned off
                    const variableCopy = srcMachineVariables[iSrcVar];
                    variableCopy.allowFiltering = false;
                    // clear out any transform equation, or else it will be executed again for
                    // this variable copy, resulting in a double-operation
                    if (_.has(variableCopy, 'transformEq')) {
                      variableCopy.transformEq = null;
                      delete variableCopy.transformEq;
                    }
                    newVariables.push(variableCopy);
                    return cb2(null);
                  }
                }
              }
              // if variable not found, create one with the same name
              newVariables.push({
                name: srcVariable,
                description: `${srcMachine}:${srcVariable}`,
                format: 'float',
              });
              return cb2(null);
            });
          } else {
            cb2(null);
          }
        }, () => {
          cb1(null);
        });
      } else if (variableOperation === 'SQL-reference') {
        if (variable.sqlDatabaseType === 'MySQL') {
          connectToSql(variable.sqlServerName, variable.sqlPort, true,
            variable.sqlDatabaseName, variable.sqlUsername, variable.sqlPassword);
        } else {
          connectToSql(variable.sqlServerName, variable.sqlPort, false,
            variable.sqlDatabaseName, variable.sqlUsername, variable.sqlPassword);
        }
      } else {
        cb1(null);
      }
    }, () => {
      for (let iNewVar = 0; iNewVar < newVariables.length; iNewVar += 1) {
        that.machine.variables.push(newVariables[iNewVar]);
      }

      // listen for data being added to the database
      db.on('added', databaseListener);

      log.debug('Started');

      // if added any variables, update the configuration
      if (newVariables.length > 0) {
        return configUpdateCb(that.machine, done);
      }
      return done(null);
    });

    return undefined;
  };

  this.stop = function stop(done) {
    // stop listeninf for data being added
    db.removeListener('added', databaseListener);

    // shut down any timers that may have been running
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    for (let i = 0; i < that.machine.variables.length; i += 1) {
      const variable = that.machine.variables[i];
      if (changeTimers[variable.name]) {
        log.info(`cancelling change timer for ${variable.name}`);
        clearTimeout(changeTimers[variable.name]);
        changeTimers[variable.name] = null;
      }
      if (alertTimers[variable.name]) {
        log.info(`cancelling alert timer for ${variable.name}`);
        clearTimeout(alertTimers[variable.name]);
        alertTimers[variable.name] = null;
      }
    }

    // clear existing alerts
    alert.clearAll(() => {
      log.debug('Stopped');
      return done(null);
    });
  };

  this.restart = function rstart(done) {
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
  hpl: hplVirtual,
  defaults,
  schema,
};
