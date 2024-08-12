
const _ = require('lodash');
const os = require('os');

let variables = [];
let connError = null;
let writeError = null;
let dataNullError = null;

const NodeS7EthernetServer = function NodeS7EthernetServer() {
  this.isoclient = 0;
  this.isoConnectionState = 0;
  this.localTSAP = 0;
  this.remoteTSAP = 0;
  this.readArray = [];
  this.connectionID = 'UNDEF';
  this.resultObject = {};
};

NodeS7EthernetServer.prototype.setConnectionError = function setConnectionError(error) {
  connError = error;
};

NodeS7EthernetServer.prototype.initiateConnection = function initiateConnection(params, callback) {
  if (params === undefined) {
    // eslint-disable-next-line no-param-reassign
    params = {
      port: 102,
      host: os.hostname(),
    };
  }
  if (typeof (params.rack) !== 'undefined') {
    this.rack = params.rack;
  }
  if (typeof (params.slot) !== 'undefined') {
    this.slot = params.slot;
  }
  if (typeof (params.localTSAP) !== 'undefined') {
    this.localTSAP = params.localTSAP;
  }
  if (typeof (params.remoteTSAP) !== 'undefined') {
    this.remoteTSAP = params.remoteTSAP;
  }
  if (typeof (params.connection_name) === 'undefined') {
    this.connectionID = `${params.host} S${this.slot}`;
  } else {
    this.connectionID = params.connection_name;
  }

  if (connError) {
    return callback(Error('Error in connection'));
  }
  this.isoConnectionState = 2;
  return callback(null);
};

NodeS7EthernetServer.prototype.addItems = function addItems(address) {
  this.readArray.push(address);
};

NodeS7EthernetServer.prototype.readAllItems = function readAllItems(callback) {
  if (connError) {
    return callback(connError);
  }
  this.readArray.forEach((data) => {
    variables.some((variable) => {
      if (_.isEqual(data, variable.address)) {
        this.resultObject[`${variable.address}`] = variable.value;
        if (dataNullError && _.isEqual(variable.address, dataNullError)) {
          this.resultObject[`${variable.address}`] = 'BAD 255';
        }
        return true;
      }
      return undefined;
    });
  });
  return callback(null, this.resultObject);
};

NodeS7EthernetServer.prototype.dropConnection = function dropConnection(callback) {
  this.isoConnectionState = 0;
  callback(null);
};

NodeS7EthernetServer.prototype.writeItems = function writeItems(address, value, cb) {
  variables.forEach((variable) => {
    let writeValue = null;
    if (!_.get(variable, 'machineConnected', false) && (_.get(variable, 'access', 'read') === 'write') && (_.isEqual(variable.address, address))) {
      writeValue = value;
      if ((writeValue === variable.value) && (!writeError)) {
        return cb(null);
      }
      return cb(Error('Error in writing the value'));
    }
    return undefined;
  });
  return undefined;
};

NodeS7EthernetServer.prototype.setWriteError = function setWriteError(writeErr, cb) {
  writeError = writeErr;
  return cb(null);
};

NodeS7EthernetServer.prototype.setDataNullError = function setDataNullError(error) {
  dataNullError = error;
};

NodeS7EthernetServer.prototype.setVariables = function setVariables(readVariable) {
  variables = readVariable;
};

module.exports = NodeS7EthernetServer;
