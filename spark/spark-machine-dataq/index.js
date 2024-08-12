/* jshint esversion: 6 */
/* eslint no-bitwise: ["error", { "allow": ["&", "|", "^", "~", "<<", ">>", ">>>", "|=", "&="] }] */
const { EventEmitter } = require('events');
const async = require('async');
const _ = require('lodash');
const camelCase = require('camelcase');
let SerialPort = require('serialport');
const pkg = require('./package.json');
const config = require('./config.json');

if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line global-require
  SerialPort = require('virtual-serialport');
}

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};
config.info = info;

const dataq = new EventEmitter();
dataq.serialPort = null;

// conversion object to generate hex value from range (in Hz) string
const rangeConvertDi149 = {
  10000: 0x0100,
  5000: 0x0200,
  2000: 0x0300,
  1000: 0x0400,
  500: 0x0500,
  200: 0x0600,
  100: 0x0700,
  50: 0x0800,
  20: 0x0900,
  10: 0x0A00,
  5: 0x0B00,
};
const rangeConvertDi1110 = {
  50000: 0x0100,
  20000: 0x0200,
  10000: 0x0300,
  5000: 0x0400,
  2000: 0x0500,
  1000: 0x0600,
  500: 0x0700,
  200: 0x0800,
  100: 0x0900,
  50: 0x0A00,
  20: 0x0B00,
  10: 0x0C00,
};


const DIGITAL_INPUTS = 8;
const DIGITAL_RATE = 9;
const DIGITAL_COUNT = 10;

const varForAnaInCh1 = {
  name: 'analogInCh1', description: 'Analog In CH1', format: 'float', access: 'read', chId: 'a1',
};
const varForAnaInCh2 = {
  name: 'analogInCh2', description: 'Analog In CH2', format: 'float', access: 'read', chId: 'a2',
};
const varForAnaInCh3 = {
  name: 'analogInCh3', description: 'Analog In CH3', format: 'float', access: 'read', chId: 'a3',
};
const varForAnaInCh4 = {
  name: 'analogInCh4', description: 'Analog In CH4', format: 'float', access: 'read', chId: 'a4',
};
const varForAnaInCh5 = {
  name: 'analogInCh5', description: 'Analog In CH5', format: 'float', access: 'read', chId: 'a5',
};
const varForAnaInCh6 = {
  name: 'analogInCh6', description: 'Analog In CH6', format: 'float', access: 'read', chId: 'a6',
};
const varForAnaInCh7 = {
  name: 'analogInCh7', description: 'Analog In CH7', format: 'float', access: 'read', chId: 'a7',
};
const varForAnaInCh8 = {
  name: 'analogInCh8', description: 'Analog In CH8', format: 'float', access: 'read', chId: 'a8',
};
const varFordigiInCh0 = {
  name: 'digiInCh0', description: 'Digital In CH0', format: 'bool', access: 'read', chId: 'd0',
};
const varFordigiInCh1 = {
  name: 'digiInCh1', description: 'Digital In CH1', format: 'bool', access: 'read', chId: 'd1',
};
const varFordigiInCh2 = {
  name: 'digiInCh2', description: 'Digital In CH2', format: 'bool', access: 'read', chId: 'd2',
};
const varFordigiInCh3 = {
  name: 'digiInCh3', description: 'Digital In CH3', format: 'bool', access: 'read', chId: 'd3',
};
// extra channels for DI-1110
const varFordigiInCh4 = {
  name: 'digiInCh4', description: 'Digital In CH4', format: 'bool', access: 'read', chId: 'd4',
};
const varFordigiInCh5 = {
  name: 'digiInCh5', description: 'Digital In CH5', format: 'bool', access: 'read', chId: 'd5',
};
const varFordigiInCh6 = {
  name: 'digiInCh6', description: 'Digital In CH6', format: 'bool', access: 'read', chId: 'd6',
};
// extra channels for DI-149
const varFordigiOutCh0 = {
  name: 'digiOutCh0',
  description: 'Digital Out CH0',
  format: 'bool',
  access: 'write',
  enableReadWrite: true,
  chId: 'd0',
};
const varFordigiOutCh1 = {
  name: 'digiOutCh1',
  description: 'Digital Out CH1',
  format: 'bool',
  access: 'write',
  enableReadWrite: true,
  chId: 'd1',
};
const varFordigiOutCh2 = {
  name: 'digiOutCh2',
  description: 'Digital Out CH2',
  format: 'bool',
  access: 'write',
  enableReadWrite: true,
  chId: 'd2',
};
const varFordigiOutCh3 = {
  name: 'digiOutCh3',
  description: 'Digital Out CH3',
  format: 'bool',
  access: 'write',
  enableReadWrite: true,
  chId: 'd3',
};

// common commands
const CMD_SLIST = 'slist';
const CMD_SRATE = 'srate';
const CMD_STOP = 'stop';
const CMD_OUTPUT = 'dout';
const CMD_OUTPUT_NO_ECHO = 'D';
const CMD_TERMINATOR = '\r';
const CMD_SPACE = ' ';
// DI-149 only commands
const CMD_BIN_MODE = 'bin';
const CMD_ASCII_MODE = 'asc';
const CMD_RESET_COUNT_DI_149 = 'R1';
const CMD_START_DI_149 = 'start';
// DI-1110 only commands
const CMD_RESET_COUNT_DI_1110 = 'reset 1';
const CMD_PS_SIZE_16 = 'ps 0';
const CMD_START_DI_1110 = 'start 0';
const CMD_ENF = 'enf DATAQ';
const CMD_DECIMATE = 'dec';
const CMD_FILTER = 'filter';

const SRATE_20_HZ_DI_149 = 37500;
const SRATE_10000_HZ_DI_1110 = 6000;
const DECIMATE_20_HZ_DI_1110 = 500;
const ALL_CHANNELS = '*';
const CIC_FILTER = '1';

const MAX_BUFFER_SIZE = 2048 * 3;
const MAX_PAYLOAD_SIZE = 22;

// payload extraction constants

