/* jshint esversion: 6 */
/* eslint no-bitwise: ["error", { "allow": ["&",  ">>", "^="] }] */
/* eslint no-param-reassign: ["error",{"props":true, "ignorePropertyModificationsFor":["self"]}] */
let SerialPort = require('serialport');

const { Readline } = SerialPort.parsers;
const _ = require('lodash');
const { EventEmitter } = require('events');
const { inherits } = require('util');

let testing = false;
if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line global-require
  SerialPort = require('virtual-serialport');
  testing = true;
}

// payload refrence used
// FINS via hostlink https://www.myomron.com/downloads/1.Manuals/Networks/W227E12_FINS_Commands_Reference_Manual.pdf
// Plain hostlink http://paginas.fe.up.pt/~pfs/recursos/plcs/omron/cs1/com_manual/sec32.pdf

// constant to define the payload mode - exported
const OmronFINSPayloadMode = 0;
const OmronFINSExtendedPayloadMode = 1;
const OmronHostlinkPayloadMode = 2;

// host link header for fins mode
const HL_HEADER_START_CHAR = '@';
const HL_HEADER_NODE_NUMBER_00 = '00'; // (for destination) possibly need to make this configuarable
const HL_HEADER_HEADER_CODE = 'FA';
const HL_HEADER_RESPONSE_DELAY = '1'; // 0-F in 10ms increments e.g. F = 150ms

// fins header
const FINS_HEADER_ICF = '00';
const FINS_HEADER_DA2 = '00'; // unit address of CPU
const FINS_HEADER_SA2 = '00';
const FINS_HEADER_SID = '00';

// fins extended header additions
const FINS_EXT_HEADER_ICF = '80';
const FINS_EXT_HEADER_RSV = '00';
const FINS_EXT_HEADER_GCT = '02';
const FINS_EXT_HEADER_DNA = '00';
const FINS_EXT_HEADER_DA1 = '00';
const FINS_EXT_HEADER_SNA = '00';
const FINS_EXT_HEADER_SA1 = '00';

// command codes (pick one of the following)
const MEMORY_AREA_READ = '0101';
const MEMORY_AREA_WRITE = '0102';

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

const MEMORY_AREAS_WRITE = {
  IR: 'WR',
  SR: 'WR',
  LR: 'WL',
  PV: 'WC',
  RC: 'WC',
  DM: 'WD',
  D: 'WD',
  AR: 'WJ',
  CIO: 'WR',
  HR: 'WH',
};

const MEMORY_AREAS_FINS = {
  DM: { code: '82', numBytes: 4 },
  D: { code: '82', numBytes: 4 },
  IR: { code: '9C', numBytes: 8 },
};

const MEMORY_AREA_DATA_FINS_EXT = {
  A: { code: 'B3', addrOffset: 0, numBytes: 4 },
  C: { code: '89', addrOffset: 0x8000, numBytes: 4 },
  CIO: { code: 'B0', addrOffset: 0, numBytes: 4 },
  D: { code: '82', addrOffset: 0, numBytes: 4 },
  DM: { code: '82', addrOffset: 0, numBytes: 4 },
  DR: { code: 'BC', addrOffset: 0x0200, numBytes: 4 },
  E: { code: '98', addrOffset: 0, numBytes: 4 },
  H: { code: 'B2', addrOffset: 0, numBytes: 4 },
  IR: { code: 'DC', addrOffset: 0x0100, numBytes: 8 },
  T: { code: '89', addrOffset: 0, numBytes: 4 },
  TK: { code: '06', addrOffset: 0, numBytes: 2 },
  TS: { code: '09', addrOffset: 0, numBytes: 2 },
  W: { code: 'B1', addrOffset: 0, numBytes: 4 },
};

const WORD_ADDRESS_LENGTH = 4;
const BIT_ADDRESS_ZERO = '00';
const BIT_ADDRESS_LENGTH = 2;
const READ_COUNT_LENGTH = 4;
const WRITE_COUNT_LENGTH = 4;
const WRITE_DATA_LENGTH = 4;

// host link footer
const HL_FOOTER_TERMINATOR = '*\r';

// can only be consts if we don't ned to set node number
const HL_HEADER_FINS = HL_HEADER_START_CHAR + HL_HEADER_NODE_NUMBER_00
 + HL_HEADER_HEADER_CODE + HL_HEADER_RESPONSE_DELAY;
