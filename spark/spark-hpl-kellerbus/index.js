/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const SerialPort = require('serialport');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplSerial = function hplSerial(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;
  let sendingActive = false;
  let readTimer = null;
  let requestIndex = 0;
  let variableReadArray = [];
  const variableReadRequestBufferArray = [];
  let resultsArray = [];
  let initializeBuffer;
  let retrySlaveId;
  let transmittedPacket;
  let receivedPacket;
  let receivedPacketTimer = null;

  // Alert Object
  alert.preLoad({
    'connection-error': {
      msg: `${machine.info.name} : Connection Error`,
      desciption: 'Not able to open connection. Please verify the configuration',
    },
    'no-echo-error': {
      msg: `${machine.info.name} : No Echo`,
      description: 'Failed to receive the echo from our tranmission packet',
    },
    'invalid-response-error': {
      msg: `${machine.info.name} : Invalid Response`,
      description: 'Invalid response was received to read request packet',
    },
    'no-response-error': {
      msg: `${machine.info.name} : No Response`,
      description: 'No response was received to read request packet',
    },
  });

  // public variables
  that.serialPort = null;
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

  //   debug function for dumping the contents of a a buffer in easy-to-read format, 16 bytes/line
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

  function calculateCrc16(buffer, length) {
    let crc = 0xFFFF;
    let odd;

    for (let i = 0; i < length; i += 1) {
      // eslint-disable-next-line no-bitwise
      crc ^= buffer[i];

      for (let j = 0; j < 8; j += 1) {
        // eslint-disable-next-line no-bitwise
        odd = crc & 0x0001;
        // eslint-disable-next-line no-bitwise
        crc >>= 1;
        if (odd) {
          // eslint-disable-next-line no-bitwise
          crc ^= 0xA001;
        }
      }
    }

    return crc;
  }

  // helper function to save array of collected results to the database
  function saveResultsToDb() {
    // process the array of results
    async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
      let variableValue = dataItem;
      // if there wasn't a result
      if (variableValue === null) {
        // if no data, and we have been asked to convert this lack of data to a zero, then do so
        if (_.get(variableReadArray[index], 'convertNullToZero', false)) {
          variableValue = 0;
        } else {
          // highlight that there was an error getting this variables data
          log.error(`Failed to get data for variable ${variableReadArray[index].name}`);
          // and just move onto next item
          return callback();
        }
      }

      that.dataCb(that.machine, variableReadArray[index], variableValue, (err, res) => {
        if (err) {
          log.error(err);
        }
        if (res) log.debug(res);
        // move onto next item once stored in db
        callback();
      });

      return undefined;
    });
  }

  function requestTimer() {
    // only start a new request if previous set has finished (although allow for failed
    // response by adding a counter )
    if (sendingActive === false) {
      // reset storage and index for starting a new request set
      requestIndex = 0;
      resultsArray = [];

      sendingActive = true;
      // console.log('------SENDING INITIALIZATION REQUEST: ');
      // dumpBuffer(initializeBuffer);
      transmittedPacket = initializeBuffer;
      receivedPacket = null;
      that.serialPort.write(initializeBuffer, (err) => {
        if (err) {
          log.error(`Error sending request: ${err}`);
        }
      });

      // now wait for processResponseData method to be called by 'on data'
    } else {
      retrySlaveId += 1;
      if (retrySlaveId >= 256) {
        retrySlaveId = 0;
      }
      initializeBuffer.writeUInt8(retrySlaveId, 0);
      initializeBuffer.writeUInt8(48, 1);
      const crc = calculateCrc16(initializeBuffer, 2);
      initializeBuffer.writeUInt16BE(crc, 2);

      sendingActive = false;
    }
  }

  function checkEcho(buf1, buf2, bufferLength) {
    if ((buf1.length < bufferLength) || (buf2.length < bufferLength)) {
      // console.log('----check for echo: false');
      return false;
    }

    let index = 0;
    let lengthToCheck = bufferLength;
    while (lengthToCheck) {
      if (buf1[index] !== buf2[index]) {
        return false;
      }
      index += 1;
      lengthToCheck -= 1;
    }

    // console.log('----check for echo: true');
    return true;
  }

  function processResponseData(data) {
    // will be triggered for each repsonse to a request, assumes response is for last sent request

    // only attempt processing if we are expecting it
    if (sendingActive === true) {
      if (checkEcho(data, transmittedPacket, transmittedPacket.length)) {
        alert.clear('no-echo-error');
        if (requestIndex === 0) {
          // console.log('------received initialization packet echo');
          // no variable associate with the first initialization packet
        } else if (data.length >= (transmittedPacket.length + 6)) {
          if ((data[0] === variableReadRequestBufferArray[requestIndex - 1][0])
                && (data[1] === variableReadRequestBufferArray[requestIndex - 1][1])) {
            // should check for error and crc here
            const floatValue = data.readFloatBE(transmittedPacket.length + 2);
            // console.log('-------resultsArray.push: ' + floatValue);
            resultsArray.push(floatValue);
            alert.clear('invalid-response-error');
            alert.clear('no-response-error');
          } else {
            // console.log('-------resultsArray.push: null');
            resultsArray.push(null);
            alert.clear('no-response-error');
            alert.raise({ key: 'invalid-response-error' });
          }
        } else {
          // console.log('-----no packet data to parse!!!');
          alert.clear('invalid-response-error');
          alert.raise({ key: 'no-response-error' });
        }

        // send request for next var (if any left, else process whole array result)
        requestIndex += 1;
        if (requestIndex <= variableReadArray.length) {
          // console.log('------SENDING READ REQUEST: ');
          // dumpBuffer(variableReadRequestBufferArray[requestIndex - 1]);
          transmittedPacket = variableReadRequestBufferArray[requestIndex - 1];
          receivedPacket = null;
          that.serialPort.write(variableReadRequestBufferArray[requestIndex - 1], (err) => {
            if (err) {
              log.error(`Error sending request: ${err}`);
            }
          });
        } else {
          sendingActive = false;
          // save all results to the database
          saveResultsToDb();
        }
      } else {
        alert.raise({ key: 'no-echo-error' });
      }
    }
  }

  function open(callback) {
    const requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    const { device } = that.machine.settings.model;
    const baudRate = parseInt(that.machine.settings.model.baudRate, 10);
    const { parity } = that.machine.settings.model;
    const { slaveId } = that.machine.settings.model;

    // from the variable array, form a new array of 'read' packets
    variableReadArray = [];

    initializeBuffer = Buffer.alloc(4);
    retrySlaveId = slaveId;
    initializeBuffer.writeUInt8(slaveId, 0);
    initializeBuffer.writeUInt8(48, 1);
    let crc = calculateCrc16(initializeBuffer, 2);
    initializeBuffer.writeUInt16BE(crc, 2);

    that.machine.variables.forEach((variable) => {
      const readBuffer = Buffer.alloc(5);
      readBuffer.writeUInt8(slaveId, 0);
      if (variable.type === 'F30-Read Float Value') {
        readBuffer.writeUInt8(30, 1);
      } else {
        readBuffer.writeUInt8(73, 1);
      }
      readBuffer.writeUInt8(variable.address, 2);
      crc = calculateCrc16(readBuffer, 3);
      readBuffer.writeUInt16BE(crc, 3);
      variableReadRequestBufferArray.push(readBuffer);
      variableReadArray.push(variable);
    });

    // create a serial port with the correct configuration
    that.serialPort = new SerialPort(device, {
      baudRate,
      parity,
      autoOpen: false,
    });

    // attempt to open the serial port
    that.serialPort.open((err) => {
      if (err) {
        alert.raise({ key: 'connection-error' });
        return callback(err);
      }

      alert.clear('connection-error');

      // subscribe to on 'data' events based on whether reading raw or by line
      that.serialPort.on('readable', () => {
        const newData = that.serialPort.read();

        if (receivedPacket === null) {
          receivedPacket = newData;
        } else {
          receivedPacket = Buffer.concat([receivedPacket, newData]);
        }

        if (receivedPacketTimer) {
          clearTimeout(receivedPacketTimer);
          receivedPacketTimer = null;
        }
        receivedPacketTimer = setTimeout(() => {
          // console.log('------RECEIVED RESPONSE:');
          // dumpBuffer(receivedPacket);
          processResponseData(receivedPacket);
        }, 100); // wait 100 msec for any additional data
      });

      // subscribe to on 'close' events
      that.serialPort.on('close', () => {
        // console.log('Serial port closed');
      });

      readTimer = setInterval(requestTimer, requestFrequencyMs);

      // trigger callback on succesful connection
      return callback(null);
    });
  }

  function close(callback) {
    // close the serial port if open
    if (that.serialPort === null) {
      return callback(new Error('No Serial Device To Close'));
    }

    updateConnectionStatus(false);

    if (receivedPacketTimer) {
      clearTimeout(receivedPacketTimer);
      receivedPacketTimer = null;
    }

    // if we are currently in a request/response cycle (for req/res type)
    if ((sendingActive === true)) {
      // hold off on closing using an interval timer
      let waitCounter = 0;
      const activeWait = setInterval(() => {
        // until safe to do so
        if ((sendingActive === false) || (waitCounter > 20)) {
          sendingActive = false;
          clearInterval(activeWait);
          that.serialPort.close(callback);
        }
        waitCounter += 1;
      }, 100); // interval set at 100 milliseconds
    } else {
      // otherwise close immeditalely
      that.serialPort.close(callback);
    }

    return undefined;
  }


  // Privileged methods
  this.start = function start(dataCb, configUpdateCb, done) {
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
    updateConnectionStatus(false);

    if (!that.machine) {
      return done('machine undefined');
    }

    // stop the request timer task (if being used)
    if (readTimer) {
      clearInterval(readTimer);
      readTimer = null;
    }

    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }
      // close serial port if open
      if (that.serialPort) {
        close((closeErr) => {
          if (closeErr) {
            log.error(closeErr);
          }
          that.serialPort = null;
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
  hpl: hplSerial,
  defaults,
  schema,
};