// analog common
const ANALOG_12_BIT_MASK = 0x0FFF;
const SHIFT_12_BIT_TO_32_BIT = 20;
// analog DI-149 specific
const ANALOG_LOW_BYTE_SHIFT_DI_149 = 3;
const ANALOG_HIGH_BYTE_SHIFT_DI_149 = 1;
const ANALOG_LOW_BYTE_MASK_DI_149 = 0x1F;
const ANALOG_COMBINE_BYTE_SHIFT_DI_149 = 5;
// analog DI-1110 specific
const ANALOG_LOW_BYTE_SHIFT_DI_1110 = 4;
const ANALOG_LOW_BYTE_MASK_DI_1110 = 0x0F;
const ANALOG_COMBINE_BYTE_SHIFT_DI_1110 = 4;
// digital DI-149 specific
const D0_BIT_LOCATION_DI_149 = 7;
const D1_BIT_LOCATION_DI_149 = 1;
const D2_BIT_LOCATION_DI_149 = 2;
const D3_BIT_LOCATION_DI_149 = 3;
// digital DI-1110 specific
const D0_BIT_LOCATION_DI_1110 = 0;
const D1_BIT_LOCATION_DI_1110 = 1;
const D2_BIT_LOCATION_DI_1110 = 2;
const D3_BIT_LOCATION_DI_1110 = 3;
const D4_BIT_LOCATION_DI_1110 = 4;
const D5_BIT_LOCATION_DI_1110 = 5;
const D6_BIT_LOCATION_DI_1110 = 6;
// digital common
const DIGI_PROCESED_BYTE_SHIFT = 1;
const DIGI_LOW_BYTE_MASK = 0x7F;
const DIGI_14_BIT_MASK = 0x3FFF;
const DIGI_PROCESED_COMBINE_BYTE_SHIFT = 7;

const DI_1110_COUNTER_OFFSET = 32768;

const ROUNDING_DPS = 3;
const ROUNDING_CONST = 10 ** ROUNDING_DPS;

const CONNECTED_CHECK_INTERVAL = 5000;

let analogInCount = 0;
let digitalSlistOffset = -1;
let rateSlistOffset = -1;
let counterSlistOffset = -1;
let slistOffsetCurrent = 0;
let fullPayloadSize = 0;
let allOutputsOff = 0;
let outputState = 0;
let cmdSetDigitalInOrOut = 'endo 0';

let log;
let db = null;
let conf;
let alert = null;
let firstStart = true;
let modelNum;
let onStartCallback = null;
let onStopCallback = null;
let activeReceiving = false;
let disableReceiving = false;
let currentDataLength = 0;
let writeReqListenerAdded = false;

const rawConcatBuffer = Buffer.allocUnsafe(MAX_BUFFER_SIZE);
const processBuffer = Buffer.allocUnsafe(MAX_PAYLOAD_SIZE);

let lastValue = [];

let downSampleCounter;
let downSampleSkipCount;
let debouncingResetSignal;

let connectedTimer = null;

function updateConnectionStatus(connected) {
  conf.set(`machines:${pkg.name}:settings:model:connectionStatus`, connected, () => {});
}

function generateSlistElementDi149(channel, range) {
  let hexRange = 0;

  if (channel === 9) {
    hexRange = rangeConvertDi149[range || '10000'];
  }

  hexRange += channel;
  let hexRangeAsString = (`0000${hexRange.toString(16)}`).substr(-4);
  hexRangeAsString = `x${hexRangeAsString}`;

  return hexRangeAsString;
}

function stopAlerts(callback) {
  // clear existing alerts for spark-machine-wasabi
  alert.clearAll(() => {
    callback(null);
  });
}

function validPayload() {
  let i;

  if (modelNum === 'DI-149') {
    // for the DI-149 the lsb of first byte should be zero
    if ((rawConcatBuffer.readUInt8(0) & 0x01) !== 0) {
      return false;
    }

    // and the lsbs of each of the subsequent bytes should be one
    for (i = 1; i < fullPayloadSize; i += 1) {
      if ((rawConcatBuffer.readUInt8(i) & 0x01) === 0) {
        return false;
      }
    }

    // if above tests passed then must be a valid DI-149 data payload
    return true;
  }
  // for the DI-1110 low half of the low nibble of analog input channels should all be zero
  for (i = 0; i < analogInCount; i += 1) {
    if ((rawConcatBuffer.readUInt8(2 * i) & 0x03) !== 0) {
      return false;
    }
  }
  // if above test passed then must be a valid DI-1110 data payload
  return true;
}


function extractAnalogValue(buffer, byteOffset) {
  let lowByte; let highByte; let
    combined;

  if (modelNum === 'DI-149') {
    // extract the 12 bit analog value from the two bytes
    // |  4 |  3 |  2 |  1 |  0 |  X |  X |  X |
    // | 11 | 10 |  9 |  8 |  7 |  6 |  5 |  X |
    lowByte = buffer.readUInt8(byteOffset) >>> ANALOG_LOW_BYTE_SHIFT_DI_149;
    highByte = buffer.readUInt8(byteOffset + 1) >>> ANALOG_HIGH_BYTE_SHIFT_DI_149;
    combined = ((highByte << ANALOG_COMBINE_BYTE_SHIFT_DI_149)
     | (lowByte & ANALOG_LOW_BYTE_MASK_DI_149)) & ANALOG_12_BIT_MASK;

    // now turn into 2s compliment signed value (use sign propagating right shift)
    return ((combined << SHIFT_12_BIT_TO_32_BIT) ^ 0x80000000) >> SHIFT_12_BIT_TO_32_BIT;
  }
  // extract the 12 bit analog value from the two bytes
  // |  3 |  2 |  1 |  0 |  X |  X |  X |  X |
  // | 11 | 10 |  9 |  8 |  7 |  6 |  5 |  4 |
  lowByte = buffer.readUInt8(byteOffset) >>> ANALOG_LOW_BYTE_SHIFT_DI_1110;
  highByte = buffer.readUInt8(byteOffset + 1);
  combined = ((highByte << ANALOG_COMBINE_BYTE_SHIFT_DI_1110)
   | (lowByte & ANALOG_LOW_BYTE_MASK_DI_1110)) & ANALOG_12_BIT_MASK;

  // already 2s compliment signed value on DI-1110 just need to extend the sign
  // (use sign propagating right shift)
  return (combined << SHIFT_12_BIT_TO_32_BIT) >> SHIFT_12_BIT_TO_32_BIT;
}

function extractDigitalValue(buffer, byteOffset, bitLocation) {
  // extract and mask raw bit
  const rawValue = buffer.readUInt8(byteOffset) & (1 << bitLocation);
  // convert to a bool, zero is true, non zero false
  return (rawValue === 0);
}

function extractDigitalProcessedValue(buffer, byteOffset) {
  if (modelNum === 'DI-149') {
    // extract the 14 bit analog value from the two bytes
    // |  6 |  5 |  4 |  3 |  2 |  1 |  0 |  X |
    // | 13 | 12 | 11 | 10 |  9 |  8 |  7 |  X |
    const lowByte = buffer.readUInt8(byteOffset) >>> DIGI_PROCESED_BYTE_SHIFT;
    const highByte = buffer.readUInt8(byteOffset + 1) >>> DIGI_PROCESED_BYTE_SHIFT;
    return ((highByte << DIGI_PROCESED_COMBINE_BYTE_SHIFT)
     | (lowByte & DIGI_LOW_BYTE_MASK)) & DIGI_14_BIT_MASK;
  }
  // extract the 16 bit analog value from the two bytes
  // |  7 |  6 |  5 |  4 |  3 |  2 |  1 |  0 |
  // | 15 | 14 | 13 | 12 | 11 | 10 |  9 |  8 |
  return buffer.readInt16LE(byteOffset);
}

