/* jshint esversion: 6 */
// eslint-disable-next-line import/no-extraneous-dependencies
require('chai').should();
const { EventEmitter } = require('events');
// eslint-disable-next-line import/no-extraneous-dependencies
const bunyan = require('bunyan');
const pkg = require('../package.json');
const SparkHplBle = require('../index.js');

const MACHINE_ADDRESS = '1';

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});


const testMachineWac = {
  info: {
    name: 'test-machine-wac',
    fullname: 'Test Machine Wac',
    version: '1.0.0',
    description: 'Test Machine Wac',
    hpl: 'ble',
  },
  settings: {
    model: {
      enable: false,
      updateRate: 0.1,
      address: MACHINE_ADDRESS,
      publishDisabled: false,
      connectionStatus: false,
    },
  },
  variables: [{
    name: 'address_type',
    description: 'Address Type',
    format: 'char',
    value: 'bin',
  },
  {
    name: 'connectable',
    description: 'Connectable',
    format: 'bool',
    value: true,
  },
  {
    name: 'rssi',
    description: 'RSSI',
    format: 'char',
    value: 'RSSI',
  },
  {
    name: 'part_num',
    description: 'Part Number',
    format: 'char',
    addrOffset: 0,
    value: '1-12345-0',
  },
  {
    name: 'design_revision',
    description: 'Design Revision',
    format: 'char',
    addrOffset: 5,
    value: 'A1',
  },
  {
    name: 'manufacturer_ID',
    description: 'Manufacture ID',
    format: 'uint16',
    addrOffset: 7,
    value: 1234,
  },
  {
    name: 'battery_level',
    description: 'Battery Level',
    format: 'uint16',
    addrOffset: 9,
    value: 90,
  },
  {
    name: 'uint8_test',
    description: 'UInt8 Test',
    format: 'uint8',
    addrOffset: 11,
    value: 234,
  },
  {
    name: 'uint16_test',
    description: 'UInt16 Test',
    format: 'uint16',
    addrOffset: 12,
    value: 3456,
  },
  {
    name: 'uint32_test',
    description: 'UInt32 Test',
    format: 'uint32',
    addrOffset: 14,
    value: 45678,
  },
  {
    name: 'float_test',
    description: 'Float Test',
    format: 'float',
    addrOffset: 18,
    value: null,
  },
  ],
};

const testMachineIndustrialWac = {
  info: {
    name: 'test-machine-industrial-wac',
    fullname: 'Test Machine Industrial Wac',
    version: '1.0.0',
    description: 'Test Machine Industrial Wac',
    hpl: 'ble',
  },
  settings: {
    model: {
      enable: true,
      updateRate: 0.1,
      address: MACHINE_ADDRESS,
      publishDisabled: false,
      connectionStatus: false,
    },
  },
  variables: [{
    name: 'address_type',
    description: 'Address Type',
    format: 'char',
    value: 'bin',
  },
  {
    name: 'connectable',
    description: 'Connectable',
    format: 'bool',
    value: true,
  },
  {
    name: 'rssi',
    description: 'RSSI',
    format: 'char',
    value: 'RSSI',
  },
  {
    name: 'design_revision',
    description: 'Design Revision',
    format: 'char',
    addrOffset: 5,
    value: 'A1',
  },
  {
    name: 'uint8_test',
    description: 'UInt8 Test',
    format: 'uint8',
    addrOffset: 11,
    value: 234,
  },
  {
    name: 'uint16_test',
    description: 'UInt16 Test',
    format: 'uint16',
    addrOffset: 12,
    value: 3456,
  },
  {
    name: 'uint32_test',
    description: 'UInt32 Test',
    format: 'uint32',
    addrOffset: 14,
    value: 0x123400,
  },
  ],
};

const testMachineBasic = {
  info: {
    name: 'test-machine-basic',
    fullname: 'Test Machine Basic',
    version: '1.0.0',
    description: 'Test Machine Basic',
    hpl: 'ble',
  },
  settings: {
    model: {
      enable: true,
      updateRate: 0.1,
      address: MACHINE_ADDRESS,
      publishDisabled: false,
      connectionStatus: false,
    },
  },
  variables: [{
    name: 'address_type',
    description: 'Address Type',
    format: 'char',
    value: 'bin',
  },
  {
    name: 'connectable',
    description: 'Connectable',
    format: 'bool',
    value: true,
  },
  {
    name: 'rssi',
    description: 'RSSI',
    format: 'char',
    value: 'RSSI',
  },
  {
    name: 'uint8_test',
    description: 'UInt8 Test',
    format: 'uint8',
    addrOffset: 11,
    value: 234,
  },
  {
    name: 'uint16_test',
    description: 'UInt16 Test',
    format: 'uint16',
    addrOffset: 12,
    value: 3456,
  },
  {
    name: 'uint32_test',
    description: 'UInt32 Test',
    format: 'uint32',
    addrOffset: 14,
    value: 45678,
  },
  ],
};

const testList = {};

const wacBuffer = Buffer.allocUnsafe(20);
wacBuffer.writeUInt8(10, 4);
wacBuffer.writeUInt32LE(12345, 0);
wacBuffer.writeUInt8(0x41, 5);
wacBuffer.writeUInt8(0x31, 6);
wacBuffer.writeUInt16BE(1234, 7);
wacBuffer.writeUInt16LE(0.9 * 3200, 9);
wacBuffer.writeUInt8(234, 11);
wacBuffer.writeUInt16LE(3456, 12);
wacBuffer.writeUInt32LE(45678, 14);

