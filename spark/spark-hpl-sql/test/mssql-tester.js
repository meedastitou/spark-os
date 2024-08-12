/* jshint esversion: 6 */
const sqlQueryTester = require('./sql-query-tester');

let rejectConnection;

const ConnectionPool = function ConnectionPool() {
  this.connect = function connect() {
    return new Promise((resolve, reject) => {
      if (rejectConnection) {
        reject(Error('Connection failed'));
      } else {
        resolve();
      }
    });
  };

  this.close = function close() {
  };
};

const Request = function Request() {
  this.query = function query(queryString) {
    return sqlQueryTester.query(queryString);
  };
};

const MsSQLTest = function MsSQLTest() {
  this.createPool = function createPool() {
  };
};

MsSQLTest.prototype.setData = function setData(mySQL, machineVariables, sqlTableName) {
  sqlQueryTester.setData(mySQL, machineVariables, sqlTableName);
};

MsSQLTest.prototype.setReject = function setReject(reject) {
  rejectConnection = reject;
  sqlQueryTester.setReject(reject);
};

module.exports = MsSQLTest;
module.exports.ConnectionPool = ConnectionPool;
module.exports.Request = Request;
