const SerialPort = require('virtual-serialport');
const { EventEmitter } = require('events');
const { inherits } = require('util');
const _ = require('lodash');

// constant to define the payload mode
const OmronFINSPayloadMode = 0;
const OmronFINSExtendedPayloadMode = 1;
const OmronHostlinkPayloadMode = 2;

// Constants
const RESP_BUF_PADDING = 20;

const HL_MEM_CODE_INDEX = 3;
const HL_ADDR_INDEX = 5;
const HL_NUM_REGS_INDEX = 9;
const HL_RESP_CODE_INDEX = 5;

const FORCE_NO_ERROR = 0;
const FORCE_TERMINATOR_ERROR = 1;
const FORCE_FCS_ERROR = 2;

const FORCE_WRONG_CMD_ERROR = 4;
const FORCE_ERROR_CODE_ERROR = 5;
const FORCE_NO_RESP_ERROR = 6;
const HL_TEST_ERROR_CODE = '01';
const WORD_ADDRESS_LENGTH = 4;
const READ_COUNT_LENGTH = 4;
const BCD_PARSE = 10;
const HL_HEADER_START_CHAR = '@';
const HL_HEADER_NODE_NUMBER_00 = '00'; // (for destination) possibly need to make this configuarable

const HL_HEADER = HL_HEADER_START_CHAR + HL_HEADER_NODE_NUMBER_00;
// host link footer
const HL_FOOTER_TERMINATOR = '*\r';

// datalink fins encoded response indexes and lengths
const START_INDEX = 0;
const FCS_LENGTH_BYTES = 2;
const MEMORY_AREA_INDEX = 3;
const MEMORY_AREA_LENGTH_BYTES = 2;
const END_CODE_INDEX = 5;
const END_CODE_LENGTH_BYTES = 2;
const RESPONSE_DATA_INDEX = 7;
const RG_DATA_LENGTH_BYTES = 1;
const RESPONSE_NO_ERROR = 0;
const DM_DATA_LENGTH_BYTES = 4;
const HEX_PARSE = 16;
// command text
const MEMORY_AREAS_READ = {
  IR: 'RR',
  SR: 'RR',
  LR: 'RL',
  PV: 'RC',
  RC: 'RC',
  TC: 'RG', // returns a byte not a word
  DM: 'RD',
  D: 'RD',
  AR: 'RJ',
  CIO: 'RR',
  HR: 'RH',
};

const MEMORY_AREAS_HL_READ = [
  { area: 'IR', code: 'RR' },
  { area: 'LR', code: 'RL' },
  { area: 'PV', code: 'RC' },
  { area: 'DM', code: 'RD' },
  { area: 'AR', code: 'RJ' },
  { area: 'HR', code: 'RH' },
];

const MEMORY_AREAS_HL_WRITE = [
  { area: 'IR', code: 'WR' },
  { area: 'LR', code: 'WL' },
  { area: 'PV', code: 'WC' },
  { area: 'DM', code: 'WD' },
  { area: 'AR', code: 'WJ' },
  { area: 'HR', code: 'WH' },
];

let READ_TESTS_HL = null;

let WRITE_TESTS_HL = null;

const forceError = FORCE_NO_ERROR;

function getFCS(buffer, iStart, iEnd) {
  const fcsSeqCalc = Buffer.alloc(1);
  for (let iBuffer = iStart; iBuffer < iEnd; iBuffer += 1) {
    // eslint-disable-next-line no-bitwise
    fcsSeqCalc[0] ^= buffer[iBuffer];
  }

  // convert fcs to (an upper case) ascii hex string
  return fcsSeqCalc.toString('hex').toUpperCase();
}

function calculateFcs(message) {
  const bufMessage = Buffer.from(message, 'ascii');
  const fcsSeqCalc = Buffer.alloc(1);

  for (let iBuffer = 0; iBuffer < bufMessage.length; iBuffer += 1) {
    // eslint-disable-next-line no-bitwise
    fcsSeqCalc[0] ^= bufMessage[iBuffer];
  }

  // convert fcs to (an upper case) ascii hex string
  return fcsSeqCalc.toString('hex').toUpperCase();
}