function dbAddResult(err, res) {
  if (err) {
    alert.raise({ key: 'db-add-error', errorMsg: err.message });
  } else {
    alert.clear('db-add-error');
  }
  if (res) log.debug(res);
}

function processPayload(payloadBuffer) {
  // ignore payload based on our sample rate (TODO could average data rather than just ignore)
  downSampleCounter += 1;
  if (downSampleCounter >= downSampleSkipCount) {
    downSampleCounter = 0;

    const { variables } = config;

    // loop through the stored variable list
    let payloadBufferOffset = 0;
    for (let i = 0; i < variables.length; i += 1) {
      const variable = variables[i];
      if (_.get(variable, 'access', 'read') === 'read') {
        let value;
        let rawValue;
        let digitalIn = false;

        switch (variable.chId) {
          case 'a1':
          case 'a2':
          case 'a3':
          case 'a4':
          case 'a5':
          case 'a6':
          case 'a7':
          case 'a8': {
            // get 12 bit data for this channel
            value = extractAnalogValue(payloadBuffer, payloadBufferOffset);
            payloadBufferOffset += 2;
            break;
          }
          case 'd0': {
            digitalIn = true;
            // get boolean value for this channel
            if (modelNum === 'DI-149') {
              value = extractDigitalValue(payloadBuffer, 2 * digitalSlistOffset,
                D0_BIT_LOCATION_DI_149);
            } else {
              value = extractDigitalValue(payloadBuffer, (2 * digitalSlistOffset) + 1,
                D0_BIT_LOCATION_DI_1110);
            }

            // additionaly if we are using this to reset the counter
            if (config.settings.model.digiInCh0Mode === 'Counter Reset') {
              // reset the counter, making sure we debounce the input
              if (value > 0) {
                if (debouncingResetSignal === false) {
                  debouncingResetSignal = true;
                  // send reset command (no ack to this command)
                  if (modelNum === 'DI-149') {
                    dataq.serialPort.write(CMD_RESET_COUNT_DI_149 + CMD_TERMINATOR);
                  } else {
                    dataq.serialPort.write(CMD_RESET_COUNT_DI_1110 + CMD_TERMINATOR);
                  }
                }
              } else {
                debouncingResetSignal = false;
              }
            }
            break;
          }
          case 'd1': {
            digitalIn = true;
            // get boolean value for this channel
            if (modelNum === 'DI-149') {
              value = extractDigitalValue(payloadBuffer, (2 * digitalSlistOffset) + 1,
                D1_BIT_LOCATION_DI_149);
            } else {
              value = extractDigitalValue(payloadBuffer, (2 * digitalSlistOffset) + 1,
                D1_BIT_LOCATION_DI_1110);
            }
            break;
          }
          case 'd2': {
            digitalIn = true;
            if (config.settings.model.digiInCh2Mode === 'Normal') {
              // get boolean value for this channel
              if (modelNum === 'DI-149') {
                value = extractDigitalValue(payloadBuffer, (2 * digitalSlistOffset) + 1,
                  D2_BIT_LOCATION_DI_149);
              } else {
                value = extractDigitalValue(payloadBuffer, (2 * digitalSlistOffset) + 1,
                  D2_BIT_LOCATION_DI_1110);
              }
            } else {
              // Rate mode, get 14 or 16 bit raw data
              rawValue = extractDigitalProcessedValue(payloadBuffer, 2 * rateSlistOffset);

              if (modelNum === 'DI-149') {
                // now convert to Hz
                value = parseInt(config.settings.model.digiInCh2RateRangeDi149, 10)
                 * rawValue / 16384;
              } else {
                // on the DI-1110 -32768 means zero, so remove the offset
                rawValue += DI_1110_COUNTER_OFFSET;
                // now convert to Hz
                value = parseInt(config.settings.model.digiInCh2RateRangeDi1110, 10)
                 * rawValue / 65536;
              }
              // and round to n dps
              value = Math.round(value * ROUNDING_CONST) / ROUNDING_CONST;
            }
            break;
          }
          case 'd3': {
            digitalIn = true;
            if (config.settings.model.digiInCh3Mode === 'Normal') {
              // get boolean value for this channel
              if (modelNum === 'DI-149') {
                value = extractDigitalValue(payloadBuffer, (2 * digitalSlistOffset) + 1,
                  D3_BIT_LOCATION_DI_149);
              } else {
                value = extractDigitalValue(payloadBuffer, (2 * digitalSlistOffset) + 1,
                  D3_BIT_LOCATION_DI_1110);
              }
            } else {
              // Counter mode, get 14 or 16 bit data
              value = extractDigitalProcessedValue(payloadBuffer, 2 * counterSlistOffset);
              if (modelNum === 'DI-1110') {
                // on the DI-1110 -32768 means zero, so remove the offset
                value += DI_1110_COUNTER_OFFSET;
              }
            }
            break;
          }
          case 'd4': {
            digitalIn = true;
            // get boolean value for this channel
            value = extractDigitalValue(payloadBuffer, (2 * digitalSlistOffset) + 1,
              D4_BIT_LOCATION_DI_1110);
            break;
          }
          case 'd5': {
            digitalIn = true;
            // get boolean value for this channel
            value = extractDigitalValue(payloadBuffer, (2 * digitalSlistOffset) + 1,
              D5_BIT_LOCATION_DI_1110);
            break;
          }
          case 'd6': {
            digitalIn = true;
            // get boolean value for this channel
            value = extractDigitalValue(payloadBuffer, (2 * digitalSlistOffset) + 1,
              D6_BIT_LOCATION_DI_1110);
            break;
          }
          default:
        }

        // by default we are going to publish this variable into the database
        let publishData = true;
        // however if 'on change' setting is enabled and we are dealing with a digital input, then
        if (config.settings.model.onChange === true && digitalIn === true) {
          // don't publish if the last value is the same as the current value
          if (_.has(lastValue, variable.name)) {
            if (value === lastValue[variable.name]) {
              publishData = false;
            }
          }
          // update the last value for this digital input
          lastValue[variable.name] = value;
        }

        // only publish data into database if required
        if (publishData === true) {
          const data = {
            machine: config.info.name,
            variable: variable.name,
          };

          data[variable.name] = value;
          db.add(data, dbAddResult);
        }
      }
    }
  }
}

