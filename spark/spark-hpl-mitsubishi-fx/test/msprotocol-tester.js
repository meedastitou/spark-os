
const _ = require('lodash');
const { EventEmitter } = require('events');

let variables = [];
let readArray = [];
let connError = null;
let writeError = null;

const MCProtocolTester = function MCProtocolTester() {
};

MCProtocolTester.prototype.emitter = new EventEmitter();

MCProtocolTester.prototype.setConnectionError = function setConnectionError(error) {
  connError = error;
};

MCProtocolTester.prototype.initiateConnection = function initiateConnection(args, callback) {
  if (connError) return callback(connError);
  return callback(undefined);
};

MCProtocolTester.prototype.addItems = function addItems(readItems) {
  readArray = readItems;
};

MCProtocolTester.prototype.readAllItems = function readAllItems(callback) {
  if (connError) {
    return callback(connError);
  }
  const resultObject = {};
  let iRead = 0;
  for (let iVar = 0; iVar < variables.length; iVar += 1) {
    const variable = variables[iVar];
    if (_.get(variable, 'access', 'read') === 'read') {
      resultObject[readArray[iRead]] = variable.value;
      iRead += 1;
    }
  }
  return callback(null, resultObject);
};

MCProtocolTester.prototype.dropConnection = function dropConnection() {
};

MCProtocolTester.prototype.writeItems = function writeItems(address, value, cb) {
  variables.forEach((variable) => {
    const varAddr = variable.memoryArea + variable.address;
    let writeValue = null;
    if (!_.get(variable, 'machineConnected', false) && (_.get(variable, 'access', 'read') === 'write') && (_.isEqual(varAddr, address))) {
      writeValue = value;
      if ((writeValue === variable.value) && (!writeError)) {
        this.emitter.emit('wrote', writeValue);
        return cb(null);
      }
      return cb(Error('Error in writing the value'));
    }
    return undefined;
  });
  return undefined;
};

MCProtocolTester.prototype.setWriteError = function setWriteError(writeErr, cb) {
  writeError = writeErr;
  return cb(null);
};

MCProtocolTester.prototype.setVariables = function setVariables(readVariables) {
  variables = readVariables;
};

module.exports = MCProtocolTester;
