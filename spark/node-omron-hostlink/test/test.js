require('chai').should();
const _ = require('lodash');
const hostLink = require('../index.js');

const RESP_BUF_PADDING = 20;
const RESP_TIMEOUT = 10;
const FINS_COMMAND_CODE_READ = '0101';
const FINS_COMMAND_CODE_WRITE = '0102';

const FINS_RESP_WAIT_TIME_INDEX = 5;
const FINS_ICF_INDEX = 7;
const FINS_RESP_COMMAND_INDEX = 15;
const FINS_MEM_CODE_INDEX = 18;
const FINS_ADDR_INDEX = 20;
const FINS_BIT_INDEX = 24;
const FINS_NUM_REGS_INDEX = 26;
const FINS_RESP_CODE_INDEX = 19;

const FINS_EXT_RESP_WAIT_TIME_INDEX = 5;
const FINS_EXT_ICF_INDEX = 7;
const FINS_EXT_RESP_COMMAND_INDEX = 27;
const FINS_EXT_MEM_CODE_INDEX = 30;
const FINS_EXT_ADDR_INDEX = 32;
const FINS_EXT_NUM_REGS_INDEX = 38;
const FINS_EXT_RESP_CODE_INDEX = 31;

const HL_MEM_CODE_INDEX = 3;
const HL_ADDR_INDEX = 5;
const HL_NUM_REGS_INDEX = 9;
const HL_RESP_CODE_INDEX = 5;

const FORCE_NO_ERROR = 0;
const FORCE_TERMINATOR_ERROR = 1;
const FORCE_FCS_ERROR = 2;
const FORCE_NOT_MARKED_RESP_ERROR = 3;
const FORCE_WRONG_CMD_ERROR = 4;
const FORCE_ERROR_CODE_ERROR = 5;
const FORCE_NO_RESP_ERROR = 6;
const FINS_TEST_ERROR_CODE = '0101';
const FINS_TEST_PARSED_ERROR_CODE = '1:1';
const HL_TEST_ERROR_CODE = '01';
const HL_TEST_PARSED_ERROR_CODE = '1';

const MEMORY_AREAS_FINS = [
  { area: 'DM', code: '82', numBytes: 4 },
  { area: 'IR', code: '9C', numBytes: 8 },
];

const MEMORY_AREAS_FINS_EXT = [
  {
    area: 'A', code: 'B3', addrOffset: 0, numBytes: 4,
  },
  {
    area: 'C', code: '89', addrOffset: 0x8000, numBytes: 4,
  },
  {
    area: 'CIO', code: 'B0', addrOffset: 0, numBytes: 4,
  },
  {
    area: 'DM', code: '82', addrOffset: 0, numBytes: 4,
  },
  {
    area: 'DR', code: 'BC', addrOffset: 0x0200, numBytes: 4,
  },
  {
    area: 'E', code: '98', addrOffset: 0, numBytes: 4,
  },
  {
    area: 'H', code: 'B2', addrOffset: 0, numBytes: 4,
  },
  {
    area: 'IR', code: 'DC', addrOffset: 0x0100, numBytes: 8,
  },
  {
    area: 'TK', code: '06', addrOffset: 0, numBytes: 2,
  },
  {
    area: 'TS', code: '09', addrOffset: 0, numBytes: 2,
  },
  {
    area: 'W', code: 'B1', addrOffset: 0, numBytes: 4,
  },
];

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

const READ_TESTS_FINS = [
  { address: 'DM0000', numRegs: 1, values: [123] },
  { address: 'DM0100', numRegs: 3, values: [234, 345, 456] },
  { address: 'IR0200', numRegs: 1, values: [34567] },
];

const READ_TESTS_FINS_EXT = [
  { address: 'DM0000', numRegs: 1, values: [123] },
  { address: 'DM0100', numRegs: 3, values: [234, 345, 456] },
  { address: 'DM0010.02', numRegs: 1, values: [1] },
  { address: 'A0200', numRegs: 1, values: [345] },
  { address: 'C0300', numRegs: 1, values: [456] },
  { address: 'CIO0400', numRegs: 1, values: [567] },
  { address: 'DR0500', numRegs: 1, values: [678] },
  { address: 'E0600', numRegs: 1, values: [789] },
  { address: 'H0700', numRegs: 1, values: [890] },
  { address: 'IR0800', numRegs: 1, values: [901] },
  { address: 'W0900', numRegs: 1, values: [1234] },
  { address: 'TK0010', numRegs: 1, values: [12] },
  { address: 'TS0020', numRegs: 1, values: [23] },
];