function processData() {
  if (activeReceiving === false) {
    // if in 'stopped' mode we should just be seeing the responses to our configuration
    // requests (all terminated with a carriage return)

    // check the buffer to see if it has a carriage return indicating a response message
    if (rawConcatBuffer.lastIndexOf(CMD_TERMINATOR, currentDataLength - 1) !== -1) {
      // if DI-149 do its initialization sequence
      if (modelNum === 'DI-149') {
        // does message contain response to sending the packet size command or an slist command
        if ((rawConcatBuffer.lastIndexOf(CMD_ASCII_MODE + CMD_TERMINATOR,
          currentDataLength - 1) !== -1)
           || (rawConcatBuffer.lastIndexOf(CMD_SLIST + CMD_SPACE, currentDataLength - 1) !== -1)) {
          // if so then send the next command
          if (slistOffsetCurrent < analogInCount) {
            const channelNum = parseInt(config.variables[slistOffsetCurrent]
              .chId.substring(1), 10) - 1;
            dataq.serialPort.write(CMD_SLIST + CMD_SPACE + slistOffsetCurrent + CMD_SPACE
               + generateSlistElementDi149(channelNum) + CMD_TERMINATOR);
            slistOffsetCurrent += 1;
          } else if (slistOffsetCurrent === digitalSlistOffset) {
            dataq.serialPort.write(CMD_SLIST + CMD_SPACE + slistOffsetCurrent + CMD_SPACE
              + generateSlistElementDi149(DIGITAL_INPUTS) + CMD_TERMINATOR);
            slistOffsetCurrent += 1;
          } else if (slistOffsetCurrent === rateSlistOffset) {
            dataq.serialPort.write(CMD_SLIST + CMD_SPACE + slistOffsetCurrent + CMD_SPACE
             + generateSlistElementDi149(DIGITAL_RATE,
               config.settings.model.digiInCh2RateRangeDi149) + CMD_TERMINATOR);
            slistOffsetCurrent += 1;
          } else if (slistOffsetCurrent === counterSlistOffset) {
            dataq.serialPort.write(CMD_SLIST + CMD_SPACE + slistOffsetCurrent + CMD_SPACE
              + generateSlistElementDi149(DIGITAL_COUNT) + CMD_TERMINATOR);
            slistOffsetCurrent += 1;
          } else {
            dataq.serialPort.write(CMD_SRATE + CMD_SPACE + SRATE_20_HZ_DI_149 + CMD_TERMINATOR);
          }
        } else if (rawConcatBuffer.lastIndexOf(CMD_SRATE + CMD_SPACE + SRATE_20_HZ_DI_149
           + CMD_TERMINATOR, currentDataLength - 1) !== -1) {
          // set all outputs off
          dataq.serialPort.write(CMD_OUTPUT + CMD_SPACE + allOutputsOff + CMD_TERMINATOR);
        } else if (rawConcatBuffer.lastIndexOf(CMD_OUTPUT + CMD_SPACE + allOutputsOff
           + CMD_TERMINATOR, currentDataLength - 1) !== -1) {
          // all configuration done, change mode to binary for actual data aquisition
          dataq.serialPort.write(CMD_BIN_MODE + CMD_TERMINATOR);
        } else if (rawConcatBuffer.lastIndexOf(CMD_BIN_MODE + CMD_TERMINATOR,
          currentDataLength - 1) !== -1) {
          // now trigger the data aquisition
          dataq.serialPort.write(CMD_START_DI_149 + CMD_TERMINATOR);
        } else if (rawConcatBuffer.lastIndexOf(CMD_START_DI_149 + CMD_TERMINATOR,
          currentDataLength - 1) !== -1) {
          // flag that we are in active receiving mode now
          activeReceiving = true;
          updateConnectionStatus(true);
          log.info('Configured DI-149 and successfully started scanning');
          // and trigger start callback on succesful enable
          onStartCallback(null, config.info);
        }
      // otherwise do initialization sequence of DI-1110
      // does the message contain the response to sending the stop command
      } else if (rawConcatBuffer.lastIndexOf(CMD_STOP + CMD_TERMINATOR,
        currentDataLength - 1) !== -1) {
        // if so then send the next command, setting the packet size to 2048 bytes
        dataq.serialPort.write(CMD_PS_SIZE_16 + CMD_TERMINATOR);
      } else if ((rawConcatBuffer.lastIndexOf(CMD_PS_SIZE_16 + CMD_TERMINATOR,
        currentDataLength - 1) !== -1)
           || (rawConcatBuffer.lastIndexOf(CMD_SLIST + CMD_SPACE, currentDataLength - 1) !== -1)) {
        // if the message contains the response to sending the packet size command or
        // an slist command,send the next command
        if (slistOffsetCurrent < analogInCount) {
          const channelNum = parseInt(config.variables[slistOffsetCurrent]
            .chId.substring(1), 10) - 1;
          dataq.serialPort.write(CMD_SLIST + CMD_SPACE + slistOffsetCurrent
               + CMD_SPACE + channelNum + CMD_TERMINATOR);
          slistOffsetCurrent += 1;
        } else if (slistOffsetCurrent === digitalSlistOffset) {
          dataq.serialPort.write(CMD_SLIST + CMD_SPACE + slistOffsetCurrent
               + CMD_SPACE + DIGITAL_INPUTS + CMD_TERMINATOR);
          slistOffsetCurrent += 1;
        } else if (slistOffsetCurrent === rateSlistOffset) {
          dataq.serialPort.write(CMD_SLIST + CMD_SPACE + slistOffsetCurrent + CMD_SPACE
               + (DIGITAL_RATE + rangeConvertDi1110[config.settings.model.digiInCh2RateRangeDi1110])
               + CMD_TERMINATOR);
          slistOffsetCurrent += 1;
        } else if (slistOffsetCurrent === counterSlistOffset) {
          dataq.serialPort.write(CMD_SLIST + CMD_SPACE + slistOffsetCurrent
               + CMD_SPACE + DIGITAL_COUNT + CMD_TERMINATOR);
          slistOffsetCurrent += 1;
        } else {
          // begin the  setting of the decimated srate setting
          dataq.serialPort.write(CMD_ENF + CMD_TERMINATOR);
        }
      } else if (rawConcatBuffer.lastIndexOf(CMD_ENF + CMD_TERMINATOR,
        currentDataLength - 1) !== -1) {
        dataq.serialPort.write(CMD_SRATE + CMD_SPACE + SRATE_10000_HZ_DI_1110 + CMD_TERMINATOR);
      } else if (rawConcatBuffer.lastIndexOf(CMD_SRATE + CMD_SPACE + SRATE_10000_HZ_DI_1110
           + CMD_TERMINATOR, currentDataLength - 1) !== -1) {
        dataq.serialPort.write(CMD_DECIMATE + CMD_SPACE
             + DECIMATE_20_HZ_DI_1110 + CMD_TERMINATOR);
      } else if (rawConcatBuffer.lastIndexOf(CMD_DECIMATE + CMD_SPACE + DECIMATE_20_HZ_DI_1110
           + CMD_TERMINATOR, currentDataLength - 1) !== -1) {
        // filter all channels with a CIC filter
        dataq.serialPort.write(CMD_FILTER + CMD_SPACE + ALL_CHANNELS + CMD_SPACE
             + CIC_FILTER + CMD_TERMINATOR);
      } else if (rawConcatBuffer.lastIndexOf(CMD_FILTER + CMD_SPACE + ALL_CHANNELS
           + CMD_SPACE + CIC_FILTER + CMD_TERMINATOR, currentDataLength - 1) !== -1) {
        // set all digital i/o to inputs
        dataq.serialPort.write(cmdSetDigitalInOrOut + CMD_TERMINATOR);
      } else if (rawConcatBuffer.lastIndexOf(cmdSetDigitalInOrOut + CMD_TERMINATOR,
        currentDataLength - 1) !== -1) {
        // set all outputs off
        dataq.serialPort.write(CMD_OUTPUT + CMD_SPACE + allOutputsOff + CMD_TERMINATOR);
      } else if (rawConcatBuffer.lastIndexOf(CMD_OUTPUT + CMD_SPACE + allOutputsOff
           + CMD_TERMINATOR, currentDataLength - 1) !== -1) {
        // now trigger the data aquisition, note this command is not echoed on DI-1110
        dataq.serialPort.write(CMD_START_DI_1110 + CMD_TERMINATOR);
        // flag that we are in active receiving mode now
        activeReceiving = true;
        updateConnectionStatus(true);
        log.info('Configured DI-1110 and successfully started scanning');
        // and trigger start callback on succesful enable
        onStartCallback(null, config.info);
      }


      // effectively clear the buffer by reseting the data length
      currentDataLength = 0;
    }
  } else if (disableReceiving === true) {
    // if we are actively receiving, but are trying to stop

    // look for the expected response
    if (rawConcatBuffer.lastIndexOf(CMD_STOP + CMD_TERMINATOR, currentDataLength - 1) !== -1) {
      // this is how we know our capture disabled message was recieved correctly, set the flag
      // and trigger serial port close with stop callback on succesful disable (if not already
      // closed due to timeout)

      disableReceiving = false;
      dataq.serialPort.close(() => {
        stopAlerts(onStopCallback);
      });

      // effectively clear the buffer by reseting the data length
      currentDataLength = 0;
    }
  } else if (fullPayloadSize > 0) {
    // active receiving mode, should be getting 22 byte (or multiples of) payload data
    while (currentDataLength >= fullPayloadSize) {
      // examine the signature of the data looking for a valid data payload
      if (validPayload() === true) {
        // extract payload into process buffer
        rawConcatBuffer.copy(processBuffer, 0, 0, fullPayloadSize);

        // process the payload to write to our db variables
        processPayload(processBuffer);

        // remove what has been used
        currentDataLength -= fullPayloadSize;

        // if there is still some data left
        if (currentDataLength > 0) {
          // move the buffer back to the beginning
          rawConcatBuffer.copy(rawConcatBuffer, 0, fullPayloadSize,
            fullPayloadSize + currentDataLength);
        }
      } else {
        // if start of buffer is not start of payload, then remove this byte and try again
        rawConcatBuffer.copy(rawConcatBuffer, 0, 1, currentDataLength - 1);
        currentDataLength -= 1;
      }
    }
  } else {
    currentDataLength = 0;
  }
}

