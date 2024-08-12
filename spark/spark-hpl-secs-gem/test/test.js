/* jshint esversion: 6 */
require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const net = require('net');
const pkg = require('../package.json');
const SparkHplSecsGem = require('../index.js');

const CLIENT_PORT = 5000;

const selectReqBuf = Buffer.from([0, 0, 0, 0x0a, 0xff, 0xff,
  0, 0, 0, 1, 0, 1, 0, 0]);
const selectRspBuf = Buffer.from([0, 0, 0, 0x0a, 0xff, 0xff,
  0, 0, 0, 2, 0, 1, 0, 0]);
const estabCommCmdFromMachineBuf = Buffer.from([0, 0, 0, 18, 0, 0, 0x81, 13,
  0, 0, 0, 1, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0]);
const estabCommCmdBuf = Buffer.from([0, 0, 0, 12, 0, 0, 0x81, 13,
  0, 0, 0, 1, 0, 0, 1, 0]);
const estabCommAckBuf = Buffer.from([0, 0, 0, 17, 0, 0, 1, 14,
  0, 0, 0, 1, 0, 0, 1, 2,
  0x21, 1, 0, 1, 0]);
const enableAlarmsCmdBuf = Buffer.from([0, 0, 0, 17, 0, 0, 0x85, 3,
  0, 0, 0, 1, 0, 0, 1, 2,
  0x21, 1, 0x80, 0xb1, 0]);
const enableAlarmsAckBuf = Buffer.from([0, 0, 0, 13, 0, 0, 5, 4,
  0, 0, 0, 1, 0, 0, 0x21, 1,
  0]);
const statusReqCmdBuf = Buffer.from([0, 0, 0, 16, 0, 0, 0x81, 3,
  0, 0, 0, 1, 0, 0, 1]);
const statusReqRspBuf = Buffer.from([0, 0, 0, 29, 0, 0, 1, 4,
  0, 0, 0, 1, 0, 3, 1]);
const constReqCmdBuf = Buffer.from([0, 0, 0, 16, 0, 0, 0x82, 13,
  0, 0, 0, 1, 0, 0, 1]);
const constReqRspBuf = Buffer.from([0, 0, 0, 18, 0, 0, 2, 14,
  0, 0, 0, 1, 0, 4, 1]);
const writeConstCmdBuf = Buffer.from([0, 0, 0, 13, 0, 0, 0x82, 15,
  0, 0, 0, 1, 0, 0, 1, 1,
  1, 2, 0xA9, 2]);
const writeConstAckBuf = Buffer.from([0, 0, 0, 13, 0, 0, 2, 16,
  0, 0, 0, 1, 0, 0, 0x21, 1,
  0]);
const alarmReportBuf = Buffer.from([0, 0, 0, 63, 0, 0, 0x85, 1,
  0, 0, 0, 0, 0, 0, 1, 3,
  0x21, 1, 0x80, 0xb1, 4, 0, 0, 0,
  123, 0x41, 40, 0x54, 0x65, 0x73, 0x74, 0x20,
  0x41, 0x6c, 0x61, 0x72, 0x6d, 0x20, 0x20, 0x20,
  0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20,
  0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20,
  0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20,
  0x20, 0x20, 0x20]);
const alarmReportAckBuf = Buffer.from([0, 0, 0, 13, 0, 0, 5, 2,
  0, 0, 0, 0, 0, 0, 0x21, 1,
  0]);

const deleteReportRequestBuf = Buffer.from([0x00, 0x00, 0x00, 0x1e, 0x00, 0x00, 0x82, 0x21,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x01, 0x02,
  0xb1, 0x04, 0x00, 0x00, 0x0b, 0xb8, 0x01, 0x01,
  0x01, 0x02, 0xb1, 0x04, 0x00, 0x00, 0x01, 0xc8,
  0x01, 0x00]);
const deleteReportAckBuf = Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x00, 0x00, 0x02, 0x22,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x21, 0x01,
  0x00]);