const HL_HEADER = HL_HEADER_START_CHAR + HL_HEADER_NODE_NUMBER_00;

const FINS_HEADER = FINS_HEADER_ICF + FINS_HEADER_DA2 + FINS_HEADER_SA2 + FINS_HEADER_SID;
const FINS_EXT_HEADER = FINS_EXT_HEADER_ICF + FINS_EXT_HEADER_RSV + FINS_EXT_HEADER_GCT
  + FINS_EXT_HEADER_DNA
  + FINS_EXT_HEADER_DA1 + FINS_HEADER_DA2 + FINS_EXT_HEADER_SNA + FINS_EXT_HEADER_SA1
  + FINS_HEADER_SA2 + FINS_HEADER_SID;

const HEX_PARSE = 16;
const BCD_PARSE = 10;

// datalink fins encoded response indexes and lengths
const START_INDEX = 0;
const FCS_LENGTH_BYTES = 2;
const ICF_INDEX = 7;
const ICF_LENGTH_BYTES = 2;
const ICF_RESPONSE_MASK = 0x40;
const FINS_COMMAND_INDEX = 15;
const FINS_EXT_COMMAND_INDEX = 27;
const COMMAND_LENGTH_BYTES = 4;
const MAIN_RESPONSE_INDEX = 19;
const FINS_EXT_MAIN_RESPONSE_INDEX = 31;
const SUB_RESPONSE_INDEX = 21;
const FINS_EXT_SUB_RESPONSE_INDEX = 33;
const RESPONSE_LENGTHS_BYTES = 2;
const RESPONSE_NO_ERROR = 0;
const FINS_RESPONSE_DATA_INDEX = 23;
const FINS_EXT_RESPONSE_DATA_INDEX = 35;
const DM_DATA_LENGTH_BYTES = 4;
const RG_DATA_LENGTH_BYTES = 1;

const MEMORY_AREA_INDEX = 3;
const MEMORY_AREA_LENGTH_BYTES = 2;
const END_CODE_INDEX = 5;
const END_CODE_LENGTH_BYTES = 2;
const RESPONSE_DATA_INDEX = 7;

// defaults use for serial connection
const DEFAULT_BAUD_RATE = 9600;
const DEFAULT_DATA_BITS = 7;
const DEFAULT_STOP_BITS = 2;
const DEFAULT_PARITY = 'even';
const DEFAULT_TIMEOUT = 500;


function HostLinkClient(device, payloadMode, serialOptions) {
  EventEmitter.call(this);
  HostLinkClient.init.call(this, device, payloadMode, serialOptions);
}

// extend the EventEmitter class
inherits(HostLinkClient, EventEmitter);

// helper functions

function calculateFcs(message) {
  const bufMessage = Buffer.from(message, 'ascii');
  const fcsSeqCalc = Buffer.alloc(1);

  for (let iBuffer = 0; iBuffer < bufMessage.length; iBuffer += 1) {
    fcsSeqCalc[0] ^= bufMessage[iBuffer];
  }

  // convert fcs to (an upper case) ascii hex string
  return fcsSeqCalc.toString('hex').toUpperCase();
}

