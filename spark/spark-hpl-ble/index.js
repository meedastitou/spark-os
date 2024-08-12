const _ = require('lodash');
let nodeBle = require('node-ble');
const defaults = require('./defaults.json');
const schema = require('./schema.json');

const MAX_BAT_MV = 3200;

// constructor
const hplBLE = function hplBLE(log, machine, model, conf) {
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line global-require
    nodeBle = require('./test/ble-tester');
    this.bleTester = nodeBle;
  }

  // Private variables
  const that = this;
  let timer = null;
  let waitingPeriph; // last read peripheral
  const nbCommonVar = 3; // Number of common values for every ble devices

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


  // Private methods

  function getValueLE(variable, buffData) {
    let value;
    switch (variable.format) {
      case 'uint8':
        value = buffData.readUInt8(variable.addrOffset);
        break;
      case 'uint16':
        value = buffData.readUInt16LE(variable.addrOffset);
        break;
      case 'uint32':
        value = buffData.readUInt32LE(variable.addrOffset);
        break;
      default:
        value = null;
        break;
    }
    return value;
  }

  function getValueBE(variable, buffData) {
    let value;
    switch (variable.format) {
      case 'uint8':
        value = buffData.readUInt8(variable.addrOffset);
        break;
      case 'uint16':
        value = buffData.readUInt16BE(variable.addrOffset);
        break;
      case 'uint32':
        value = buffData.readUInt32BE(variable.addrOffset);
        break;
      default:
        value = null;
        break;
    }
    return value;
  }

  function getCommonValues(peripheral) {
    let value; let
      variable;
    for (let k = 0; k < nbCommonVar; k += 1) {
      variable = that.machine.variables[k];
      switch (variable.name) {
        case 'address_type':
          value = peripheral.addressType;
          break;
        case 'connectable':
          // This one is certainly not useful
          // (because we never connect to the peripheral)
          value = peripheral.connectable;
          break;
        case 'rssi':
          value = peripheral.rssi;
          break;
        default:
        {
          log.error('ERROR: variable name is wrong');
          return that.dataCb();
        }
      }
      that.dataCb(that.machine, variable, value);
    }
    return undefined;
  }

  function getValuesFromWac(buffData) {
    let value; let
      variable;
    for (let i = nbCommonVar; i < that.machine.variables.length; i += 1) {
      variable = that.machine.variables[i];
      switch (variable.name) {
        case 'part_num':
          value = Math.floor(buffData.readUInt8(variable.addrOffset + 4) / 10);
          value += `-${buffData.readUInt32LE(variable.addrOffset)}`;
          value += `-${buffData.readUInt8(variable.addrOffset + 4) % 10}`;
          break;
        case 'design_revision':
          value = String.fromCharCode(
            buffData.readUInt8(variable.addrOffset),
            buffData.readUInt8(variable.addrOffset + 1),
          );
          break;
        case 'manufacturer_ID':
          value = buffData.readUInt16BE(variable.addrOffset);
          break;
        case 'battery_level':
          value = buffData.readUInt16LE(variable.addrOffset);
          value = (value / MAX_BAT_MV) * 100; // get battery level as a percentage
          break;
        default:
          value = null;
          break;
      }
      if (value === null) {
        value = getValueLE(variable, buffData);
      }
      if (value === null) {
        // Should never happen
        log.info('----------ERROR wrong format in TE APP Count');
      }
      that.dataCb(that.machine, variable, value);
    }
  }

  function getValuesFromIndustrialWac(buffData) {
    let value; let
      variable;
    for (let j = nbCommonVar; j < that.machine.variables.length; j += 1) {
      variable = that.machine.variables[j];
      // should be by format (but many exception --| tpo discuss)
      if (variable.name !== 'design_revision') {
        value = getValueBE(variable, buffData);
        if (variable.format === 'uint32') {
          // eslint-disable-next-line no-bitwise
          value &= 0xffffff00;
        }
      } else {
        value = String.fromCharCode(
          buffData.readUInt8(variable.addrOffset),
          buffData.readUInt8(variable.addrOffset + 1),
        );
      }
      if (value === null) {
        // Should never happen
        log.info('----------ERROR wrong format in TEWac');
      }
      that.dataCb(that.machine, variable, value);
    }
  }

  function getValuesFromBasicMachine(buffData) {
    let value; let
      variable;
    for (let i = nbCommonVar; i < that.machine.variables.length; i += 1) {
      variable = that.machine.variables[i];
      value = getValueLE(variable, buffData);
      that.dataCb(that.machine, variable, value);
    }
  }


  function readTimer() {
    if (waitingPeriph === undefined) return;
    getCommonValues(waitingPeriph);
    const advert = waitingPeriph.advertisement;
    if (advert.localName === 'TE Applicator Count') {
      getValuesFromWac(advert.manufacturerData);
    } else if (advert.localName === 'TEWac') {
      getValuesFromIndustrialWac(advert.manufacturerData);
    } else {
      // basic machine is supposed to have numeric variables only, and
      // the variable length  should be exactly on 1, 2 or 4 bytes
      // and the format should be in Little Endian
      getValuesFromBasicMachine(advert.manufacturerData);
    }
  }

  /* Callback function to get list from sparkBTLE module */
  function readList(list) {
    updateConnectionStatus(true);
    // Listen to one specific WAC
    const { address } = that.machine.settings.model;
    if (list[address] !== undefined) {
      if (list[address].id === address) {
        if (address === undefined) {
          log.error('ID UNDEFINED');
          // return;
        }
        if (!list[address].advertisement.manufacturerData) {
          log.error('WAC should have manufacturer data');
          return;
        }

        waitingPeriph = list[address];
      }
    } else {
      waitingPeriph = undefined;
    }
  }

  // Privileged methods

  this.start = function start(dataCb, configUpdateCb, done) {
    updateConnectionStatus(false);

    if (typeof dataCb !== 'function') {
      return done('dataCb not a function');
    }
    if (!that.machine) {
      return done('machine undefined');
    }
    that.dataCb = dataCb;

    if (typeof configUpdateCb !== 'function') {
      return done('configUpdateCb not a function');
    }
    that.configUpdateCb = configUpdateCb;

    // check if the machine is enabled
    if (!that.machine.settings.model.enable) {
      log.debug(`${machine.info.name} Disabled`);
      return done(null);
    }

    nodeBle.start();
    nodeBle.on('newList', (list) => {
      readList(list);
    });

    timer = setInterval(readTimer,
      that.machine.settings.model.updateRate * 1000);
    return done(null);
  };

  this.stop = function stop(done) {
    updateConnectionStatus(false);

    if (!that.machine) {
      return done('machine undefined');
    }
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    nodeBle.removeListener('newList', () => {
      log.info('Stopped listening for BTLE devices.');
    });

    nodeBle.stop();
    log.debug('Stopped');
    return done(null);
  };

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop((err) => {
      if (err) return done(err);
      that.start(that.dataCb, that.configUpdateCb, startErr => done(startErr));
      return undefined;
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
  hpl: hplBLE,
  defaults,
  schema,
};