const defineReportRequestBuf = Buffer.from([0x00, 0x00, 0x00, 0x24, 0x00, 0x00, 0x82, 0x21,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x01, 0x02,
  0xb1, 0x04, 0x00, 0x00, 0x0b, 0xb8, 0x01, 0x01,
  0x01, 0x02, 0xb1, 0x04, 0x00, 0x00, 0x01, 0xc8,
  0x01, 0x01, 0xb1, 0x04, 0x00, 0x00, 0x01, 0x39]);
const defineReportAckBuf = Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x00, 0x00, 0x02, 0x22,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x21, 0x01,
  0x00]);

const linkReportRequestBuf = Buffer.from([0x00, 0x00, 0x00, 0x24, 0x00, 0x00, 0x82, 0x23,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x01, 0x02,
  0xb1, 0x04, 0x00, 0x00, 0x0b, 0xb8, 0x01, 0x01,
  0x01, 0x02, 0xb1, 0x04, 0x00, 0x00, 0x01, 0xc8,
  0x01, 0x01, 0xb1, 0x04, 0x00, 0x00, 0x01, 0xc8]);
const linkReportAckBuf = Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x00, 0x00, 0x02, 0x24,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x21, 0x01,
  0x00]);

const eventEnableRequestBuf = Buffer.from([0x00, 0x00, 0x00, 0x17, 0x00, 0x00, 0x82, 0x25,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x01, 0x02,
  0x25, 0x01, 0x01, 0x01, 0x01, 0xb1, 0x04, 0x00,
  0x00, 0x01, 0xc8]);
const eventEnableAckBuf = Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x00, 0x00, 0x02, 0x26,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x21, 0x01,
  0x00]);

const respBuf = Buffer.allocUnsafe(1000);

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});


