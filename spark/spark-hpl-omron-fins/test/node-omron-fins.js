/* eslint-disable no-bitwise */
/* eslint-disable prefer-const */
let { EventEmitter } = require('events');
let _ = require('lodash');
let { inherits } = require('util');

let variableWriteArray = [];
let variableReadArray = [];
let readError = null;
let readVarError = null;
let writeError = null;
let connError = null;

function FinsClient(port, host, options) {
  if (!(this instanceof FinsClient)) return new FinsClient(port, host, options);
  // inherits(FinsClient, EventEmitter);
  EventEmitter.call(this);
  FinsClient.init.call(this, port, host, options);
}

inherits(FinsClient, EventEmitter);


FinsClient.init = function init(port, host, options) {
  let self = this;
  this.port = port;
  this.host = host;
  this.options = options;
  self.timer = null;
  this.counter = 1;

  if (connError) {
    self.timer = setTimeout(() => {
      self.emit('timeout');
      clearTimeout(self.timer);
    }, 1000);
  }
};

FinsClient.prototype.close = function close() {
  this.emit('close');
};

function classifier(variable) {
  let result = [];
  let high = null; let low = null;
  switch (variable.format) {
    case 'int8':
    case 'uint8':
      // eslint-disable-next-line no-bitwise
      high = variable.value >>> 8;
      result = [high];
      break;
    case 'int16':
    case 'uint16':
      result = [variable.value];
      break;
    case 'int32':
    case 'uint32':
    case 'float':
      high = (variable.value & 0xffff0000) >> 16;
      low = (variable.value & 0x0000ffff);
      result = [low, high];
      break;
    case 'double':
      high = variable.value >>> 48;
      result.push(high);
      high = variable.value >>> 32;
      high &= 0x00FF;
      result.push(high);
      low = variable.value & 0x000F;
      result.push(low);
      low = variable.value & 0xFF;
      result.push(low);
      break;
    case 'bool':
      result.push(variable.value);
      break;
    case 'char':
      result.push(variable.value);
      break;
    default: break;
  }
  return result;
}

FinsClient.prototype.read = function read(address, regsToRead, callback) {
  const READ_COMMAND = '0101';

  if (readError) {
    this.emit('error', 'Error in reading');
    return callback(null);
  }

  variableReadArray.forEach((variable) => {
    if (_.isEqual(variable.address, address)) {
      if (readVarError && _.isEqual(address, readVarError)) {
        this.emit('reply', null);
        return callback(null);
      }
      let result = classifier(variable);
      let responseObj = {
        remotehost: this.port,
        sid: this.counter,
        command: READ_COMMAND,
        response: 0,
        values: result,
      };

      this.emit('reply', responseObj);
      return callback(null);
    }
    return undefined;
  });
  return undefined;
};

FinsClient.prototype.write = function write(address, regsToWrite, callback) {
  if (writeError) {
    return callback(new Error('Write Error'));
  }
  variableWriteArray.forEach((variable) => {
    if (_.isEqual(variable.address, address)) {
      if ((variable.value === regsToWrite)) {
        return callback(null);
      }
      return callback(new Error('Error in writing '));
    }
    return undefined;
  });
  return undefined;
};

const TestServerOmronFins = function TestServerOmronFins() {
};

TestServerOmronFins.prototype.setReadVariables = function setReadVariables(variables) {
  variableReadArray = variables;
};

TestServerOmronFins.prototype.setWriteVariables = function setWriteVariables(variables) {
  variableWriteArray = variables;
};

TestServerOmronFins.prototype.setConnectionError = function setConnectionError(_connError) {
  connError = _connError;
};

TestServerOmronFins.prototype.setReadError = function setReadError(_readErrorArg) {
  readError = _readErrorArg;
};

TestServerOmronFins.prototype.setReadVarError = function setReadVarError(_readErrorArg) {
  readVarError = _readErrorArg;
};

TestServerOmronFins.prototype.setWriteError = function setWriteError(_writeErrorArg) {
  writeError = _writeErrorArg;
};

module.exports.FinsClient = FinsClient;
module.exports.TestServerOmronFins = TestServerOmronFins;