const READ_TESTS_HL = [
  { address: 'DM0000', numRegs: 1, values: [123] },
  { address: 'IR0100', numRegs: 3, values: [234, 345, 456] },
  { address: 'DM0010.02', numRegs: 1, values: [1] },
  { address: 'LR0000', numRegs: 1, values: [345] },
  { address: 'PV0000', numRegs: 1, values: [456] },
  { address: 'AR0000', numRegs: 1, values: [678] },
  { address: 'HR0000', numRegs: 1, values: [789] },
];

const WRITE_TESTS_FINS = [
  { address: 'DM0000', values: 123 },
  { address: 'DM0100', values: [234, 345, 456] },
];

const WRITE_TESTS_FINS_EXT = [
  { address: 'DM0000', values: 123 },
  { address: 'DM0100', values: [234, 345, 456] },
  { address: 'A0200', values: 345 },
  { address: 'C0300', values: 456 },
  { address: 'CIO0400', values: 567 },
  { address: 'DR0500', values: 678 },
  { address: 'E0600', values: 789 },
  { address: 'H0700', values: 890 },
  { address: 'IR0800', values: 901 },
  { address: 'W0900', values: 1234 },
  { address: 'TK0010', values: 12 },
  { address: 'TS0020', values: 23 },
];

const WRITE_TESTS_HL = [
  { address: 'DM0000', values: 123 },
  { address: 'IR0100', values: [234, 345, 456] },
  { address: 'LR0000', values: 345 },
  { address: 'PV0000', values: 456 },
  { address: 'AR0000', values: 678 },
  { address: 'HR0000', values: 789 },
];


const serialOptions = { timeout: RESP_TIMEOUT };

let forceError = FORCE_NO_ERROR;
let client;

function getFCS(buffer, iStart, iEnd) {
  const fcsSeqCalc = Buffer.alloc(1);
  for (let iBuffer = iStart; iBuffer < iEnd; iBuffer += 1) {
    // eslint-disable-next-line no-bitwise
    fcsSeqCalc[0] ^= buffer[iBuffer];
  }

  // convert fcs to (an upper case) ascii hex string
  return fcsSeqCalc.toString('hex').toUpperCase();
}

function writeToSerialPortFINSRead(data) {
  const iTerminator = data.indexOf('*');
  if (iTerminator === -1) return;
  if (getFCS(data, 0, iTerminator - 2) !== data.toString('ascii', iTerminator - 2, iTerminator)) return;
  const memCode = data.toString('ascii', FINS_MEM_CODE_INDEX, FINS_MEM_CODE_INDEX + 2);
  const addr = _.padStart(parseInt(data.toString('ascii',
    FINS_ADDR_INDEX, FINS_ADDR_INDEX + 4), 16).toString(), 4, '0');
  const bitNum = data.toString('ascii', FINS_BIT_INDEX, FINS_BIT_INDEX + 2);
  const numRegs = parseInt(data.toString('ascii', FINS_NUM_REGS_INDEX, FINS_NUM_REGS_INDEX + 4), 16);
  for (let iArea = 0; iArea < MEMORY_AREAS_FINS.length; iArea += 1) {
    if (MEMORY_AREAS_FINS[iArea].code === memCode) {
      let addressString = MEMORY_AREAS_FINS[iArea].area + addr;
      if (bitNum !== '00') {
        addressString += `.${bitNum}`;
      }
      const { numBytes } = MEMORY_AREAS_FINS[iArea];
      for (let iTest = 0; iTest < READ_TESTS_FINS.length; iTest += 1) {
        if ((READ_TESTS_FINS[iTest].address === addressString)
        && (READ_TESTS_FINS[iTest].numRegs === numRegs)) {
          const respBuffer = Buffer.allocUnsafe(data.length + RESP_BUF_PADDING);
          data.copy(respBuffer, 0, 0, FINS_RESP_WAIT_TIME_INDEX);
          respBuffer.write('00', FINS_RESP_WAIT_TIME_INDEX, 2);
          data.copy(respBuffer, FINS_RESP_WAIT_TIME_INDEX + 2, FINS_RESP_WAIT_TIME_INDEX + 1);
          if (forceError !== FORCE_NOT_MARKED_RESP_ERROR) {
            respBuffer.write('C', FINS_ICF_INDEX, 1);
          }
          if (forceError !== FORCE_ERROR_CODE_ERROR) {
            respBuffer.write('0000', FINS_RESP_CODE_INDEX, 4);
          } else {
            respBuffer.write(FINS_TEST_ERROR_CODE, FINS_RESP_CODE_INDEX, 4);
          }
          let iBuffer = FINS_RESP_CODE_INDEX + 4;
          for (let iReg = 0; iReg < numRegs; iReg += 1) {
            respBuffer.write(_.padStart(READ_TESTS_FINS[iTest].values[iReg].toString(16), numBytes, '0'),
              iBuffer, numBytes);
            iBuffer += numBytes;
          }
          if (forceError === FORCE_WRONG_CMD_ERROR) {
            respBuffer.write(FINS_COMMAND_CODE_WRITE, FINS_RESP_COMMAND_INDEX, 4);
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
            client.port.writeToComputer(respBuffer.slice(0, iBuffer + 4).toString());
          }
          break;
        }
      }
      break;
    }
  }
}