function onSetListener(key) {
  // check if anything in the model changes
  const re = new RegExp(`machines:${pkg.name}:settings:model:(?!connectionStatus)`);
  if (re.test(key)) {
    conf.get(`machines:${pkg.name}:settings:model`, (err, model) => {
      log.debug(`machines:${pkg.name}:settings:model`, model);

      if (!_.isEqual(model, config.settings.model)) {
        // if any of the setting have changed
        log.debug(`machines:${pkg.name}:settings:model changed from`, config.settings.model, 'to', model);

        // update our local copy
        config.settings.model = model;

        // request a restart
        dataq.emit('restartRequest', info.name);
      }
    });
  }
}

function createNewVariableListFromSettings() {
  let tmpVar;
  const newVariables = [];
  const offValue = modelNum === 'DI-1110';

  let anyDigitalIn = false;
  let anyRateIn = false;
  let anyCounterIn = false;
  let digitalOutputBits = 0;
  analogInCount = 0;
  digitalSlistOffset = -1;
  rateSlistOffset = -1;
  counterSlistOffset = -1;


  // add any ENABLED analog input channel variables
  if (config.settings.model.anaInCh1Enable === true) {
    tmpVar = varForAnaInCh1;
    tmpVar.name = camelCase(config.settings.model.anaInCh1Name).replace(/[^a-zA-Z0-9-_]/g, '');
    tmpVar.description = config.settings.model.anaInCh1Name;
    newVariables.push(tmpVar);
    analogInCount += 1;
  }
  if (config.settings.model.anaInCh2Enable === true) {
    tmpVar = varForAnaInCh2;
    tmpVar.name = camelCase(config.settings.model.anaInCh2Name).replace(/[^a-zA-Z0-9-_]/g, '');
    tmpVar.description = config.settings.model.anaInCh2Name;
    newVariables.push(tmpVar);
    analogInCount += 1;
  }
  if (config.settings.model.anaInCh3Enable === true) {
    tmpVar = varForAnaInCh3;
    tmpVar.name = camelCase(config.settings.model.anaInCh3Name).replace(/[^a-zA-Z0-9-_]/g, '');
    tmpVar.description = config.settings.model.anaInCh3Name;
    newVariables.push(tmpVar);
    analogInCount += 1;
  }
  if (config.settings.model.anaInCh4Enable === true) {
    tmpVar = varForAnaInCh4;
    tmpVar.name = camelCase(config.settings.model.anaInCh4Name).replace(/[^a-zA-Z0-9-_]/g, '');
    tmpVar.description = config.settings.model.anaInCh4Name;
    newVariables.push(tmpVar);
    analogInCount += 1;
  }
  if (config.settings.model.anaInCh5Enable === true) {
    tmpVar = varForAnaInCh5;
    tmpVar.name = camelCase(config.settings.model.anaInCh5Name).replace(/[^a-zA-Z0-9-_]/g, '');
    tmpVar.description = config.settings.model.anaInCh5Name;
    newVariables.push(tmpVar);
    analogInCount += 1;
  }
  if (config.settings.model.anaInCh6Enable === true) {
    tmpVar = varForAnaInCh6;
    tmpVar.name = camelCase(config.settings.model.anaInCh6Name).replace(/[^a-zA-Z0-9-_]/g, '');
    tmpVar.description = config.settings.model.anaInCh6Name;
    newVariables.push(tmpVar);
    analogInCount += 1;
  }
  if (config.settings.model.anaInCh7Enable === true) {
    tmpVar = varForAnaInCh7;
    tmpVar.name = camelCase(config.settings.model.anaInCh7Name).replace(/[^a-zA-Z0-9-_]/g, '');
    tmpVar.description = config.settings.model.anaInCh7Name;
    newVariables.push(tmpVar);
    analogInCount += 1;
  }
  if (config.settings.model.anaInCh8Enable === true) {
    tmpVar = varForAnaInCh8;
    tmpVar.name = camelCase(config.settings.model.anaInCh8Name).replace(/[^a-zA-Z0-9-_]/g, '');
    tmpVar.description = config.settings.model.anaInCh8Name;
    newVariables.push(tmpVar);
    analogInCount += 1;
  }

  // add any ENABLED digital input channel variables
  if (config.settings.model.digiInCh0Enable === true) {
    tmpVar = varFordigiInCh0;
    tmpVar.name = camelCase(config.settings.model.digiInCh0Name).replace(/[^a-zA-Z0-9-_]/g, '');
    tmpVar.description = config.settings.model.digiInCh0Name;
    if ((modelNum === 'DI-1110') && config.settings.model.digiInCh0OutConfig) {
      tmpVar.access = 'write';
      tmpVar.enableReadWrite = true;
      tmpVar.initialValue = offValue;
      digitalOutputBits = 0x01;
    } else {
      anyDigitalIn = true;
    }
    newVariables.push(tmpVar);
  }
  if (config.settings.model.digiInCh1Enable === true) {
    tmpVar = varFordigiInCh1;
    tmpVar.name = camelCase(config.settings.model.digiInCh1Name).replace(/[^a-zA-Z0-9-_]/g, '');
    tmpVar.description = config.settings.model.digiInCh1Name;
    if ((modelNum === 'DI-1110') && config.settings.model.digiInCh1OutConfig) {
      tmpVar.access = 'write';
      tmpVar.enableReadWrite = true;
      tmpVar.initialValue = offValue;
      digitalOutputBits |= 0x02;
    } else {
      anyDigitalIn = true;
    }
    newVariables.push(tmpVar);
  }
  if (config.settings.model.digiInCh2Enable === true) {
    tmpVar = varFordigiInCh2;
    tmpVar.name = camelCase(config.settings.model.digiInCh2Name).replace(/[^a-zA-Z0-9-_]/g, '');
    tmpVar.description = config.settings.model.digiInCh2Name;
    if ((modelNum === 'DI-1110') && config.settings.model.digiInCh2OutConfig) {
      tmpVar.access = 'write';
      tmpVar.enableReadWrite = true;
      tmpVar.initialValue = offValue;
      digitalOutputBits |= 0x04;
    } else if (config.settings.model.digiInCh2Mode === 'Rate') {
      // if using channel 3 for rate, then change format from bool to 16bit
      tmpVar.format = 'float';
      anyRateIn = true;
    } else {
      anyDigitalIn = true;
    }
    newVariables.push(tmpVar);
  }
  if (config.settings.model.digiInCh3Enable === true) {
    tmpVar = varFordigiInCh3;
    tmpVar.name = camelCase(config.settings.model.digiInCh3Name).replace(/[^a-zA-Z0-9-_]/g, '');
    tmpVar.description = config.settings.model.digiInCh3Name;
    // if using channel 4 for counter, then change format from bool to 16bit
    if ((modelNum === 'DI-1110') && config.settings.model.digiInCh3OutConfig) {
      tmpVar.access = 'write';
      tmpVar.enableReadWrite = true;
      tmpVar.initialValue = offValue;
      digitalOutputBits |= 0x08;
    } else if (config.settings.model.digiInCh3Mode === 'Counter') {
      tmpVar.format = 'uint16';
      anyCounterIn = true;
    } else {
      anyDigitalIn = true;
    }
    newVariables.push(tmpVar);
  }
  if (modelNum === 'DI-1110') {
    if (config.settings.model.digiInCh4Enable === true) {
      tmpVar = varFordigiInCh4;
      tmpVar.name = camelCase(config.settings.model.digiInCh4Name).replace(/[^a-zA-Z0-9-_]/g, '');
      tmpVar.description = config.settings.model.digiInCh4Name;
      if (config.settings.model.digiInCh4OutConfig) {
        tmpVar.access = 'write';
        tmpVar.enableReadWrite = true;
        tmpVar.initialValue = offValue;
        digitalOutputBits |= 0x10;
      } else {
        anyDigitalIn = true;
      }
      newVariables.push(tmpVar);
    }
    if (config.settings.model.digiInCh5Enable === true) {
      tmpVar = varFordigiInCh5;
      tmpVar.name = camelCase(config.settings.model.digiInCh5Name).replace(/[^a-zA-Z0-9-_]/g, '');
      tmpVar.description = config.settings.model.digiInCh5Name;
      if (config.settings.model.digiInCh5OutConfig) {
        tmpVar.access = 'write';
        tmpVar.enableReadWrite = true;
        tmpVar.initialValue = offValue;
        digitalOutputBits |= 0x20;
      } else {
        anyDigitalIn = true;
      }
      newVariables.push(tmpVar);
    }
    if (config.settings.model.digiInCh6Enable === true) {
      tmpVar = varFordigiInCh6;
      tmpVar.name = camelCase(config.settings.model.digiInCh6Name).replace(/[^a-zA-Z0-9-_]/g, '');
      tmpVar.description = config.settings.model.digiInCh6Name;
      if (config.settings.model.digiInCh6OutConfig) {
        tmpVar.access = 'write';
        tmpVar.enableReadWrite = true;
        tmpVar.initialValue = offValue;
        digitalOutputBits |= 0x40;
      } else {
        anyDigitalIn = true;
      }
      newVariables.push(tmpVar);
    }
  } else {
    if (config.settings.model.digiOutCh0Enable === true) {
      tmpVar = varFordigiOutCh0;
      tmpVar.name = camelCase(config.settings.model.digiOutCh0Name).replace(/[^a-zA-Z0-9-_]/g, '');
      tmpVar.description = config.settings.model.digiOutCh0Name;
      tmpVar.initialValue = offValue;
      digitalOutputBits |= 0x01;
      newVariables.push(tmpVar);
    }
    if (config.settings.model.digiOutCh1Enable === true) {
      tmpVar = varFordigiOutCh1;
      tmpVar.name = camelCase(config.settings.model.digiOutCh1Name).replace(/[^a-zA-Z0-9-_]/g, '');
      tmpVar.description = config.settings.model.digiOutCh1Name;
      tmpVar.initialValue = offValue;
      digitalOutputBits |= 0x02;
      newVariables.push(tmpVar);
    }
    if (config.settings.model.digiOutCh2Enable === true) {
      tmpVar = varFordigiOutCh2;
      tmpVar.name = camelCase(config.settings.model.digiOutCh2Name).replace(/[^a-zA-Z0-9-_]/g, '');
      tmpVar.description = config.settings.model.digiOutCh2Name;
      tmpVar.initialValue = offValue;
      digitalOutputBits |= 0x04;
      newVariables.push(tmpVar);
    }
    if (config.settings.model.digiOutCh3Enable === true) {
      tmpVar = varFordigiOutCh3;
      tmpVar.name = camelCase(config.settings.model.digiOutCh3Name).replace(/[^a-zA-Z0-9-_]/g, '');
      tmpVar.description = config.settings.model.digiOutCh3Name;
      tmpVar.initialValue = offValue;
      digitalOutputBits |= 0x08;
      newVariables.push(tmpVar);
    }
  }

  // compute endo command to set digital outputs for the DI-1110
  cmdSetDigitalInOrOut = `endo ${digitalOutputBits}`;

  // initialize all outputs to 1 (not sinking) for DI-1110, 0 for DI-149
  if (modelNum === 'DI-1110') {
    allOutputsOff = digitalOutputBits;
  } else {
    allOutputsOff = ~digitalOutputBits & 0x0F;
  }
  outputState = allOutputsOff;

  // compute full payload size and slist offsets, if any, for digital inputs,
  // rate input, and count input (-1 of none)
  fullPayloadSize = 2 * analogInCount;
  if (anyDigitalIn) {
    fullPayloadSize += 2;
    digitalSlistOffset = analogInCount;
  }
  if (anyRateIn) {
    fullPayloadSize += 2;
    rateSlistOffset = anyDigitalIn ? analogInCount + 1 : analogInCount;
  }
  if (anyCounterIn) {
    fullPayloadSize += 2;
    if (anyDigitalIn) {
      counterSlistOffset = anyRateIn ? analogInCount + 2 : analogInCount + 1;
    } else {
      counterSlistOffset = anyRateIn ? analogInCount + 1 : analogInCount;
    }
  }

  return newVariables;
}

