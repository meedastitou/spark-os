/* jshint esversion: 6 */
/* eslint no-bitwise: ["error", { "allow": ["&", "<<"] }] */
const _ = require('lodash');
const async = require('async');
let ads = require('node-ads');
const os = require('os');
const defaults = require('./defaults.json');
const schema = require('./schema.json');

let variableFormatArray;
let variableArrayLengthArray;
let variableLengthArray;
let variableNameArray;
let handleArray;

let multiReadHandles = null;
let readActiveFlag = false;
// let lastReadTimestamp = 0;
// let currentReadTimestamp = 0;
// let readRequestTimestamp = 0;

const deliverEntireResultVariable = {
  name: 'CombinedResult',
  description: 'CombinedResult',
  format: 'char',
  array: true,
};

// constructor
const hplBeckhoffADS = function hplBeckhoffADS(log, machine, model, conf, db, alert) {
  // if running test harness, get Beckhoff ADS tester
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line global-require
    ads = require('./test/beckhoff-ads-tester');
    this.tester = ads;
    // get fake network addresses to test auto local AMS address code
    os.networkInterfaces = ads.networkInterfaces;
  }

  // preload alert messages that have known keys
  alert.preLoad({
    'configuration-error': {
      msg: `${machine.info.name}: Configuration Error`,
      description: x => `Cannot start due to invalid configuration. Error: ${x.errorMsg}.`,
    },
    'connection-error': {
      msg: `${machine.info.name}: Connection Error`,
      description: x => `Failed to connect to remote plc. Error: ${x.errorMsg}. Check addresses are correct and that Spark has been added as a route on the remote plc`,
    },
    'connection-issue': {
      msg: `${machine.info.name}: Connection Issue`,
      description: x => `Connection issue with remote plc. Error: ${x.errorMsg}. Attempting to re-connect`,
    },
    'db-add-error': {
      msg: `${machine.info.name}: Database Add Error`,
      description: x => `Error adding to the database. Error: ${x.errorMsg}`,
    },
  });

  // Private variables
  const that = this;
  let timer = null;
  let client = null;
  let variableReadArray = [];
  let destVariables = [];
  let variablesWriteObj = {};
  let requestFrequencyMs;
  let ipAddress;
  let amsAddress;
  let amsPort;
  let localAmsAddress;
  let connecting = false;
  let previousComms = false;
  let disconnectedTimer = null;
  let connectionReported = false;
  let requestingRestart = false;

  const RESTART_REQUEST_TIME = 10 * 1000;

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  // if old automatic local AMS address checkbox was set, try to calculate the local AMS address and save it
  if (_.has(that.machine.settings.model, 'autoLocalAmsAddress') && that.machine.settings.model.autoLocalAmsAddress) {
    // get all network interfaces
    const networks = os.networkInterfaces();
    const networkIPAddresses = [];
    Object.keys(networks).forEach((key) => {
      // get only ethx addresses with IPv4 addresses
      const network = networks[key];
      if (key.startsWith('eth')) {
        for (let iAddr = 0; iAddr < network.length; iAddr += 1) {
          const addr = network[iAddr];
          if (_.has(addr, 'family') && _.has(addr, 'address') && _.has(addr, 'netmask') && (addr.family === 'IPv4')) {
            networkIPAddresses.push({ name: key, address: addr.address, netmask: addr.netmask });
          }
        }
      }
    });
    // if one network address use it
    if (networkIPAddresses.length === 1) {
      that.machine.settings.model.localAmsAddress = `${networkIPAddresses[0].address}.1.1`;
    } else if (networkIPAddresses.length !== 0) {
      // if more than one address, find the one on the same subnet as the slave IP address
      let localAmsAddressFound = false;
      if (validateIPaddress(that.machine.settings.model.ipAddress)) {
        const slaveIPInt = ipToInt(that.machine.settings.model.ipAddress);
        for (let iIP = 0; iIP < networkIPAddresses.length; iIP += 1) {
          const netIPInt = ipToInt(networkIPAddresses[iIP].address);
          const netMaskInt = ipToInt(networkIPAddresses[iIP].netmask);
          if ((slaveIPInt & netMaskInt) === (netIPInt & netMaskInt)) {
            that.machine.settings.model.localAmsAddress = `${networkIPAddresses[iIP].address}.1.1`;
            localAmsAddressFound = true;
            break;
          }
        }
      }

      // if the local AMS address not found yet, used the ethx address with the smallest x
      if (!localAmsAddressFound) {
        let minEthx = parseInt(networkIPAddresses[0].name.substring(3), 10);
        let iMinEthx = 0;
        for (let iIP = 1; iIP < networkIPAddresses.length; iIP += 1) {
          const ethx = parseInt(networkIPAddresses[iIP].name.substring(3), 10);
          if (ethx < minEthx) {
            minEthx = ethx;
            iMinEthx = iIP;
          }
        }
        that.machine.settings.model.localAmsAddress = `${networkIPAddresses[iMinEthx].address}.1.1`;
      }
    }

    // clear  the local AMS address flag
    that.machine.settings.model.autoLocalAmsAddress = false;

    // save the changes to the model if we have a configuration callback
    conf.set(`machines:${that.machine.info.name}`, that.machine, () => {
    });
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  // private methods
  function ipToInt(ipString) {
    let intVal = 0;
    const split = ipString.split('.');
    for (let iSplit = 0; iSplit < split.length; iSplit += 1) {
      intVal = (intVal << 8) + parseInt(split[iSplit], 10);
    }
    return intVal;
  }

  function validateIPaddress(ipaddress) {
    /* eslint max-len: ["error", { "code": 300 }] */
    if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ipaddress)) {
      return true;
    }
    return false;
  }

  function validateAMSaddress(amsaddress) {
    /* eslint max-len: ["error", { "code": 300 }] */
    if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(amsaddress)) {
      return true;
    }
    return false;
  }

  function reconnectionHelper(errorMessage) {
    /* eslint no-use-before-define: ["error", { "functions": false }] */

    // console.log(`------reconnectionHelper.  errorMessage = ${errorMessage}`);

    // prevent multiple simultaneous attempts at reconnecting
    if (!connecting) {
      log.info('Disconnected. Attempting to re-connect');
      connecting = true;

      // raise connection issue alert
      alert.raise({ key: 'connection-issue', errorMsg: errorMessage });

      // disable reads until reconnected
      if (timer) {
        // console.log('---------------clearing timer - reconnectionHelper');
        clearInterval(timer);
        timer = null;
      }

      multiReadHandles = null;

      // call client.end() in timer function to prevent stack blow-up due to recursion
      // console.log('--------setting timeout for disconnecting / reconnecting');
      setTimeout(() => {
        // console.log('--------checking client');
        if (client) {
          if (_.has(client, 'machineConnected')) {
            // console.log('--------calling client.endNoHandles()');
            client.endNoHandles(() => {
              // console.log('--------client.endNoHandles callback - calling ads.connect');
              client = ads.connect({
                host: ipAddress,
                amsNetIdTarget: amsAddress,
                amsNetIdSource: localAmsAddress,
                amsPortTarget: amsPort,
              }, () => {
                // console.log('--------ads.connect callback');
                log.info('Re-Connected');
                connectionDetected();
                updateConnectionStatus(true);
                connecting = false;

                // clear connection issue alert
                alert.clear('connection-issue');

                // restart read timer
                timer = setInterval(readTimer, requestFrequencyMs);
              });
              client.on('error', handleError);
              client.on('timeout', handleTimeout);
            });
          } else {
            // console.log('--------no endNoHandles - calling ads.connect');
            client = ads.connect({
              host: ipAddress,
              amsNetIdTarget: amsAddress,
              amsNetIdSource: localAmsAddress,
              amsPortTarget: amsPort,
            }, () => {
              // console.log('--------ads.connect callback');
              log.info('Re-Connected');
              connectionDetected();
              updateConnectionStatus(true);
              connecting = false;

              // clear connection issue alert
              alert.clear('connection-issue');

              // restart read timer
              timer = setInterval(readTimer, requestFrequencyMs);
            });
            client.on('error', handleError);
            client.on('timeout', handleTimeout);
          }
        }
      }, 100);
    } else {
      log.info('reconnectionHelper bailed, as already attempting reconnect');
    }
  }

  function handleTimeout(error) {
    // handle timeouts from tcp (timeout is not set, so will not get these currently)
    log.error(`tcp timeout error: ${error.message}`);
  }

  function handleError(error) {
    // if error has come via tcp dirrectly
    if ((error.code === 'EHOSTUNREACH') || (error.code === 'ECONNRESET') || (error.code === 'EPIPE')) {
      // attempt to re-connect (force it to attempt to reconnect by setting flag )
      disconnectionDetected();
      updateConnectionStatus(false);
      connecting = false;
      reconnectionHelper(error.message);
    } else if (!requestingRestart) {
      // otherwise likely to come from ADS response  e.g 'target machine not found' due to wrong host AMS address
      // so alert user and do not try and reconnected
      requestingRestart = true;
      // console.log(`-------handleError: error = ${JSON.stringify(error)}`);
      if (timer) {
        // console.log('---------------clearing timer - handleError');
        clearInterval(timer);
        timer = null;
      }

      // wait, then request a restart of the machine
      that.stop(() => {
        // console.log('!!!!!!!!!!!!!!!! handleError');
        alert.raise({ key: 'connection-error', errorMsg: error.message });
        disconnectionDetected();
        updateConnectionStatus(false);

        setTimeout(() => {
          requestingRestart = false;
          that.start(that.dataCb, that.configUpdateCb, (err) => {
            if (err) {
              log.info(`Error requesting restart: ${err.message}`);
            } else {
              log.info('Requested restart completed');
            }
          });
        }, RESTART_REQUEST_TIME);
      });
    }
  }

  function disconnectionDetected() {
    // ingore disconectiong if already know disconnected
    if (disconnectedTimer) return;

    // start a timer to set any machine connected variables to false
    disconnectedTimer = setTimeout(() => {
      disconnectedTimer = null;
      connectionReported = false;
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

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function readAll(variableArray, done) {
    const resultsArray = [];
    let result = [];
    // itterate through each variable given in the config file
    async.forEachOfSeries(variableArray, (variable, index, callback) => {
      // calculate the variable's read length based on its format
      let length;
      let arrayLength;
      if (variable.format === 'char') {
        length = (variable.length === undefined ? 1 : variable.length);
        arrayLength = 1;
      } else if ((variable.format === 'uint8') || (variable.format === 'int8') || (variable.format === 'bool')) {
        arrayLength = (variable.length === undefined ? 1 : variable.length);
        length = 1;
      } else if ((variable.format === 'uint16') || (variable.format === 'int16')) {
        arrayLength = (variable.length === undefined ? 1 : variable.length);
        length = 2;
      } else if ((variable.format === 'uint32') || (variable.format === 'int32') || (variable.format === 'float')) {
        arrayLength = (variable.length === undefined ? 1 : variable.length);
        length = 4;
      } else if (variable.format === 'double') {
        arrayLength = (variable.length === undefined ? 1 : variable.length);
        length = 8;
      } else {
        // unsupported format create a variable specific alert
        alert.raise({
          key: `var-read-error-${variable.name}`,
          msg: `${machine.info.name}: Error Reading Variable`,
          description: `Unsupported format for variable ${variable.name}. Read will not be attempted.`,
        });
        resultsArray.push(null);
        callback();
        return;
      }

      // create a handle for this variable
      let varReadHandle;
      if (_.get(variable, 'useGroupOffsetMethod', false)) {
        const indexGroupDecimal = parseInt(variable.indexGroup, 16);
        const indexOffsetDecimal = parseInt(variable.indexOffset, 16);
        varReadHandle = {
          indexGroup: indexGroupDecimal,
          indexOffset: indexOffsetDecimal,
          bytelength: length * arrayLength,
          propname: 'value',
        };
      } else {
        varReadHandle = {
          symname: variable.adsAddressName,
          bytelength: length * arrayLength,
          propname: 'value',
        };
      }

      let timeoutCount = 0;
      let doneFlag = false;
      let returnedErr = null;
      async.whilst(
        () => ((timeoutCount < 3) && (doneFlag === false)),
        (callback2) => {
          if (client) {
            // console.log(`-------calling client.read for ${variable.name}`);
            client.read(varReadHandle, (err, handle) => {
              if (err) {
                // NOTE: some errors back from read function are not Error objects, just strings
                if (err === 'timeout') {
                  // console.log('!!!!!!!!!!!!! client.read err = ' + JSON.stringify(err));
                  log.info('timeout on read');
                  // if a timeout occurs it means we have connection problems, bail out of async loop
                  returnedErr = err;
                  timeoutCount += 1;
                  callback2(null);
                } else {
                  // else the error has come from the remote host
                  // raise a read alert for this variable
                  let alertDescription = `Read error for ${variable.name}. ${err}.`;
                  if ((Object.prototype.hasOwnProperty.call(err, 'message')) && (err.message === 'symbol not found')) {
                    previousComms = true;
                    // be more specific for 'address not found' errors
                    alertDescription = `Address name not found for variable ${variable.name}. Make sure the variable's address name is set correctly.`;
                  }
                  alert.raise({
                    key: `var-read-error-${variable.name}`,
                    msg: `${machine.info.name}: Error Reading Variable`,
                    description: alertDescription,
                  });
                  resultsArray.push(null);
                  doneFlag = true;
                  callback2(null);
                }
              } else {
                // we have succesfully read data from the host
                previousComms = true;
                alert.clear('connection-error');

                // try/catch here as Buffer reads can throw if not enough data is there
                try {
                  result = [];
                  // get data ready for database based on the format returned
                  if (variable.format === 'char') {
                    // extract as ascii string
                    const data = handle.value.toString('ascii', 0, length);
                    resultsArray.push(_.trimEnd(data, '\u0000'));
                  } else if (variable.format === 'uint8') {
                    if (arrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / length); i += 1) {
                        result.push(handle.value.readUInt8(i));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readUInt8(0));
                    }
                  } else if (variable.format === 'uint16') {
                    if (arrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / length); i += 1) {
                        result.push(handle.value.readUInt16LE(i * 2));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readUInt16LE(0));
                    }
                  } else if (variable.format === 'uint32') {
                    if (arrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / length); i += 1) {
                        result.push(handle.value.readUInt32LE(i * 4));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readUInt32LE(0));
                    }
                  } else if (variable.format === 'int8') {
                    if (arrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / length); i += 1) {
                        result.push(handle.value.readInt8(i));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readInt8(0));
                    }
                  } else if (variable.format === 'int16') {
                    if (arrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / length); i += 1) {
                        result.push(handle.value.readInt16LE(i * 2));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readInt16LE(0));
                    }
                  } else if (variable.format === 'int32') {
                    if (arrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / length); i += 1) {
                        result.push(handle.value.readInt32LE(i * 4));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readInt32LE(0));
                    }
                  } else if (variable.format === 'float') {
                    if (arrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / length); i += 1) {
                        result.push(handle.value.readFloatLE(i * 4));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readFloatLE(0));
                    }
                  } else if (variable.format === 'double') {
                    if (arrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / length); i += 1) {
                        result.push(handle.value.readDoubleLE(i * 8));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readDoubleLE(0));
                    }
                  } else if (variable.format === 'bool') {
                    if (arrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / length); i += 1) {
                        result.push(handle.value.readUInt8(i) !== 0);
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readUInt8(0) !== 0);
                    }
                  } else {
                    throw new Error('Unsupported Format');
                  }
                  // clear variable read alert
                  alert.clear(`var-read-error-${variable.name}`);
                } catch (exception) {
                  let alertDescription = `Unknown read error for variable ${variable.name}.`;
                  if (exception.message === 'Index out of range') {
                    alertDescription = `Not enough data returned for variable ${variable.name}. Make sure the variable's format is set correctly.`;
                  } else if (exception.message === 'Unsupported Format') {
                    alertDescription = `Unsupported format for variable ${variable.name}. Make sure the variable's format is set correctly.`;
                  }
                  alert.raise({
                    key: `var-read-error-${variable.name}`,
                    msg: `${machine.info.name}: Error Reading Variable`,
                    description: alertDescription,
                  });
                  // write null to results array as there is no data for this variable
                  resultsArray.push(null);
                }
                // move on to next item
                doneFlag = true;
                callback2(null);
              }
            });
          } else {
            doneFlag = true;
            callback2(null);
          }
        },
        (err) => {
          if (err) {
            callback(err);
          } else if (!doneFlag) {
            callback(new Error(returnedErr));
          } else {
            if (timeoutCount > 0) {
              // console.log(`--------retrieved data after ${timeoutCount} timeouts`);
            }
            callback(null);
          }
        },
      );
    }, (err) => {
      if (err) {
        // can get the timeout error from read either because the ADS is ignoring us (wrong ADS address)
        // or because the connection has been lost (e.g. enet unplugged) we want to treat the two cases
        // differently so we have a flag to help us choose the correct action
        if (previousComms === true) {
          // attempt to re-connect if we previously had success reading/writing
          reconnectionHelper(err.message);
        } else {
          // create a connection alert and don't attempt re-connect
          //          if (client) client.end();
          //          if (timer) clearInterval(timer);
          // console.log('---------------checking timer');
          if (timer) {
            clearInterval(timer);
            // console.log('---------------setting new timer');
            timer = setInterval(readTimer, requestFrequencyMs);
          }
          // console.log('!!!!!!!!!!!!!!!! readAll: err = ' + JSON.stringify(err));
          alert.raise({ key: 'connection-error', errorMsg: 'Timeout on Data Read attempt' });
        }
      }
      done(err, resultsArray);
    });
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function readAllMulti(variableArray, done) {
    //    const numberToMultiRead = that.machine.settings.model.multiReadRequestCount;

    const resultsArray = [];
    let result = [];
    let readNumber = 0;

    // itterate through each variable given in the config file
    async.forEachOfSeries(variableArray, (variable, index, callback) => {
      // calculate the variable's read length based on its format
      if (readNumber === 0) {
        variableFormatArray = [];
        variableArrayLengthArray = [];
        variableLengthArray = [];
        variableNameArray = [];
        handleArray = [];
      }

      let length;
      let arrayLength;
      if (variable.format === 'char') {
        length = (variable.length === undefined ? 1 : variable.length);
        arrayLength = 1;
      } else if ((variable.format === 'uint8') || (variable.format === 'int8') || (variable.format === 'bool')) {
        arrayLength = (variable.length === undefined ? 1 : variable.length);
        length = 1;
      } else if ((variable.format === 'uint16') || (variable.format === 'int16')) {
        arrayLength = (variable.length === undefined ? 1 : variable.length);
        length = 2;
      } else if ((variable.format === 'uint32') || (variable.format === 'int32') || (variable.format === 'float')) {
        arrayLength = (variable.length === undefined ? 1 : variable.length);
        length = 4;
      } else if (variable.format === 'double') {
        arrayLength = (variable.length === undefined ? 1 : variable.length);
        length = 8;
      } else {
        // unsupported format create a variable specific alert
        alert.raise({
          key: `var-read-error-${variable.name}`,
          msg: `${machine.info.name}: Error Reading Variable`,
          description: `Unsupported format for variable ${variable.name}. Read will not be attempted.`,
        });
        callback(new Error('Unsupported format'));
        return;
      }
      variableFormatArray.push(variable.format);
      variableArrayLengthArray.push(arrayLength);
      variableLengthArray.push(length);
      variableNameArray.push(variable.name);

      // create a handle for this variable
      let varReadHandle;
      if (_.get(variable, 'useGroupOffsetMethod', false)) {
        varReadHandle = {
          indexGroup: variable.indexGroup,
          indexOffset: variable.indexOffset,
          bytelength: length * arrayLength,
        };
      } else {
        varReadHandle = {
          symname: variable.adsAddressName,
          bytelength: length * arrayLength,
        };
      }
      handleArray.push(varReadHandle);
      readNumber += 1;
      callback(null);
    }, (err) => {
      if (err) {
        done(err, null);
      } else if (client) {
        if (!multiReadHandles) {
          // console.log('-------getting handles');
          client.getHandles(handleArray, (multiReadErr, handles) => {
            if (multiReadErr) {
              // console.log('-------error getting handles');
              // NOTE: some errors back from read function are not Error objects, just strings
              if (multiReadErr === 'timeout') {
                log.info('timeout on read');
                // can get the timeout error from read either because the ADS is ignoring us (wrong ADS address)
                // or because the connection has been lost (e.g. enet unplugged) we want to treat the two cases
                // differently so we have a flag to help us choose the correct action
                if (previousComms === true) {
                  // attempt to re-connect if we previously had success reading/writing
                  reconnectionHelper(multiReadErr.message);
                } else {
                  // create a connection alert and don't attempt re-connect
                  if (client) client.end();
                  if (timer) {
                    // console.log('---------------clearing timer - readAllMulti');
                    clearInterval(timer);
                    timer = null;
                  }
                  // console.log('!!!!!!!!!!!!!!!! readAllMulti: multiReadErr = ' + JSON.stringify(multiReadErr));
                  alert.raise({ key: 'connection-error', errorMsg: 'Timeout on Data Read attempt' });
                }
              } else {
                // else the error has come from the remote host
                // raise a read alert for this variable
                let alertDescription = 'Multi read error: ';
                if (Object.prototype.hasOwnProperty.call(multiReadErr, 'message')) {
                  previousComms = true;
                  // be more specific for 'address not found' errors
                  alertDescription += multiReadErr.message;
                }
                alert.raise({
                  key: 'multiRead-error',
                  msg: `${machine.info.name}: Error Reading Variables`,
                  description: alertDescription,
                });
              }
              done(new Error(multiReadErr), null);
            } else {
              // console.log('-------getting handles successful');
              // lastReadTimestamp = new Date();
              previousComms = true;
              multiReadHandles = handles;
              done(new Error('initial handle read - no data yet'), null);
            }
          });
        } else {
          // console.log('-------multiReadWithExistingHandles');
          // readRequestTimestamp = new Date();
          client.multiReadWithExistingHandles(multiReadHandles, (multiReadErr, handles) => {
            if (multiReadErr) {
              // console.log('-------multiReadWithExistingHandles error');
              // NOTE: some errors back from read function are not Error objects, just strings
              if (multiReadErr === 'timeout') {
                log.info('timeout on read');
                // attempt to re-connect, since we previously had success reading/writing
                reconnectionHelper(multiReadErr.message);
              } else {
                // else the error has come from the remote host
                // raise a read alert for this variable
                let alertDescription = 'Multi read error: ';
                if (Object.prototype.hasOwnProperty.call(multiReadErr, 'message')) {
                  previousComms = true;
                  // be more specific for 'address not found' errors
                  alertDescription += multiReadErr.message;
                }
                alert.raise({
                  key: 'multiRead-error',
                  msg: `${machine.info.name}: Error Reading Variables`,
                  description: alertDescription,
                });
              }
              done(new Error(multiReadErr), null);
            } else {
              // currentReadTimestamp = new Date();
              // let elapsedSeconds = currentReadTimestamp - readRequestTimestamp;
              // console.log(`-------multiRead response in ${elapsedSeconds}msec`);

              // elapsedSeconds = Math.round((currentReadTimestamp - lastReadTimestamp) / 1000);
              // lastReadTimestamp = currentReadTimestamp;
              // console.log(`-------multiReadWithExistingHandles successful!!!!!!!!! Time since last read = ${elapsedSeconds}`);

              // we have succesfully read data from the host
              readNumber = 0;
              handles.forEach((handle) => {
                const localVariableFormat = variableFormatArray[readNumber];
                const localVariableArrayLength = variableArrayLengthArray[readNumber];
                const localVariableLength = variableLengthArray[readNumber];
                const localVariableName = variableNameArray[readNumber];

                previousComms = true;
                alert.clear('connection-error');
                alert.clear('multiRead-error');
                // try/catch here as Buffer reads can throw if not enough data is there
                try {
                  result = [];
                  // get data ready for database based on the format returned
                  if (localVariableFormat === 'char') {
                    // extract as ascii string
                    const data = handle.value.toString('ascii', 0, localVariableLength);
                    resultsArray.push(_.trimEnd(data, '\u0000'));
                  } else if (localVariableFormat === 'uint8') {
                    if (localVariableArrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / localVariableLength); i += 1) {
                        result.push(handle.value.readUInt8(i));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readUInt8(0));
                    }
                  } else if (localVariableFormat === 'uint16') {
                    if (localVariableArrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / localVariableLength); i += 1) {
                        result.push(handle.value.readUInt16LE(i * 2));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readUInt16LE(0));
                    }
                  } else if (localVariableFormat === 'uint32') {
                    if (localVariableArrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / localVariableLength); i += 1) {
                        result.push(handle.value.readUInt32LE(i * 4));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readUInt32LE(0));
                    }
                  } else if (localVariableFormat === 'int8') {
                    if (localVariableArrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / localVariableLength); i += 1) {
                        result.push(handle.value.readInt8(i));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readInt8(0));
                    }
                  } else if (localVariableFormat === 'int16') {
                    if (localVariableArrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / localVariableLength); i += 1) {
                        result.push(handle.value.readInt16LE(i * 2));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readInt16LE(0));
                    }
                  } else if (localVariableFormat === 'int32') {
                    if (localVariableArrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / localVariableLength); i += 1) {
                        result.push(handle.value.readInt32LE(i * 4));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readInt32LE(0));
                    }
                  } else if (localVariableFormat === 'float') {
                    if (localVariableArrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / localVariableLength); i += 1) {
                        result.push(handle.value.readFloatLE(i * 4));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readFloatLE(0));
                    }
                  } else if (localVariableFormat === 'double') {
                    if (localVariableArrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / localVariableLength); i += 1) {
                        result.push(handle.value.readDoubleLE(i * 8));
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readDoubleLE(0));
                    }
                  } else if (localVariableFormat === 'bool') {
                    if (localVariableArrayLength > 1) {
                      for (let i = 0; i < (handle.value.length / localVariableLength); i += 1) {
                        result.push(handle.value.readUInt8(i) !== 0);
                      }
                      resultsArray.push(result);
                    } else {
                      resultsArray.push(handle.value.readUInt8(0) !== 0);
                    }
                  } else {
                    throw new Error('Unsupported Format');
                  }
                  // clear variable read alert
                  alert.clear(`var-read-error-${localVariableName}`);
                } catch (exception) {
                  let alertDescription = `Unknown read error for variable ${localVariableName}.`;
                  if (exception.message === 'Index out of range') {
                    alertDescription = `Not enough data returned for variable ${localVariableName}. Make sure the variable's format is set correctly.`;
                  } else if (exception.message === 'Unsupported Format') {
                    alertDescription = `Unsupported format for variable ${localVariableName}. Make sure the variable's format is set correctly.`;
                  }
                  alert.raise({
                    key: `var-read-error-${localVariableName}`,
                    msg: `${machine.info.name}: Error Reading Variable`,
                    description: alertDescription,
                  });
                  // write null to results array as there is no data for this variable
                  resultsArray.push(null);
                }
                readNumber += 1;
              });

              done(null, resultsArray);
            }
          });
        }
      } else {
        done(new Error('Client not defined'), null);
      }
    });
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function processResults(err, dataArray) {
    // console.log('---------------processResults');
    if (err) {
      readActiveFlag = false;
      // console.log('---------------processResults - err');
      return;
    }
    // process the array of results
    log.debug('Started process results');
    // if delivering combined result, create one variable
    if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
      const combinedResultArray = [];
      for (let iVar = 0; iVar < dataArray.length; iVar += 1) {
        combinedResultArray.push({
          name: variableReadArray[iVar].name,
          value: dataArray[iVar],
        });
      }
      // console.log(`deliverEntireResultsVariable = ${JSON.stringify(deliverEntireResultVariable)}`);
      // console.log(`combinedResultArray = ${JSON.stringify(combinedResultArray)}`);
      that.dataCb(that.machine, deliverEntireResultVariable, combinedResultArray, (dataCbErr, res) => {
        if (dataCbErr) {
          // console.log(`error = ${dataCbErr.message}`);
          alert.raise({ key: 'db-add-error', errorMsg: dataCbErr.message });
        } else {
          alert.clear('db-add-error');
        }
        if (res) log.debug(res);
      });
    } else {
      async.forEachOfSeries(dataArray, (dataItem, index, callback) => {
        // if there wasn't a result for this variable
        if (dataItem === null) {
          // just move onto next item, alert/error has already been flagged for this
          return callback();
        }
        // othewise update the database
        return that.dataCb(that.machine, variableReadArray[index], dataItem, (dataCbErr, res) => {
          if (dataCbErr) {
            alert.raise({ key: 'db-add-error', errorMsg: dataCbErr.message });
          } else {
            alert.clear('db-add-error');
          }
          if (res) log.debug(res);
          // move onto next item once stored in db
          return callback();
        });
      });
      readActiveFlag = false;
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function readTimer() {
    if (readActiveFlag) {
      // console.log('-------attempting read before processing previous read');
      return;
    }

    // read the latest data from each of the read variables given in the config file
    if (that.machine.settings.model.multiReadEnabled) {
      readAllMulti(variableReadArray, processResults);
    } else {
      readAll(variableReadArray, processResults);
    }
  }

  // function readTimer() {
  //   // read the latest data from each of the read variables given in the config file
  //   readAllMulti(variableReadArray, (err, dataArray) => {
  //     // possibly a connection error, there will be no data to post so just return
  //     if (err) {
  //       return;
  //     }
  //     // process the array of results
  //     log.debug('Started process results');
  //     // if delivering combined result, create one variable
  //     if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
  //       const combinedResultArray = [];
  //       for (let iVar = 0; iVar < dataArray.length; iVar += 1) {
  //         combinedResultArray.push({
  //           name: variableReadArray[iVar].name,
  //           value: dataArray[iVar],
  //         });
  //       }
  //       that.dataCb(that.machine, deliverEntireResultVariable, combinedResultArray, (dataCbErr, res) => {
  //         if (dataCbErr) {
  //           alert.raise({ key: 'db-add-error', errorMsg: dataCbErr.message });
  //         } else {
  //           alert.clear('db-add-error');
  //         }
  //         if (res) log.debug(res);
  //       });
  //     } else {
  //       async.forEachOfSeries(dataArray, (dataItem, index, callback) => {
  //         // if there wasn't a result for this variable
  //         if (dataItem === null) {
  //           // just move onto next item, alert/error has already been flagged for this
  //           return callback();
  //         }
  //         // othewise update the database
  //         return that.dataCb(that.machine, variableReadArray[index], dataItem, (dataCbErr, res) => {
  //           if (dataCbErr) {
  //             alert.raise({ key: 'db-add-error', errorMsg: dataCbErr.message });
  //           } else {
  //             alert.clear('db-add-error');
  //           }
  //           if (res) log.debug(res);
  //           // move onto next item once stored in db
  //           return callback();
  //         });
  //       });
  //     }
  //   });
  // }

  // returns true if a variable already exists
  function variableExists(variableName) {
    const nVars = that.machine.variables.length;
    for (let iVar = 0; iVar < nVars; iVar += 1) {
      if (variableName === that.machine.variables[iVar].name) return true;
    }

    return false;
  }

  function open(callback) {
    requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    ({
      ipAddress, amsAddress, amsPort, localAmsAddress,
    } = that.machine.settings.model);
    connectionReported = false;

    // check ip addresses etc are valid before attempting connection
    if (!validateIPaddress(ipAddress)) {
      alert.raise({ key: 'configuration-error', errorMsg: 'Invalid IP Address' });
      return callback(null);
    }
    if (!validateAMSaddress(amsAddress)) {
      alert.raise({ key: 'configuration-error', errorMsg: 'Invalid AMS Address' });
      return callback(null);
    }
    if (!validateAMSaddress(localAmsAddress)) {
      alert.raise({ key: 'configuration-error', errorMsg: 'Invalid Local AMS Address' });
      return callback(null);
    }
    if ((typeof amsPort !== 'number') || (amsPort < 1) || (amsPort > 999)) {
      alert.raise({ key: 'configuration-error', errorMsg: 'Invalid AMS Port' });
      return callback(null);
    }

    // clear possbile configuration errors
    alert.clear('configuration-error');

    // from the variable array, form a new array of 'read' specific variables
    // i.e. filter out 'write' only variables
    variableReadArray = [];
    destVariables = [];
    async.forEachOfSeries(that.machine.variables, (item, index, cb) => {
      const variable = item;
      // if read or write not set, assume read
      // skip machine connected variables
      if (!_.has(variable, 'machineConnected') || !variable.machineConnected) {
        if (!(variable.access === 'write' || variable.access === 'read')) {
          variable.access = 'read';
          variableReadArray.push(variable);
        } else if (variable.access === 'read') {
          variableReadArray.push(variable);
        } else if (variable.access === 'write') {
          if (_.has(variable, 'array') && variable.array && _.has(variable, 'destVariables')) {
            for (let iDestVar = 0; iDestVar < variable.destVariables.length; iDestVar += 1) {
              const destVariable = variable.destVariables[iDestVar];

              // add destination variable only if it does not already exists
              if (!variableExists(destVariable.destVariable)) {
                const destVarObj = {
                  name: destVariable.destVariable,
                  adsAddressName: variable.adsAddressName,
                  description: `Destination variable ${destVariable.destVariable}`,
                  format: variable.format,
                  access: variable.access,
                  array: variable.array,
                  arrayIndex: destVariable.arrayIndex,
                };
                destVariables.push(destVarObj);
              }
            }
          }
        }
      }
      return cb();
    });
    if (!_.isEmpty(destVariables)) {
      async.forEachOfSeries(destVariables, (data, index, cb) => {
        that.machine.variables.push(data);
        return cb();
      });
      destVariables = [];
    }
    // convert the variables array to an object for easy searching when writing variables and filter it down to just 'write' variables
    variablesWriteObj = _.keyBy(_.filter(that.machine.variables, variable => ((variable.access === 'write') && (!_.has(variable, 'machineConnected') || !variable.machineConnected))), 'name');

    // raise connection issue alert (if all is well will be cleared swiftly)
    alert.raise({ key: 'connection-issue', errorMsg: 'initial connection' });
    // attempt to connect
    connecting = true;
    previousComms = false;
    client = ads.connect({
      host: ipAddress,
      amsNetIdTarget: amsAddress,
      amsNetIdSource: localAmsAddress,
      amsPortTarget: amsPort,
      timeout: 5000,
    }, () => {
      // console.log('!!!!! Connected');
      log.info('Connected');
      connectionDetected();
      updateConnectionStatus(true);
      connecting = false;

      // clear connection issue alert
      alert.clear('connection-issue');

      // all is well, set a timer task up to read data at the requested frequency
      if (timer) {
        // console.log('---------------clearing timer - open');
        clearInterval(timer);
      }
      timer = setInterval(readTimer, requestFrequencyMs);
    });

    // subscribe to error handler
    client.on('error', handleError);

    // subscribe to timeout handler
    client.on('timeout', handleTimeout);

    // connection may be delayed (e.g. if ADS machine not actually connected) so return before conneciton event
    return callback(null);
  }

  function close(callback) {
    updateConnectionStatus(false);
    // console.log('--------------------close');
    if (client) {
      // console.log('--------------------calling client.end');
      client.end(() => {
        // console.log('--------------------calling client.end callback');
        callback(null);
      });
    } else {
      callback(null);
    }
  }

  this.writeData = function writeData(value, done) {
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
    const variable = variablesWriteObj[variableName];

    let dataToWrite;
    try {
      switch (variable.format) {
        case 'char': dataToWrite = Buffer.from(value[value.variable]);
          break;
        case 'bool': dataToWrite = Buffer.allocUnsafe(1);
          dataToWrite.writeUInt8(value[value.variable] === true ? 1 : 0, 0);
          break;
        case 'uint8': dataToWrite = Buffer.allocUnsafe(1);
          dataToWrite.writeUInt8(value[value.variable], 0);
          break;
        case 'int8': dataToWrite = Buffer.allocUnsafe(1);
          dataToWrite.writeInt8(value[value.variable], 0);
          break;
        case 'uint16': dataToWrite = Buffer.allocUnsafe(2);
          dataToWrite.writeUInt16LE(value[value.variable], 0);
          break;
        case 'int16': dataToWrite = Buffer.allocUnsafe(2);
          dataToWrite.writeInt16LE(value[value.variable], 0);
          break;
        case 'uint32': dataToWrite = Buffer.allocUnsafe(4);
          dataToWrite.writeUInt32LE(value[value.variable], 0);
          break;
        case 'int32': dataToWrite = Buffer.allocUnsafe(4);
          dataToWrite.writeInt32LE(value[value.variable], 0);
          break;
        case 'float': dataToWrite = Buffer.allocUnsafe(4);
          dataToWrite.writeFloatLE(value[value.variable], 0);
          break;
        case 'double': dataToWrite = Buffer.allocUnsafe(8);
          dataToWrite.writeDoubleLE(value[value.variable], 0);
          break;
        default:
          throw new Error('Unsupported Format');
      }
    } catch (err) {
      // create 'write' specific variable alert (error will either be from Unsupported format or from Node buffer value validation)
      alert.raise({
        key: `var-write-error-${variable.name}`,
        msg: `${machine.info.name}: Error Writing Variable`,
        description: `Error in writing ${variable.name}. Error: ${err.message}`,
      });

      done();
      return;
    }
    let variableToWrite = variable.adsAddressName;

    if (variable.arrayIndex) {
      variableToWrite = `${variable.adsAddressName}[${variable.arrayIndex}]`;
    }
    // create a handle for this write variable
    const varWriteHandle = {
      symname: variableToWrite,
      bytelength: dataToWrite.length,
      value: dataToWrite,
    };

    // attempt to write
    client.write(varWriteHandle, (err) => {
      if (err) {
        if (err === 'timeout') {
          // can get the timeout error from write either because the ADS is ignoring us (wrong ADS address)
          // or because the connection has been lost (e.g. enet unplugged) we want to treat the two cases
          // differently so we have a flag to help us choose the correct action
          if (previousComms === true) {
            // attempt to re-connect if we previously had success reading/writing
            reconnectionHelper(err.message);
          } else {
            // create a connection alert and don't attempt re-connect
            client.end();
            // console.log('!!!!!!!!!!!!!!!! writeData');
            alert.raise({ key: 'connection-error', errorMsg: 'Timeout on Data Write attempt' });
          }
        } else {
          // create 'write' specific variable alert
          alert.raise({
            key: `var-write-error-${variable.name}`,
            msg: `${machine.info.name}: Error Writing Variable`,
            description: `Error in writing ${variable.name} to ${value.machine}. Error: ${err}`,
          });
        }
      } else {
        // we have succesfully written data to the host
        previousComms = true;

        log.debug(`${variable.name} has been written to the machine ${value.machine}`);
        // clear variable write alert
        alert.clear(`var-write-error-${variable.name}`);
      }
      done();
    });
  };

  // Privileged methods
  this.start = function start(dataCb, configUpdateCb, done) {
    updateConnectionStatus(false);

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

    multiReadHandles = null;
    readActiveFlag = false;

    return open((err) => {
      if (err) {
        return done(err);
      }

      log.info('Started');
      return done(null);
    });
  };

  this.stop = function stop(done) {
    if (!that.machine) {
      done('machine undefined');
      return;
    }

    if (timer) {
      // console.log('---------------clearing timer - stop');
      clearInterval(timer);
      timer = null;
    }

    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }

    alert.clearAll(() => {
      if (client) {
        close(() => {
          client = null;
          // console.log('------- stopped');
          log.info('Stopped');
          done(null);
        });
      } else {
        log.info('Stopped');
        done(null);
      }
    });
  };

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop(() => {
      that.start(that.dataCb, that.configUpdateCb, err => done(err));
    });
  };

  this.updateModel = function updateModel(newModel, done) {
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

module.exports = {
  hpl: hplBeckhoffADS,
  defaults,
  schema,
};