function processReplyFinsRead(self, responseString) {
  // console.log("Response: " + responseString);

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

  // check ICF is C0 (or at least the repsonse bit is set - 0x40)
  const responseIcf = responseString.substr(ICF_INDEX, ICF_LENGTH_BYTES);
  if ((parseInt(responseIcf, HEX_PARSE) & ICF_RESPONSE_MASK) !== ICF_RESPONSE_MASK) {
    self.emit('error', new Error('Error response packet is not marked as response.'));
    return null;
  }

  // check command code matches what we sent
  const responseCommand = responseString.substr(FINS_COMMAND_INDEX, COMMAND_LENGTH_BYTES);
  if (responseCommand !== MEMORY_AREA_READ) {
    self.emit('error', new Error(`Error response packet contains wrong command: ${responseCommand}`));
    return null;
  }

  // check response code
  const responseMainResponseCodeInt = parseInt(responseString.substr(MAIN_RESPONSE_INDEX,
    RESPONSE_LENGTHS_BYTES), HEX_PARSE);
  const responseSubResponseCodeInt = parseInt(responseString.substr(SUB_RESPONSE_INDEX,
    RESPONSE_LENGTHS_BYTES), HEX_PARSE);
  if ((responseMainResponseCodeInt !== RESPONSE_NO_ERROR)
   || (responseSubResponseCodeInt !== RESPONSE_NO_ERROR)) {
    self.emit('error', new Error(`Error Non Zero response code: ${responseMainResponseCodeInt}:${responseSubResponseCodeInt}`));
    return null;
  }

  // get data and send back in an array, may be more that one value)
  const data = responseString.substring(FINS_RESPONSE_DATA_INDEX, termIndex - FCS_LENGTH_BYTES);

  // create the array of results (still in string format)
  const resultStringArray = data.match(new RegExp(`.{${self.expectedNumBytes}}`, 'g'));
  if (resultStringArray === null || resultStringArray.length === 0) {
    self.emit('error', new Error('Error no data found in read response.'));
    return null;
  }

  // convert each to an integer number
  const resultArray = [];
  resultStringArray.forEach((element) => { // note syncronous function
    resultArray.push(parseInt(element, HEX_PARSE));
  });

  return { values: resultArray };
}

function processReplyFinsExtendedRead(self, responseString) {
  // console.log("Response: " + responseString);

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

  // check ICF is C0 (or at least the repsonse bit is set - 0x40)
  const responseIcf = responseString.substr(ICF_INDEX, ICF_LENGTH_BYTES);
  if ((parseInt(responseIcf, HEX_PARSE) & ICF_RESPONSE_MASK) !== ICF_RESPONSE_MASK) {
    self.emit('error', new Error('Error response packet is not marked as response.'));
    return null;
  }

  // check command code matches what we sent
  const responseCommand = responseString.substr(FINS_EXT_COMMAND_INDEX, COMMAND_LENGTH_BYTES);
  if (responseCommand !== MEMORY_AREA_READ) {
    self.emit('error', new Error(`Error response packet contains wrong command: ${responseCommand}`));
    return null;
  }

  // check response code
  const responseMainResponseCodeInt = parseInt(responseString.substr(FINS_EXT_MAIN_RESPONSE_INDEX,
    RESPONSE_LENGTHS_BYTES), HEX_PARSE);
  const responseSubResponseCodeInt = parseInt(responseString.substr(FINS_EXT_SUB_RESPONSE_INDEX,
    RESPONSE_LENGTHS_BYTES), HEX_PARSE);
  if ((responseMainResponseCodeInt !== RESPONSE_NO_ERROR)
   || (responseSubResponseCodeInt !== RESPONSE_NO_ERROR)) {
    self.emit('error', new Error(`Error Non Zero response code: ${responseMainResponseCodeInt}:${responseSubResponseCodeInt}`));
    return null;
  }

  // get data and send back in an array, may be more that one value)
  const data = responseString.substring(FINS_EXT_RESPONSE_DATA_INDEX, termIndex - FCS_LENGTH_BYTES);

  // create the array of results (still in string format)
  const resultStringArray = data.match(new RegExp(`.{${self.expectedNumBytes}}`, 'g'));
  if (resultStringArray === null || resultStringArray.length === 0) {
    self.emit('error', new Error('Error no data found in read response.'));
    return null;
  }

  // convert each to an integer number
  const resultArray = [];
  resultStringArray.forEach((element) => { // note syncronous function
    const intValue = parseInt(element, HEX_PARSE);

    if (self.bitToRead === null) {
      resultArray.push(intValue);
    } else {
      resultArray.push(((2 ** self.bitToRead) & intValue) >> self.bitToRead);
    }
  });

  return { values: resultArray };
}

function processReplyRead(self, responseString) {
  // console.log("Response: " + responseString);

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
      resultArray.push(((2 ** self.bitToRead) & intValue) >> self.bitToRead);
    }
  });

  return { values: resultArray };
}