function writeReqListener(key) {
  db.get(key, (err, value) => {
    if (err) {
      log.error({
        err,
        key,
      }, `Error fetching variable for ${key.machine}`);
      return;
    } if (value.machine === 'spark-machine-dataq') {
      // find the variable in the configation to get is channel ID
      const { variables } = config;
      for (let iVar = 0; iVar < variables.length; iVar += 1) {
        const variable = variables[iVar];
        if ((variable.name === value.variable)
             && _.get(variable, 'enableReadWrite', false)) {
          switch (variables[iVar].chId) {
            case 'd0':
              if (value[value.variable]) {
                outputState |= 0x01;
              } else {
                outputState &= 0xFE;
              }
              break;
            case 'd1':
              if (value[value.variable]) {
                outputState |= 0x02;
              } else {
                outputState &= 0xFD;
              }
              break;
            case 'd2':
              if (value[value.variable]) {
                outputState |= 0x04;
              } else {
                outputState &= 0xFB;
              }
              break;
            case 'd3':
              if (value[value.variable]) {
                outputState |= 0x08;
              } else {
                outputState &= 0xF7;
              }
              break;
            case 'd4':
              if (value[value.variable]) {
                outputState |= 0x10;
              } else {
                outputState &= 0xEF;
              }
              break;
            case 'd5':
              if (value[value.variable]) {
                outputState |= 0x20;
              } else {
                outputState &= 0xDF;
              }
              break;
            case 'd6':
              if (value[value.variable]) {
                outputState |= 0x40;
              } else {
                outputState &= 0xBF;
              }
              break;
            default:
          }

          // write all the output bits (use no-echo cmd for DI-149)
          if (modelNum === 'DI-149') {
            dataq.serialPort.write(CMD_OUTPUT_NO_ECHO + `0${outputState.toString(16)}`.slice(-2) + CMD_TERMINATOR);
          } else {
            dataq.serialPort.write(CMD_OUTPUT + CMD_SPACE + outputState + CMD_TERMINATOR);
          }

          break;
        }
      }
    }
  });
}

