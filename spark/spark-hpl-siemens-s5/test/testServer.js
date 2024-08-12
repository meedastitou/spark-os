const _ = require('lodash');

let variables;
let writeVariables;
let varError = null;
let varReadError = null;
let writeError = null;
let connError = null;

/* const typeToSize = {
  float: {
    size: 4,
    method: 'Float',
  },
  double: {
    size: 4,
    method: 'Double',
  },
  int8: {
    size: 1,
    method: 'Int8',
  },
  int16: {
    size: 2,
    method: 'Int16',
  },
  int32: {
    size: 4,
    method: 'Int32',
  },
  int64: {
    size: 8,
    method: 'Int64',
  },
  uint8: {
    size: 1,
    method: 'UInt8',
  },
  uint16: {
    size: 2,
    method: 'UInt16',
  },
  uint32: {
    size: 4,
    method: 'UInt32',
  },
  uint64: {
    size: 8,
    method: 'UInt64',
  },
  char: {
    size: 1,
    method: 'Int8',
  },
  bool: {
    size: 1,
    method: 'Int8',
  },
}; */


const TestServerSiemensS5 = function TestServerSiemensS5(device) {
  this.device = device;

  this.openSync = function openSync() {
    if (connError) {
      throw new Error(connError);
    }
    return undefined;
  };

  this.closeSync = function closeSync() {
    return true;
  };

  function convertToBuffer(variable) {
    let buff = null;
    switch (variable.format) {
      case 'bool':
      case 'int8':
      case 'unint8':
        buff = Buffer.allocUnsafe(1);
        buff.writeInt8(variable.value, 0);
        break;
      case 'int16':
      case 'uint16':
        buff = Buffer.allocUnsafe(2);
        buff.writeUInt16BE(variable.value, 0);
        break;
      case 'int32':
      case 'uint32':
        buff = Buffer.allocUnsafe(4);
        buff.writeUInt32BE(variable.value, 0);
        break;
      case 'int64':
      case 'uint64':
        buff = Buffer.allocUnsafe(8);
        if (variable.endian === 'BE') {
          buff.writeUInt32BE(Math.floor(variable.value / 0x100000000), 0);
          // eslint-disable-next-line no-bitwise
          buff.writeUInt32BE(variable.value & 0xFFFFFFFF, 4);
        } else {
          buff.writeUInt32LE(Math.floor(variable.value / 0x100000000), 4);
          // eslint-disable-next-line no-bitwise
          buff.writeUInt32LE(variable.value & 0xFFFFFFFF, 0);
        }
        break;
      case 'float':
        buff = Buffer.allocUnsafe(4);
        buff.writeFloatBE(variable.value, 0);
        break;
      case 'double':
        buff = Buffer.allocUnsafe(8);
        buff.writeDoubleBE(variable.value, 0);
        break;

      default: break;
    }
    return buff;
  }

  function readValue(buffer, format) {
    let result = null;
    switch (format) {
      case 'int8':
      case 'uint8':
        result = buffer.readInt8();
        break;
      case 'int16':
      case 'uint16':
        result = buffer.readUInt16BE(0);
        break;
      case 'int32':
      case 'uint32':
        result = buffer.readUInt16BE(0);
        break;
      case 'float':
        result = buffer.readFloatBE(0);
        break;
      case 'double':
        result = buffer.readDoubleBE(0);
        break;
      case 'bool':
        result = buffer.readInt8(0);
        break;

      default: break;
    }
    return result;
  }

  // eslint-disable-next-line no-unused-vars
  this.readSync = function readSync(addr, size) {
    let result = null;
    if (varError || _.isEqual(parseInt(varReadError, 16), addr)) {
      varReadError = null;
      throw new Error(varError);
    }
    variables.some((data) => {
      const address = parseInt(data.address, 16);
      if (_.isEqual(address, addr)) {
        result = data;
        return true;
      }
      return undefined;
    });
    if (!result) {
      throw new Error('Address is invalid');
    }

    const buff = convertToBuffer(result);
    return buff;
  };

  // eslint-disable-next-line no-unused-vars
  this.writeSync = function writeSync(addr, size, buff) {
    if (writeError) {
      writeError = null;
      throw new Error('Write Error');
    }
    writeVariables.some((variable) => {
      let writeValue = null;
      if ((_.isEqual(parseInt(variable.address, 16), addr))) {
        writeValue = readValue(buff, variable.format);
        if (writeValue === variable.value) {
          return true;
        }
        return undefined;
      }
      return undefined;
    });
    return undefined;
  };
};

TestServerSiemensS5.prototype.setVariables = function setVariables(variable) {
  variables = variable;
};

TestServerSiemensS5.prototype.setWriteVariables = function setWriteVariables(variable) {
  writeVariables = variable;
};

TestServerSiemensS5.prototype.setVariableError = function setVariableError(error) {
  varError = error;
};

TestServerSiemensS5.prototype.setVarReadError = function setVarReadError(error) {
  varReadError = error;
};

TestServerSiemensS5.prototype.setWriteError = function setWriteError(error) {
  writeError = error;
};

TestServerSiemensS5.prototype.setConnectionError = function setConnectionError(error) {
  connError = error;
};

module.exports = TestServerSiemensS5;