function processReplyFinsWrite(self, responseString) {
  // console.log("Response: " + responseString);

  const termIndex = responseString.lastIndexOf('*');

  // check for expected terminator
  if (termIndex === -1) {
    self.emit('error', new Error('Error cannot find complete message.'));
    return;
  }

  const responseMessage = responseString.substring(START_INDEX, termIndex - FCS_LENGTH_BYTES);
  const responseFcs = responseString.substr(termIndex - FCS_LENGTH_BYTES, FCS_LENGTH_BYTES);
  const responseFcsCalculated = calculateFcs(responseMessage);

  // check sent fcs matches calculate version
  if (responseFcs !== responseFcsCalculated) {
    self.emit('error', new Error(`Error likely corrupt data due to Fcs mismatch. Sent: ${responseFcs} Calculated: ${responseFcsCalculated}`));
    return;
  }

  // check ICF is C0 (or at least the repsonse bit is set - 0x40)
  const responseIcf = responseString.substr(ICF_INDEX, ICF_LENGTH_BYTES);
  if ((parseInt(responseIcf, HEX_PARSE) & ICF_RESPONSE_MASK) !== ICF_RESPONSE_MASK) {
    self.emit('error', new Error('Error response packet is not marked as response.'));
    return;
  }

  // check command code matches what we sent
  const responseCommand = responseString.substr(FINS_COMMAND_INDEX, COMMAND_LENGTH_BYTES);
  if (responseCommand !== MEMORY_AREA_WRITE) {
    self.emit('error', new Error(`Error response packet contains wrong command: ${responseCommand}`));
    return;
  }

  // check response code
  const responseMainResponseCodeInt = parseInt(responseString.substr(MAIN_RESPONSE_INDEX,
    RESPONSE_LENGTHS_BYTES), HEX_PARSE);
  const responseSubResponseCodeInt = parseInt(responseString.substr(SUB_RESPONSE_INDEX,
    RESPONSE_LENGTHS_BYTES), HEX_PARSE);
  if ((responseMainResponseCodeInt !== RESPONSE_NO_ERROR)
   || (responseSubResponseCodeInt !== RESPONSE_NO_ERROR)) {
    self.emit('error', new Error(`Error Non Zero response code: ${responseMainResponseCodeInt}:${responseSubResponseCodeInt}`));
  }
}

function processReplyFinsExtendedWrite(self, responseString) {
  // console.log("Response: " + responseString);

  const termIndex = responseString.lastIndexOf('*');

  // check for expected terminator
  if (termIndex === -1) {
    self.emit('error', new Error('Error cannot find complete message.'));
    return;
  }

  const responseMessage = responseString.substring(START_INDEX, termIndex - FCS_LENGTH_BYTES);
  const responseFcs = responseString.substr(termIndex - FCS_LENGTH_BYTES, FCS_LENGTH_BYTES);
  const responseFcsCalculated = calculateFcs(responseMessage);

  // check sent fcs matches calculate version
  if (responseFcs !== responseFcsCalculated) {
    self.emit('error', new Error(`Error likely corrupt data due to Fcs mismatch. Sent: ${responseFcs} Calculated: ${responseFcsCalculated}`));
    return;
  }

  // check ICF is C0 (or at least the repsonse bit is set - 0x40)
  const responseIcf = responseString.substr(ICF_INDEX, ICF_LENGTH_BYTES);
  if ((parseInt(responseIcf, HEX_PARSE) & ICF_RESPONSE_MASK) !== ICF_RESPONSE_MASK) {
    self.emit('error', new Error('Error response packet is not marked as response.'));
    return;
  }

  // check command code matches what we sent
  const responseCommand = responseString.substr(FINS_EXT_COMMAND_INDEX, COMMAND_LENGTH_BYTES);
  if (responseCommand !== MEMORY_AREA_WRITE) {
    self.emit('error', new Error(`Error response packet contains wrong command: ${responseCommand}`));
    return;
  }

  // check response code
  const responseMainResponseCodeInt = parseInt(responseString.substr(FINS_EXT_MAIN_RESPONSE_INDEX,
    RESPONSE_LENGTHS_BYTES), HEX_PARSE);
  const responseSubResponseCodeInt = parseInt(responseString.substr(FINS_EXT_SUB_RESPONSE_INDEX,
    RESPONSE_LENGTHS_BYTES), HEX_PARSE);
  if ((responseMainResponseCodeInt !== RESPONSE_NO_ERROR)
   || (responseSubResponseCodeInt !== RESPONSE_NO_ERROR)) {
    self.emit('error', new Error(`Error Non Zero response code: ${responseMainResponseCodeInt}:${responseSubResponseCodeInt}`));
  }
}