const testMachine = {
  info: {
    name: 'test-machine',
    fullname: 'Test machine',
    version: '1.0.0',
    description: 'Test Machine',
    hpl: 'net',
  },
  settings: {
    model: {
      enable: true,
      ipAddress: os.hostname(),
      port: CLIENT_PORT,
      sparkDeviceID: 1,
      equipDeviceID: 0,
      requestFrequency: 1,
    },
  },
  variables: [{
    name: 'count',
    description: 'Count',
    format: 'int16',
    type: 'Status Variable (SV)',
    numericID: 0,
    value: 1234,
  },
  {
    name: 'temperature',
    description: 'Temperature',
    format: 'float',
    type: 'Equipment Constant (EC)',
    numericID: 10,
    value: 23.0,
  },
  {
    name: 'stringTest',
    description: 'String Test',
    format: 'char',
    type: 'Status Variable (SV)',
    numericID: 40,
    value: 'ABC',
  },
  {
    name: 'boolTest',
    description: 'Bool Test',
    format: 'bool',
    type: 'Status Variable (SV)',
    numericID: 100,
    value: true,
  },
  {
    name: 'arrayVariable',
    description: 'Array Variable',
    type: 'Status Variable (SV)',
    format: 'int8',
    numericID: 200,
    array: true,
    value: [1, 2, 3],
  },
  {
    name: 'writeUInt8Test',
    description: 'Write UInt8 Test',
    format: 'uint8',
    type: 'Equipment Constant (EC)',
    numericID: 300,
    access: 'write',
    value: 123,
  },
  {
    name: 'writeUInt16Test',
    description: 'Write UInt16 Test',
    format: 'uint16',
    type: 'Equipment Constant (EC)',
    numericID: 301,
    access: 'write',
    value: 12345,
  },
  {
    name: 'writeUInt32Test',
    description: 'Write UInt32 Test',
    format: 'uint32',
    type: 'Equipment Constant (EC)',
    numericID: 302,
    access: 'write',
    value: 123456,
  },
  {
    name: 'writeUInt64Test',
    description: 'Write UInt64 Test',
    format: 'uint64',
    type: 'Equipment Constant (EC)',
    numericID: 303,
    access: 'write',
    value: 12345678,
  },
  {
    name: 'writeInt8Test',
    description: 'Write Int8 Test',
    format: 'int8',
    type: 'Equipment Constant (EC)',
    numericID: 304,
    access: 'write',
    value: 123,
  },
  {
    name: 'writeInt16Test',
    description: 'Write Int16 Test',
    format: 'int16',
    type: 'Equipment Constant (EC)',
    numericID: 305,
    access: 'write',
    value: 12345,
  },
  {
    name: 'writeInt32Test',
    description: 'Write Int32 Test',
    format: 'int32',
    type: 'Equipment Constant (EC)',
    numericID: 306,
    access: 'write',
    value: 123456,
  },
  {
    name: 'writeInt64Test',
    description: 'Write Int64 Test',
    format: 'int64',
    type: 'Equipment Constant (EC)',
    numericID: 307,
    access: 'write',
    value: 12345678,
  },
  {
    name: 'writeStringTest',
    description: 'Write String Test',
    format: 'char',
    type: 'Equipment Constant (EC)',
    numericID: 308,
    access: 'write',
    value: 'abcdef',
  },
  {
    name: 'writeBoolTest',
    description: 'Write Boolean Test',
    format: 'bool',
    type: 'Equipment Constant (EC)',
    numericID: 309,
    access: 'write',
    value: true,
  },
  {
    name: 'writeFloatTest',
    description: 'Write Float Test',
    format: 'float',
    type: 'Equipment Constant (EC)',
    numericID: 310,
    access: 'write',
    value: 1234.0,
  },
  {
    name: 'writeDoubleTest',
    description: 'Write Double Test',
    format: 'double',
    type: 'Equipment Constant (EC)',
    numericID: 311,
    access: 'write',
    value: 345678.0,
  },
  {
    name: 'alarmCodesTest',
    description: 'Alarm Codes Test',
    format: 'uint16',
    type: 'Active Alarm Codes',
    numericID: 312,
    array: true,
  },
  {
    name: 'alarmTextsTest',
    description: 'Alarm Texts Test',
    format: 'char',
    type: 'Active Alarm Texts',
    numericID: 313,
    array: true,
  },
  {
    name: 'eventDV',
    description: 'Event Data Variable',
    format: 'char',
    type: 'Data Variable (DV) (requires CEID)',
    numericID: 313,
    CEID: 456,
    array: true,
  },
  {
    name: 'machineConnected',
    description: 'Machine Connected',
    format: 'bool',
    machineConnected: true,
  }],
};

// const invalidVariableMachine = {
//   info: {
//     name: 'invalid-variable-machine',
//     fullname: 'Invalid variable machine',
//     version: '1.0.0',
//     description: 'Invalid Variable Machine',
//     hpl: 'opcua',
//   },
//   settings: {
//     model: {
//       enable: true,
//       ipAddress: os.hostname(),
//       port: CLIENT_PORT,
//     },
//   },
//   variables: [{
//     name: 'invalid',
//     description: 'Invalid',
//     format: 'int16',
//   }],
// };

const db = new EventEmitter();

function dataCb(machine, variable, value, done) {
  const data = {
    machine: machine.info.name,
    variable: variable.name,
  };
  data[variable.name] = value;
  log.debug({ data });
  db.emit('data', data);
  done(null);
}

function configUpdateCb(machine, done) {
  log.debug({ machine });
  return done(null);
}

let alerts = {};
const sparkAlert = new EventEmitter();
sparkAlert.getAlerter = function getAlerter() {
  return {
    clearAll(done) {
      return done(null);
    },
    preLoad: function preLoad(preloadAlerts) {
      alerts = preloadAlerts;
    },
    raise: function raise(_alert) {
      const alert = _alert;
      if (_.has(alerts, alert.key)) _.extend(alert, alerts[alert.key]);
      Object.keys(alert).forEach((k) => {
        // check if the key is a function
        if (typeof alert[k] === 'function') {
          // if it is then run the function and replace
          // the key with the output
          alert[k] = alert[k](alert);
        }
      });
      sparkAlert.emit('raise', alert);
    },
    clear(key) {
      log.debug({ key }, 'Cleared alert');
    },
  };
};