const wacPeriph = {
  id: MACHINE_ADDRESS,
  advertisement: {
    manufacturerData: wacBuffer,
    localName: 'TE Applicator Count',
  },
  addressType: 'bin',
  connectable: true,
  rssi: 'RSSI',
};

const wacIndBuffer = Buffer.allocUnsafe(20);
wacIndBuffer.writeUInt8(0x41, 5);
wacIndBuffer.writeUInt8(0x31, 6);
wacIndBuffer.writeUInt8(234, 11);
wacIndBuffer.writeUInt16BE(3456, 12);
wacIndBuffer.writeUInt32BE(0x123400, 14);

const wacIndPeriph = {
  id: MACHINE_ADDRESS,
  advertisement: {
    manufacturerData: wacIndBuffer,
    localName: 'TEWac',
  },
  addressType: 'bin',
  connectable: true,
  rssi: 'RSSI',
};

const basicBuffer = Buffer.allocUnsafe(20);
basicBuffer.writeUInt8(234, 11);
basicBuffer.writeUInt16LE(3456, 12);
basicBuffer.writeUInt32LE(45678, 14);

const basicPeriph = {
  id: MACHINE_ADDRESS,
  advertisement: {
    manufacturerData: basicBuffer,
    localName: 'Basic',
  },
  addressType: 'bin',
  connectable: true,
  rssi: 'RSSI',
};

testList[MACHINE_ADDRESS] = wacPeriph;

const db = new EventEmitter();

function dataCb(machine, variable, value) {
  const data = {
    machine: machine.info.name,
    variable: variable.name,
  };
  data[variable.name] = value;
  log.debug({ data });
  db.emit('data', data);
}

function configUpdateCb(machine, done) {
  log.debug({ machine });
  return done(null);
}

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

describe('SPARK HPL BLE', () => {
  let sparkHplBle;

  it('successfully create a new ble machine for wac', (done) => {
    // eslint-disable-next-line new-cap
    sparkHplBle = new SparkHplBle.hpl(log.child({
      machine: testMachineWac.info.name,
    }), testMachineWac, testMachineWac.settings.model, sparkConfig);
    return done();
  });

  it('start should error when datacb is not a function', (done) => {
    sparkHplBle.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplBle.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('before a successfull start the connection status should be false', (done) => {
    sparkConfig.get(`machines:${testMachineWac.info.name}:settings:model:connectionStatus`).should.equal(false);
    return done();
  });

  it('start should succeed with machine disabled', (done) => {
    sparkHplBle.start(dataCb, configUpdateCb, (err) => {
      if (err) return done();
      return done();
    });
  });

  it('update model should succeed with machine enabled', (done) => {
    sparkHplBle.updateModel({
      enable: true,
      updateRate: 0.1,
      address: MACHINE_ADDRESS,
      publishDisabled: false,
      connectionStatus: false,
    }, (err) => {
      if (err) return done();
      return done();
    });
  });

  it('after emitting a list the connection status should be true', (done) => {
    sparkHplBle.bleTester.emit('newList', testList);
    sparkConfig.get(`machines:${testMachineWac.info.name}:settings:model:connectionStatus`).should.equal(true);
    return done();
  });

  it('the ble machine should produce valid variable values for wac peripheral', (done) => {
    const gotDataForVar = [];
    db.on('data', (data) => {
      testMachineWac.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            if (variable.value === null) {
              (data[variable.name] === null).should.equal(true);
            } else {
              data[variable.name].should.eql(variable.value);
            }
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachineWac.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
  });

  it('stop should succeed', (done) => {
    sparkHplBle.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new ble machine for wac industrial', (done) => {
    // eslint-disable-next-line new-cap
    sparkHplBle = new SparkHplBle.hpl(log.child({
      machine: testMachineIndustrialWac.info.name,
    }), testMachineWac, testMachineIndustrialWac.settings.model, sparkConfig);
    return done();
  });

  it('start should succeed with machine enabled', (done) => {
    sparkHplBle.start(dataCb, configUpdateCb, (err) => {
      if (err) return done();
      return done();
    });
  });

  it('the ble machine should produce valid variable values for wac industrial peripheral', (done) => {
    const gotDataForVar = [];
    testList[MACHINE_ADDRESS] = wacIndPeriph;
    db.on('data', (data) => {
      testMachineIndustrialWac.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachineIndustrialWac.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
    sparkHplBle.bleTester.emit('newList', testList);
  });

  it('stop should succeed', (done) => {
    sparkHplBle.stop((err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('successfully create a new ble machine for a basic machine', (done) => {
    // eslint-disable-next-line new-cap
    sparkHplBle = new SparkHplBle.hpl(log.child({
      machine: testMachineBasic.info.name,
    }), testMachineWac, testMachineBasic.settings.model, sparkConfig);
    return done();
  });

  it('start should succeed with machine enabled', (done) => {
    sparkHplBle.start(dataCb, configUpdateCb, (err) => {
      if (err) return done();
      return done();
    });
  });

  it('the ble machine should produce valid variable values for wac industrial peripheral', (done) => {
    const gotDataForVar = [];
    testList[MACHINE_ADDRESS] = basicPeriph;
    db.on('data', (data) => {
      testMachineBasic.variables.forEach((variable) => {
        if (variable.name === data.variable) {
          if (gotDataForVar.indexOf(data.variable) === -1) {
            data[variable.name].should.eql(variable.value);
            gotDataForVar.push(data.variable);
            if (gotDataForVar.length === testMachineBasic.variables.length) {
              db.removeAllListeners('data');
              return done();
            }
          }
        }
        return undefined;
      });
    });
    sparkHplBle.bleTester.emit('newList', testList);
  });
});