function processReplyWrite(self, responseString) {
  // console.log("Response: " + responseString);

  const termIndex = responseString.lastIndexOf('*');

  // check for expected terminator
  if (termIndex === -1) {
    self.emit('error', new Error('Error cannot find complete message.'));
    return;
  }

  const responseMessage = responseString.substring(START_INDEX, termIndex - FCS_LENGTH_BYTES);
  const responseFcs = responseString.substr(termIndex - FCS_LENGTH_BYTES, FCS_LENGTH_BYTES);
  const responseFcsCalculated = calculateFcs(responseMessage);

  // check sent fcs matches calculate version
  if (responseFcs !== responseFcsCalculated) {
    self.emit('error', new Error(`Error likely corrupt data due to Fcs mismatch. Sent: ${responseFcs} Calculated: ${responseFcsCalculated}`));
    return;
  }

  // check if memory area in response matches the request
  const responseMemoryAreaCode = responseString.substr(MEMORY_AREA_INDEX, MEMORY_AREA_LENGTH_BYTES);
  if (responseMemoryAreaCode !== self.memoryAreaCode) {
    self.emit('error', new Error('Error response packet does not match request header code.'));
    return;
  }

  // check end code is not non-zero
  const responseEndCode = parseInt(responseString.substr(END_CODE_INDEX,
    END_CODE_LENGTH_BYTES), BCD_PARSE);
  if (responseEndCode !== RESPONSE_NO_ERROR) {
    self.emit('error', new Error(`Error code recieved in response packet: ${responseEndCode}`));
  }
}

function formDataLinkWithFinsReadPayload(self, decodedMemory, regsToRead, callback) {
  const command = MEMORY_AREA_READ;

  // get the memory area designator code
  const memoryAreaCode = MEMORY_AREAS_FINS[decodedMemory.memoryArea].code;
  if (memoryAreaCode === undefined || memoryAreaCode === null) {
    return callback(new Error('Invalid memory area to read.'));
  }

  // convert address from bcd string to hex string (padded to 4 digits)
  const addressToReadInt = parseInt(decodedMemory.address, BCD_PARSE);
  const addressToReadHex = _.padStart(addressToReadInt.toString(HEX_PARSE), WORD_ADDRESS_LENGTH, '0');

  // convert 'bit to read' from bcd string to hex string (padded to 4 digits)
  const bitToReadInt = decodedMemory.bit ? parseInt(decodedMemory.bit, BCD_PARSE) : 0;
  const bitToReadHex = _.padStart(bitToReadInt.toString(HEX_PARSE), BIT_ADDRESS_LENGTH, '0');

  // convert regsToRead from integer to hex string and pad to 4 digits
  const regsToReadHex = _.padStart(regsToRead.toString(HEX_PARSE), READ_COUNT_LENGTH, '0');

  // form the command text area
  const commandText = memoryAreaCode + addressToReadHex + bitToReadHex + regsToReadHex;

  // form the message from its consituent parts
  let message = HL_HEADER_FINS + FINS_HEADER + command + commandText;

  // before adding on the message footer, need to calculate the fcs (frame check sequence))
  const fcsString = calculateFcs(message);

  // now we can create the footer
  const hlfooter = fcsString + HL_FOOTER_TERMINATOR;

  // finalize the message with the footer
  message += hlfooter;

  // save the expected number of bytes if extended mode
  self.expectedNumBytes = MEMORY_AREAS_FINS[decodedMemory.memoryArea].numBytes;

  // create a buffer to return with
  return Buffer.from(message, 'ascii');
}

