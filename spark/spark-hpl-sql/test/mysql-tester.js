/* jshint esversion: 6 */
const sqlQueryTester = require('./sql-query-tester');

let rejectConnection;

const MySQLTester = function MySQLTester() {
  const Connection = function Connection() {
    this.query = function query(queryString) {
      return sqlQueryTester.query(queryString);
    };

    this.release = function release() {
    };
  };

  const ConnectionPool = function ConnectionPool() {
    this.getConnection = function getConnection() {
      return new Promise((resolve, reject) => {
        if (rejectConnection) {
          reject(Error('Connection failed'));
        } else {
          resolve(new Connection());
        }
      });
    };

    this.end = function end() {
    };
  };

  this.createPool = function createPool() {
    return new ConnectionPool();
  };

  this.setData = function setData(mySQL, machineVariables, sqlTableName) {
    sqlQueryTester.setData(mySQL, machineVariables, sqlTableName);
  };

  this.setReject = function setReject(reject) {
    rejectConnection = reject;
    sqlQueryTester.setReject(reject);
  };
};

module.exports = new MySQLTester();