function processReplyRead(self, responseString) {
  const termIndex = responseString.lastIndexOf('*');

  // check for expected terminator
  if (termIndex === -1) {
    self.emit('error', new Error('Error cannot find complete message.'));
    return null;
  }

  const responseMessage = responseString.substring(START_INDEX, termIndex - FCS_LENGTH_BYTES);
  const responseFcs = responseString.substr(termIndex - FCS_LENGTH_BYTES, FCS_LENGTH_BYTES);
  const responseFcsCalculated = calculateFcs(responseMessage);

  // check sent fcs matches calculate version
  if (responseFcs !== responseFcsCalculated) {
    self.emit('error', new Error(`Error likely corrupt data due to Fcs mismatch. Sent: ${responseFcs} Calculated: ${responseFcsCalculated}`));
    return null;
  }

  // check if memory area in response matches the request
  const responseMemoryAreaCode = responseString.substr(MEMORY_AREA_INDEX, MEMORY_AREA_LENGTH_BYTES);
  if (responseMemoryAreaCode !== self.memoryAreaCode) {
    self.emit('error', new Error('Error response packet does not match request header code.'));
    return null;
  }

  // check end code is not non-zero
  const responseEndCode = parseInt(responseString.substr(END_CODE_INDEX,
    END_CODE_LENGTH_BYTES), BCD_PARSE);
  if (responseEndCode !== RESPONSE_NO_ERROR) {
    self.emit('error', new Error(`Error code recieved in response packet: ${responseEndCode}`));
    return null;
  }

  // get data and send back in an array, may be more that one value)
  const data = responseString.substring(RESPONSE_DATA_INDEX, termIndex - FCS_LENGTH_BYTES);

  // create the array of results (still in string format)
  let resultStringArray;
  // all responses are 4 byte responses except for TC Status (RG) ones
  if (self.memoryAreaCode === 'RG') {
    resultStringArray = data.match(new RegExp(`.{${RG_DATA_LENGTH_BYTES}}`, 'g'));
  } else {
    resultStringArray = data.match(new RegExp(`.{${DM_DATA_LENGTH_BYTES}}`, 'g'));
  }
  if (resultStringArray === null || resultStringArray.length === 0) {
    self.emit('error', new Error('Error no data found in read response.'));
    return null;
  }

  // convert each 'hex encoded string' to an integer number, or mask and shift (if bitToRead is set)
  const resultArray = [];
  resultStringArray.forEach((element) => { // note syncronous function
    const intValue = parseInt(element, HEX_PARSE);

    if (self.bitToRead === null) {
      resultArray.push(intValue);
    } else {
      // eslint-disable-next-line no-bitwise
      resultArray.push(((2 ** self.bitToRead) & intValue) >> self.bitToRead);
    }
  });

  return { values: resultArray };
}