function formDataLinkWithFinsExtendedReadPayload(self, decodedMemory, regsToRead, callback) {
  const command = MEMORY_AREA_READ;

  // get the memory area designator code
  const memoryAreaCode = MEMORY_AREA_DATA_FINS_EXT[decodedMemory.memoryArea].code;
  if (memoryAreaCode === undefined || memoryAreaCode === null) {
    return callback(new Error('Invalid memory area to read.'));
  }

  // store bit to read as an integer so we can mask the response
  self.bitToRead = decodedMemory.bit ? parseInt(decodedMemory.bit, BCD_PARSE) : null;

  // convert address from bcd string to hex string (padded to 4 digits)
  const addressToReadInt = parseInt(decodedMemory.address, BCD_PARSE)
   + MEMORY_AREA_DATA_FINS_EXT[decodedMemory.memoryArea].addrOffset;
  const addressToReadHex = _.padStart(addressToReadInt.toString(HEX_PARSE), WORD_ADDRESS_LENGTH, '0');

  // convert regsToRead from integer to hex string and pad to 4 digits
  const regsToReadHex = _.padStart(regsToRead.toString(HEX_PARSE), READ_COUNT_LENGTH, '0');

  // form the command text area
  const commandText = memoryAreaCode + addressToReadHex + BIT_ADDRESS_ZERO + regsToReadHex;

  // form the message from its consituent parts
  let message = HL_HEADER_FINS + FINS_EXT_HEADER + command + commandText;

  // before adding on the message footer, need to calculate the fcs (frame check sequence))
  const fcsString = calculateFcs(message);

  // now we can create the footer
  const hlfooter = fcsString + HL_FOOTER_TERMINATOR;

  // finalize the message with the footer
  message += hlfooter;

  // save the expected number of bytes if extended mode
  self.expectedNumBytes = MEMORY_AREA_DATA_FINS_EXT[decodedMemory.memoryArea].numBytes;

  // create a buffer to return with
  return Buffer.from(message, 'ascii');
}

function formDataLinkReadPayload(self, decodedMemory, regsToRead, callback) {
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

  // console.log("Sending Message: " + message);

  // create a buffer to return with
  return Buffer.from(message, 'ascii');
}

function formDataLinkWithFinsWritePayload(self, decodedMemory, dataToBeWritten, callback) {
  const command = MEMORY_AREA_WRITE;

  // get the memory area designator code
  const memoryAreaCode = MEMORY_AREAS_FINS[decodedMemory.memoryArea].code;
  if (memoryAreaCode === undefined || memoryAreaCode === null) {
    return callback(new Error('Invalid memory area to write.'));
  }

  // get the number of bytes in each data value
  const dataNumBytes = MEMORY_AREAS_FINS[decodedMemory.memoryArea].numBytes;

  // convert address from bcd string to hex string (padded to 4 digits)
  const addressToWriteInt = parseInt(decodedMemory.address, BCD_PARSE);
  const addressToWriteHex = _.padStart(addressToWriteInt.toString(HEX_PARSE), WORD_ADDRESS_LENGTH, '0');

  // convert number of values to write to hex string (padded to 2 digits)
  const isArray = _.isArray(dataToBeWritten);
  const valuesToWriteInt = isArray ? dataToBeWritten.length : 1;
  const valuesToWriteHex = _.padStart(valuesToWriteInt.toString(HEX_PARSE), WRITE_COUNT_LENGTH, '0');

  // form the command text area (no bit address)
  let commandText = memoryAreaCode + addressToWriteHex + BIT_ADDRESS_ZERO + valuesToWriteHex;

  // add the data values
  if (isArray) {
    for (let iVal = 0; iVal < valuesToWriteInt; iVal += 1) {
      commandText += _.padStart(dataToBeWritten[iVal].toString(HEX_PARSE), dataNumBytes, '0');
    }
  } else {
    commandText += _.padStart(dataToBeWritten.toString(HEX_PARSE), dataNumBytes, '0');
  }

  // form the message from its consituent parts
  let message = HL_HEADER_FINS + FINS_HEADER + command + commandText;

  // before adding on the message footer, need to calculate the fcs (frame check sequence))
  const fcsString = calculateFcs(message);

  // now we can create the footer
  const hlfooter = fcsString + HL_FOOTER_TERMINATOR;

  // finalize the message with the footer
  message += hlfooter;

  // create a buffer to return with
  return Buffer.from(message, 'ascii');
}

