const _ = require('lodash');
const constants = require('./constants.js');

let variables = [];
let variableError = null;
let connError = null;
let writeError = null;

const NodeS7Serial = function NodeS7Serial() {
  this.isoConnectionState = 0;
  this.protocolMode = 0;
  this.device = 0;
  this.baudRate = 0;
  this.party = 0;
  this.mpiMode = 0;
  this.mpiSpeed = 0;
  this.localAddress = 0;
  this.plcAddress = 0;
  this.serialPort = null;
  this.readArray = [];
  this.resultObject = {};
};

// eslint-disable-next-line max-len
function constructor(protocolMode, device, baudRate, parity, mpiMode, mpiSpeed, localAddress, plcAddress) {
  const object = new NodeS7Serial();
  object.protocolMode = protocolMode;
  object.device = device;
  object.baudRate = baudRate;
  object.parity = parity;
  object.mpiMode = mpiMode;
  object.mpiSpeed = mpiSpeed;
  object.localAddress = localAddress;
  object.plcAddress = plcAddress;
  return object;
}

NodeS7Serial.prototype.setVariableError = function setVariableError(error) {
  variableError = error;
};

NodeS7Serial.prototype.setConnectionError = function setConnectionError(error) {
  connError = error;
};

NodeS7Serial.prototype.initiateConnection = function initiateConnection(callback) {
  if (connError) {
    return callback(connError);
  }
  this.isoConnectionState = 0;
  return callback(null);
};

NodeS7Serial.prototype.addItems = function addItems(address) {
  this.readArray.push(address);
  return true;
};

NodeS7Serial.prototype.dropConnection = function dropConnection(callback) {
  this.isoConnectionState = 0;
  return callback(null);
};

NodeS7Serial.prototype.readAllItems = function readAllItems(callback) {
  this.readArray.forEach((data) => {
    variables.some((variable) => {
      if (_.isEqual(data, variable.address)) {
        this.resultObject[`${variable.address}`] = variable.value;

        if (variableError) {
          this.resultObject[`${variable.address}`] = 'BAD 255';
        }
        return true;
      }
      return undefined;
    });
  });

  if (variableError) {
    return callback(variableError, this.resultObject);
  }
  return callback(null, this.resultObject);
};

NodeS7Serial.prototype.writeItems = function writeItems(data, value, cb) {
  variables.forEach((variable) => {
    let writeValue = null;
    if (!_.get(variable, 'machineConnected', false) && (_.get(variable, 'access', 'read') === 'write') && (_.isEqual(variable.address, data.address))) {
      writeValue = value;
      if (writeValue === variable.value && (!writeError)) {
        return cb(null);
      }
      return cb(Error('Error in writing the value'));
    }
    return undefined;
  });
  return undefined;
};

NodeS7Serial.prototype.setVariables = function setVariables(readVariables) {
  variables = [];
  variables = readVariables;
};

NodeS7Serial.prototype.setWriteError = function setWriteError(writeErr, cb) {
  writeError = writeErr;
  return cb(null);
};

module.exports = NodeS7Serial;
module.exports.constructor = constructor;
module.exports.constants = constants;