dataq.start = function start(modules, done) {
  log = modules['spark-logging'].exports.getLogger(pkg.name);
  db = modules['spark-db'].exports;
  conf = modules['spark-config'].exports;
  alert = modules['spark-alert'].exports.getAlerter(pkg.name);

  // listen for changes to the enable key
  // but only add the listener once
  if (conf.listeners('set').indexOf(onSetListener) === -1) {
    log.debug('config.settings.model', config.settings.model);
    conf.on('set', onSetListener);
  }

  // listening to the write changes in the db
  if (!writeReqListenerAdded) {
    db.addListener('write-added', writeReqListener);
    writeReqListenerAdded = true;
  }

  // preload alert messages that have known keys
  alert.preLoad({
    'initialization-error': {
      msg: 'DataQ: Initialization Error',
      description: x => `DataQ is not able to initialize correctly. Error: ${x.errorMsg}`,
    },
    'serial-error': {
      msg: 'DataQ: Serial Error',
      description: x => `Error from serial port. Error: ${x.errorMsg}`,
    },
    'start-timeout': {
      msg: 'DataQ: Timeout on Start',
      description: 'Problem connecting to DataQ. Timeout while sending setup and start requests.',
    },
    'buffer-overflow': {
      msg: 'DataQ: Buffer Overflow',
      description: 'Too much unprocessed data received. Clearing out buffer.',
    },
    'db-add-error': {
      msg: 'DataQ: Database Add Error',
      description: x => `Error adding to the database. Error: ${x.errorMsg}`,
    },
  });

  // do the following steps one after another using async
  async.series([
    (cb) => {
      // read the current settings from the database model
      conf.get(`machines:${pkg.name}:settings:model`, (err, model) => {
        // if there is model data in the db, update to it
        // (e.g. overwrite what was read from readonly file)
        if (model) {
          config.settings.model = _.merge({}, config.settings.model, model);
        }
        cb(null);
      });
    },
    (cb) => {
      // read the current variable list
      conf.get(`machines:${pkg.name}:variables`, (err, currentVariables) => {
        // and write it to our local copy
        if (currentVariables) {
          config.variables = currentVariables;
        }
        cb(null);
      });
    },
    (cb) => {
      // if process has just started up
      if (firstStart === true) {
        firstStart = false;
        // write back config incase config json file has newer data than config database
        conf.set(`machines:${pkg.name}`, config, cb);
      } else {
        // otherwise no need to update
        cb(null);
      }
    },
    (cb) => {
      // store the model number
      ({ modelNum } = config.settings.model);

      // create variable list from settings data
      const newVariables = createNewVariableListFromSettings();

      // do variable lists match
      if (_.isEqual(newVariables, config.variables) === false) {
        // if not
        config.variables = newVariables;
        // write back updated list to config variable database
        conf.set(`machines:${pkg.name}:variables`, config.variables, (err) => {
          if (err) {
            return cb(err);
          }
          return cb(null);
        });
      } else {
        return cb(null);
      }
      return undefined;
    },
  ],
  (err) => {
    // once all async task are completed, check for error
    if (err) {
      // raise an initialization alert including the error message
      alert.raise({ key: 'initialization-error', errorMsg: err.message });
      return done(null);
    }

    // check enable state before continuing
    if (!config.settings.model.enable) {
      log.info('Disabled');
      return done(null, config.info);
    }
    // store a reference to the start callback
    onStartCallback = done;

    // calculate skip rate based on configured sample rate (we setdevice to sample at 20Hz
    // and throw away data if configured sampling rate is set lower)
    downSampleSkipCount = 20 / parseInt(config.settings.model.samplingRate, 10);

    // create a serial port with the correct configuration (virtual serial port,
    // so baudrate has no effect)
    dataq.serialPort = new SerialPort(config.settings.model.device, {
      baudRate: 115200,
      autoOpen: false,
    });

    // attempt to open the serial port
    dataq.serialPort.open((openErr) => {
      if (openErr) {
        // raise an initialization alert including the error message
        alert.raise({ key: 'initialization-error', errorMsg: openErr.message });
        return done(null, config.info);
      }

      // if we get here there have been no initialization issues,
      // so clear alert just in case it was raised
      alert.clear('initialization-error');

      // reset counters and flags
      currentDataLength = 0;
      downSampleCounter = 0;
      debouncingResetSignal = false;
      activeReceiving = false;
      lastValue = [];

      // read data that is available but keep the stream from entering "flowing mode"
      dataq.serialPort.on('readable', () => {
        const data = dataq.serialPort.read();
        alert.clear('serial-error');

        // if we have enough space in our buffer
        if (data.length + currentDataLength < MAX_BUFFER_SIZE) {
          // append new data to our buffer (keeping track of its length)
          data.copy(rawConcatBuffer, currentDataLength);
          currentDataLength += data.length;
        } else {
          // if too much data is being buffered, throw away all but new buffer
          data.copy(rawConcatBuffer, 0);
          alert.raise({ key: 'buffer-overflow' });
          currentDataLength = data.length;
        }

        // process the data
        processData();
      });

      // subscribe to on 'error' events
      dataq.serialPort.on('error', (onErrorErr) => {
        alert.raise({ key: 'serial-error', errorMsg: onErrorErr.message });
      });

      // subscribe to on 'close' events
      dataq.serialPort.on('close', () => {
        log.debug('Serial port closed');
      });

      let initialMessage;
      if (modelNum === 'DI-149') {
        // for DI-149, start by setting the mode to ASCII to send the configuration messages
        initialMessage = CMD_ASCII_MODE + CMD_TERMINATOR;
      } else {
        // for DI-1110, start by sending a stop command
        initialMessage = CMD_STOP + CMD_TERMINATOR;
      }

      // start building the slist at position 0 in processData()
      slistOffsetCurrent = 0;

      // start a timer to monitor the connected status
      connectedTimer = setInterval(() => {
        updateConnectionStatus(activeReceiving);
      }, CONNECTED_CHECK_INTERVAL);

      log.info('Sending Initial Config Msg');
      dataq.serialPort.write(initialMessage, (writeErr) => {
        if (writeErr) {
          alert.raise({ key: 'serial-error', errorMsg: writeErr.message });
          return done(null, config.info);
        }
        // start a timeout function incase we get no response
        setTimeout(() => {
          // if we had no response to our 'capture enable' message
          if (activeReceiving === false) {
            // callback with appropriate error
            alert.raise({ key: 'start-timeout' });
            onStartCallback(null, config.info);
          }
        }, 5000);
        return undefined;
      });
      return undefined;
    });
    return undefined;
  });
};