function writeToSerialPortFINSExtendedRead(data) {
  const iTerminator = data.indexOf('*');
  if (iTerminator === -1) return;
  if (getFCS(data, 0, iTerminator - 2) !== data.toString('ascii', iTerminator - 2, iTerminator)) return;
  const memCode = data.toString('ascii', FINS_EXT_MEM_CODE_INDEX, FINS_EXT_MEM_CODE_INDEX + 2);
  const addrInt = parseInt(data.toString('ascii', FINS_EXT_ADDR_INDEX, FINS_EXT_ADDR_INDEX + 4), 16);
  const numRegs = parseInt(data.toString('ascii', FINS_EXT_NUM_REGS_INDEX, FINS_EXT_NUM_REGS_INDEX + 4), 16);
  for (let iArea = 0; iArea < MEMORY_AREAS_FINS_EXT.length; iArea += 1) {
    if (MEMORY_AREAS_FINS_EXT[iArea].code === memCode) {
      const addr = _.padStart((addrInt - MEMORY_AREAS_FINS_EXT[iArea].addrOffset).toString(), 4, '0');
      const addressString = MEMORY_AREAS_FINS_EXT[iArea].area + addr;
      const { numBytes } = MEMORY_AREAS_FINS_EXT[iArea];
      for (let iTest = 0; iTest < READ_TESTS_FINS_EXT.length; iTest += 1) {
        const addrSplit = READ_TESTS_FINS_EXT[iTest].address.split('.');
        const addressNoBit = addrSplit[0];
        if ((addressNoBit === addressString)
        && (READ_TESTS_FINS_EXT[iTest].numRegs === numRegs)) {
          const bitNum = addrSplit.length === 2 ? parseInt(addrSplit[1], 10) : 0;
          const respBuffer = Buffer.allocUnsafe(data.length + RESP_BUF_PADDING);
          data.copy(respBuffer, 0, 0, FINS_EXT_RESP_WAIT_TIME_INDEX);
          respBuffer.write('00', FINS_EXT_RESP_WAIT_TIME_INDEX, 2);
          data.copy(respBuffer, FINS_EXT_RESP_WAIT_TIME_INDEX + 2,
            FINS_EXT_RESP_WAIT_TIME_INDEX + 1);
          if (forceError !== FORCE_NOT_MARKED_RESP_ERROR) {
            respBuffer.write('4', FINS_EXT_ICF_INDEX, 1);
          }
          if (forceError !== FORCE_ERROR_CODE_ERROR) {
            respBuffer.write('0000', FINS_EXT_RESP_CODE_INDEX, 4);
          } else {
            respBuffer.write(FINS_TEST_ERROR_CODE, FINS_EXT_RESP_CODE_INDEX, 4);
          }
          let iBuffer = FINS_EXT_RESP_CODE_INDEX + 4;
          for (let iReg = 0; iReg < numRegs; iReg += 1) {
            respBuffer.write(_.padStart((READ_TESTS_FINS_EXT[iTest].values[iReg]
               * (2 ** bitNum)).toString(16), numBytes, '0'),
            iBuffer, numBytes);
            iBuffer += numBytes;
          }
          if (forceError === FORCE_WRONG_CMD_ERROR) {
            respBuffer.write(FINS_COMMAND_CODE_WRITE, FINS_EXT_RESP_COMMAND_INDEX, 4);
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
            client.port.writeToComputer(respBuffer.slice(0, iBuffer + 4).toString());
          }
          break;
        }
      }
      break;
    }
  }
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
            client.port.writeToComputer(respBuffer.slice(0, iBuffer + 4).toString());
          }
          break;
        }
      }
    }
  }
}