function formDataLinkWithFinsExtendedWritePayload(self, decodedMemory, dataToBeWritten, callback) {
  const command = MEMORY_AREA_WRITE;

  // get the memory area designator code
  const memoryAreaCode = MEMORY_AREA_DATA_FINS_EXT[decodedMemory.memoryArea].code;
  if (memoryAreaCode === undefined || memoryAreaCode === null) {
    return callback(new Error('Invalid memory area to write.'));
  }

  // get the number of bytes in each data value
  const dataNumBytes = MEMORY_AREA_DATA_FINS_EXT[decodedMemory.memoryArea].numBytes;

  // convert address from bcd string to hex string (padded to 4 digits)
  const addressToWriteInt = parseInt(decodedMemory.address, BCD_PARSE)
   + MEMORY_AREA_DATA_FINS_EXT[decodedMemory.memoryArea].addrOffset;
  const addressToWriteHex = _.padStart(addressToWriteInt.toString(HEX_PARSE), WORD_ADDRESS_LENGTH, '0');

  // convert number of values to write to hex string (padded to 2 digits)
  const isArray = _.isArray(dataToBeWritten);
  const valuesToWriteInt = isArray ? dataToBeWritten.length : 1;
  const valuesToWriteHex = _.padStart(valuesToWriteInt.toString(HEX_PARSE), WRITE_COUNT_LENGTH, '0');

  // form the command text area (no bit address)
  let commandText = memoryAreaCode + addressToWriteHex + BIT_ADDRESS_ZERO + valuesToWriteHex;

  // add the data values
  if (isArray) {
    for (let iVal = 0; iVal < valuesToWriteInt; iVal += 1) {
      commandText += _.padStart(dataToBeWritten[iVal].toString(HEX_PARSE), dataNumBytes, '0');
    }
  } else {
    commandText += _.padStart(dataToBeWritten.toString(HEX_PARSE), dataNumBytes, '0');
  }

  // form the message from its consituent parts
  let message = HL_HEADER_FINS + FINS_EXT_HEADER + command + commandText;

  // before adding on the message footer, need to calculate the fcs (frame check sequence))
  const fcsString = calculateFcs(message);

  // now we can create the footer
  const hlfooter = fcsString + HL_FOOTER_TERMINATOR;

  // finalize the message with the footer
  message += hlfooter;

  // create a buffer to return with
  return Buffer.from(message, 'ascii');
}

function formDataLinkWritePayload(self, decodedMemory, dataToBeWritten, callback) {
  // get the memory area designator code
  const memoryAreaCode = MEMORY_AREAS_WRITE[decodedMemory.memoryArea];
  if (memoryAreaCode === undefined || memoryAreaCode === null) {
    return callback(new Error('Invalid memory area to write.'));
  }
  // store memory area, to compare with response
  self.memoryAreaCode = memoryAreaCode;

  // pad address to 4 digits
  const addressToWrite = _.padStart(decodedMemory.address, WORD_ADDRESS_LENGTH, '0');

  // convert number of values to write to decimak string (padded to 4 digits)
  const isArray = _.isArray(dataToBeWritten);
  const valuesToWrite = isArray ? dataToBeWritten.length : 1;

  // add the data values
  let dataValuesString = '';
  if (isArray) {
    for (let iVal = 0; iVal < valuesToWrite; iVal += 1) {
      dataValuesString += _.padStart(dataToBeWritten[iVal].toString(HEX_PARSE), WRITE_DATA_LENGTH, '0');
    }
  } else {
    dataValuesString = _.padStart(dataToBeWritten.toString(HEX_PARSE), WRITE_DATA_LENGTH, '0');
  }

  // form the message from its consituent parts
  let message = HL_HEADER + memoryAreaCode + addressToWrite + dataValuesString;

  // before adding on the message footer, need to calculate the fcs (frame check sequence))
  const fcsString = calculateFcs(message);

  // now we can create the footer
  const hlfooter = fcsString + HL_FOOTER_TERMINATOR;

  // finalize the message with the footer
  message += hlfooter;

  // console.log("Sending Message: " + message);

  // create a buffer to return with
  return Buffer.from(message, 'ascii');
}