dataq.stop = function stop(done) {
  // stop connection status monitoring  timer
  if (connectedTimer) {
    clearInterval(connectedTimer);
    connectedTimer = null;
  }

  // stop lsitening to the write events in the db
  if (db) {
    db.removeListener('write-added', writeReqListener);
    writeReqListenerAdded = false;
  }

  if (dataq.serialPort) {
    if (dataq.serialPort.isOpen) {
      // turn off all the output bits
      dataq.serialPort.write(CMD_OUTPUT + CMD_SPACE + allOutputsOff + CMD_TERMINATOR);

      // store a reference to the stop callback
      onStopCallback = done;

      // if we are currently capturing
      if (activeReceiving === true) {
        // we need to send a 'stop' message before closing the port (reset success flag first)
        disableReceiving = true;

        // send the 'stop' message
        dataq.serialPort.write(CMD_STOP + CMD_TERMINATOR, (err) => {
          if (err) {
            dataq.serialPort.close(() => {
              stopAlerts(onStopCallback);
            });
          }
          // now wait for ack, or timeout to close the serial port and return stop callback
        });

        // start a timout function incase we get no response, or the pending request never gets out
        setTimeout(() => {
          // if we had no response to our 'stop' message
          if (disableReceiving === true) {
            disableReceiving = false;

            log.debug('Timeout waiting for stop. Closing serial Port');
            // just close the port
            dataq.serialPort.close(() => {
              stopAlerts(onStopCallback);
            });
          }
        }, 2000);
      } else {
        dataq.serialPort.close(() => {
          stopAlerts(onStopCallback);
        });
      }
    } else {
      // if serial port is not open, then just call the callback immeditalely
      return stopAlerts(done);
    }
  } else {
    // if serial port is null, then just call the callback immeditalely
    return stopAlerts(done);
  }

  return undefined;
};

dataq.require = function require() {
  return ['spark-logging',
    'spark-db',
    'spark-alert',
    'spark-config',
  ];
};

module.exports = dataq;
