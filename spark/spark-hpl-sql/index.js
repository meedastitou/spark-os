/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
let mssql = require('mssql');
let mysql = require('promise-mysql');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplSQL = function hplSQL(log, machine, model, conf, db, alert) {
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line global-require
    mssql = require('./test/mssql-tester');
    // eslint-disable-next-line global-require
    mysql = require('./test/mysql-tester');
    this.mssqlTester = mssql;
    this.mysqlTester = mysql;
  }

  // Private variables
  const that = this;

  const RECONNECT_TIME = 10000; // 10 seconds

  let isMySQL = false;
  let connected = false;
  let sqlDbConnectionPool = null;
  let sqlDbRequest = null;
  let numTableRows = 0;
  let requestTimer = null;
  let reconnectTimer = null;
  let disconnectedTimer = null;
  let variableReportTimer = null;
  let connectionReported = false;
  let disconnectionReported = false;
  let lastKeyFieldValue = 0;

  let addTimestampField = false;
  let baseTimestampFieldName = '';
  let utcOffset = 0;

  let updateDatabaseVariableList = [];
  let recordReportDwell = 100;

  let requestFrequencyMs = 10000;

  let machineStarted = false;

  const combinedResultVariable = {
    name: 'CombinedResult',
    description: 'CombinedResult',
    format: 'char',
    array: true,
  };

  // Alert Object
  alert.preLoad({
    'invalid-where-error': {
      msg: `${machine.info.name}: Invalid Where Condition`,
      description: x => `Invalid Where condition in variable ${x.variable}`,
    },
    'connection-error': {
      msg: `${machine.info.name}: Connection Error`,
      description: x => `Client is not able to connect to SQL server. Error: ${x.errorMsg}`,
    },
    'read-error': {
      msg: `${machine.info.name}: Unable to read from SQL server`,
      description: x => `Client is not able to read from the SQL server. Error: ${x.errorMsg}`,
    },
    'database-error': {
      msg: `${machine.info.name}: Error Writing to Database`,
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
    'datetime-error': {
      msg: 'Multirecord Key Field: Error with date/time field',
      description: 'The specified field could not be converted to a proper date/time value',
    },
  });

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  function updateConnectionStatus(connectedStatus) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connectedStatus, () => {});
  }

  updateConnectionStatus(false);

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function updateDatabase(variable, value) {
    that.dataCb(that.machine, variable, value, (err, res) => {
      if (err) {
        alert.raise({ key: 'database-error', errorMsg: err.message });
      } else {
        alert.clear('database-error');
      }
      if (res) log.debug(res);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function requestTimerFunction() {
    if (!_.get(that.machine.settings.model, 'reportAllUpdatedRecords', false)) {
      // eslint-disable-next-line no-use-before-define
      readAndReportRecordsOriginal();
    } else {
      // eslint-disable-next-line no-use-before-define
      readAndReportAllUpdatedRecords();
    }
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function updateDatabaseFromList() {
    // eslint-disable-next-line max-len
    // log.info(`>>> updateDatabaseVariableList.length = ${updateDatabaseVariableList.length}`);
    // eslint-disable-next-line max-len
    // log.info(`>>> updateDatabaseVariableList = ${JSON.stringify(updateDatabaseVariableList)}`);

    if (variableReportTimer) {
      clearTimeout(variableReportTimer);
      variableReportTimer = null;
    }

    if (updateDatabaseVariableList.length > 0) {
      const firstArrayElement = updateDatabaseVariableList.shift();
      const updateVariable = firstArrayElement.variable;
      const updateValue = firstArrayElement.value;

      that.dataCb(that.machine, updateVariable, updateValue, (err, res) => {
        if (err) {
          alert.raise({ key: 'database-error', errorMsg: err.message });
        } else {
          alert.clear('database-error');
        }
        if (res) log.debug(res);

        if (recordReportDwell) {
          variableReportTimer = setTimeout(updateDatabaseFromList, recordReportDwell);
        } else {
          setImmediate(updateDatabaseFromList);
        }
      });
    } else {
      // we're done reporting the variables - set the timer for our next read.
      // log.info('-----setting requestTimer');
      requestTimer = setTimeout(requestTimerFunction, requestFrequencyMs);
    }
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  // helper function to convert a string formatted result into its correct 'format'
  function convertResult(format, resultString) {
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

          result = (resultString.toLowerCase() === 'true') || (resultString === '1');
          break;
        default:
      }
    }
    return result;
  }

  function disconnectionDetected() {
    // ingore disconectiong if already know disconnected
    if (disconnectedTimer || disconnectionReported) return;

    // start a timer to set any machine connected variables to false
    disconnectedTimer = setTimeout(() => {
      disconnectedTimer = null;
      connectionReported = false;
      disconnectionReported = true;
      async.forEachSeries(that.machine.variables, (variable, callback) => {
        // set only machine connected variables to false
        if (_.has(variable, 'machineConnected') && variable.machineConnected) {
          that.dataCb(that.machine, variable, false, (err, res) => {
            if (err) log.error(err);
            if (res) log.debug(res);
          });
        }

        callback();
      });
    }, _.has(that.machine.settings.model, 'disconnectReportTime') ? 1000 * that.machine.settings.model.disconnectReportTime : 0);
  }

  function connectionDetected() {
    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = false;
    }

    // if connection alreay reported, don't report it again
    if (connectionReported) return;
    connectionReported = true;
    disconnectionReported = false;

    async.forEachSeries(that.machine.variables, (variable, callback) => {
      // set only machine connected variables to true
      if (_.has(variable, 'machineConnected') && variable.machineConnected) {
        that.dataCb(that.machine, variable, true, (err, res) => {
          if (err) log.error(err);
          if (res) log.debug(res);
        });
      }

      callback();
    });
  }

  function disconnectFromSql() {
    if (isMySQL) {
      if (sqlDbConnectionPool) {
        sqlDbConnectionPool.end();
        sqlDbConnectionPool = null;
      }
    } else if (sqlDbConnectionPool) {
      sqlDbConnectionPool.close();
      sqlDbConnectionPool = null;
    }

    connected = false;
  }

  function disconnectReconnectToSql() {
    if (reconnectTimer === null) {
      disconnectionDetected();
      updateConnectionStatus(false);
      disconnectFromSql();

      if (machineStarted) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          // eslint-disable-next-line no-use-before-define
          connectToSql();
        }, RECONNECT_TIME);
      }
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readAndReportRecordsOriginal() {
    if (connected) {
      // get the current number of rows in the SQL table
      let sqlSelectString;
      if (isMySQL) {
        sqlSelectString = `select count (*) from ${that.machine.settings.model.sqlTableName}`;
      } else {
        sqlSelectString = `select count (*) from [${that.machine.settings.model.sqlTableName}]`;
      }
      // console.log(`---sending sql query (all updated records): ${sqlSelectString}`);
      sqlDbRequest.query(sqlSelectString)
        .then((numRowsResult) => {
          alert.clear('read-error');

          // log.info(`----numRowsResult = ${JSON.stringify(numRowsResult)}`);
          // if number of rows changed or always updating, update the variables
          let numRows;
          if (isMySQL) {
            numRows = numRowsResult[0]['count (*)'];
          } else {
            numRows = numRowsResult.recordset[0][''];
          }
          if (!_.get(that.machine.settings.model, 'updateOnRowChange', true) || (numRows !== numTableRows)) {
            numTableRows = numRows;

            async.forEachSeries(that.machine.variables, (variable, callback) => {
              if (!_.get(variable, 'machineConnected', false)) {
                // build the select query for this variable
                let selectQuery = 'select ';

                // for mssql, if not array, add top 1, if array add top n if length = n
                const array = _.get(variable, 'array', false);
                if (!isMySQL) {
                  if (array) {
                    const arrayLength = _.get(variable, 'length', 0);
                    if (arrayLength >= 0) {
                      selectQuery += `top ${variable.length} `;
                    }
                  } else {
                    selectQuery += 'top 1 ';
                  }
                }

                // add the column to read
                selectQuery += variable.column;

                // add from table
                if (isMySQL) {
                  selectQuery += ` from ${that.machine.settings.model.sqlTableName} `;
                } else {
                  selectQuery += ` from [${that.machine.settings.model.sqlTableName}] `;
                }

                // if where condition, add it
                const where = _.get(variable, 'where', '').trim();
                if (where.length !== 0) {
                  selectQuery += `where ${variable.where} `;
                }

                // add the order by column and order (ascending or descending)
                selectQuery += `order by ${variable.orderBy} ${variable.order === 'Ascending' ? 'asc' : 'desc'}`;

                // for mysql, if not array, add limit 1, if array add limit n if length = n
                if (isMySQL) {
                  if (array) {
                    const arrayLength = _.get(variable, 'length', 0);
                    if (arrayLength >= 0) {
                      selectQuery += ` limit ${variable.length} `;
                    }
                  } else {
                    selectQuery += ' limit 1';
                  }
                }

                // issue the select query
                // log.info(`---sending sql query (original): ${selectQuery}`);
                sqlDbRequest.query(selectQuery).then((varResult) => {
                  // get the value or array of values
                  // log.info(`----varResult = ${JSON.stringify(varResult)}`);
                  let value;
                  if (array) {
                    value = [];
                    if (isMySQL) {
                      for (let iVal = 0; iVal < varResult.length; iVal += 1) {
                        value.push(convertResult(variable.format,
                          varResult[iVal][variable.column]));
                      }
                    } else {
                      for (let iVal = 0; iVal < varResult.recordset.length; iVal += 1) {
                        value.push(convertResult(variable.format,
                          varResult.recordset[iVal][variable.column]));
                      }
                    }
                  } else if (isMySQL) {
                    value = convertResult(variable.format, varResult[0][variable.column]);
                  } else {
                    value = convertResult(variable.format, varResult.recordset[0][variable.column]);
                  }

                  // save the value to the database
                  updateDatabase(variable, value);

                  callback();
                }).catch((err) => {
                  callback(err);
                });
              } else {
                callback();
              }
            }, (err) => {
              if (err) {
                alert.raise({ key: 'read-error', errorMsg: err.message });

                // disconnect and try to reconnect to the SQL database
                disconnectReconnectToSql();
              } else {
                // log.info('-----setting requestTimer');
                requestTimer = setTimeout(requestTimerFunction, requestFrequencyMs);
              }
            });
          } else {
            // log.info('-----setting requestTimer');
            requestTimer = setTimeout(requestTimerFunction, requestFrequencyMs);
          }
        }).catch((err) => {
          alert.raise({ key: 'read-error', errorMsg: err.message });

          // disconnect and try to reconnect to the SQL database
          disconnectReconnectToSql();
        });
    } else {
      // log.info('-----setting requestTimer');
      requestTimer = setTimeout(requestTimerFunction, requestFrequencyMs);
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function objectIsEmpty(obj) {
    if (Object.keys(obj).length === 0) {
      return true;
    }

    return false;
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readAndReportAllUpdatedRecords() {
    if (connected) {
      // get the current number of rows in the SQL table
      let sqlSelectString;
      if (isMySQL) {
        sqlSelectString = `select count (*) from ${that.machine.settings.model.sqlTableName}`;
      } else {
        sqlSelectString = `select count (*) from [${that.machine.settings.model.sqlTableName}]`;
      }

      addTimestampField = _.get(that.machine.settings.model, 'addTimestampField', false);
      baseTimestampFieldName = _.get(that.machine.settings.model, 'baseTimestampFieldName', '');
      utcOffset = _.get(that.machine.settings.model, 'utcOffset', 0);

      let multirecordKeyField = _.get(that.machine.settings.model, 'multirecordKeyField', 'ID');

      // console.log(`--- sending sql query (all updated records): ${sqlSelectString}`);
      sqlDbRequest.query(sqlSelectString)
        .then((numRowsResult) => {
          // console.log(`----numRowsResult = ${JSON.stringify(numRowsResult)}`);
          alert.clear('read-error');

          // if number of rows changed or always updating, update the variables
          let numRows;
          if (isMySQL) {
            numRows = numRowsResult[0]['count (*)'];
          } else {
            numRows = numRowsResult.recordset[0][''];
          }

          // console.log(`--- record count = ${numRows}, numTableRows = ${numTableRows}`);
          let newRowCount = numRows - numTableRows;
          if (numTableRows === 0) {
            newRowCount = 1;
            // console.log('--- first read - request latest record');
          }

          // if there are no new rows, read only the last row to see if its keyfield has changed
          let keyFieldMustIncreaseFlag = false;
          if (newRowCount === 0) {
            newRowCount = 1;
            // when we are re-reading the last row, require the keyField actually increase.
            // if we are reading new rows, we will also report values for when the
            // keyField is only equal, not increasing.
            keyFieldMustIncreaseFlag = true;
          }


          // console.log(`--- request last ${newRowCount} records`);
          numTableRows = numRows;

          let multireadString = `select top ${newRowCount}`;
          let addMultirecordKeyField = true;
          let firstColumnNameFlag = true;
          for (let varIndex = 0; varIndex < that.machine.variables.length; varIndex += 1) {
            if (_.has(that.machine.variables[varIndex], 'column')) {
              const columnName = that.machine.variables[varIndex].column;
              if (columnName !== '') {
                if (firstColumnNameFlag) {
                  firstColumnNameFlag = false;
                } else {
                  multireadString += ',';
                }
                multireadString += ` ${columnName}`;
                // only add the multirecord key field if it doesn't match an exisiting
                // field, case-insensitive.
                if (columnName.toLowerCase() === multirecordKeyField.toLowerCase()) {
                  addMultirecordKeyField = false;
                  multirecordKeyField = columnName;
                }
              }
            }
          }
          if (addMultirecordKeyField) {
            if (multirecordKeyField !== '') {
              if (!firstColumnNameFlag) {
                multireadString += ',';
              }
              multireadString += ` ${multirecordKeyField}`;
            }
          }
          if (isMySQL) {
            multireadString += ` from ${that.machine.settings.model.sqlTableName} order by `;
          } else {
            multireadString += ` from [${that.machine.settings.model.sqlTableName}] order by `;
          }
          multireadString += multirecordKeyField;
          multireadString += ' desc';
          // console.log(`---sending sql query (all updated records): ${multireadString}`);
          sqlDbRequest.query(multireadString).then((varResult) => {
            // console.log(`----varResult = ${JSON.stringify(varResult)}`);
            // log.info('----------------------------------------');
            const queryTimetamp = new Date(Date.now());

            let recordIndexCount = 0;
            if (isMySQL) {
              // needs to be tested - currenty only tested for 'Microsoft SQL'
              recordIndexCount = varResult.length;
            } else {
              recordIndexCount = varResult.recordset.length;
            }
            if (_.get(that.machine.settings.model, 'deliverCombinedResult', true)) {
              // log.info('delivering combined result');
              // deliver the updated values in a single CombinedResult variable.
              let combinedResultArray = [];
              for (let recordIndex = (recordIndexCount - 1); recordIndex >= 0; recordIndex -= 1) {
                let recordset = {};
                if (isMySQL) {
                  // needs to be tested - currenty only tested for 'Microsoft SQL'
                  recordset = varResult[recordIndex];
                } else {
                  recordset = varResult.recordset[recordIndex];
                }
                let keyFieldValue = _.get(recordset, multirecordKeyField, -1);
                // console.log(`---keyFieldValue = ${keyFieldValue}`);
                // console.log(`---lastKeyFieldValue = ${lastKeyFieldValue}`);
                if (_.get(that.machine.settings.model, 'multirecordKeyFieldAsDateTimeString', false)) {
                  // console.log('multirecordKeyFieldAsDateTimeString = true');
                  keyFieldValue = Date.parse(keyFieldValue);
                  // console.log(`---Date.parse(keyFieldValue) = ${keyFieldValue}`);
                  // eslint-disable-next-line no-restricted-globals
                  if ((isNaN(keyFieldValue)) || (keyFieldValue === 0)) {
                    alert.raise({ key: 'datetime-error' });
                    keyFieldValue = -1;
                  } else {
                    alert.clear('datetime-error');
                  }
                }
                if (((keyFieldMustIncreaseFlag) && (keyFieldValue > lastKeyFieldValue))
                    || ((!keyFieldMustIncreaseFlag) && (keyFieldValue >= lastKeyFieldValue))) {
                  // got a new row, fill in our variables
                  lastKeyFieldValue = keyFieldValue;
                  const data = {};
                  for (let varIndex = 0;
                    varIndex < that.machine.variables.length;
                    varIndex += 1) {
                    const variable = that.machine.variables[varIndex];
                    if (!_.get(variable, 'machineConnected', false)) {
                      if (_.has(recordset, variable.column)) {
                        data[variable.name] = convertResult(variable.format,
                          recordset[variable.column]);
                      }
                    }
                  }

                  if (!objectIsEmpty(data)) {
                    // log.info('----got record: ' + JSON.stringify(data));

                    if (addTimestampField) {
                      let fieldTimestamp = queryTimetamp;
                      if (baseTimestampFieldName !== '') {
                        // log.info('---getting baseTimestampField: ' +
                        //             baseTimestampFieldName);
                        if (_.has(data, baseTimestampFieldName)) {
                          // log.info('---found it.  timestamp = ' +
                          //             data[baseTimestampFieldName]);
                          fieldTimestamp = Date.parse(data[baseTimestampFieldName]);
                          // eslint-disable-next-line no-restricted-globals
                          if (isNaN(fieldTimestamp)) {
                            fieldTimestamp = queryTimetamp;
                          }
                        }
                      }
                      const adjustedUTCTimestamp = fieldTimestamp + (utcOffset * 60 * 60 * 1000);
                      const adjustedTimestamp = new Date(adjustedUTCTimestamp);

                      data.timestamp = adjustedTimestamp.toISOString();
                    }

                    combinedResultArray.push(data);
                    if (combinedResultArray.length >= _.get(that.machine.settings.model, 'maxMultirecordReportArraySize', 1)) {
                      // we've got all the records we're supposed to report at once
                      if (recordIndex > 0) {
                        // and we still have more to process, so send
                        // what he have now and continue
                        // log.info('---sending combinedResult: ' +
                        //             JSON.stringify(combinedResultArray));
                        // eslint-disable-next-line max-len
                        // log.info(`--- reporting CombinedResult with ${combinedResultArray.length} records`);
                        updateDatabase(combinedResultVariable, combinedResultArray);
                        combinedResultArray = [];
                      }
                    }
                  }
                }
              }
              if (combinedResultArray.length !== 0) {
                // log.info('---sending combinedResult: ' +
                //             JSON.stringify(combinedResultArray));
                // eslint-disable-next-line max-len
                // log.info(`--- reporting CombinedResult with ${combinedResultArray.length} records`);
                updateDatabase(combinedResultVariable, combinedResultArray);
                // log.info('-----setting requestTimer');
                requestTimer = setTimeout(requestTimerFunction, requestFrequencyMs);
              } else {
                // log.info('--- no new records: latest ' +
                //              multirecordKeyField + ' field = ' + lastKeyFieldValue);
                // log.info('-----setting requestTimer');
                requestTimer = setTimeout(requestTimerFunction, requestFrequencyMs);
              }
            } else {
              // log.info('NOT delivering combined result');
              // deliver the updated values as individual variables
              recordReportDwell = _.get(that.machine.settings.model, 'recordReportDwell', 0);
              // initialize the list of variables we're going to report
              updateDatabaseVariableList = [];
              if (_.get(that.machine.settings.model, 'reportUpdatedRecordDataAsArray', true)) {
                // log.info('reportUpdatedRecordDataAsArray');
                // go through all the received data and create arrays to report
                // as the value for each variable.
                let localLastKeyFieldValue = lastKeyFieldValue;
                for (let varIndex = 0; varIndex < that.machine.variables.length; varIndex += 1) {
                  const variable = that.machine.variables[varIndex];
                  if (!_.get(variable, 'machineConnected', false)) {
                    const valueArray = [];
                    localLastKeyFieldValue = lastKeyFieldValue;
                    for (let recordIndex = (recordIndexCount - 1);
                      recordIndex >= 0;
                      recordIndex -= 1) {
                      let recordset = {};
                      if (isMySQL) {
                        // needs to be tested - currenty only tested for 'Microsoft SQL'
                        recordset = varResult[recordIndex];
                      } else {
                        recordset = varResult.recordset[recordIndex];
                      }
                      let keyFieldValue = _.get(recordset, multirecordKeyField, -1);
                      // console.log(`---keyFieldValue = ${keyFieldValue}`);
                      // console.log(`---lastKeyFieldValue = ${lastKeyFieldValue}`);
                      if (_.get(that.machine.settings.model, 'multirecordKeyFieldAsDateTimeString', false)) {
                        keyFieldValue = Date.parse(keyFieldValue);
                        // console.log(`---Date.parse(keyFieldValue) = ${keyFieldValue}`);
                        // eslint-disable-next-line no-restricted-globals
                        if ((isNaN(keyFieldValue)) || (keyFieldValue === 0)) {
                          alert.raise({ key: 'datetime-error' });
                          keyFieldValue = -1;
                        } else {
                          alert.clear('datetime-error');
                        }
                      }
                      if (((keyFieldMustIncreaseFlag)
                           && (keyFieldValue > localLastKeyFieldValue))
                          || ((!keyFieldMustIncreaseFlag)
                           && (keyFieldValue >= localLastKeyFieldValue))) {
                        // got a new row, fill in our variables
                        localLastKeyFieldValue = keyFieldValue;

                        if (_.has(recordset, variable.column)) {
                          valueArray.push(convertResult(variable.format,
                            recordset[variable.column]));
                        }
                      }
                    }
                    if (valueArray.length > 0) {
                      const updateVariable = { variable, value: valueArray };
                      updateDatabaseVariableList.push(updateVariable);
                    }
                  }
                }
                lastKeyFieldValue = localLastKeyFieldValue;
              } else {
                // log.info('NOT reportUpdatedRecordDataAsArray');
                // go through each received record and report each individual value
                // for each individual value
                for (let recordIndex = (recordIndexCount - 1);
                  recordIndex >= 0;
                  recordIndex -= 1) {
                  let recordset = {};
                  if (isMySQL) {
                    // needs to be tested - currenty only tested for 'Microsoft SQL'
                    recordset = varResult[recordIndex];
                  } else {
                    recordset = varResult.recordset[recordIndex];
                  }
                  let keyFieldValue = _.get(recordset, multirecordKeyField, -1);
                  // console.log(`---keyFieldValue = ${keyFieldValue}`);
                  // console.log(`---lastKeyFieldValue = ${lastKeyFieldValue}`);
                  if (_.get(that.machine.settings.model, 'multirecordKeyFieldAsDateTimeString', false)) {
                    keyFieldValue = Date.parse(keyFieldValue);
                    // console.log(`---Date.parse(keyFieldValue) = ${keyFieldValue}`);
                    // eslint-disable-next-line no-restricted-globals
                    if ((isNaN(keyFieldValue)) || (keyFieldValue === 0)) {
                      alert.raise({ key: 'datetime-error' });
                      keyFieldValue = -1;
                    } else {
                      alert.clear('datetime-error');
                    }
                  }
                  if (((keyFieldMustIncreaseFlag) && (keyFieldValue > lastKeyFieldValue))
                      || ((!keyFieldMustIncreaseFlag) && (keyFieldValue >= lastKeyFieldValue))) {
                    // got a new row, fill in our variables
                    lastKeyFieldValue = keyFieldValue;
                    for (let varIndex = 0;
                      varIndex < that.machine.variables.length;
                      varIndex += 1) {
                      const variable = that.machine.variables[varIndex];
                      if (!_.get(variable, 'machineConnected', false)) {
                        if (_.has(recordset, variable.column)) {
                          const updateVariable = {
                            variable,
                            value: convertResult(variable.format,
                              recordset[variable.column]),
                          };
                          updateDatabaseVariableList.push(updateVariable);
                        }
                      }
                    }
                  }
                }
              }
              if (updateDatabaseVariableList.length > 0) {
                updateDatabaseFromList();
              } else {
                // log.info('-----setting requestTimer');
                requestTimer = setTimeout(requestTimerFunction, requestFrequencyMs);
              }
            }
          }).catch((err) => {
            log.info(`!!!!query err = ${err}`);
            alert.raise({ key: 'read-error', errorMsg: err.message });

            // disconnect and try to reconnect to the SQL database
            disconnectReconnectToSql();
          });
        }).catch((err) => {
          alert.raise({ key: 'read-error', errorMsg: err.message });

          // disconnect and try to reconnect to the SQL database
          disconnectReconnectToSql();
        });
    } else {
      // log.info('-----setting requestTimer');
      requestTimer = setTimeout(requestTimerFunction, requestFrequencyMs);
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function connectToSql() {
    // create the MS SQL configuration
    const sqlConfig = {
      port: that.machine.settings.model.sqlPort,
      database: that.machine.settings.model.sqlDatabaseName,
      user: that.machine.settings.model.username,
      password: that.machine.settings.model.password,
    };

    log.info('>>>>> connectToSql');

    // create a connection to the SQL database
    if (isMySQL) {
      sqlConfig.host = that.machine.settings.model.sqlServerName;
      sqlDbConnectionPool = mysql.createPool(sqlConfig);
      sqlDbConnectionPool.getConnection().then((conn) => {
        log.info('>>> got mySql connection');
        alert.clear('connection-error');
        sqlDbRequest = conn;
        connected = true;
        connectionDetected();
        updateConnectionStatus(true);
        // log.info('-----setting requestTimer');
        requestTimer = setTimeout(requestTimerFunction, requestFrequencyMs);
      }).catch((err) => {
        log.info(`>>> mySql getConnection error.  err = ${err}`);
        alert.raise({ key: 'connection-error', errorMsg: err.message });
        disconnectReconnectToSql();
      });
    } else {
      sqlConfig.server = that.machine.settings.model.sqlServerName;
      if (_.has(that.machine.settings.model, 'mssqlRequestTimeout')) {
        sqlConfig.requestTimeout = that.machine.settings.model.mssqlRequestTimeout;
      }
      sqlDbConnectionPool = new mssql.ConnectionPool(sqlConfig);
      sqlDbConnectionPool.connect().then(() => {
        log.info('>>> got msSql connection');
        alert.clear('connection-error');
        sqlDbRequest = new mssql.Request(sqlDbConnectionPool);
        connected = true;
        connectionDetected();
        updateConnectionStatus(true);
        // log.info('-----setting requestTimer');
        requestTimer = setTimeout(requestTimerFunction, requestFrequencyMs);
      }).catch((err) => {
        log.info(`>>> msSql getConnection error.  err = ${err}`);
        alert.raise({ key: 'connection-error', errorMsg: err.message });
        disconnectReconnectToSql();
      });
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function open(callback) {
    requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    connectionReported = false;
    disconnectionReported = false;
    numTableRows = 0;
    machineStarted = true;

    // get whether MySQL or Microsoft SQL
    isMySQL = that.machine.settings.model.sqlServerType === 'MySQL';

    addTimestampField = _.get(that.machine.settings.model, 'addTimestampField', false);
    baseTimestampFieldName = _.get(that.machine.settings.model, 'baseTimestampFieldName', '');
    utcOffset = _.get(that.machine.settings.model, 'utcOffset', 0);

    lastKeyFieldValue = 0;

    if (_.get(that.machine.settings.model, 'reportAllUpdatedRecords', false)) {
      that.machine.variables.push(combinedResultVariable);
    }

    // connect to the SQL database
    connectToSql();

    // trigger callback on succesful connection
    return callback(null);
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function validateCondition(condition) {
    // replace AND and OR with && and ||
    let evalCond = condition.trim().toUpperCase();
    if (evalCond.length === 0) return true;
    evalCond = evalCond.replace(/ AND /gi, '&&');
    evalCond = evalCond.replace(/\)AND/gi, ')&&');
    evalCond = evalCond.replace(/AND\(/gi, '&&(');
    evalCond = evalCond.replace(/ OR /gi, '||');
    evalCond = evalCond.replace(/\)OR/gi, ')||');
    evalCond = evalCond.replace(/OR\(/gi, '||(');

    // replace = with == if not preceded by < or >
    evalCond = evalCond.replace(/(?<![<|>])=/gi, '==');

    // replace <> with !=
    evalCond = evalCond.replace(/<>/gi, '!=');

    // replace variable names with 0
    evalCond = evalCond.replace(/[A-Z]+[A-Z0-9_-]*/gi, ' 0 ');

    // return true only if condition evaluates without throwing an error
    try {
      // eslint-disable-next-line no-eval
      eval(evalCond);
      return true;
    } catch (e) {
      return false;
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

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

    // validate any where conditions
    for (let iVar = 0; iVar < that.machine.variables.length; iVar += 1) {
      if (_.has(that.machine.variables[iVar], 'where')) {
        if (!validateCondition(that.machine.variables[iVar].where)) {
          alert.raise({ key: 'invalid-where-error', variable: that.machine.variables[iVar].name });
          return done(new Error('Invalid Where condition'));
        }
      }
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

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  this.stop = function stop(done) {
    updateConnectionStatus(false);

    machineStarted = false;

    if (!that.machine) {
      return done('machine undefined');
    }

    // stop the request timer task (if being used)
    if (requestTimer) {
      clearTimeout(requestTimer);
      requestTimer = null;
    }

    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }

    // if any pending reconnection, stop its timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (variableReportTimer) {
      clearTimeout(variableReportTimer);
      variableReportTimer = null;
    }

    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }

      disconnectFromSql();

      log.info('Stopped');
      return done(null);
    });

    return undefined;
  };

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop((err) => {
      if (err) return done(err);
      that.start(that.dataCb, that.configUpdateCb, startErr => done(startErr));
      return undefined;
    });
  };

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  this.updateModel = function updateModel(newModel, done) {
    log.debug('Updating');
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

module.exports = {
  hpl: hplSQL,
  defaults,
  schema,
};