function writeToSerialPortFINSWrite(data) {
  const iTerminator = data.indexOf('*');
  if (iTerminator === -1) return;
  if (getFCS(data, 0, iTerminator - 2) !== data.toString('ascii', iTerminator - 2, iTerminator)) return;
  const memCode = data.toString('ascii', FINS_MEM_CODE_INDEX, FINS_MEM_CODE_INDEX + 2);
  const addr = _.padStart(parseInt(data.toString('ascii',
    FINS_ADDR_INDEX, FINS_ADDR_INDEX + 4), 16).toString(), 4, '0');
  for (let iArea = 0; iArea < MEMORY_AREAS_FINS.length; iArea += 1) {
    if (MEMORY_AREAS_FINS[iArea].code === memCode) {
      const addressString = MEMORY_AREAS_FINS[iArea].area + addr;
      for (let iTest = 0; iTest < WRITE_TESTS_FINS.length; iTest += 1) {
        if (WRITE_TESTS_FINS[iTest].address === addressString) {
          const respBuffer = Buffer.allocUnsafe(data.length);
          data.copy(respBuffer, 0, 0, FINS_RESP_WAIT_TIME_INDEX);
          respBuffer.write('00', FINS_RESP_WAIT_TIME_INDEX, 2);
          data.copy(respBuffer, FINS_RESP_WAIT_TIME_INDEX + 2, FINS_RESP_WAIT_TIME_INDEX + 1);
          if (forceError !== FORCE_NOT_MARKED_RESP_ERROR) {
            respBuffer.write('C', FINS_ICF_INDEX, 1);
          }
          if (forceError !== FORCE_ERROR_CODE_ERROR) {
            respBuffer.write('0000', FINS_RESP_CODE_INDEX, 4);
          } else {
            respBuffer.write(FINS_TEST_ERROR_CODE, FINS_RESP_CODE_INDEX, 4);
          }
          if (forceError === FORCE_WRONG_CMD_ERROR) {
            respBuffer.write(FINS_COMMAND_CODE_READ, FINS_RESP_COMMAND_INDEX, 4);
          }
          if (forceError !== FORCE_FCS_ERROR) {
            respBuffer.write(getFCS(respBuffer, 0, FINS_RESP_CODE_INDEX + 4),
              FINS_RESP_CODE_INDEX + 4, 2);
          } else {
            respBuffer.write('xx', FINS_RESP_CODE_INDEX + 4, 2);
          }
          if (forceError !== FORCE_TERMINATOR_ERROR) {
            respBuffer.write('*\r', FINS_RESP_CODE_INDEX + 6, 2);
          }
          if (forceError !== FORCE_NO_RESP_ERROR) {
            client.port.writeToComputer(respBuffer.slice(0, FINS_RESP_CODE_INDEX + 8).toString());
          }
          break;
        }
      }
      break;
    }
  }
}