function writeToSerialPortHostlinkRead(data) {
  const iTerminator = data.indexOf('*');
  if (iTerminator === -1) return;

  if (getFCS(data, 0, iTerminator - 2) !== data.toString('ascii', iTerminator - 2, iTerminator)) return;

  const memCode = data.toString('ascii', HL_MEM_CODE_INDEX, HL_MEM_CODE_INDEX + 2);
  for (let iArea = 0; iArea < MEMORY_AREAS_HL_READ.length; iArea += 1) {
    if (MEMORY_AREAS_HL_READ[iArea].code === memCode) {
      const addr = data.toString('ascii', HL_ADDR_INDEX, HL_ADDR_INDEX + 4);
      const numRegs = parseInt(data.toString('ascii', HL_NUM_REGS_INDEX, HL_NUM_REGS_INDEX + 4), 10);
      const addressString = MEMORY_AREAS_HL_READ[iArea].area + addr;
      for (let iTest = 0; iTest < READ_TESTS_HL.length; iTest += 1) {
        const addrSplit = READ_TESTS_HL[iTest].address.split('.');
        const addressNoBit = addrSplit[0];
        if ((addressNoBit === addressString)
              && (READ_TESTS_HL[iTest].numRegs === numRegs)) {
          const bitNum = addrSplit.length === 2 ? parseInt(addrSplit[1], 10) : 0;
          const respBuffer = Buffer.allocUnsafe(data.length + RESP_BUF_PADDING);
          data.copy(respBuffer, 0, 0, HL_ADDR_INDEX);

          if (forceError !== FORCE_ERROR_CODE_ERROR) {
            respBuffer.write('00', HL_RESP_CODE_INDEX, 2);
          } else {
            respBuffer.write(HL_TEST_ERROR_CODE, HL_RESP_CODE_INDEX, 2);
          }
          let iBuffer = HL_RESP_CODE_INDEX + 2;
          for (let iReg = 0; iReg < numRegs; iReg += 1) {
            respBuffer.write(_.padStart((READ_TESTS_HL[iTest].values[iReg]
                     * (2 ** bitNum)).toString(16), 4, '0'), iBuffer, 4);
            iBuffer += 4;
          }
          if (forceError === FORCE_WRONG_CMD_ERROR) {
            respBuffer.write('XX', HL_MEM_CODE_INDEX, 2);
          }
          if (forceError !== FORCE_FCS_ERROR) {
            respBuffer.write(getFCS(respBuffer, 0, iBuffer), iBuffer, 2);
          } else {
            respBuffer.write('xx', iBuffer, 2);
          }
          if (forceError !== FORCE_TERMINATOR_ERROR) {
            respBuffer.write('*\r', iBuffer + 2, 2);
          }
          if (forceError !== FORCE_NO_RESP_ERROR) {
            const result = respBuffer.slice(0, iBuffer + 4).toString();
            // eslint-disable-next-line consistent-return
            return result;
          }
          break;
        }
      }
    }
  }
}

function HostLinkClient(device, payloadMode, serialOptions) {
  EventEmitter.call(this);
  HostLinkClient.init.call(this, device, payloadMode, serialOptions);
}

inherits(HostLinkClient, EventEmitter);

HostLinkClient.init = function init(device, payloadMode, serialOptions) {
  this.payloadMode = payloadMode;
  this.port = new SerialPort(device, {
    baudRate: serialOptions.baudRate,
    dataBits: serialOptions.dataBits,
    stopBits: serialOptions.stopBits,
    parity: serialOptions.parity,
  });

  setTimeout(() => {
    this.emit('open');
  }, 1000);

  this.port.on('dataToDevice', this.read);

  return this;
};

// eslint-disable-next-line max-len
HostLinkClient.prototype.read = function formDataLinkReadPayload(address, regsToRead, callback) {
  const self = this;

  // decode the address into its constiuent parts
  const re = /([A-Z,a-z]{1,3})([0-9]{2,5})\.?([0-9]{1,2})?/;
  const matches = address.match(re);
  if (matches === null) {
    return callback(new Error('Invalid memory area to read.'));
  }

  const decodedMemory = {
    memoryArea: matches[1].toUpperCase(),
    address: matches[2],
    bit: matches[3],
  };

  // get the memory area designator code
  const memoryAreaCode = MEMORY_AREAS_READ[decodedMemory.memoryArea];
  if (memoryAreaCode === undefined || memoryAreaCode === null) {
    return callback(new Error('Invalid memory area to read.'));
  }
  // store memory area, to compare with response
  self.memoryAreaCode = memoryAreaCode;

  // pad address to 4 digits
  const addressToRead = _.padStart(decodedMemory.address, WORD_ADDRESS_LENGTH, '0');

  // store bit to read as an integer so we can mask the response
  self.bitToRead = decodedMemory.bit ? parseInt(decodedMemory.bit, BCD_PARSE) : null;

  // convert regsToRead to bcd and pad to 4 digits
  const regsToReadString = _.padStart(regsToRead.toString(BCD_PARSE), READ_COUNT_LENGTH, '0');

  // form the message from its consituent parts
  let message = HL_HEADER + memoryAreaCode + addressToRead + regsToReadString;

  // before adding on the message footer, need to calculate the fcs (frame check sequence))
  const fcsString = calculateFcs(message);
  // now we can create the footer
  const hlfooter = fcsString + HL_FOOTER_TERMINATOR;

  // finalize the message with the footer
  message += hlfooter;

  const result = writeToSerialPortHostlinkRead(Buffer.from(message, 'ascii'));

  const response = processReplyRead(this, result);
  self.emit('reply', response);

  return callback(null, response);
};