HostLinkClient.init = function init(device, payloadMode, serialOpts) {
  const self = this;

  let serialOptions = serialOpts;

  this.payloadMode = payloadMode;

  // set serial option to defaults if not supplied
  if (!serialOptions) serialOptions = {};
  if (!serialOptions.baudRate) serialOptions.baudRate = DEFAULT_BAUD_RATE;
  if (!serialOptions.dataBits) serialOptions.dataBits = DEFAULT_DATA_BITS;
  if (!serialOptions.stopBits) serialOptions.stopBits = DEFAULT_STOP_BITS;
  if (!serialOptions.parity) serialOptions.parity = DEFAULT_PARITY;
  if (!serialOptions.timeout) serialOptions.timeout = DEFAULT_TIMEOUT;

  this.timeout = serialOptions.timeout;
  this.timer = null;
  this.reading = true;

  // open the serial port with the chosen options
  this.port = new SerialPort(device, {
    baudRate: serialOptions.baudRate,
    dataBits: serialOptions.dataBits,
    stopBits: serialOptions.stopBits,
    parity: serialOptions.parity,
  });

  // set serial parser to return only whole lines ending in a carriage return
  this.parser = this.port.pipe(new Readline({ delimiter: '\r' }));

  function receive(buf) {
    if (self.timer) {
      clearTimeout(self.timer);
      self.timer = null;
    }

    // if send read command
    if (self.reading) {
      let msg;

      switch (self.payloadMode) {
        case OmronFINSPayloadMode:
          msg = processReplyFinsRead(self, buf);
          break;
        case OmronFINSExtendedPayloadMode:
          msg = processReplyFinsExtendedRead(self, buf);
          break;
        default:
          msg = processReplyRead(self, buf);
          break;
      }

      // return message (may be null)
      self.emit('reply', msg);
    } else { // if last sent write command
      switch (self.payloadMode) {
        case OmronFINSPayloadMode:
          processReplyFinsWrite(self, buf);
          break;
        case OmronFINSExtendedPayloadMode:
          processReplyFinsExtendedWrite(self, buf);
          break;
        default:
          processReplyWrite(self, buf);
          break;
      }
    }
  }

  function open() {
    self.emit('open');
  }

  function close() {
    self.emit('close');
  }

  function error(err) {
    self.emit('error', err);
  }

  if (testing) {
    this.port.on('data', receive);
  } else {
    this.parser.on('data', receive);
  }
  this.port.on('open', open);
  this.port.on('close', close);
  this.port.on('error', error);
};

function startTimeoutTimer(self) {
  if (self.timeout) {
    self.timer = setTimeout(() => {
      self.emit('timeout');
    }, self.timeout);
  }
}

// api functions

HostLinkClient.prototype.read = function read(address, regsToRead, callback) {
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

  // encode the message in the correct format based on mode
  let messageToSend;
  switch (self.payloadMode) {
    case OmronFINSPayloadMode:
      messageToSend = formDataLinkWithFinsReadPayload(self, decodedMemory, regsToRead, callback);
      break;
    case OmronFINSExtendedPayloadMode:
      messageToSend = formDataLinkWithFinsExtendedReadPayload(self,
        decodedMemory, regsToRead, callback);
      break;
    default:
      messageToSend = formDataLinkReadPayload(self, decodedMemory, regsToRead, callback);
      break;
  }

  // start timeout timer
  startTimeoutTimer(self);

  // remember that this is a read
  self.reading = true;

  // and send via serial
  self.port.write(messageToSend, callback);

  return undefined;
};

HostLinkClient.prototype.write = function write(address, dataToBeWritten, callback) {
  const self = this;

  // decode the address into its constiuent parts
  const re = /([A-Z,a-z]{1,3})([0-9]{2,5})\.?([0-9]{1,2})?/;
  const matches = address.match(re);
  if (matches === null) {
    return callback(new Error('Invalid memory area to write.'));
  }

  const decodedMemory = {
    memoryArea: matches[1].toUpperCase(),
    address: matches[2],
    bit: matches[3],
  };

  // encode the message in the correct format based on mode
  let messageToSend;
  switch (self.payloadMode) {
    case OmronFINSPayloadMode:
      messageToSend = formDataLinkWithFinsWritePayload(self, decodedMemory,
        dataToBeWritten, callback);
      break;
    case OmronFINSExtendedPayloadMode:
      messageToSend = formDataLinkWithFinsExtendedWritePayload(self, decodedMemory,
        dataToBeWritten, callback);
      break;
    default:
      messageToSend = formDataLinkWritePayload(self, decodedMemory, dataToBeWritten, callback);
      break;
  }

  // start timeout timer
  startTimeoutTimer(self);

  // remember that this is a write
  self.reading = false;

  // and send via serial
  self.port.write(messageToSend, callback);

  return undefined;
};

HostLinkClient.prototype.close = function close() {
  if (this.port.isOpen) {
    this.port.close();
  }
};

module.exports = {
  client: HostLinkClient,
  OmronFINSPayloadMode,
  OmronFINSExtendedPayloadMode,
  OmronHostlinkPayloadMode,
};