function writeToSerialPortFINSExtendedWrite(data) {
  const iTerminator = data.indexOf('*');
  if (iTerminator === -1) return;
  if (getFCS(data, 0, iTerminator - 2) !== data.toString('ascii', iTerminator - 2, iTerminator)) return;
  const memCode = data.toString('ascii', FINS_EXT_MEM_CODE_INDEX, FINS_EXT_MEM_CODE_INDEX + 2);
  const addrInt = parseInt(data.toString('ascii', FINS_EXT_ADDR_INDEX, FINS_EXT_ADDR_INDEX + 4), 16);
  for (let iArea = 0; iArea < MEMORY_AREAS_FINS_EXT.length; iArea += 1) {
    if (MEMORY_AREAS_FINS_EXT[iArea].code === memCode) {
      const addr = _.padStart((addrInt - MEMORY_AREAS_FINS_EXT[iArea].addrOffset).toString(), 4, '0');
      const addressString = MEMORY_AREAS_FINS_EXT[iArea].area + addr;
      for (let iTest = 0; iTest < WRITE_TESTS_FINS_EXT.length; iTest += 1) {
        const addrSplit = WRITE_TESTS_FINS_EXT[iTest].address.split('.');
        const addressNoBit = addrSplit[0];
        if (addressNoBit === addressString) {
          const respBuffer = Buffer.allocUnsafe(data.length + RESP_BUF_PADDING);
          data.copy(respBuffer, 0, 0, FINS_EXT_RESP_WAIT_TIME_INDEX);
          respBuffer.write('00', FINS_EXT_RESP_WAIT_TIME_INDEX, 2);
          data.copy(respBuffer, FINS_EXT_RESP_WAIT_TIME_INDEX + 2,
            FINS_EXT_RESP_WAIT_TIME_INDEX + 1);
          if (forceError !== FORCE_NOT_MARKED_RESP_ERROR) {
            respBuffer.write('4', FINS_EXT_ICF_INDEX, 1);
          }
          if (forceError !== FORCE_ERROR_CODE_ERROR) {
            respBuffer.write('0000', FINS_EXT_RESP_CODE_INDEX, 4);
          } else {
            respBuffer.write(FINS_TEST_ERROR_CODE, FINS_EXT_RESP_CODE_INDEX, 4);
          }

          if (forceError === FORCE_WRONG_CMD_ERROR) {
            respBuffer.write(FINS_COMMAND_CODE_READ, FINS_EXT_RESP_COMMAND_INDEX, 4);
          }
          if (forceError !== FORCE_FCS_ERROR) {
            respBuffer.write(getFCS(respBuffer, 0, FINS_EXT_RESP_CODE_INDEX + 4),
              FINS_EXT_RESP_CODE_INDEX + 4, 2);
          } else {
            respBuffer.write('xx', FINS_EXT_RESP_CODE_INDEX + 4, 2);
          }
          if (forceError !== FORCE_TERMINATOR_ERROR) {
            respBuffer.write('*\r', FINS_EXT_RESP_CODE_INDEX + 6, 2);
          }
          if (forceError !== FORCE_NO_RESP_ERROR) {
            client.port.writeToComputer(respBuffer.slice(0,
              FINS_EXT_RESP_CODE_INDEX + 8).toString());
          }
          break;
        }
      }
      break;
    }
  }
}

function writeToSerialPortHostlinkWrite(data) {
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
            client.port.writeToComputer(respBuffer.slice(0, HL_RESP_CODE_INDEX + 6).toString());
          }
          break;
        }
      }
    }
  }
}

