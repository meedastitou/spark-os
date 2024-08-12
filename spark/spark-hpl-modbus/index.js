/* jshint esversion: 6 */
/* eslint no-underscore-dangle: ["error", { "allow": ["_port"] }] */
/* eslint no-bitwise: ["error", { "allow": ["<<"] }] */
const _ = require('lodash');
const async = require('async');
let ModbusRTU = require('modbus-serial');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

const deliverEntireResultVariable = {
  name: 'CombinedResult',
  description: 'CombinedResult',
  format: 'char',
  array: true,
};

// constructor
const hplModbus = function hplModbus(log, machine, model, conf, db, alert) {
  // if running test harness, get Modbus tester and set the variables
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line global-require
    ModbusRTU = require('./test/modbus-tester');
    this.tester = ModbusRTU;
  }

  // Private variables
  const that = this;
  let optimize = true;
  let sendingActive = false;
  let timer = null;
  let client = null;
  let interfaceType = null;
  let requestFrequencyMs = null;
  let modbusMachineShutdown = false;
  let modbusMachineConnectionAlertFlag = false;
  let variableReadArray = [];
  let disconnectedTimer = null;
  let connectionReported = false;
  let setTimeoutEachCycle = false;

  const TYPE = 0;
  const ADDR = 1;
  const FORMAT = 2;
  const COUNT = 3;

  // Alert Objects
  const SERIAL_CONNECTIVITY_ALERT = {
    key: `${machine.info.name}-connectivity-alert`,
    msg: `${machine.info.name}: Unable to open serial port`,
    description: 'Not able to open serial port.  Please verify the serial connection configuration and try again.',
  };
  const ETHERNET_CONNECTIVITY_ALERT = {
    key: `${machine.info.name}-connectivity-alert`,
    msg: `${machine.info.name}: Unable to open connection`,
    description: 'Not able to open connection.  Please verify the connection configuration and try again.',
  };
  const NO_RESPONSE_ALERT = {
    key: `${machine.info.name}-connectivity-alert`,
    msg: `${machine.info.name}: No response from modbus client`,
    description: 'No response from modbus client.  Check client device and connection.',
  };

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine, {
    settings: {
      model,
    },
  });

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

  // private methods
  function readTimer() {
    let errorCount = 0;

    // read the latest data from each of the variables given in the config file
    // eslint-disable-next-line no-use-before-define
    readAll(variableReadArray, (err, dataArray) => {
      if (err) {
        log.error(err.message);
        if (setTimeoutEachCycle) {
          timer = setTimeout(readTimer, requestFrequencyMs);
        }
        return;
      }

      // if delivering combined result, create one variable
      if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
        const combinedResultArray = [];
        let iVar = 0;
        _.forOwn(dataArray, (dataValue) => {
          const variable = variableReadArray[iVar];
          iVar += 1;
          let value = dataValue;
          if (value === null) {
            errorCount += 1;
          } else if (_.get(variable, 'decEncoding', false)) {
            value = parseInt(value.toString(16), 10);
          }

          combinedResultArray.push({
            name: variable.name,
            value,
          });
        });
        that.dataCb(that.machine, deliverEntireResultVariable,
          combinedResultArray, (errDB, res) => {
            if (errDB) {
              log.error(errDB);
            }
            if (res) log.debug(res);
          });

        // if we've had more than one error and if modbus is using optimized transfers
        if ((errorCount > 1) && (optimize === true)) {
          // if so then disable, so we can get as many transfers back as possible next time
          // 1 missing value in block of values will cause all to fail if using optimized transfers
          optimize = false;
          log.info('Falling back to non-optimized transfers');
        }

        if (setTimeoutEachCycle) {
          timer = setTimeout(readTimer, requestFrequencyMs);
        }
      } else {
        // process the array of results
        async.forEachOfSeries(dataArray, (dataItem, index, callback) => {
          // if there wasn't a result
          const variable = variableReadArray[index];

          if (dataItem === null) {
            // highlight that there was an error getting this variables data
            log.error(`Failed to get data for variable ${variable.name}`);
            errorCount += 1;
            // and just move onto next item
            callback();
          } else {
            let dataValue = dataItem;
            if (_.get(variable, 'decEncoding', false)) {
              if (dataValue !== null) {
                dataValue = parseInt(dataItem.toString(16), 10);
              }
            }

            // othewise update the database
            that.dataCb(that.machine, variable, dataValue, (errDB, res) => {
              if (errDB) {
                log.error(errDB);
              }
              if (res) log.debug(res);
              // move onto next item once stored in db
              callback();
            });
          }
        }, () => {
          // if we've had more than one error and if modbus is using optimized transfers
          // disable optimization
          if ((errorCount > 1) && (optimize === true)) {
            optimize = false;
            log.info('Falling back to non-optimized transfers');
          }

          if (setTimeoutEachCycle) {
            timer = setTimeout(readTimer, requestFrequencyMs);
          }
        });
      }
    });
  }

  function raiseAlert(ALERT_OBJECT) {
    // avoid raising an alert once the machine stop event is triggered to stop unwanted alert.raise
    if (!modbusMachineShutdown) {
      // To avoid calling readTimer for next next set of variables before completion of currrent
      if (!setTimeoutEachCycle) {
        if (timer) {
          clearInterval(timer);
        }
        timer = setInterval(readTimer, requestFrequencyMs);
      }
      // Raise an alert
      alert.raise({
        key: ALERT_OBJECT.key,
        msg: ALERT_OBJECT.msg,
        description: ALERT_OBJECT.description,
      });
      modbusMachineConnectionAlertFlag = true;
    }

    return true;
  }

  function clearAlert(ALERT_OBJECT) {
    if (modbusMachineConnectionAlertFlag) {
      alert.clear(ALERT_OBJECT.key);
      modbusMachineConnectionAlertFlag = false;
    }

    return true;
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

  function openEthernet(callback) {
    const { ipAddress } = that.machine.settings.model;
    const { slaveId } = that.machine.settings.model;
    const { timeoutInterval } = that.machine.settings.model;

    client.connectTCP(ipAddress, (err) => {
      if (err) {
        return callback(err);
      }

      client.setID(slaveId);
      client.setTimeout(timeoutInterval);

      callback(null);
      return undefined;
    });
  }

  function validateSerial(path, baudRate, mode, parity) {
    // first check mode
    if ((mode !== 'RTU') && (mode !== 'ASCII_8BIT') && (mode !== 'ASCII_7BIT')) {
      return false;
    }

    // then check parity
    if ((parity !== 'none') && (parity !== 'even') && (parity !== 'mark') && (parity !== 'odd') && (parity !== 'space')) {
      return false;
    }

    // then a simple check that a path has been entered
    if (path.length === 0) {
      return false;
    }
    // then check baudrate
    if (baudRate === 75 || baudRate === 110 || baudRate === 300 || baudRate === 1200
       || baudRate === 2400 || baudRate === 4800 || baudRate === 9600 || baudRate === 19200
       || baudRate === 38400 || baudRate === 57600 || baudRate === 115200) {
      return true;
    }
    return false;
  }

  function openSerial(callback) {
    let numDatabits = 8;
    const path = that.machine.settings.model.device;
    const baudRate = parseInt(that.machine.settings.model.baudRate, 10);
    const { parity } = that.machine.settings.model;
    const { mode } = that.machine.settings.model;
    const { slaveId } = that.machine.settings.model;
    const { timeoutInterval } = that.machine.settings.model;

    // do a simple check on path, rate and mode before attempting connection
    if (validateSerial(path, baudRate, mode, parity)) {
      if (mode === 'RTU') {
        client.connectRTUBuffered(path, {
          baudRate,
          databits: numDatabits,
          parity,
        }, (err) => {
          if (err) {
            return callback(err);
          }
          client.setID(slaveId);
          client.setTimeout(timeoutInterval);
          callback(null);
          return undefined;
        });
      } else {
        if (mode === 'ASCII_7BIT') {
          numDatabits = 7;
        }

        client.connectAsciiSerial(path, {
          baudRate,
          databits: numDatabits,
          parity,
        }, (err) => {
          if (err) {
            return callback(err);
          }
          client.setID(slaveId);
          client.setTimeout(timeoutInterval);
          callback(null);
          return undefined;
        });
      }
    } else {
      callback(new Error('Invalid Device, Baudrate, Mode, or Parity'));
    }
  }

  function reconnectEthernet() {
    if (!modbusMachineShutdown) {
      if (!client.isOpen) {
        // disable the read interval timer
        if (timer) {
          if (setTimeoutEachCycle) {
            clearTimeout(timer);
          } else {
            clearInterval(timer);
          }
          timer = null;
          sendingActive = false;
        }

        // need to destroy and re-instatiate modbus
        client = null;
        client = new ModbusRTU();

        // wait a while before attempting another open
        setTimeout(() => {
          if (modbusMachineShutdown) return;
          openEthernet((err) => {
            if (err) {
              log.error(err);
              // if we still cannot connect, call ourselves again
              reconnectEthernet();
              return;
            }
            // if connection is now good, clear the alert
            clearAlert(ETHERNET_CONNECTIVITY_ALERT);
            connectionDetected();
            updateConnectionStatus(true);
            // and restart the read interval timer
            if (setTimeoutEachCycle) {
              timer = setTimeout(readTimer, requestFrequencyMs);
            } else {
              timer = setInterval(readTimer, requestFrequencyMs);
            }
            log.info('Connection Re-established');
          });
        }, 5000);
      }
    }
  }

  function open(callback) {
    client = new ModbusRTU();
    requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    interfaceType = that.machine.settings.model.interface;
    setTimeoutEachCycle = _.get(that.machine.settings.model, 'startRequestTimerAfterResponse', false);
    connectionReported = false;

    if (interfaceType === 'ethernet') {
      // open connection to a tcp line
      openEthernet((err) => {
        if (err) {
          log.error(err);
          // if there was an error opening, raise and alert
          raiseAlert(ETHERNET_CONNECTIVITY_ALERT);
          disconnectionDetected();
          updateConnectionStatus(false);
          // and attempt to reconnect
          reconnectEthernet();
          return callback(null);
        }

        connectionDetected();
        updateConnectionStatus(true);
        if (setTimeoutEachCycle) {
          timer = setTimeout(readTimer, requestFrequencyMs);
        } else {
          timer = setInterval(readTimer, requestFrequencyMs);
        }
        log.info('Started');
        return callback(null);
      });
    } else {
      // open connection to a serial line
      openSerial((err) => {
        if (err) {
          log.error(err);
          raiseAlert(SERIAL_CONNECTIVITY_ALERT);
          disconnectionDetected();
          updateConnectionStatus(false);
          return callback(null);
        }

        connectionDetected();
        updateConnectionStatus(true);
        if (setTimeoutEachCycle) {
          timer = setTimeout(readTimer, requestFrequencyMs);
        } else {
          timer = setInterval(readTimer, requestFrequencyMs);
        }
        log.info('Started');
        return callback(null);
      });
    }
  }

  function close(callback) {
    // close the port if open
    if ((client._port === null) || (client._port === undefined) || (client.isOpen === false)) {
      return callback(new Error('No open port to close'));
    }

    updateConnectionStatus(false);

    // if we are currently in a request/response cycle
    if (sendingActive === true) {
      // hold off on closing using an interval timer
      let waitCounter = 0;
      const activeWait = setInterval(() => {
        // until safe to do so
        if ((sendingActive === false) || (waitCounter > 20)) {
          clearInterval(activeWait);
          client.close(callback);
        }
        waitCounter += 1;
      }, 100); // interval set at 100 milliseconds
    } else {
      // otherwise close immeditalely
      client.close(callback);
    }

    return undefined;
  }

  function readAll(variableArray, done) {
    // if we are still sending from the last cycle
    if (sendingActive === true) {
      return done(new Error('Cyclic read function returning early due to still being busy from last read'), {});
    }

    // console.log('----readAll----');

    // do nothing if no read variables
    if (variableArray.length === 0) {
      return done(null, {});
    }

    sendingActive = true;

    // first try and optimize the variable array to create fewer transactions
    const optimizedRequestArray = [];
    // add in first variable request
    optimizedRequestArray.push([variableArray[0].type,
      parseInt(variableArray[0].address, 16), variableArray[0].format,
      variableArray[0].length === undefined ? 1 : variableArray[0].length]);
    for (let i = 1; i < variableArray.length; i += 1) {
      const variable = variableArray[i];
      // if optimization is enabled and current index type and format match previously added
      // request (and it's not a string)
      let optimized = false;
      if ((optimize === true)
        && (variable.type === variableArray[i - 1].type)
        && (variable.format === variableArray[i - 1].format)
        && (variable.format !== 'char')) {
        // check if the address is next in line
        let lenCheck = 1;
        if ((variable.format === 'int32') || (variable.format === 'float')) {
          lenCheck = 2;
        }
        // if so
        if (parseInt(variableArray[i - 1].address, 16) + lenCheck
         === parseInt(variable.address, 16)) {
          // then just update the current transaction entry's count field
          // eslint-disable-next-line max-len
          optimizedRequestArray[optimizedRequestArray.length - 1][COUNT] = optimizedRequestArray[optimizedRequestArray.length - 1][COUNT] + 1;
          optimized = true;
        }
      }
      // otherwise create a new transaction
      if (!optimized) {
        optimizedRequestArray.push([variable.type, parseInt(variable.address, 16),
          variable.format, variable.length === undefined ? 1 : variable.length]);
      }
    }

    const resultsArray = {};
    let counter = 0;
    // itterate through each variable given in the config file
    async.forEachOfSeries(optimizedRequestArray, (item, index, callback) => {
      // If we're shutting down the machine, just exit
      if (modbusMachineShutdown) {
        sendingActive = false;
        return done(null, resultsArray);
      }

      // console.log(`----reading ${item[TYPE]}:${item[ADDR]}   length:${item[COUNT]}`);

      // read data over modbus based on variable type
      switch (item[TYPE]) {
        case 'di': // discrete inputs
          client.readDiscreteInputs(item[ADDR], item[COUNT], (err, modbusData) => {
            // get data ready for database
            if (err) {
              log.error(`client.read err = ${err}`);
              // console.log(`client.read err = ${err}`);
            }
            for (let i = 0; i < item[COUNT]; i += 1) {
              if (err) {
                resultsArray[counter] = null;
                if (err.message.lastIndexOf('Timed out') !== -1) {
                  raiseAlert(NO_RESPONSE_ALERT);
                  disconnectionDetected();
                  updateConnectionStatus(false);
                  // if we timed out we should not try reading the other vars
                  return callback(err);
                } if (err.message.lastIndexOf('Port Not Open') !== -1) {
                  if (interfaceType === 'ethernet') {
                    raiseAlert(ETHERNET_CONNECTIVITY_ALERT);
                    disconnectionDetected();
                    updateConnectionStatus(false);
                    reconnectEthernet();
                    return callback(err);
                  }
                } else {
                  // clear the alerts when error TimedOut is rectified but still not proper data
                  clearAlert(NO_RESPONSE_ALERT);
                  connectionDetected();
                  updateConnectionStatus(true);
                }
              } else {
                // extract bit data from each bit of the data
                resultsArray[counter] = modbusData.data[i];
                clearAlert(NO_RESPONSE_ALERT);
                connectionDetected();
                updateConnectionStatus(true);
              }
              counter += 1;
            }
            // move onto next item
            return callback();
          });
          break;
        case 'coil': // output coils
          client.readCoils(item[ADDR], item[COUNT], (err, modbusData) => {
            if (err) {
              log.error(`client.read err = ${err}`);
              // console.log(`client.read err = ${err}`);
            }
            // get data ready for database
            for (let i = 0; i < item[COUNT]; i += 1) {
              if (err) {
                resultsArray[counter] = null;
                if (err.message.lastIndexOf('Timed out') !== -1) {
                  raiseAlert(NO_RESPONSE_ALERT);
                  disconnectionDetected();
                  updateConnectionStatus(false);
                  // if we timed out we should not try reading the other vars
                  return callback(err);
                } if (err.message.lastIndexOf('Port Not Open') !== -1) {
                  if (interfaceType === 'ethernet') {
                    raiseAlert(ETHERNET_CONNECTIVITY_ALERT);
                    disconnectionDetected();
                    updateConnectionStatus(false);
                    reconnectEthernet();
                    return callback(err);
                  }
                } else {
                  // clear the alerts when error TimedOut is rectified but still not proper data
                  clearAlert(NO_RESPONSE_ALERT);
                  connectionDetected();
                  updateConnectionStatus(true);
                }
              } else {
                // extract bit data from each bit of the data
                resultsArray[counter] = modbusData.data[i];
                clearAlert(NO_RESPONSE_ALERT);
                connectionDetected();
                updateConnectionStatus(true);
              }
              counter += 1;
            }
            // move onto next item
            return callback();
          });
          break;
        case 'hr': { // holding registers
          // 16bit (or more if bonded) so look at format property to see what length we need to get
          let length;
          if (item[FORMAT] === 'char') {
            length = Math.round(item[COUNT] / 2); // 2 chars to each 16 bit address
          } else if (item[FORMAT] === 'int16') {
            length = item[COUNT];
          } else if (item[FORMAT] === 'uint16') {
            length = item[COUNT];
          } else if (item[FORMAT] === 'int32') {
            length = item[COUNT] * 2;
          } else if (item[FORMAT] === 'float') {
            length = item[COUNT] * 2;
          } else {
            // unsupoorted format  e.g. boolean in a holding register, skip all of these
            for (let i = 0; i < item[COUNT]; i += 1) {
              resultsArray[counter] = null;
              counter += 1;
            }

            // and return
            return callback();
          }
          // read the holding register for the correct length
          client.readHoldingRegisters(item[ADDR], length, (err, modbusData) => {
            if (err) {
              log.error(`client.read err = ${err}`);
              // console.log(`client.read err = ${err}`);
            }
            let i = 0;

            if (err) {
              if (item[FORMAT] === 'char') {
                resultsArray[counter] = null;
                counter += 1;
              } else {
                for (i = 0; i < item[COUNT]; i += 1) {
                  resultsArray[counter] = null;
                  counter += 1;
                }
              }
              if (err.message.lastIndexOf('Timed out') !== -1) {
                raiseAlert(NO_RESPONSE_ALERT);
                disconnectionDetected();
                updateConnectionStatus(false);
                // if we timed out we should not try reading the other vars
                return callback(err);
              } if (err.message.lastIndexOf('Port Not Open') !== -1) {
                if (interfaceType === 'ethernet') {
                  raiseAlert(ETHERNET_CONNECTIVITY_ALERT);
                  disconnectionDetected();
                  updateConnectionStatus(false);
                  reconnectEthernet();
                  return callback(err);
                }
              } else {
                // clear the alerts when error TimedOut is rectified but still not proper data
                clearAlert(NO_RESPONSE_ALERT);
                connectionDetected();
                updateConnectionStatus(true);
              }
              return callback();
            }
            // get data ready for database based on the format returned)
            if (item[FORMAT] === 'char') {
              // extract as ascii string
              if (_.get(that.machine.settings.model, 'swapCharacterPairs', true)) {
                // if first char of pair in high byte of register, swap each two ascii characters
                const swappedBuffer = Buffer.allocUnsafe(length * 2);
                for (i = 0; i < length; i += 1) {
                  swappedBuffer.writeUInt16LE(modbusData.buffer.readUInt16BE(i * 2), i * 2);
                }
                resultsArray[counter] = swappedBuffer.toString('ascii', 0, item[COUNT]);
              } else {
                resultsArray[counter] = modbusData.buffer.toString('ascii', 0, item[COUNT]);
              }
              counter += 1;
            } else if (item[FORMAT] === 'int16') {
              for (i = 0; i < item[COUNT]; i += 1) {
                // check byte ordering before extracting the 16bit data
                if (that.machine.settings.model.highByteFirst === true) {
                  resultsArray[counter] = modbusData.buffer.readInt16BE(i * 2);
                } else {
                  resultsArray[counter] = modbusData.buffer.readInt16LE(i * 2);
                }
                counter += 1;
              }
            } else if (item[FORMAT] === 'uint16') {
              for (i = 0; i < item[COUNT]; i += 1) {
                // check byte ordering before extracting the 16bit data (treat hex as unsigned)
                if (that.machine.settings.model.highByteFirst === true) {
                  resultsArray[counter] = modbusData.buffer.readUInt16BE(i * 2);
                } else {
                  resultsArray[counter] = modbusData.buffer.readUInt16LE(i * 2);
                }
                counter += 1;
              }
            } else if (item[FORMAT] === 'int32') {
              for (i = 0; i < item[COUNT]; i += 1) {
                // 32 bit data, need to check byte and word ordering
                if (that.machine.settings.model.highByteFirst === true) {
                  if (that.machine.settings.model.highWordFirst === true) {
                    resultsArray[counter] = modbusData.buffer.readInt32BE(i * 4);
                  } else {
                    resultsArray[counter] = (modbusData.buffer.readInt16BE(i * 4 + 2) << 16)
                     + modbusData.buffer.readUInt16BE(i * 4);
                  }
                } else if (that.machine.settings.model.highWordFirst === false) {
                  resultsArray[counter] = modbusData.buffer.readInt32LE(i * 4);
                } else {
                  resultsArray[counter] = (modbusData.buffer.readInt16LE(i * 4) << 16)
                   + modbusData.buffer.readUInt16LE(i * 4 + 2);
                }
                counter += 1;
              }
            } else if (item[FORMAT] === 'float') {
              for (i = 0; i < item[COUNT]; i += 1) {
                if ((that.machine.settings.model.highByteFirst === true)
                 && (that.machine.settings.model.highWordFirst === true)) {
                  // if fully big endian
                  resultsArray[counter] = modbusData.buffer.readFloatBE(i * 4);
                } else if ((that.machine.settings.model.highByteFirst === false)
                 && (that.machine.settings.model.highWordFirst === false)) {
                  // if fully little endian
                  resultsArray[counter] = modbusData.buffer.readFloatLE(i * 4);
                } else {
                  const buffer = new ArrayBuffer(4);
                  if ((that.machine.settings.model.highByteFirst === true)) {
                    (new Uint16Array(buffer))[0] = modbusData.buffer.readUInt16BE(i * 4);
                    (new Uint16Array(buffer))[1] = modbusData.buffer.readUInt16BE(i * 4 + 2);
                  } else {
                    (new Uint16Array(buffer))[0] = modbusData.buffer.readUInt16LE(i * 4 + 2);
                    (new Uint16Array(buffer))[1] = modbusData.buffer.readUInt16LE(i * 4);
                  }
                  [resultsArray[counter]] = new Float32Array(buffer);
                }
                counter += 1;
              }
            }
            clearAlert(NO_RESPONSE_ALERT);
            connectionDetected();
            updateConnectionStatus(true);

            // move onto next item
            return callback();
          });
          break;
        }

        default:
        case 'ir': { // input registers currently unsupported, move onto next item
          let length;
          if (item[FORMAT] === 'char') {
            length = Math.round(item[COUNT] / 2); // 2 chars to each 16 bit address
          } else if (item[FORMAT] === 'int16') {
            length = item[COUNT];
          } else if (item[FORMAT] === 'uint16') {
            length = item[COUNT];
          } else if (item[FORMAT] === 'int32') {
            length = item[COUNT] * 2;
          } else if (item[FORMAT] === 'float') {
            length = item[COUNT] * 2;
          } else {
            // unsupoorted format  e.g. boolean in a holding register, skip all of these
            for (let i = 0; i < item[COUNT]; i += 1) {
              resultsArray[counter] = null;
              counter += 1;
            }

            // and return
            return callback();
          }

          client.readInputRegisters(item[ADDR], length, (err, modbusData) => {
            if (err) {
              log.error(`client.read err = ${err}`);
              // console.log(`client.read err = ${err}`);
            }
            let i = 0;

            if (err) {
              if (item[FORMAT] === 'char') {
                resultsArray[counter] = null;
                counter += 1;
              } else {
                for (i = 0; i < item[COUNT]; i += 1) {
                  resultsArray[counter] = null;
                  counter += 1;
                }
              }
              if (err.message.lastIndexOf('Timed out') !== -1) {
                raiseAlert(NO_RESPONSE_ALERT);
                disconnectionDetected();
                updateConnectionStatus(false);
                // if we timed out we should not try reading the other vars
                return callback(err);
              } if (err.message.lastIndexOf('Port Not Open') !== -1) {
                if (interfaceType === 'ethernet') {
                  raiseAlert(ETHERNET_CONNECTIVITY_ALERT);
                  disconnectionDetected();
                  updateConnectionStatus(false);
                  reconnectEthernet();
                  return callback(err);
                }
              } else {
                // clear the alerts when error TimedOut is rectified but still not proper data
                clearAlert(NO_RESPONSE_ALERT);
                connectionDetected();
                updateConnectionStatus(true);
              }
              return callback();
            }
            if (item[FORMAT] === 'char') {
              // extract as ascii string
              if (_.get(that.machine.settings.model, 'swapCharacterPairs', true)) {
                // if first char of pair in high byte of register, swap each two ascii characters
                const swappedBuffer = Buffer.allocUnsafe(length * 2);
                for (i = 0; i < length; i += 1) {
                  swappedBuffer.writeUInt16LE(modbusData.buffer.readUInt16BE(i * 2), i * 2);
                }
                resultsArray[counter] = swappedBuffer.toString('ascii', 0, item[COUNT]);
              } else {
                resultsArray[counter] = modbusData.buffer.toString('ascii', 0, item[COUNT]);
              }
              counter += 1;
            } else if (item[FORMAT] === 'int16') {
              for (i = 0; i < item[COUNT]; i += 1) {
                // check byte ordering before extracting the 16bit data
                if (that.machine.settings.model.highByteFirst === true) {
                  resultsArray[counter] = modbusData.buffer.readInt16BE(i * 2);
                } else {
                  resultsArray[counter] = modbusData.buffer.readInt16LE(i * 2);
                }
                counter += 1;
              }
            } else if (item[FORMAT] === 'uint16') {
              for (i = 0; i < item[COUNT]; i += 1) {
                // check byte ordering before extracting the 16bit data (treat hex as unsigned)
                if (that.machine.settings.model.highByteFirst === true) {
                  resultsArray[counter] = modbusData.buffer.readUInt16BE(i * 2);
                } else {
                  resultsArray[counter] = modbusData.buffer.readUInt16LE(i * 2);
                }
                counter += 1;
              }
            } else if (item[FORMAT] === 'int32') {
              for (i = 0; i < item[COUNT]; i += 1) {
                // 32 bit data, need to check byte and word ordering
                if (that.machine.settings.model.highByteFirst === true) {
                  if (that.machine.settings.model.highWordFirst === true) {
                    resultsArray[counter] = modbusData.buffer.readInt32BE(i * 4);
                  } else {
                    resultsArray[counter] = (modbusData.buffer.readInt16BE(i * 4 + 2) << 16)
                     + modbusData.buffer.readUInt16BE(i * 4);
                  }
                } else if (that.machine.settings.model.highWordFirst === false) {
                  resultsArray[counter] = modbusData.buffer.readInt32LE(i * 4);
                } else {
                  resultsArray[counter] = (modbusData.buffer.readInt16LE(i * 4) << 16)
                   + modbusData.buffer.readUInt16LE(i * 4 + 2);
                }
                counter += 1;
              }
            } else if (item[FORMAT] === 'float') {
              for (i = 0; i < item[COUNT]; i += 1) {
                if ((that.machine.settings.model.highByteFirst === true)
                 && (that.machine.settings.model.highWordFirst === true)) {
                  // if fully big endian
                  resultsArray[counter] = modbusData.buffer.readFloatBE(i * 4);
                } else if ((that.machine.settings.model.highByteFirst === false)
                 && (that.machine.settings.model.highWordFirst === false)) {
                  // if fully little endian
                  resultsArray[counter] = modbusData.buffer.readFloatLE(i * 4);
                } else {
                  const buffer = new ArrayBuffer(4);
                  if ((that.machine.settings.model.highByteFirst === true)) {
                    (new Uint16Array(buffer))[0] = modbusData.buffer.readUInt16BE(i * 4);
                    (new Uint16Array(buffer))[1] = modbusData.buffer.readUInt16BE(i * 4 + 2);
                  } else {
                    (new Uint16Array(buffer))[0] = modbusData.buffer.readUInt16LE(i * 4 + 2);
                    (new Uint16Array(buffer))[1] = modbusData.buffer.readUInt16LE(i * 4);
                  }
                  [resultsArray[counter]] = new Float32Array(buffer);
                }
                counter += 1;
              }
            }
            clearAlert(NO_RESPONSE_ALERT);
            connectionDetected();
            updateConnectionStatus(true);

            // move on to next variable
            return callback();
          });
          break;
        }
      }
      return undefined;
    }, (err) => {
      sendingActive = false;
      return done(err, resultsArray);
    });

    return undefined;
  }

  this.writeData = function writeData(value, done) {
    // console.log('----writeData----');

    // Iterating through the variables to find the address and Type of the variable
    const variableName = value.variable;

    if (!_.has(that.variablesObj, variableName)) {
      return done();
    }

    const data = that.variablesObj[variableName];

    // ignore machibne connectivity status variable - read-only
    if (_.has(data, 'machineConnected') && data.machineConnected) {
      return done();
    }

    // console.log(`----writing ${data.type}:${data.address}   value:${value.variable}`);

    switch (data.type) {
      case 'coil':
      case 'di':
        if (data.format === 'bool') {
          client.writeCoil(parseInt(data.address, 16), value[value.variable], (error) => {
            if (error) {
              log.error({
                err: error,
              }, `MODBUS WRITE-BACK : Error in writing ${data.name} to ${value.machine}`);
              return done(error);
            }
            log.debug(`${data.name} has been written to the machine ${value.machine}`);
            return done(null);
          });
        }
        break;

      case 'hr': {
        const writeValArray = [];
        const dataFormat = data.format;

        // preparing the data ready for the machine to accept
        if (dataFormat === 'char') {
          const strVal = value[value.variable].toString();
          const buff = Buffer.alloc((strVal.length % 2) === 0 ? strVal.length : strVal.length + 1);
          buff.write(strVal, 0, strVal.length, 'ascii');
          for (let iBuff = 0; iBuff < buff.length; iBuff += 2) {
            if (that.machine.settings.model.highByteFirst) {
              writeValArray.push(buff.readUInt16BE(iBuff));
            } else {
              writeValArray.push(buff.readUInt16LE(iBuff));
            }
          }
        } else if (dataFormat === 'uint16') {
          if (that.machine.settings.model.highByteFirst) {
            writeValArray[0] = value[value.variable];
          } else {
            const buff = Buffer.allocUnsafe(2);
            buff.writeUInt16BE(value[value.variable], 0);
            writeValArray[0] = buff.readUInt16LE(0);
          }
        } else if (dataFormat === 'int16') {
          const buff = Buffer.allocUnsafe(2);
          buff.writeInt16BE(value[value.variable], 0);
          if (that.machine.settings.model.highByteFirst) {
            writeValArray[0] = buff.readUInt16BE(0);
          } else {
            writeValArray[0] = buff.readUInt16LE(0);
          }
        } else if (dataFormat === 'int32') {
          const buff = Buffer.allocUnsafe(4);
          buff.writeInt32BE(value[value.variable], 0);
          if (that.machine.settings.model.highByteFirst) {
            if (that.machine.settings.model.highWordFirst) {
              writeValArray[0] = buff.readUInt16BE(0);
              writeValArray[1] = buff.readUInt16BE(2);
            } else {
              writeValArray[0] = buff.readUInt16BE(2);
              writeValArray[1] = buff.readUInt16BE(0);
            }
          } else if (that.machine.settings.model.highWordFirst) {
            writeValArray[0] = buff.readUInt16LE(0);
            writeValArray[1] = buff.readUInt16LE(2);
          } else {
            writeValArray[0] = buff.readUInt16LE(2);
            writeValArray[1] = buff.readUInt16LE(0);
          }
        } else if (dataFormat === 'float') {
          const buff = Buffer.allocUnsafe(4);
          buff.writeFloatBE(value[value.variable], 0);
          if (that.machine.settings.model.highByteFirst) {
            if (that.machine.settings.model.highWordFirst) {
              writeValArray[0] = buff.readUInt16BE(0);
              writeValArray[1] = buff.readUInt16BE(2);
            } else {
              writeValArray[0] = buff.readUInt16BE(2);
              writeValArray[1] = buff.readUInt16BE(0);
            }
          } else if (that.machine.settings.model.highWordFirst) {
            writeValArray[0] = buff.readUInt16LE(0);
            writeValArray[1] = buff.readUInt16LE(2);
          } else {
            writeValArray[0] = buff.readUInt16LE(2);
            writeValArray[1] = buff.readUInt16LE(0);
          }
        }
        client.writeRegisters(parseInt(data.address, 16), writeValArray, (error) => {
          if (error) {
            log.error({
              err: error,
            }, `MODBUS WRITE-BACK : Error in writing ${data.name} to ${value.machine}`);
            return done(error);
          }
          log.debug(`${data.name} has been written to the machine ${value.machine}`);
          return done(null);
        });
        break;
      }
      default:
    }

    return undefined;
  };

  // Privileged methods
  this.start = function start(dataCb, configUpdateCb, done) {
    updateConnectionStatus(false);

    if (!that.machine) {
      return done('machine undefined');
    }

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
    variableReadArray = [];
    // add the access property if it is not defined explicitly
    async.forEachOfSeries(that.machine.variables, (item, index, callback) => {
      // skip machine connected variables
      if (!_.has(item, 'machineConnected') || !item.machineConnected) {
        if (!(item.access === 'write' || item.access === 'read')) {
          const itemWithAccess = item;
          itemWithAccess.access = 'read';
          variableReadArray.push(itemWithAccess);
        } else if (item.access === 'read') {
          variableReadArray.push(item);
        }
      }
      return callback();
    });
    // convert the variables array to an object for easy searching
    that.variablesObj = _.keyBy(that.machine.variables, 'name');

    modbusMachineShutdown = false;
    open((err) => {
      if (err) {
        return done(err);
      }

      log.info('Started');
      return done(null);
    });

    return undefined;
  };

  this.stop = function stop(done) {
    if (!that.machine) {
      return done('machine undefined');
    }

    if (timer) {
      if (setTimeoutEachCycle) {
        timer = clearTimeout(timer);
      } else {
        timer = clearInterval(timer);
      }
      timer = null;
    }

    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }

    modbusMachineShutdown = true;
    // the machine has Stopped so clear all the alerts we might have raised
    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }

      // close modbus device if its open
      if (client) {
        close((closeErr) => {
          if (closeErr) {
            log.error(closeErr.message);
          }
          client = null;
          log.info('Stopped');
          return done(null);
        });
      } else {
        log.info('Stopped');
        return done(null);
      }

      return undefined;
    });

    return undefined;
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
  hpl: hplModbus,
  defaults,
  schema,
};
