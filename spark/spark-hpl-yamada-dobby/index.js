/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const SerialPort = require('serialport');
const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplYamadaDobby = function hplYamadaDobby(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'device-open-error': {
      msg: 'Yamada Dobby: Device Open Error',
      description: x => `Error opening chosen serial device. Error: ${x.errorMsg}`,
    },
    'db-add-error': {
      msg: 'Yamada Dobby: Database Add Error',
      description: x => `Error adding to the database. Error: ${x.errorMsg}`,
    },
  });

  // Private variables
  const that = this;
  let sendingActive = false;
  let sendingReadRequest = true;
  let timer = null;
  let writeTimer = null;
  let serialPort = null;
  let requestIndex = 0;
  let variableReadArray = [];
  let variablesWriteObj = {};
  let resultsArray = [];
  let responseBufferString = '';
  let requestBlockedCounter = 0;
  let machineId = '';
  let usingChecksum = false;
  let usingCrLf = false;
  let variableRequests = [];
  let responseTerminator = '';
  let numBytesAfterResponseTerminator = 0;
  let previousAlarmCode = 0;
  let disconnectedTimer = null;
  let connectionReported = false;
  let disconnectionReported = false;

  const STX = '\u0002';
  const ETX = '\u0003';
  const LF = '\u000A';
  const CR = '\u000D';
  const VLINK_READ_CODE = '20';
  const VLINK_WRITE_CODE = '21';
  const VLINK_ACK_CODE = '00';

  const VLINK_NAK_CODES = {
    '02': 'Overrun/Framing error: An overrun or framing error is detected in the received data',
    '03': 'Parity error: A parity error is detected in the received data',
    '04': 'Sum check error: A sum error occurs with the received data',
    '06': 'Count error: The memory read/write count is 0.',
    '0F': 'ETX error: No ETX code is found',
    11: 'Character error: A character not used in the received data is found (other than 0 to F)',
    12: 'Command error: An invalid command is given',
    13: 'Memory setting error: The address or device number is invalid',
  };

  const WRITE_WAIT_TIMEOUT = 100;

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

  // for old machines: make sure that they operate as before - as big endian
  if (!_.has(that.machine.settings.model, 'highByteFirst')) {
    that.machine.settings.model.highByteFirst = true;
  }
  if (!_.has(that.machine.settings.model, 'highWordFirst')) {
    that.machine.settings.model.highWordFirst = true;
  }

  function disconnectionDetected() {
    // ingore disconectiong if already know disconnected
    if (disconnectedTimer || disconnectionReported) return;

    // start a timer to set any machine connected variables to false
    disconnectedTimer = setTimeout(() => {
      disconnectedTimer = null;
      connectionReported = false;
      disconnectionReported = true;
      async.forEachSeries(that.machine.variables, (variable, callback) => {
        // set only machine connected variables to false
        if (_.has(variable, 'machineConnected') && variable.machineConnected) {
          that.dataCb(that.machine, variable, false, (err, res) => {
            if (err) log.error(err);
            if (res) log.debug(res);
          });
        }

        callback();
      });
    }, _.has(that.machine.settings.model, 'disconnectReportTime') ? 1000 * that.machine.settings.model.disconnectReportTime : 0);
  }

  function connectionDetected() {
    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = false;
    }

    // if connection alreay reported, don't report it again
    if (connectionReported) return;
    connectionReported = true;
    disconnectionReported = false;

    async.forEachSeries(that.machine.variables, (variable, callback) => {
      // set only machine connected variables to true
      if (_.has(variable, 'machineConnected') && variable.machineConnected) {
        that.dataCb(that.machine, variable, true, (err, res) => {
          if (err) log.error(err);
          if (res) log.debug(res);
        });
      }

      callback();
    });
  }

  function requestTimer() {
    // only start a new request if previous set has finished (although allow for failed response by adding a counter )
    if ((sendingActive === false) || (requestBlockedCounter > 3)) {
      // reset storage and index for starting a new request set
      requestBlockedCounter = 0;
      requestIndex = 0;
      resultsArray = [];
      responseBufferString = '';

      // make a tcp request for first var in list (but only if request key exists)
      sendingReadRequest = true;
      sendingActive = true;
      serialPort.write(variableRequests[0]);

    // now wait for processResponseData method to be called by 'on data'
    } else {
      disconnectionDetected();
      updateConnectionStatus(false);
      requestBlockedCounter += 1;
    }
  }

  // helper function for v-link protocol mode to calculate the request checksum
  function calculateVLinkChecksum(requestString) {
    const requestBuffer = Buffer.from(requestString);

    let checksumTotal = 0;
    for (let i = 0; i < requestBuffer.length; i += 1) {
      checksumTotal += requestBuffer[i];
    }
    const checksumTotalHex = checksumTotal.toString(16).toUpperCase();
    const checksumTotalHexLastTwoBytes = checksumTotalHex.substr(checksumTotalHex.length - 2);

    return checksumTotalHexLastTwoBytes;
  }

  // helper function used to extract the response value from the ascii encoded vlink response
  function getValueFromVLinkResponse(variable) {
    let returnValue = null;

    // first test for NAK error codes
    const ackCode = responseBufferString.substr(3, 2);
    if (ackCode !== VLINK_ACK_CODE) {
      alert.raise({
        key: `res-error-${variable.name}`,
        msg: `Yamada Dobby: Invalid Response for Variable ${variable.name}`,
        description: `ACK error for variable '${variable.name}'. Error:${VLINK_NAK_CODES[ackCode]}`,
      });
      return returnValue;
    }

    // then check message is for us
    const v7Id = responseBufferString.substr(1, 2);
    if (v7Id !== machineId) {
      alert.raise({
        key: `res-error-${variable.name}`,
        msg: `Yamada Dobby: Invalid Response for Variable ${variable.name}`,
        description:
          `V-LINK Id of response (${v7Id}) does not match configured id(${machineId}) for variable ${variable.name}`,
      });
      return returnValue;
    }

    // extract the data portion of the response
    let lastIndex = usingChecksum ? responseBufferString.length - 3 : responseBufferString.length - 1;
    lastIndex = usingCrLf ? lastIndex - 2 : lastIndex;
    const dataBufferString = responseBufferString.substring(5, lastIndex);

    // place in a buffer so we can decode the ascii encoding
    const dataBuffer = Buffer.from(dataBufferString, 'hex');

    // now extract the data based on the variables format
    switch (variable.format) {
      case 'int8': {
        returnValue = that.machine.settings.model.highByteFirst ? dataBuffer.readInt16BE(0) : dataBuffer.readInt16LE(0);
        break;
      }
      case 'uint8': {
        returnValue = that.machine.settings.model.highByteFirst ? dataBuffer.readUInt16BE(0) : dataBuffer.readUInt16LE(0);
        break;
      }
      case 'bool': {
        // if bitRead not defined for this variable set to lsb
        const bitToRead = (Object.prototype.hasOwnProperty.call(variable, 'bitRead')) ? variable.bitRead : 0;
        const tmp16bitWord = that.machine.settings.model.highByteFirst
          ? dataBuffer.readUInt16BE(0) : dataBuffer.readUInt16LE(0);
        // create mask and mask the required bit, and if result more than zero then set to return value to true
        /* eslint no-bitwise: ["error", { "allow": ["<<", ">>", "&"] }] */
        returnValue = ((2 ** bitToRead) & tmp16bitWord) > 0;
        break;
      }
      case 'int16': {
        returnValue = that.machine.settings.model.highByteFirst ? dataBuffer.readInt16BE(0) : dataBuffer.readInt16LE(0);
        break;
      }
      case 'uint16': {
        returnValue = that.machine.settings.model.highByteFirst ? dataBuffer.readUInt16BE(0) : dataBuffer.readUInt16LE(0);
        break;
      }
      case 'int32': {
        if (that.machine.settings.model.highByteFirst) {
          if (that.machine.settings.model.highWordFirst) {
            returnValue = dataBuffer.readInt32BE(0);
          } else {
            returnValue = (dataBuffer.readInt16BE(2) << 16) + dataBuffer.readUInt16BE(0);
          }
        } else if (that.machine.settings.model.highWordFirst) {
          returnValue = (dataBuffer.readnt16LE(0) << 16) + dataBuffer.readUInt16LE(2);
        } else {
          returnValue = dataBuffer.readInt32LE(0);
        }
        break;
      }
      case 'uint32': {
        if (that.machine.settings.model.highByteFirst) {
          if (that.machine.settings.model.highWordFirst) {
            returnValue = dataBuffer.readUInt32BE(0);
          } else {
            returnValue = (dataBuffer.readUInt16BE(2) << 16) + dataBuffer.readUInt16BE(0);
          }
        } else if (that.machine.settings.model.highWordFirst) {
          returnValue = (dataBuffer.readUnt16LE(0) << 16) + dataBuffer.readUInt16LE(2);
        } else {
          returnValue = dataBuffer.readUInt32LE(0);
        }
        break;
      }
      case 'float': {
        if (that.machine.settings.model.highByteFirst) {
          if (that.machine.settings.model.highWordFirst) {
            returnValue = dataBuffer.readFloatBE(0);
          } else {
            const buffer = new ArrayBuffer(4);
            (new Uint16Array(buffer))[0] = dataBuffer.readUInt16BE(0);
            (new Uint16Array(buffer))[1] = dataBuffer.readUInt16BE(2);
            ([returnValue] = new Float32Array(buffer));
          }
        } else if (that.machine.settings.model.highWordFirst) {
          const buffer = new ArrayBuffer(4);
          (new Uint16Array(buffer))[0] = dataBuffer.readUInt16LE(2);
          (new Uint16Array(buffer))[1] = dataBuffer.readUInt16LE(0);
          ([returnValue] = new Float32Array(buffer));
        } else {
          returnValue = dataBuffer.readFloatLE(0);
        }
        break;
      }
      case 'double': {
        if (that.machine.settings.model.highByteFirst) {
          if (that.machine.settings.model.highWordFirst) {
            returnValue = dataBuffer.readDoubleBE(0);
          } else {
            const buffer = new ArrayBuffer(8);
            (new Uint16Array(buffer))[0] = dataBuffer.readUInt16BE(0);
            (new Uint16Array(buffer))[1] = dataBuffer.readUInt16BE(2);
            (new Uint16Array(buffer))[2] = dataBuffer.readUInt16BE(4);
            (new Uint16Array(buffer))[3] = dataBuffer.readUInt16BE(6);
            ([returnValue] = new Float64Array(buffer));
          }
        } else if (that.machine.settings.model.highWordFirst) {
          const buffer = new ArrayBuffer(8);
          (new Uint16Array(buffer))[0] = dataBuffer.readUInt16LE(6);
          (new Uint16Array(buffer))[1] = dataBuffer.readUInt16LE(4);
          (new Uint16Array(buffer))[2] = dataBuffer.readUInt16LE(2);
          (new Uint16Array(buffer))[3] = dataBuffer.readUInt16LE(0);
          ([returnValue] = new Float64Array(buffer));
        } else {
          returnValue = dataBuffer.readDoubleLE(0);
        }
        break;
      }
      case 'char': {
        // TODO may neeed to tidy ends of odd length strings (as data always sent in multiples of 16bit)
        returnValue = dataBuffer.swap16().toString(); // strings need byte swapping
        break;
      }
      case 'int64':
      case 'uint64': {
        alert.raise({
          key: `res-error-${variable.name}`,
          msg: `Yamada Dobby: Invalid Format for Variable ${variable.name}`,
          description: `No support for reading int64 or uint64. Edit variable  '${variable.name}' to set a valid Format.`,
        });
        break;
      }
      default: {
        alert.raise({
          key: `res-error-${variable.name}`,
          msg: `Yamada Dobby: Unrecognized Format for Variable ${variable.name}`,
          description: `Unrecognized Format. Edit variable  '${variable.name}' to set a valid Format.`,
        });
        break;
      }
    }
    return returnValue;
  }

  // helper function used to extract the alarm code from the multiple registers in the ascii encoded vlink response
  function getDecodedAlarmCodeFromVLinkResponse(variable) {
    let returnValue = null;

    // first test for NAK error codes
    const ackCode = responseBufferString.substr(3, 2);
    if (ackCode !== VLINK_ACK_CODE) {
      alert.raise({
        key: `res-error-${variable.name}`,
        msg: `Yamada Dobby: Invalid Response for Variable ${variable.name}`,
        description: `ACK error for variable '${variable.name}'. Error:${VLINK_NAK_CODES[ackCode]}`,
      });
      return returnValue;
    }

    // then check message is for us
    const v7Id = responseBufferString.substr(1, 2);
    if (v7Id !== machineId) {
      alert.raise({
        key: `res-error-${variable.name}`,
        msg: `Yamada Dobby: Invalid Response for Variable ${variable.name}`,
        description:
          `V-LINK Id of response (${v7Id}) does not match configured id(${machineId}) for variable ${variable.name}`,
      });
      return returnValue;
    }

    // extract the data portion of the response
    let lastIndex = usingChecksum ? responseBufferString.length - 3 : responseBufferString.length - 1;
    lastIndex = usingCrLf ? lastIndex - 2 : lastIndex;
    const dataBufferString = responseBufferString.substring(5, lastIndex);

    // convert the input string to a series of ascii hex digits
    const dataBuffer = Buffer.from(dataBufferString, 'hex');

    let bufferIndex = 0;
    let doneFlag = false;
    returnValue = 0;
    while ((bufferIndex <= (dataBuffer.length - 2)) && (doneFlag === false)) {
      // bring in the registers one 16-bit value at a time
      const registerValue = dataBuffer.readUInt16BE(bufferIndex);

      // and walk through looking for the first bit set
      let bitIndex = 0;
      while ((bitIndex < 16) && (doneFlag === false)) {
        if (registerValue & (0x01 << bitIndex)) {
          let alarmCode = (bufferIndex * 8) + bitIndex + 1;
          // account for the skip in the continguous alarm codes (alarm register 12 jumps to alamr 201)
          if (alarmCode > 176) {
            alarmCode += 24;
          }

          if (alarmCode === previousAlarmCode) {
            returnValue = previousAlarmCode;
            doneFlag = true;
          } else if (returnValue === 0) {
            // only take the first alarm code we find, if we're not using the previousAlarmCode.
            returnValue = alarmCode;
          }
        }
        bitIndex += 1;
      }
      bufferIndex += 2;
    }

    // succesfully decoded msg for this variable so clear any previously raised alerts
    alert.clear(`res-error-${variable.name}`);

    previousAlarmCode = returnValue;
    return returnValue;
  }

  function getVLinkWriteRequest(value) {
    // get the variable definition
    const variable = variablesWriteObj[value.variable];

    // build the invariant portion of the write request
    let writeRequest = STX + machineId + VLINK_WRITE_CODE;

    // add the number of words to write, request key, and the data to be written, formating it based on the type
    switch (variable.format) {
      case 'int8':
      case 'int16': {
        const dataBuffer = Buffer.allocUnsafe(2);
        if (that.machine.settings.model.highByteFirst) {
          dataBuffer.writeInt16BE(value[value.variable], 0);
        } else {
          dataBuffer.writeInt16LE(value[value.variable], 0);
        }
        writeRequest += `01${variable.requestKey}${dataBuffer.toString('hex')}`;
        break;
      }
      case 'uint8':
      case 'uint16': {
        const dataBuffer = Buffer.allocUnsafe(2);
        if (that.machine.settings.model.highByteFirst) {
          dataBuffer.writeUInt16BE(value[value.variable], 0);
        } else {
          dataBuffer.writeUInt16LE(value[value.variable], 0);
        }
        writeRequest += `01${variable.requestKey}${dataBuffer.toString('hex')}`;
        break;
      }
      case 'bool': {
        const dataBuffer = Buffer.allocUnsafe(2);
        if (that.machine.settings.model.highByteFirst) {
          dataBuffer.writeUInt16BE(value[value.variable] ? 1 : 0, 0);
        } else {
          dataBuffer.writeUInt16LE(value[value.variable] ? 1 : 0, 0);
        }
        writeRequest += `01${variable.requestKey}${dataBuffer.toString('hex')}`;
        break;
      }
      case 'int32': {
        const dataBuffer = Buffer.allocUnsafe(4);
        if (that.machine.settings.model.highByteFirst) {
          if (that.machine.settings.model.highWordFirst) {
            dataBuffer.writeInt32BE(value[value.variable], 0);
          } else {
            dataBuffer.writeUInt16BE(value[value.variable] & 0xFFFF, 0);
            dataBuffer.writeInt16BE(value[value.variable] >> 16, 2);
          }
        } else if (that.machine.settings.model.highWordFirst) {
          dataBuffer.writeInt16LE(value[value.variable] >> 16, 0);
          dataBuffer.writeUInt16LE(value[value.variable] & 0xFFFF, 2);
        } else {
          dataBuffer.writeInt32LE(value[value.variable], 0);
        }
        writeRequest += `02${variable.requestKey}${dataBuffer.toString('hex')}`;
        break;
      }
      case 'uint32': {
        const dataBuffer = Buffer.allocUnsafe(4);
        if (that.machine.settings.model.highByteFirst) {
          if (that.machine.settings.model.highWordFirst) {
            dataBuffer.writeUInt32BE(value[value.variable], 0);
          } else {
            dataBuffer.writeUInt16BE(value[value.variable] & 0xFFFF, 0);
            dataBuffer.writeUInt16BE(value[value.variable] >> 16, 2);
          }
        } else if (that.machine.settings.model.highWordFirst) {
          dataBuffer.writeUInt16LE(value[value.variable] >> 16, 0);
          dataBuffer.writeUInt16LE(value[value.variable] & 0xFFFF, 2);
        } else {
          dataBuffer.writeUInt32LE(value[value.variable], 0);
        }
        writeRequest += `02${variable.requestKey}${dataBuffer.toString('hex')}`;
        break;
      }
      case 'float': {
        const dataBuffer = Buffer.allocUnsafe(4);
        if (that.machine.settings.model.highByteFirst) {
          if (that.machine.settings.model.highWordFirst) {
            dataBuffer.writeFloatBE(value[value.variable], 0);
          } else {
            const buffer = new ArrayBuffer(4);
            (new Float32Array(buffer))[0] = value[value.variable];
            dataBuffer.writeUInt16BE((new Uint16Array(buffer))[0], 0);
            dataBuffer.writeUInt16BE((new Uint16Array(buffer))[1], 2);
          }
        } else if (that.machine.settings.model.highWordFirst) {
          const buffer = new ArrayBuffer(4);
          (new Float32Array(buffer))[0] = value[value.variable];
          dataBuffer.writeUInt16LE((new Uint16Array(buffer))[1], 0);
          dataBuffer.writeUInt16LE((new Uint16Array(buffer))[0], 2);
        } else {
          dataBuffer.writeFloatBE(value[value.variable], 0);
        }
        writeRequest += `02${variable.requestKey}${dataBuffer.toString('hex')}`;
        break;
      }
      case 'double': {
        const dataBuffer = Buffer.allocUnsafe(8);
        if (that.machine.settings.model.highByteFirst) {
          if (that.machine.settings.model.highWordFirst) {
            dataBuffer.writeDoubleBE(value[value.variable], 0);
          } else {
            const buffer = new ArrayBuffer(8);
            (new Float64Array(buffer))[0] = value[value.variable];
            dataBuffer.writeUInt16BE((new Uint16Array(buffer))[0], 0);
            dataBuffer.writeUInt16BE((new Uint16Array(buffer))[1], 2);
            dataBuffer.writeUInt16BE((new Uint16Array(buffer))[2], 4);
            dataBuffer.writeUInt16BE((new Uint16Array(buffer))[3], 6);
          }
        } else if (that.machine.settings.model.highWordFirst) {
          const buffer = new ArrayBuffer(8);
          (new Float64Array(buffer))[0] = value[value.variable];
          dataBuffer.writeUInt16LE((new Uint16Array(buffer))[3], 0);
          dataBuffer.writeUInt16LE((new Uint16Array(buffer))[2], 2);
          dataBuffer.writeUInt16LE((new Uint16Array(buffer))[1], 4);
          dataBuffer.writeUInt16LE((new Uint16Array(buffer))[0], 6);
        } else {
          dataBuffer.writeDoubleBE(value[value.variable], 0);
        }
        writeRequest += `04${variable.requestKey}${dataBuffer.toString('hex')}`;
        break;
      }
      case 'char': {
        // strings always written with even number of bytes
        let writeString = value[value.variable];
        if ((writeString.length % 2) !== 0) writeString += ' ';

        // divide by two to get number of words required
        let wordLength = Math.ceil(writeString.length / 2);
        // bounds check word length
        wordLength = wordLength > 255 ? 255 : wordLength;
        wordLength = wordLength <= 0 ? 1 : wordLength;
        // convert integer word length to a hex string and pad with leading '0' if necessary
        let dataLengthString = wordLength.toString(16).toUpperCase();
        if (dataLengthString.length === 1) dataLengthString = `0${dataLengthString}`;

        // byte swap the string, as required
        writeRequest += dataLengthString + Buffer.from(writeString).swap16().toString();
        break;
      }
      default: {
        return '';
      }
    }

    // complete the write request
    writeRequest += ETX;

    // add on a calculated checksum if required
    if (usingChecksum) writeRequest += calculateVLinkChecksum(writeRequest);

    // add crlf if required
    if (usingCrLf) writeRequest += CR + LF;

    return writeRequest;
  }

  // helper function to save array of collected results to the database
  function saveResultsToDb() {
    // process the array of results
    async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
      // if there wasn't a result
      if (dataItem === null) {
        // just move onto next item, alert/error has already been flagged for this
        return callback();
      }
      // othewise update the database
      return that.dataCb(that.machine, variableReadArray[index], dataItem, (err, res) => {
        if (err) {
          alert.raise({ key: 'db-add-error', errorMsg: err.message });
        } else {
          alert.clear('db-add-error');
        }
        if (res) log.debug(res);
        // move onto next item once stored in db
        return callback();
      });
    });
  }

  function processResponseData(data) {
    // will be triggered for each response to a request, assumes response is for last sent request

    // only attempt processing if we are expecting it
    if (sendingActive === true) {
      // append current buffer with new data (don't trim in case of non-printable escape characters are used)
      responseBufferString += data.toString();

      // find out where response terminator should be
      const terminatorPosition = (responseBufferString.length - 1) - numBytesAfterResponseTerminator;

      // if character in the terminator position is the response terminator, we have all the data
      if ((terminatorPosition > 0) && (responseBufferString[terminatorPosition] === responseTerminator)) {
        connectionDetected();
        updateConnectionStatus(true);

        // if response to read request
        if (sendingReadRequest) {
          // extract the value from the response, based on the V-LINK response
          let valueToStore;

          // depending on whether it is an alarm response, or a normal one
          if ((Object.prototype.hasOwnProperty.call(variableReadArray[requestIndex], 'alarmVariable')) && (variableReadArray[requestIndex].alarmVariable === true)) {
            valueToStore = getDecodedAlarmCodeFromVLinkResponse(variableReadArray[requestIndex]);
          } else {
            valueToStore = getValueFromVLinkResponse(variableReadArray[requestIndex]);
          }

          // store the variable in the results array
          resultsArray.push(valueToStore);

          // clear the buffer now it has been used
          responseBufferString = '';

          // send request for next var (if any left, else process whole array result)
          requestIndex += 1;
          if (requestIndex !== variableReadArray.length) {
            serialPort.write(variableRequests[requestIndex]);
          } else {
            sendingActive = false;
            // save all results to the database
            saveResultsToDb();
          }
        } else { // if response to write request
          sendingActive = false;
        }
      } else {
        // else just wait for more data from another 'on data'
      }
    }
  }

  // helper function for v-link protocol mode to convert the format into number of words to read
  function calculateVLinkWordsToReadField(format, length) {
    let dataLengthString;

    switch (format) {
      default:
      case 'int8':
      case 'int16':
      case 'uint8':
      case 'uint16':
      case 'bool': {
        dataLengthString = '01';
        break;
      }
      case 'int32':
      case 'uint32':
      case 'float': {
        dataLengthString = '02';
        break;
      }
      case 'int64':
      case 'uint64':
      case 'double': {
        dataLengthString = '04';
        break;
      }
      case 'char': {
        // divide by two to get number of words required
        let wordLength = Math.ceil(length / 2);
        // bounds check word length
        wordLength = wordLength > 255 ? 255 : wordLength;
        wordLength = wordLength <= 0 ? 1 : wordLength;
        // convert integer word length to a hex string and pad with leading '0' if necessary
        dataLengthString = wordLength.toString(16).toUpperCase();
        dataLengthString = dataLengthString.length === 1 ? `0${dataLengthString}` : dataLengthString;
        break;
      }
    }
    return dataLengthString;
  }

  function open(callback) {
    const requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    const { device, parity } = that.machine.settings.model;
    const baudRate = parseInt(that.machine.settings.model.baudRate, 10);
    connectionReported = false;
    disconnectionReported = false;

    // from the variable array, form a new array of 'read' specific variables
    // i.e. filter out alarm code variables (and possibly 'write' only variables in the future)
    variableReadArray = [];
    that.machine.variables.forEach((variable) => {
      if (!_.has(variable, 'machineConnected') || !variable.machineConnected) {
        // if read or write not set, assume read
        if (!(variable.access === 'write' || variable.access === 'read')) {
          variable.access = 'read'; // eslint-disable-line no-param-reassign
          variableReadArray.push(variable);
        } else if (variable.access === 'read') {
          variableReadArray.push(variable);
        }
      }
    });
    // convert the variables array to an object for easy searching when writing variables and filter it down to just
    // 'write' variables - also exclude arrays, machine connected variables, and variables without request keys
    variablesWriteObj = _.keyBy(_.filter(that.machine.variables,
      variable => ((variable.access === 'write') && _.has(variable, 'requestKey')
       && (!_.has(variable, 'array') || !variable.array)
       && (!_.has(variable, 'machineConnected') || !variable.machineConnected))), 'name');

    // configure V-LINK specific request payload information

    // create a 2 byte hex string from the v7 port number 1-31 (01 to 1F)
    machineId = that.machine.settings.model.v7port.toString(16).toUpperCase();
    machineId = machineId.length === 1 ? `0${machineId}` : machineId;

    // set some comnfiguration flags required for both request creation and repsonse parsing
    ({ usingChecksum, usingCrLf } = that.machine.settings.model);

    variableRequests = [];
    variableReadArray.forEach((variable) => {
      let numWords;
      let requestKey;
      // if this is the alarm variable
      if ((Object.prototype.hasOwnProperty.call(variable, 'alarmVariable')) && (variable.alarmVariable === true)) {
        // new combined alarm variable requires 13 registers to calculate. at a specific address
        numWords = '0D';
        requestKey = '010208000000000000';
      } else {
        // do a check that this variable has a request key
        if (!Object.prototype.hasOwnProperty.call(variable, 'requestKey')) {
          alert.raise({
            key: `var-error-${variable.name}`,
            msg: 'Yamada Dobby: Invalid Variable Definition',
            description: `Variable '${variable.name}' does not have required property 'Request Key' set.`,
          });
          return;
        }
        // clear possibly previously set alert
        alert.clear(`var-error-${variable.name}`);

        // calculate words to read as a hex string 1-255 (01 to FF)
        numWords = calculateVLinkWordsToReadField(variable.format, variable.length);
        ({ requestKey } = variable);
      }

      // start forming the request string
      let variableRequest = STX + machineId + VLINK_READ_CODE + numWords + requestKey + ETX;
      // add on a calculated checksum if required
      variableRequest = usingChecksum ? variableRequest + calculateVLinkChecksum(variableRequest) : variableRequest;
      // add crlf if required
      variableRequest = usingCrLf ? variableRequest + CR + LF : variableRequest;

      variableRequests.push(variableRequest);
    });

    responseTerminator = ETX;
    numBytesAfterResponseTerminator = usingChecksum ? 2 : 0;
    numBytesAfterResponseTerminator = usingCrLf ? numBytesAfterResponseTerminator + 2 : numBytesAfterResponseTerminator;

    // create a serial port with the correct configuration
    serialPort = new SerialPort(device, {
      baudRate,
      parity,
      autoOpen: false,
    });

    // attempt to open the serial port
    return serialPort.open((err) => {
      if (err) {
        alert.raise({ key: 'device-open-error', errorMsg: err });
        return callback(err);
      }

      // read data that is available but keep the stream from entering "flowing mode"
      serialPort.on('readable', () => {
        const data = serialPort.read();
        processResponseData(data);
      });

      // subscribe to on 'close' events
      serialPort.on('close', () => {
        log.debug('Serial port closed');

        // stop the request timer task if applicable (i.e. if not closed by our request)
        if (timer) {
          clearInterval(timer);
          timer = null;
          sendingActive = false;
        }
      });

      // set up a repeat task to trigger the requests
      timer = setInterval(requestTimer, requestFrequencyMs);

      // trigger callback on succesful open
      return callback(null);
    });
  }

  function close(callback) {
    // if we are currently in a request/response cycle (for req/res type)
    if ((sendingActive === true)) {
      // hold off on closing using an interval timer
      let waitCounter = 0;
      const activeWait = setInterval(() => {
        // until safe to do so
        if ((sendingActive === false) || (waitCounter > 20)) {
          sendingActive = false;
          clearInterval(activeWait);
          serialPort.close(callback);
        }
        waitCounter += 1;
      }, 100); // interval set at 100 milliseconds
    } else {
      // otherwise close immeditalely
      serialPort.close(callback);
    }
  }

  function sendWriteRequest(value) {
    if (sendingActive) {
      writeTimer = setTimeout(sendWriteRequest, WRITE_WAIT_TIMEOUT, value);
    } else {
      writeTimer = null;

      // send the write request
      const writeRequest = getVLinkWriteRequest(value);
      if (writeRequest.length > 0) {
        alert.clear(`var-write-type-error-${value.variable}`);

        sendingReadRequest = false;
        sendingActive = true;

        serialPort.write(writeRequest);
      } else {
        alert.raise({
          key: `var-write-type-error-${value.variable}`,
          msg: `${machine.info.name}: Unsupported Type Error Writing Variable`,
          description: `Error writing ${value.variable}. Variable type is not supported for writing`,
        });
      }
    }
  }

  this.writeData = function writeData(value, done) {
    // get the variable name and make sure it exists and is writable
    const variableName = value.variable;
    if (!Object.prototype.hasOwnProperty.call(variablesWriteObj, variableName)) {
      // create 'write' specific variable alert
      alert.raise({
        key: `var-write-error-${variableName}`,
        msg: `${machine.info.name}: Error Writing Variable`,
        description: `Error in writing ${variableName}. Variable does not exist or is not writable`,
      });
      done();
      return;
    }
    // clear variable write alert
    alert.clear(`var-write-error-${variableName}`);

    // send the write rquest, retrying if currently sending a requestTimer
    sendWriteRequest(value);
    done();
  };

  // Privileged methods
  this.start = function start(dataCb, configUpdateCb, done) {
    if (typeof dataCb !== 'function') {
      return done('dataCb not a function');
    }
    that.dataCb = dataCb;

    if (typeof configUpdateCb !== 'function') {
      return done('configUpdateCb not a function');
    }
    that.configUpdateCb = configUpdateCb;

    // check if the machine is enabled
    if (!that.machine.settings.model.enable) {
      log.debug(`${that.machine.info.name} Disabled`);
      return done(null);
    }

    return open((err) => {
      if (err) {
        return done(err);
      }

      log.info('Started');
      return done(null);
    });
  };

  this.stop = function stop(done) {
    updateConnectionStatus(false);

    // clear existing alerts
    alert.clearAll(() => {
      // stop the request timer task (if being used)
      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      // if any pending disconnection detection, stop its timer
      if (disconnectedTimer) {
        clearTimeout(disconnectedTimer);
        disconnectedTimer = null;
      }

      // if any pending write, stop its timer
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
      }

      // close serial port if open
      if (serialPort) {
        if (serialPort.isOpen) {
          return close((err) => {
            if (err) {
              log.error(err);
            }
            serialPort = null;
            log.info('Stopped');
            return done(null);
          });
        }
      }
      log.info('Stopped');
      return done(null);
    });
  };

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop(() => {
      that.start(that.dataCb, that.configUpdateCb, err => done(err));
    });
  };

  this.updateModel = function updateModel(newModel, done) {
    log.debug('Updating');
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

module.exports = {
  hpl: hplYamadaDobby,
  defaults,
  schema,
};
