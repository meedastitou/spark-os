/* jshint esversion: 6 */
const { EventEmitter } = require('events');
const _ = require('lodash');

const NETWORKS = {
  eth1:
    [{
      address: '10.0.2.15',
      netmask: '255.255.255.0',
      family: 'IPv4',
    }],
  eth0:
    [{
      address: '127.0.0.1',
      netmask: '255.0.0.0',
      family: 'IPv4',
    }],
};

let variables;

const BeckhoffADSTester = function BeckhoffADSTester() {
  const BeckhoffADSTesterClient = new EventEmitter();
  BeckhoffADSTesterClient.read = function read(readHandle, callback) {
    for (let iVar = 0; iVar < variables.length; iVar += 1) {
      const variable = variables[iVar];
      if (!_.get(variable, 'machineConnected', false)
       && (_.get(variable, 'access', 'read') === 'read')) {
        if (variable.adsAddressName === readHandle.symname) {
          let valueBuffer = null;
          switch (variable.format) {
            case 'char':
              valueBuffer = Buffer.allocUnsafe(variable.length);
              valueBuffer.write(variable.value, 0, variable.length, 'ascii');
              break;
            case 'uint8':
              if (variable.length === undefined) {
                valueBuffer = Buffer.allocUnsafe(1);
                valueBuffer.writeUInt8(variable.value, 0);
              } else {
                valueBuffer = Buffer.allocUnsafe(variable.length);
                for (let iVal = 0; iVal < variable.length; iVal += 1) {
                  valueBuffer.writeUInt8(variable.value[iVal], iVal);
                }
              }
              break;
            case 'uint16':
              if (variable.length === undefined) {
                valueBuffer = Buffer.allocUnsafe(2);
                valueBuffer.writeUInt16LE(variable.value, 0);
              } else {
                valueBuffer = Buffer.allocUnsafe(2 * variable.length);
                for (let iVal = 0; iVal < variable.length; iVal += 1) {
                  valueBuffer.writeUInt16LE(variable.value[iVal], 2 * iVal);
                }
              }
              break;
            case 'uint32':
              if (variable.length === undefined) {
                valueBuffer = Buffer.allocUnsafe(4);
                valueBuffer.writeUInt32LE(variable.value, 0);
              } else {
                valueBuffer = Buffer.allocUnsafe(4 * variable.length);
                for (let iVal = 0; iVal < variable.length; iVal += 1) {
                  valueBuffer.writeUInt32LE(variable.value[iVal], 4 * iVal);
                }
              }
              break;
            case 'int8':
              if (variable.length === undefined) {
                valueBuffer = Buffer.allocUnsafe(1);
                valueBuffer.writeInt8(variable.value, 0);
              } else {
                valueBuffer = Buffer.allocUnsafe(variable.length);
                for (let iVal = 0; iVal < variable.length; iVal += 1) {
                  valueBuffer.writeInt8(variable.value[iVal], iVal);
                }
              }
              break;
            case 'int16':
              if (variable.length === undefined) {
                valueBuffer = Buffer.allocUnsafe(2);
                valueBuffer.writeInt16LE(variable.value, 0);
              } else {
                valueBuffer = Buffer.allocUnsafe(2 * variable.length);
                for (let iVal = 0; iVal < variable.length; iVal += 1) {
                  valueBuffer.writeInt16LE(variable.value[iVal], 2 * iVal);
                }
              }
              break;
            case 'int32':
              if (variable.length === undefined) {
                valueBuffer = Buffer.allocUnsafe(4);
                valueBuffer.writeInt32LE(variable.value, 0);
              } else {
                valueBuffer = Buffer.allocUnsafe(4 * variable.length);
                for (let iVal = 0; iVal < variable.length; iVal += 1) {
                  valueBuffer.writeInt32LE(variable.value[iVal], 4 * iVal);
                }
              }
              break;
            case 'float':
              if (variable.length === undefined) {
                valueBuffer = Buffer.allocUnsafe(4);
                valueBuffer.writeFloatLE(variable.value, 0);
              } else {
                valueBuffer = Buffer.allocUnsafe(4 * variable.length);
                for (let iVal = 0; iVal < variable.length; iVal += 1) {
                  valueBuffer.writeFloatLE(variable.value[iVal], 4 * iVal);
                }
              }
              break;
            case 'double':
              if (variable.length === undefined) {
                valueBuffer = Buffer.allocUnsafe(8);
                valueBuffer.writeDoubleLE(variable.value, 0);
              } else {
                valueBuffer = Buffer.allocUnsafe(8 * variable.length);
                for (let iVal = 0; iVal < variable.length; iVal += 1) {
                  valueBuffer.writeDoubleLE(variable.value[iVal], 8 * iVal);
                }
              }
              break;
            case 'bool':
              if (variable.length === undefined) {
                valueBuffer = Buffer.allocUnsafe(1);
                valueBuffer.writeUInt8(variable.value ? 1 : 0, 0);
              } else {
                valueBuffer = Buffer.allocUnsafe(variable.length);
                for (let iVal = 0; iVal < variable.length; iVal += 1) {
                  valueBuffer.writeUInt8(variable.value[iVal] ? 1 : 0, iVal);
                }
              }
              break;
            default:
          }
          return callback(null, { value: valueBuffer });
        }
      }
    }
    return callback('variable not found', null);
  };

  BeckhoffADSTesterClient.multiRead = function multiRead(readHandles, callback) {
    const returnHandleArray = [];
    for (let iHandle = 0; iHandle < readHandles.length; iHandle += 1) {
      const readHandle = readHandles[iHandle];
      let foundVariableFlag = false;
      for (let iVar = 0; iVar < variables.length; iVar += 1) {
        const variable = variables[iVar];
        if (!_.get(variable, 'machineConnected', false)
         && (_.get(variable, 'access', 'read') === 'read')) {
          if (variable.adsAddressName === readHandle.symname) {
            let valueBuffer = null;
            switch (variable.format) {
              case 'char':
                valueBuffer = Buffer.allocUnsafe(variable.length);
                valueBuffer.write(variable.value, 0, variable.length, 'ascii');
                break;
              case 'uint8':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(1);
                  valueBuffer.writeUInt8(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeUInt8(variable.value[iVal], iVal);
                  }
                }
                break;
              case 'uint16':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(2);
                  valueBuffer.writeUInt16LE(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(2 * variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeUInt16LE(variable.value[iVal], 2 * iVal);
                  }
                }
                break;
              case 'uint32':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(4);
                  valueBuffer.writeUInt32LE(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(4 * variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeUInt32LE(variable.value[iVal], 4 * iVal);
                  }
                }
                break;
              case 'int8':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(1);
                  valueBuffer.writeInt8(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeInt8(variable.value[iVal], iVal);
                  }
                }
                break;
              case 'int16':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(2);
                  valueBuffer.writeInt16LE(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(2 * variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeInt16LE(variable.value[iVal], 2 * iVal);
                  }
                }
                break;
              case 'int32':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(4);
                  valueBuffer.writeInt32LE(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(4 * variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeInt32LE(variable.value[iVal], 4 * iVal);
                  }
                }
                break;
              case 'float':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(4);
                  valueBuffer.writeFloatLE(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(4 * variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeFloatLE(variable.value[iVal], 4 * iVal);
                  }
                }
                break;
              case 'double':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(8);
                  valueBuffer.writeDoubleLE(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(8 * variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeDoubleLE(variable.value[iVal], 8 * iVal);
                  }
                }
                break;
              case 'bool':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(1);
                  valueBuffer.writeUInt8(variable.value ? 1 : 0, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeUInt8(variable.value[iVal] ? 1 : 0, iVal);
                  }
                }
                break;
              default:
            }
            returnHandleArray.push({ value: valueBuffer });
            iVar = variables.length; // break out of search loop
            foundVariableFlag = true;
          }
        }
      }
      if (!foundVariableFlag) {
        return callback('variable not found', null);
      }
    }
    return callback(null, returnHandleArray);
  };

  BeckhoffADSTesterClient.getHandles = function getHandles(readHandles, callback) {
    return callback(null, readHandles);
  };

  BeckhoffADSTesterClient.multiReadWithExistingHandles = function multiRead(readHandles, callback) {
    const returnHandleArray = [];
    for (let iHandle = 0; iHandle < readHandles.length; iHandle += 1) {
      const readHandle = readHandles[iHandle];
      let foundVariableFlag = false;
      for (let iVar = 0; iVar < variables.length; iVar += 1) {
        const variable = variables[iVar];
        if (!_.get(variable, 'machineConnected', false)
         && (_.get(variable, 'access', 'read') === 'read')) {
          if (variable.adsAddressName === readHandle.symname) {
            let valueBuffer = null;
            switch (variable.format) {
              case 'char':
                valueBuffer = Buffer.allocUnsafe(variable.length);
                valueBuffer.write(variable.value, 0, variable.length, 'ascii');
                break;
              case 'uint8':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(1);
                  valueBuffer.writeUInt8(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeUInt8(variable.value[iVal], iVal);
                  }
                }
                break;
              case 'uint16':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(2);
                  valueBuffer.writeUInt16LE(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(2 * variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeUInt16LE(variable.value[iVal], 2 * iVal);
                  }
                }
                break;
              case 'uint32':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(4);
                  valueBuffer.writeUInt32LE(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(4 * variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeUInt32LE(variable.value[iVal], 4 * iVal);
                  }
                }
                break;
              case 'int8':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(1);
                  valueBuffer.writeInt8(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeInt8(variable.value[iVal], iVal);
                  }
                }
                break;
              case 'int16':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(2);
                  valueBuffer.writeInt16LE(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(2 * variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeInt16LE(variable.value[iVal], 2 * iVal);
                  }
                }
                break;
              case 'int32':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(4);
                  valueBuffer.writeInt32LE(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(4 * variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeInt32LE(variable.value[iVal], 4 * iVal);
                  }
                }
                break;
              case 'float':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(4);
                  valueBuffer.writeFloatLE(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(4 * variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeFloatLE(variable.value[iVal], 4 * iVal);
                  }
                }
                break;
              case 'double':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(8);
                  valueBuffer.writeDoubleLE(variable.value, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(8 * variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeDoubleLE(variable.value[iVal], 8 * iVal);
                  }
                }
                break;
              case 'bool':
                if (variable.length === undefined) {
                  valueBuffer = Buffer.allocUnsafe(1);
                  valueBuffer.writeUInt8(variable.value ? 1 : 0, 0);
                } else {
                  valueBuffer = Buffer.allocUnsafe(variable.length);
                  for (let iVal = 0; iVal < variable.length; iVal += 1) {
                    valueBuffer.writeUInt8(variable.value[iVal] ? 1 : 0, iVal);
                  }
                }
                break;
              default:
            }
            returnHandleArray.push({ value: valueBuffer });
            iVar = variables.length; // break out of search loop
            foundVariableFlag = true;
          }
        }
      }
      if (!foundVariableFlag) {
        return callback('variable not found', null);
      }
    }
    return callback(null, returnHandleArray);
  };

  BeckhoffADSTesterClient.write = function write(writeHandle, callback) {
    for (let iVar = 0; iVar < variables.length; iVar += 1) {
      const variable = variables[iVar];
      if (!_.get(variable, 'machineConnected', false)
       && (_.get(variable, 'access', 'read') === 'write')) {
        if (variable.adsAddressName === writeHandle.symname) {
          let writeValue = null;
          switch (variable.format) {
            case 'char':
              writeValue = writeHandle.value.toString('ascii', 0, writeHandle.bytelength);
              break;
            case 'uint8':
            case 'uint16':
            case 'uint32':
              writeValue = writeHandle.value.readUIntLE(0, writeHandle.bytelength);
              break;
            case 'int8':
            case 'int16':
            case 'int32':
              writeValue = writeHandle.value.readIntLE(0, writeHandle.bytelength);
              break;
            case 'float':
              writeValue = writeHandle.value.readFloatLE(0);
              break;
            case 'double':
              writeValue = writeHandle.value.readDoubleLE(0);
              break;
            case 'bool':
              writeValue = writeHandle.value.readUInt8(0) !== 0;
              break;
            default:
          }
          if (writeValue === variable.value) {
            callback(null);
          } else {
            callback('write failed');
          }
          return;
        }
      }
    }

    callback('invalid write variable');
  };
  BeckhoffADSTesterClient.end = function end(callback) {
    if (callback) callback();
  };

  this.setVariables = function setVariables(machineVariables) {
    variables = machineVariables;
  };

  this.emit = function emit(emitEvent, emitData) {
    setTimeout(() => {
      BeckhoffADSTesterClient.emit(emitEvent, emitData);
    }, 100);
  };

  this.networkInterfaces = function networkInterfaces() {
    return NETWORKS;
  };

  this.connect = function connect(options, callback) {
    callback();
    return BeckhoffADSTesterClient;
  };
};

module.exports = new BeckhoffADSTester();
