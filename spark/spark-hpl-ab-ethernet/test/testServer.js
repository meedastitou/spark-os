const _ = require('lodash');

let variables = [];
let connectionError = null;
let readError = null;
let writeError = null;

const client = function nodepcccTestServer() {
  this.port = null;
  this.host = null;
  this.routing = [];
  this.readArray = [];
  this.resultObject = {};

  // private methods
  this.initiateConnection = (connConfig, callback) => {
    this.port = connConfig.port;
    this.host = connConfig.host;
    this.routing = connConfig.routing;

    if (connectionError) {
      return callback(new Error(connectionError));
    }
    return callback(null);
  };

  this.addItems = (address) => {
    this.readArray.push(address);
    return undefined;
  };

  this.dropConnection = () => null;

  this.readAllItems = (callback) => {
    if (readError) {
      return callback(new Error(readError));
    }
    this.readArray.forEach((data) => {
      variables.some((variable) => {
        if (_.isEqual(data, variable.address)) {
          this.resultObject[`${variable.address}`] = variable.value;
          return true;
        }
        return undefined;
      });
    });

    return callback(null, this.resultObject);
  };

  this.writeItems = (address, value, callback) => {
    if (writeError) {
      return callback(new Error(writeError));
    }
    variables.forEach((variable) => {
      let writeValue = null;
      if (_.isEqual(variable.address, address)) {
        writeValue = value;
        if ((writeValue === variable.value)) {
          return callback(null);
        }
      }
      return undefined;
    });
    return undefined;
  };
};

client.prototype.setVariables = (variable) => {
  variables = variable;
};

client.prototype.setConnectionError = (error) => {
  connectionError = error;
};

client.prototype.setReadError = (error) => {
  readError = error;
};

client.prototype.setWriteError = (error) => {
  writeError = error;
};

module.exports = client;