// eslint-disable-next-line max-len
HostLinkClient.prototype.writeToSerialPortHostlinkWrite = function writeToSerialPortHostlinkWrite(data) {
  const iTerminator = data.indexOf('*');
  if (iTerminator === -1) return;
  if (getFCS(data, 0, iTerminator - 2) !== data.toString('ascii', iTerminator - 2, iTerminator)) return;
  const memCode = data.toString('ascii', HL_MEM_CODE_INDEX, HL_MEM_CODE_INDEX + 2);
  for (let iArea = 0; iArea < MEMORY_AREAS_HL_WRITE.length; iArea += 1) {
    if (MEMORY_AREAS_HL_WRITE[iArea].code === memCode) {
      const addr = data.toString('ascii', HL_ADDR_INDEX, HL_ADDR_INDEX + 4);
      const addressString = MEMORY_AREAS_HL_WRITE[iArea].area + addr;
      for (let iTest = 0; iTest < WRITE_TESTS_HL.length; iTest += 1) {
        const addrSplit = WRITE_TESTS_HL[iTest].address.split('.');
        const addressNoBit = addrSplit[0];
        if (addressNoBit === addressString) {
          const respBuffer = Buffer.allocUnsafe(data.length + RESP_BUF_PADDING);
          data.copy(respBuffer, 0, 0, HL_ADDR_INDEX);
          if (forceError !== FORCE_ERROR_CODE_ERROR) {
            respBuffer.write('00', HL_RESP_CODE_INDEX, 2);
          } else {
            respBuffer.write(HL_TEST_ERROR_CODE, HL_RESP_CODE_INDEX, 2);
          }

          if (forceError === FORCE_WRONG_CMD_ERROR) {
            respBuffer.write('XX', HL_MEM_CODE_INDEX, 2);
          }
          if (forceError !== FORCE_FCS_ERROR) {
            respBuffer.write(getFCS(respBuffer, 0, HL_RESP_CODE_INDEX + 2),
              HL_RESP_CODE_INDEX + 2, 2);
          } else {
            respBuffer.write('xx', HL_RESP_CODE_INDEX + 2, 2);
          }
          if (forceError !== FORCE_TERMINATOR_ERROR) {
            respBuffer.write('*\r', HL_RESP_CODE_INDEX + 4, 2);
          }
          if (forceError !== FORCE_NO_RESP_ERROR) {
            this.port.writeToComputer(respBuffer.slice(0, HL_RESP_CODE_INDEX + 6).toString());
          }
          break;
        }
      }
    }
  }
};

const TestServerOmronHostlink = function TestServerOmronHostlink() {

};

TestServerOmronHostlink.prototype.setReadVariables = function setReadVariables(variables) {
  READ_TESTS_HL = variables;
};

TestServerOmronHostlink.prototype.setWriteVariables = function setWriteVariables(variables) {
  WRITE_TESTS_HL = variables;
};

module.exports = {
  tester: TestServerOmronHostlink,
  client: HostLinkClient,
  OmronFINSPayloadMode,
  OmronFINSExtendedPayloadMode,
  OmronHostlinkPayloadMode,
};
