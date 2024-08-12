/* jshint esversion: 6 */
const _ = require('lodash');

let isMySQL = false;
let variables;
let variableQueryStrings;
let numRows = 1;
let rejectQuery = false;

const SQLQueryTester = function SQLQueryTester() {
  this.query = function query(queryString) {
    const response = isMySQL ? [] : { recordset: [] };
    if (queryString.startsWith('select count (*)')) {
      if (isMySQL) {
        response.push({ 'count (*)': numRows });
      } else {
        response.recordset.push({ '': numRows });
      }
      numRows += 1;
    } else if ((queryString.startsWith('select top 1 column1, column2, column3, column7, column0 from SparkData order by column0 desc'))
               || (queryString.startsWith('select top 1 column1, column2, column3, column7, column0 from [SparkData] order by column0 desc'))) {
      for (let iVar = 0; iVar < variables.length; iVar += 1) {
        const variable = variables[iVar];
        if (!_.get(variable, 'machineConnected', false)) {
          const value = {};
          value[variable.column] = variable.value;
          value.column0 = 1;
          if (isMySQL) {
            response.push(value);
          } else {
            response.recordset.push(value);
          }
        }
      }
    } else if ((queryString.startsWith('select top 1 column1, column2, column3, column7, column0Date from SparkData order by column0Date desc'))
               || (queryString.startsWith('select top 1 column1, column2, column3, column7, column0Date from [SparkData] order by column0Date desc'))) {
      for (let iVar = 0; iVar < variables.length; iVar += 1) {
        const variable = variables[iVar];
        if (!_.get(variable, 'machineConnected', false)) {
          const value = {};
          value[variable.column] = variable.value;
          value.column0Date = 'Thu May 18 2023 23:35:42 GMT+0000 (UTC)';
          if (isMySQL) {
            response.push(value);
          } else {
            response.recordset.push(value);
          }
        }
      }
    } else {
      for (let iVar = 0; iVar < variables.length; iVar += 1) {
        if (queryString === variableQueryStrings[iVar]) {
          const variable = variables[iVar];
          if (_.get(variable, 'array', false)) {
            for (let iVal = 0; iVal < variable.value.length; iVal += 1) {
              const value = {};
              value[variable.column] = variable.value[iVal];
              if (isMySQL) {
                response.push(value);
              } else {
                response.recordset.push(value);
              }
            }
          } else if (_.get(variable, 'stringConvertTest', false)) {
            const value = {};
            value[variable.column] = `${variable.value}`;
            if (isMySQL) {
              response.push(value);
            } else {
              response.recordset.push(value);
            }
          } else {
            const value = {};
            value[variable.column] = variable.value;
            if (isMySQL) {
              response.push(value);
            } else {
              response.recordset.push(value);
            }
          }
          break;
        }
      }
    }
    return new Promise((resolve, reject) => {
      if (rejectQuery) {
        reject(Error('Invalid query'));
      } else {
        resolve(response);
      }
    });
  };

  this.setData = function setData(mySQL, machineVariables, sqlTableName) {
    isMySQL = mySQL;
    variables = machineVariables;
    variableQueryStrings = [];
    for (let iVar = 0; iVar < variables.length; iVar += 1) {
      const variable = variables[iVar];
      if (_.get(variable, 'machineConnected', false)) {
        variableQueryStrings.push(null);
      } else {
        // build the select query for this variable
        let selectQuery = 'select ';

        // for mysql, if not array, add limit 1, if array add limit n if length = n
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
          selectQuery += ` from ${sqlTableName} `;
        } else {
          selectQuery += ` from [${sqlTableName}] `;
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

        variableQueryStrings.push(selectQuery);
      }
    }
  };

  this.setReject = function setReject(reject) {
    rejectQuery = reject;
  };
};

module.exports = new SQLQueryTester();
