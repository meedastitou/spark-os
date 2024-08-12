/* jshint esversion: 6 */
/* eslint no-underscore-dangle: ["error", { "allow": ["_port"] }] */
const _ = require('lodash');

let variables;
let highByteFirst = false;
let highWordFirst = false;
let causeError = null;

const ModbusTester = function ModbusTester() {
  this.isOpen = false;
  this._port = null;

  function readBits(type, address, numBits, callback) {
    const data = [];
    for (let iBit = 0; iBit < numBits; iBit += 1) {
      data.push(null);
    }
    variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
      && (_.get(variable, 'access', 'read') === 'read')
      && (variable.type === type)) {
        const varAddress = parseInt(variable.address, 16);
        if ((varAddress >= address) && (varAddress < (address + numBits))) {
          data[varAddress - address] = variable.value;
        }
      }
    });
    callback(null, { data });
  }

  function readWords(type, address, numWords, callback) {
    if (causeError) {
      return callback(causeError, null);
    }

    const buffer = Buffer.alloc(2 * numWords);
    variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && (_.get(variable, 'access', 'read') === 'read')
       && (variable.type === type)) {
        const varAddress = parseInt(variable.address, 16);
        if ((varAddress >= address) && (varAddress < (address + numWords))) {
          let { value } = variable;
          if (_.get(variable, 'decEncoding', false)) {
            value = parseInt(value.toString(10), 16);
          }
          switch (variable.format) {
            case 'char':
              buffer.write(value);
              if (highByteFirst) {
                buffer.swap16();
              }
              break;
            case 'uint16':
              if (highByteFirst) {
                buffer.writeUInt16BE(value, varAddress - address);
              } else {
                buffer.writeUInt16LE(value, varAddress - address);
              }
              break;
            case 'int16':
              if (highByteFirst) {
                buffer.writeInt16BE(value, varAddress - address);
              } else {
                buffer.writeInt16LE(value, varAddress - address);
              }
              break;
            case 'int32':
              if (highByteFirst) {
                if (highWordFirst) {
                  buffer.writeInt32BE(value, 2 * (varAddress - address));
                } else {
                  const arrayBuffer = new ArrayBuffer(4);
                  (new Int32Array(arrayBuffer))[0] = value;
                  buffer.writeUInt16BE((new Uint16Array(arrayBuffer))[0],
                    2 * (varAddress - address));
                  buffer.writeUInt16BE((new Uint16Array(arrayBuffer))[1],
                    2 * (varAddress - address) + 2);
                }
              } else if (highWordFirst) {
                const arrayBuffer = new ArrayBuffer(4);
                (new Int32Array(arrayBuffer))[0] = value;
                buffer.writeUInt16LE((new Uint16Array(arrayBuffer))[1],
                  2 * (varAddress - address));
                buffer.writeUInt16LE((new Uint16Array(arrayBuffer))[0],
                  2 * (varAddress - address) + 2);
              } else {
                buffer.writeInt32LE(value, 2 * (varAddress - address));
              }
              break;
            case 'float':
              if (highByteFirst) {
                if (highWordFirst) {
                  buffer.writeFloatBE(value, 2 * (varAddress - address));
                } else {
                  const arrayBuffer = new ArrayBuffer(4);
                  (new Float32Array(arrayBuffer))[0] = value;
                  buffer.writeUInt16BE((new Uint16Array(arrayBuffer))[0],
                    2 * (varAddress - address));
                  buffer.writeUInt16BE((new Uint16Array(arrayBuffer))[1],
                    2 * (varAddress - address) + 2);
                }
              } else if (highWordFirst) {
                const arrayBuffer = new ArrayBuffer(4);
                (new Float32Array(arrayBuffer))[0] = value;
                buffer.writeUInt16LE((new Uint16Array(arrayBuffer))[1],
                  2 * (varAddress - address));
                buffer.writeUInt16LE((new Uint16Array(arrayBuffer))[0],
                  2 * (varAddress - address) + 2);
              } else {
                buffer.writeFloatLE(value, 2 * (varAddress - address));
              }
              break;
            default:
          }
        }
      }
    });
    callback(null, { buffer });
    return undefined;
  }

  this.connectRTUBuffered = function connectRTUBuffered(path, options, callback) {
    this.isOpen = true;
    this._port = 'RTUBuffered';
    callback(null);
  };

  this.connectAsciiSerial = function connectAsciiSerial(path, options, callback) {
    this.isOpen = true;
    this._port = 'AsciiSerial';
    callback(null);
  };

  this.connectTCP = function connectTCP(ipAddress, callback) {
    this.isOpen = true;
    this._port = 'TCP';
    callback(null);
  };

  this.close = function close(callback) {
    this.isOpen = false;
    this._port = null;
    callback(null);
  };

  this.setID = function setID() {
  };

  this.setTimeout = function setTimeout() {
  };

  this.readDiscreteInputs = function readDiscreteInputs(address, numBits, callback) {
    readBits('di', address, numBits, callback);
  };

  this.readCoils = function readCoils(address, numBits, callback) {
    readBits('coil', address, numBits, callback);
  };

  this.readHoldingRegisters = function readHoldingRegisters(address, numWords, callback) {
    this.isOpen = causeError === null;
    readWords('hr', address, numWords, callback);
  };

  this.readInputRegisters = function readInputRegisters(address, numWords, callback) {
    readWords('ir', address, numWords, callback);
  };

  this.writeRegisters = function writeRegisters(address, writeValues, callback) {
    for (let iVar = 0; iVar < variables.length; iVar += 1) {
      const variable = variables[iVar];
      if (!_.get(variable, 'machineConnected', false)
      && (_.get(variable, 'access', 'read') === 'write')
      && (variable.type === 'hr')
      && (parseInt(variable.address, 16) === address)) {
        let writeValue = null;
        switch (variable.format) {
          case 'char': {
            let buffer = Buffer.allocUnsafe(2 * writeValues.length);
            for (let iVal = 0; iVal < writeValues.length; iVal += 1) {
              if (highByteFirst) {
                buffer.writeUInt16BE(writeValues[iVal], 2 * iVal);
              } else {
                buffer.writeUInt16LE(writeValues[iVal], 2 * iVal);
              }
            }
            // remove extra byte of strings with odd lengths
            if (buffer.readUInt8(buffer.length - 1) === 0) {
              buffer = buffer.slice(0, buffer.length - 1);
            }
            writeValue = buffer.toString('ascii');
            break;
          }
          case 'uint16':
            if (highByteFirst) {
              [writeValue] = writeValues;
            } else {
              const buffer = Buffer.allocUnsafe(2);
              buffer.writeUInt16BE(writeValues[0], 0);
              writeValue = buffer.readUInt16LE(0);
            }
            break;
          case 'int16': {
            const buffer = Buffer.allocUnsafe(2);
            buffer.writeUInt16BE(writeValues[0], 0);
            if (highByteFirst) {
              writeValue = buffer.readInt16BE(0);
            } else {
              writeValue = buffer.readInt16LE(0);
            }
            break;
          }
          case 'int32': {
            const buffer = Buffer.allocUnsafe(4);
            if (highByteFirst) {
              if (highWordFirst) {
                buffer.writeUInt16BE(writeValues[0], 0);
                buffer.writeUInt16BE(writeValues[1], 2);
              } else {
                buffer.writeUInt16BE(writeValues[0], 2);
                buffer.writeUInt16BE(writeValues[1], 0);
              }
              writeValue = buffer.readInt32BE(0);
            } else {
              if (highWordFirst) {
                buffer.writeUInt16BE(writeValues[0], 2);
                buffer.writeUInt16BE(writeValues[1], 0);
              } else {
                buffer.writeUInt16BE(writeValues[0], 0);
                buffer.writeUInt16BE(writeValues[1], 2);
              }
              writeValue = buffer.readInt32LE(0);
            }
            break;
          }
          case 'float': {
            const buffer = Buffer.allocUnsafe(4);
            if (highByteFirst) {
              if (highWordFirst) {
                buffer.writeUInt16BE(writeValues[0], 0);
                buffer.writeUInt16BE(writeValues[1], 2);
              } else {
                buffer.writeUInt16BE(writeValues[0], 2);
                buffer.writeUInt16BE(writeValues[1], 0);
              }
              writeValue = buffer.readFloatBE(0);
            } else {
              if (highWordFirst) {
                buffer.writeUInt16BE(writeValues[0], 2);
                buffer.writeUInt16BE(writeValues[1], 0);
              } else {
                buffer.writeUInt16BE(writeValues[0], 0);
                buffer.writeUInt16BE(writeValues[1], 2);
              }
              writeValue = buffer.readFloatLE(0);
            }
            break;
          }
          default:
        }
        if (writeValue === variable.value) {
          callback(null);
        } else {
          console.log(`writeValue = ${writeValue}`);
          console.log(`variable.value = ${variable.value}`);
          callback(Error('write failed'));
        }
        return;
      }
    }
    callback(Error('invalid write variable'));
  };

  this.writeCoil = function writeCoil(address, state, callback) {
    for (let iVar = 0; iVar < variables.length; iVar += 1) {
      const variable = variables[iVar];
      if (!_.get(variable, 'machineConnected', false)
      && (_.get(variable, 'access', 'read') === 'write')
      && ((variable.type === 'coil') || (variable.type === 'di'))
      && (parseInt(variable.address, 16) === address)) {
        if (state === variable.value) {
          callback(null);
        } else {
          callback(Error('write failed'));
        }
        return;
      }
    }
  };
};


ModbusTester.prototype.setVariables = function setVariables(machineVariables) {
  variables = machineVariables;
};

ModbusTester.prototype.setEndedness = function setEndedness(highBFirst, highWFirst) {
  highByteFirst = highBFirst;
  highWordFirst = highWFirst;
};

ModbusTester.prototype.setCauseError = function setCauseError(error) {
  causeError = error;
};


module.exports = ModbusTester;