const config = {};
const sparkConfig = new EventEmitter();
sparkConfig.set = function set(key, value, done) {
  config[key] = value;
  if (done) return done(null);
  return undefined;
};
sparkConfig.get = function get(key, done) {
  if (done) {
    return done(null, config[key]);
  }

  return config[key];
};

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

//    debug function for dumping the contents of a a buffer in easy-to-read format, 16 bytes/line
// function dumpBuffer(buffer) {
//   let str = '';
//   for (let i = 0; i < buffer.length; i += 1) {
//     if (buffer[i] < 16) {
//       str += `0${buffer[i].toString(16)} `;
//     } else {
//       str += `${buffer[i].toString(16)} `;
//     }
//     if ((((i + 1) % 16) === 0) || ((i + 1) === buffer.length)) {
//       console.log(str);
//       str = '';
//     }
//   }
// }

let serverSocket;
net.createServer((socket) => {
  serverSocket = socket;
  socket.on('data', (data) => {
    // set the transaction ID to zero so that comparisons succeed
    const dataCopy = Buffer.from(data);
    //    console.log('dataCopy = ');
    //    dumpBuffer(dataCopy);
    const transactionId = dataCopy.readUInt16BE(12);
    dataCopy.writeUInt16BE(0, 12);
    if (dataCopy.equals(estabCommCmdBuf)) {
      socket.write(estabCommAckBuf);
    } else if (dataCopy.equals(estabCommAckBuf)) {
      //      console.log('estabCommAckBuf');
      // no response necessary
    } else if (dataCopy.equals(enableAlarmsCmdBuf)) {
      //      console.log('enableAlarmsCmdBuf');
      socket.write(enableAlarmsAckBuf);
    } else if (dataCopy.equals(selectReqBuf)) {
      socket.write(selectRspBuf);
      setTimeout(() => {
        socket.write(estabCommCmdFromMachineBuf);
      }, 100);
    } else if (dataCopy.equals(alarmReportAckBuf)) {
      db.emit('ack', true);
    } else if (dataCopy.equals(deleteReportRequestBuf)) {
      // console.log('deleteReportRequestBuf');
      socket.write(deleteReportAckBuf);
    } else if (dataCopy.equals(defineReportRequestBuf)) {
      // console.log('defineReportRequestBuf');
      socket.write(defineReportAckBuf);
    } else if (dataCopy.equals(linkReportRequestBuf)) {
      // console.log('linkReportRequestBuf');
      socket.write(linkReportAckBuf);
    } else if (dataCopy.equals(eventEnableRequestBuf)) {
      // console.log('eventEnableRequestBuf');
      socket.write(eventEnableAckBuf);
    } else if ((dataCopy.length >= 16)
               && ((statusReqCmdBuf.compare(dataCopy, 4, 15, 4, 15) === 0)
                || (constReqCmdBuf.compare(dataCopy, 4, 15, 4, 15) === 0))) {
      if (statusReqCmdBuf.compare(dataCopy, 4, 15, 4, 15) === 0) {
        statusReqRspBuf.copy(respBuf);
      } else {
        constReqRspBuf.copy(respBuf);
      }
      const nItems = dataCopy.readUInt8(15);
      //      console.log(`nItems = ${nItems}`);
      respBuf.writeUInt8(nItems, 15);
      respBuf.writeUInt16BE(transactionId, 12);
      let iRespBuf = 16;
      for (let iItem = 0; iItem < nItems; iItem += 1) {
        const numericID = dataCopy.readUInt32BE(18 + (6 * iItem));
        //        console.log(`numericID = ${numericID}`);
        for (let iVar = 0; iVar < testMachine.variables.length; iVar += 1) {
          const variable = testMachine.variables[iVar];
          if (variable.numericID === numericID) {
            if (_.get(variable, 'array', false)) {
              switch (variable.format) {
                case 'int8':
                  respBuf.writeUInt8(0x64 + 1, iRespBuf);
                  respBuf.writeUInt8(variable.value.length, iRespBuf + 1);
                  iRespBuf += 2;
                  for (let iElem = 0; iElem < variable.value.length; iElem += 1) {
                    respBuf.writeInt8(variable.value[iElem], iRespBuf);
                    iRespBuf += 1;
                  }
                  break;
                // add more cases as required by test variables
                default:
              }
            } else {
              switch (variable.format) {
                case 'char':
                  respBuf.writeUInt8(0x40 + 1, iRespBuf);
                  respBuf.writeUInt8(variable.value.length, iRespBuf + 1);
                  respBuf.write(variable.value, iRespBuf + 2, variable.value.length, 'ascii');
                  iRespBuf += variable.value.length + 2;
                  break;
                case 'bool':
                  respBuf.writeUInt8(0x24 + 1, iRespBuf);
                  respBuf.writeUInt8(1, iRespBuf + 1);
                  respBuf.writeUInt8(variable.value ? 1 : 0, iRespBuf + 2);
                  iRespBuf += 3;
                  break;
                case 'int16':
                  respBuf.writeUInt8(0x68 + 1, iRespBuf);
                  respBuf.writeUInt8(2, iRespBuf + 1);
                  respBuf.writeInt16BE(variable.value, iRespBuf + 2);
                  iRespBuf += 4;
                  break;
                case 'float':
                  respBuf.writeUInt8(0x90 + 1, iRespBuf);
                  respBuf.writeUInt8(4, iRespBuf + 1);
                  respBuf.writeFloatBE(variable.value, iRespBuf + 2);
                  iRespBuf += 6;
                  break;
                // add more cases as required by test variables
                default:
              }
            }
          }
        }
      }
      socket.write(respBuf.slice(0, iRespBuf));
    } else if ((dataCopy.length >= 21)
               && (writeConstCmdBuf.compare(dataCopy, 4, 20, 4, 20) === 0)) {
      switch (dataCopy.readUInt8(22)) {
        case 0x25:
          db.emit('write', dataCopy.readUInt8(24) !== 0);
          break;
        case 0x41:
          db.emit('write', dataCopy.toString('ascii', 24, dataCopy.readUInt8(23) + 24));
          break;
        case 0x61:
        {
          const low = data.readInt32BE(28);
          let result = (data.readInt32BE(24) * 4294967296.0) + low;
          if (low < 0) result += 4294967296;
          db.emit('write', result);
          break;
        }
        case 0x65:
          db.emit('write', dataCopy.readInt8(24));
          break;
        case 0x69:
          db.emit('write', dataCopy.readInt16BE(24));
          break;
        case 0x71:
          db.emit('write', dataCopy.readInt32BE(24));
          break;
        case 0x81:
          db.emit('write', dataCopy.readDoubleBE(24));
          break;
        case 0x91:
          db.emit('write', dataCopy.readFloatBE(24));
          break;
        case 0xA1:
        {
          db.emit('write', (data.readUInt32BE(24) * 4294967296.0) + data.readUInt32BE(28));
          break;
        }
        case 0xA5:
          db.emit('write', dataCopy.readUInt8(24));
          break;
        case 0xA9:
          db.emit('write', dataCopy.readUInt16BE(24));
          break;
        case 0xB1:
          db.emit('write', dataCopy.readUInt32BE(24));
          break;
        default:
      }
      socket.write(writeConstAckBuf);
    }
  });
}).listen(testMachine.settings.model.port);