describe('Node Omron Host Link', () => {
  it('creating a client in FINS mode should succeed', (done) => {
    // eslint-disable-next-line new-cap
    client = new hostLink.client('/dev/ttyUSB0', hostLink.OmronFINSPayloadMode, serialOptions);
    client.port.on('dataToDevice', writeToSerialPortFINSRead);
    return done();
  });

  READ_TESTS_FINS.forEach((readTest) => {
    it(`reading address ${readTest.address} should succeed in FINS mode`, (done) => {
      client.on('reply', (reply) => {
        reply.values.should.eql(readTest.values);
        client.removeAllListeners('reply');
        return done();
      });
      client.read(readTest.address, readTest.numRegs, (err) => {
        if (err) done(err);
      });
    });
  });

  it('reading should fail if no terminator in FINS mode', (done) => {
    forceError = FORCE_TERMINATOR_ERROR;
    client.on('error', (error) => {
      error.message.should.equal('Error cannot find complete message.');
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if FCS error in FINS mode', (done) => {
    forceError = FORCE_FCS_ERROR;
    client.on('error', (error) => {
      error.message.should.string('Error likely corrupt data due to Fcs mismatch.');
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if response not marked as response in FINS mode', (done) => {
    forceError = FORCE_NOT_MARKED_RESP_ERROR;
    client.on('error', (error) => {
      error.message.should.equal('Error response packet is not marked as response.');
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if wrong command code in FINS mode', (done) => {
    forceError = FORCE_WRONG_CMD_ERROR;
    client.on('error', (error) => {
      error.message.should.equal(`Error response packet contains wrong command: ${FINS_COMMAND_CODE_WRITE}`);
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if non-zero response code in FINS mode', (done) => {
    forceError = FORCE_ERROR_CODE_ERROR;
    client.on('error', (error) => {
      error.message.should.equal(`Error Non Zero response code: ${FINS_TEST_PARSED_ERROR_CODE}`);
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if no response in FINS mode', (done) => {
    forceError = FORCE_NO_RESP_ERROR;
    client.on('timeout', () => {
      client.removeAllListeners('timeout');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  WRITE_TESTS_FINS.forEach((writeTest) => {
    it(`writing address ${writeTest.address} should succeed in FINS mode`, (done) => {
      forceError = FORCE_NO_ERROR;
      client.port.removeAllListeners('dataToDevice');
      client.port.on('dataToDevice', writeToSerialPortFINSWrite);
      client.on('error', error => done(error));
      client.on('timeout', () => done(Error('Error no response to write')));
      client.write(writeTest.address, writeTest.values, (err) => {
        if (err) return done(err);
        setTimeout(() => {
          client.removeAllListeners('error');
          client.removeAllListeners('timeout');
          return done();
        }, 2 * RESP_TIMEOUT);
        return undefined;
      });
    });
  });

  it('writing should fail if no terminator in FINS mode', (done) => {
    forceError = FORCE_TERMINATOR_ERROR;
    client.on('error', (error) => {
      error.message.should.equal('Error cannot find complete message.');
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_FINS[0].address, WRITE_TESTS_FINS[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if FCS error in FINS mode', (done) => {
    forceError = FORCE_FCS_ERROR;
    client.on('error', (error) => {
      error.message.should.string('Error likely corrupt data due to Fcs mismatch.');
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_FINS[0].address, WRITE_TESTS_FINS[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if response not marked as response in FINS mode', (done) => {
    forceError = FORCE_NOT_MARKED_RESP_ERROR;
    client.on('error', (error) => {
      error.message.should.equal('Error response packet is not marked as response.');
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_FINS[0].address, WRITE_TESTS_FINS[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if wrong command code in FINS mode', (done) => {
    forceError = FORCE_WRONG_CMD_ERROR;
    client.on('error', (error) => {
      error.message.should.equal(`Error response packet contains wrong command: ${FINS_COMMAND_CODE_READ}`);
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_FINS[0].address, WRITE_TESTS_FINS[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if non-zero response code in FINS mode', (done) => {
    forceError = FORCE_ERROR_CODE_ERROR;
    client.on('error', (error) => {
      error.message.should.equal(`Error Non Zero response code: ${FINS_TEST_PARSED_ERROR_CODE}`);
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_FINS[0].address, WRITE_TESTS_FINS[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if no response in FINS mode', (done) => {
    forceError = FORCE_NO_RESP_ERROR;
    client.on('timeout', () => {
      client.removeAllListeners('timeout');
      return done();
    });
    client.write(WRITE_TESTS_FINS[0].address, WRITE_TESTS_FINS[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('creating a client in FINS extended mode should succeed', (done) => {
    // eslint-disable-next-line new-cap
    client = new hostLink.client('/dev/ttyUSB0', hostLink.OmronFINSExtendedPayloadMode,
      serialOptions);
    client.port.on('dataToDevice', writeToSerialPortFINSExtendedRead);
    return done();
  });

  READ_TESTS_FINS_EXT.forEach((readTest) => {
    it(`reading address ${readTest.address} should succeed in FINS extended mode`, (done) => {
      forceError = FORCE_NO_ERROR;
      client.on('reply', (reply) => {
        reply.values.should.eql(readTest.values);
        client.removeAllListeners('reply');
        return done();
      });
      client.read(readTest.address, readTest.numRegs, (err) => {
        if (err) done(err);
      });
    });
  });

  it('reading should fail if no terminator in FINS extended mode', (done) => {
    forceError = FORCE_TERMINATOR_ERROR;
    client.on('error', (error) => {
      error.message.should.equal('Error cannot find complete message.');
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if FCS error in FINS extended mode', (done) => {
    forceError = FORCE_FCS_ERROR;
    client.on('error', (error) => {
      error.message.should.string('Error likely corrupt data due to Fcs mismatch.');
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if response not marked as response in FINS extended mode', (done) => {
    forceError = FORCE_NOT_MARKED_RESP_ERROR;
    client.on('error', (error) => {
      error.message.should.equal('Error response packet is not marked as response.');
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if wrong command code in FINS extended mode', (done) => {
    forceError = FORCE_WRONG_CMD_ERROR;
    client.on('error', (error) => {
      error.message.should.equal(`Error response packet contains wrong command: ${FINS_COMMAND_CODE_WRITE}`);
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if non-zero response code in FINS extended mode', (done) => {
    forceError = FORCE_ERROR_CODE_ERROR;
    client.on('error', (error) => {
      error.message.should.equal(`Error Non Zero response code: ${FINS_TEST_PARSED_ERROR_CODE}`);
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if no response in FINS extended mode', (done) => {
    forceError = FORCE_NO_RESP_ERROR;
    client.on('timeout', () => {
      client.removeAllListeners('timeout');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  WRITE_TESTS_FINS_EXT.forEach((writeTest) => {
    it(`writing address ${writeTest.address} should succeed in FINS extended mode`, (done) => {
      forceError = FORCE_NO_ERROR;
      client.port.removeAllListeners('dataToDevice');
      client.port.on('dataToDevice', writeToSerialPortFINSExtendedWrite);
      client.on('error', error => done(error));
      client.on('timeout', () => done(Error('Error no response to write')));
      client.write(writeTest.address, writeTest.values, (err) => {
        if (err) return done(err);
        setTimeout(() => {
          client.removeAllListeners('error');
          client.removeAllListeners('timeout');
          return done();
        }, 2 * RESP_TIMEOUT);
        return undefined;
      });
    });
  });

  it('writing should fail if no terminator in FINS extended mode', (done) => {
    forceError = FORCE_TERMINATOR_ERROR;
    client.on('error', (error) => {
      error.message.should.equal('Error cannot find complete message.');
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_FINS_EXT[0].address, WRITE_TESTS_FINS_EXT[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if FCS error in FINS extended mode', (done) => {
    forceError = FORCE_FCS_ERROR;
    client.on('error', (error) => {
      error.message.should.string('Error likely corrupt data due to Fcs mismatch.');
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_FINS_EXT[0].address, WRITE_TESTS_FINS_EXT[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if response not marked as response in FINS extended mode', (done) => {
    forceError = FORCE_NOT_MARKED_RESP_ERROR;
    client.on('error', (error) => {
      error.message.should.equal('Error response packet is not marked as response.');
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_FINS_EXT[0].address, WRITE_TESTS_FINS_EXT[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if wrong command code in FINS extended mode', (done) => {
    forceError = FORCE_WRONG_CMD_ERROR;
    client.on('error', (error) => {
      error.message.should.equal(`Error response packet contains wrong command: ${FINS_COMMAND_CODE_READ}`);
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_FINS_EXT[0].address, WRITE_TESTS_FINS_EXT[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if non-zero response code in FINS extended mode', (done) => {
    forceError = FORCE_ERROR_CODE_ERROR;
    client.on('error', (error) => {
      error.message.should.equal(`Error Non Zero response code: ${FINS_TEST_PARSED_ERROR_CODE}`);
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_FINS_EXT[0].address, WRITE_TESTS_FINS_EXT[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if no response in FINS extended mode', (done) => {
    forceError = FORCE_NO_RESP_ERROR;
    client.on('timeout', () => {
      client.removeAllListeners('timeout');
      return done();
    });
    client.write(WRITE_TESTS_FINS_EXT[0].address, WRITE_TESTS_FINS_EXT[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('creating a client in Host Link mode should succeed', (done) => {
    // eslint-disable-next-line new-cap
    client = new hostLink.client('/dev/ttyUSB0', hostLink.OmronHostlinkPayloadMode, serialOptions);
    client.port.on('dataToDevice', writeToSerialPortHostlinkRead);
    return done();
  });

  READ_TESTS_HL.forEach((readTest) => {
    it(`reading address ${readTest.address} should succeed in Host Link mode`, (done) => {
      forceError = FORCE_NO_ERROR;
      client.on('reply', (reply) => {
        reply.values.should.eql(readTest.values);
        client.removeAllListeners('reply');
        return done();
      });
      client.read(readTest.address, readTest.numRegs, (err) => {
        if (err) done(err);
      });
    });
  });

  it('reading should fail if no terminator in Host Link mode', (done) => {
    forceError = FORCE_TERMINATOR_ERROR;
    client.on('error', (error) => {
      error.message.should.equal('Error cannot find complete message.');
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if FCS error in Host Link mode mode', (done) => {
    forceError = FORCE_FCS_ERROR;
    client.on('error', (error) => {
      error.message.should.string('Error likely corrupt data due to Fcs mismatch.');
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if response does not match request header in Host Link mode', (done) => {
    forceError = FORCE_WRONG_CMD_ERROR;
    client.on('error', (error) => {
      error.message.should.equal('Error response packet does not match request header code.');
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if non-zero response code in Host Link mode', (done) => {
    forceError = FORCE_ERROR_CODE_ERROR;
    client.on('error', (error) => {
      error.message.should.equal(`Error code recieved in response packet: ${HL_TEST_PARSED_ERROR_CODE}`);
      client.removeAllListeners('error');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  it('reading should fail if no response in Host Link mode', (done) => {
    forceError = FORCE_NO_RESP_ERROR;
    client.on('timeout', () => {
      client.removeAllListeners('timeout');
      return done();
    });
    client.read(READ_TESTS_FINS[0].address, READ_TESTS_FINS[0].numRegs, (err) => {
      if (err) done(err);
    });
  });

  WRITE_TESTS_HL.forEach((writeTest) => {
    it(`writing address ${writeTest.address} should succeed in Host Link mode`, (done) => {
      forceError = FORCE_NO_ERROR;
      client.port.removeAllListeners('dataToDevice');
      client.port.on('dataToDevice', writeToSerialPortHostlinkWrite);
      client.on('error', error => done(error));
      client.on('timeout', () => done(Error('Error no response to write')));
      client.write(writeTest.address, writeTest.values, (err) => {
        if (err) return done(err);
        setTimeout(() => {
          client.removeAllListeners('error');
          client.removeAllListeners('timeout');
          return done();
        }, 2 * RESP_TIMEOUT);
        return undefined;
      });
    });
  });

  it('writing should fail if no terminator in Host Link mode', (done) => {
    forceError = FORCE_TERMINATOR_ERROR;
    client.on('error', (error) => {
      error.message.should.equal('Error cannot find complete message.');
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_HL[0].address, WRITE_TESTS_HL[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if FCS error in Host Link mode', (done) => {
    forceError = FORCE_FCS_ERROR;
    client.on('error', (error) => {
      error.message.should.string('Error likely corrupt data due to Fcs mismatch.');
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_HL[0].address, WRITE_TESTS_HL[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if wrong command code in Host Link mode', (done) => {
    forceError = FORCE_WRONG_CMD_ERROR;
    client.on('error', (error) => {
      error.message.should.equal('Error response packet does not match request header code.');
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_HL[0].address, WRITE_TESTS_HL[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if non-zero response code in Host Link mode', (done) => {
    forceError = FORCE_ERROR_CODE_ERROR;
    client.on('error', (error) => {
      error.message.should.equal(`Error code recieved in response packet: ${HL_TEST_PARSED_ERROR_CODE}`);
      client.removeAllListeners('error');
      return done();
    });
    client.write(WRITE_TESTS_HL[0].address, WRITE_TESTS_HL[0].values, (err) => {
      if (err) done(err);
    });
  });

  it('writing should fail if no response in Host Link mode', (done) => {
    forceError = FORCE_NO_RESP_ERROR;
    client.on('timeout', () => {
      client.removeAllListeners('timeout');
      return done();
    });
    client.write(WRITE_TESTS_HL[0].address, WRITE_TESTS_HL[0].values, (err) => {
      if (err) done(err);
    });
  });
});