describe('Spark HPL SECS/GEM', () => {
  let sparkHplSecsGem;

  it('successfully create a new net hpl', (done) => {
    /* eslint new-cap: ["error", { "newIsCap": false }] */
    sparkHplSecsGem = new SparkHplSecsGem.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null, sparkAlert.getAlerter());
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplSecsGem.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplSecsGem.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('before a successful start the connection status should be false', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(false);
    return done();
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplSecsGem.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl SECS/GEM should produce data', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if (!_.get(variable, 'machineConnected', false)
       && ((variable.type === 'Status Variable (SV)') || (variable.type === 'Equipment Constant (EC)'))
       && (_.get(variable, 'access', 'read') === 'read')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === readVariables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('after a successful connection the connection status should be true', (done) => {
    sparkConfig.get(`machines:${testMachine.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`writing variable with format ${variable.format} should succeed`, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplSecsGem.writeData(value, (err) => {
          if (err) return done(err);
          db.removeAllListeners('write');
          return done();
        });
        db.on('write', (data) => {
          data.should.equal(variable.value);
        });
      });
    }
  });

  it('stop should succeed when passed valid inputs', (done) => {
    sparkHplSecsGem.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('update model should succeed with machine disabled', (done) => {
    sparkHplSecsGem.updateModel({
      enable: false,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('spark hpl SECS/GEM should produce data when re-enabled', (done) => {
    sparkHplSecsGem.updateModel({
      enable: true,
      ipAddress: os.hostname(),
      port: CLIENT_PORT,
      sparkDeviceID: 1,
      equipDeviceID: 0,
      requestFrequency: 1,
    }, (err) => {
      if (err) return done(err);
      const readVariables = [];
      const gotDataForVar = [];
      testMachine.variables.forEach((variable) => {
        if (!_.get(variable, 'machineConnected', false)
         && ((variable.type === 'Status Variable (SV)') || (variable.type === 'Equipment Constant (EC)'))
         && (_.get(variable, 'access', 'read') === 'read')) {
          readVariables.push(variable);
        }
      });
      db.on('data', (data) => {
        readVariables.forEach((variable) => {
          if (variable.name === data.variable) {
            if (gotDataForVar.indexOf(data.variable) === -1) {
              data[variable.name].should.eql(variable.value);
              gotDataForVar.push(data.variable);
              if (gotDataForVar.length === readVariables.length) {
                db.removeAllListeners('data');
                return done();
              }
            }
          }
          return undefined;
        });
      });
      return undefined;
    });
  });

  it('alarm variables should be set if an alarm report is received', (done) => {
    const alarmVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if ((variable.type === 'Active Alarm Codes') || (variable.type === 'Active Alarm Texts')) {
        alarmVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      //      console.log(`data.variable = ${data.variable}`);
      //      console.log(`data = ${JSON.stringify(data)}`);
      alarmVariables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            if (variable.type === 'Active Alarm Codes') {
              data[variable.name][0].should.eql(123);
            } else {
              data[variable.name][0].trim().should.eql('Test Alarm');
            }
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === alarmVariables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });

    //    console.log('sending alarm report:');
    //    dumpBuffer(alarmReportBuf);
    serverSocket.write(alarmReportBuf);
  });

  it('an alert should be raised and connection variables set false if the server is destroyed', (done) => {
    let alertRaised = false;
    let connectedVariableSet = false;
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('connectivity-alert');
      alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
      alert.description.should.equal('Unable to open connection. please verify the connection configuration');
      alertRaised = true;
      sparkAlert.removeAllListeners('raise');
      if (connectedVariableSet) return done();
      return undefined;
    });

    db.on('data', (data) => {
      if (data.variable === 'machineConnected') {
        data[data.variable].should.equal(false);
        connectedVariableSet = true;
        db.removeAllListeners('data');
        if (alertRaised) return done();
      }
      return undefined;
    });

    serverSocket.destroy();
  });

  it('update model should raise an alert if client port is incorrect', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('connectivity-alert');
      alert.msg.should.equal(`${testMachine.info.name}: Connection Error`);
      alert.description.should.equal('Unable to open connection. please verify the connection configuration');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkHplSecsGem.updateModel({
      enable: true,
      ipAddress: os.hostname(),
      port: CLIENT_PORT + 1,
    }, (err) => {
      if (err) return done(err);
      return undefined;
    });
  });
});
