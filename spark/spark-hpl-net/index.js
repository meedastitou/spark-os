/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const net = require('net');
const unescapeJs = require('unescape-js');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

const deliverEntireResultVariable = {
  name: 'CombinedResult',
  description: 'CombinedResult',
  format: 'char',
  array: true,
};

// constructor
const hplNet = function hplNet(log, machine, model, conf, db, alert) {
  // concatenated publish buffer size limited to 500KB
  const MAX_PUBLISH_BUFFER_SIZE = (500 * 1024);

  const SERVER_CONNECTION_TIMEOUT = 10000;

  // Private variables
  const that = this;
  let currentMode = null;
  let binaryPacket = false;
  let sendingActive = false;
  let timer = null;
  let client = null;
  let server = null;
  let serverSocket = null;
  let requestIndex = 0;
  const rawConcatBuffer = Buffer.allocUnsafe(MAX_PUBLISH_BUFFER_SIZE);
  let currentBufferSize = 0;
  let variableReadArray = [];
  let resultsArray = [];
  let port = 0;
  let host = null;
  const connectionRetryFrequency = 2000; // will try to reconnect for every 2 seconds
  let requestFrequencyMs = null;
  let netMachineShutdown = false;
  let netConnectionAlertFlag = false;
  let disconnectedTimer = null;
  let connectionReported = false;
  let serverConnectionTimer = null;

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  // Alert Object
  const CONNECTIVITY_ALERT = {
    key: `${machine.info.name}connectivity-alert`,
    msg: machine.info.name,
    description: 'not able to open connection. please verify the connection configuration',
  };
  const CLIENT_DISCONNECT_ALERT = {
    key: `${machine.info.name}connectivity-alert`,
    msg: machine.info.name,
    description: 'Client disconnected from the server',
  };
  const WAITING_FOR_CLIENT_ALERT = {
    key: `${machine.info.name}connectivity-alert`,
    msg: machine.info.name,
    description: 'waiting for the client to connect ...',
  };
  const FAILED_TO_GET_DATA_ALERT = {
    key: `${machine.info.name}connectivity-alert`,
    msg: machine.info.name,
    description: 'Failed to get the data',
  };

  // private methods

  //    debug function for dumping the contents of a a buffer in easy-to-read format, 16 bytes/line
  // function dumpBuffer(buffer) {
  //   var str = '';
  //   for (var i = 0; i < buffer.length; ++i) {
  //     if (buffer[i] < 16) {
  //       str += '0' + buffer[i].toString(16) + ' ';
  //     }
  //     else {
  //       str += buffer[i].toString(16) + ' ';
  //     }
  //     if ((((i + 1) % 16) === 0) || ((i + 1) == buffer.length)) {
  //       console.log(str);
  //       str = '';
  //     }
  //   }
  // }

  function convertType(format, resultAsString) {
    if (resultAsString !== null) {
      let result;
      switch (format) {
        case 'char':
          result = resultAsString;
          break;

        case 'int8':
        case 'int16':
        case 'int32':
        case 'int64':
        case 'uint8':
        case 'uint16':
        case 'uint32':
        case 'uint64':
          result = parseInt(resultAsString, 10);
          break;

        case 'float':
        case 'double':
          result = parseFloat(resultAsString);
          break;

        case 'bool':
          result = ((resultAsString === 'true') || (resultAsString === '1'));
          break;

        default:
          result = null;
          break;
      }

      return result;
    }
    return null;
  }

  function requestTimer() {
    // only start a new request if previous set has finished
    if ((sendingActive === false) && (variableReadArray.length !== 0)) {
      // reset storage and index for starting a new request set
      requestIndex = 0;
      resultsArray = [];
      const initialRequestKey = variableReadArray[0].requestKey;

      // make a tcp request for first var in list (but only if request key exists)
      // (requests are sent asynchronously to more easily match response with request)
      if (initialRequestKey !== undefined) {
        sendingActive = true;
        client.write(initialRequestKey);
        // now wait for processResponseData method to be called by 'on data'
      }
    }
  }

  function raiseAlert(ALERT_OBJECT, varName) {
    if (!netMachineShutdown) {
      if (currentMode === 'req/res as client') {
        if (timer) {
          clearInterval(timer);
        }
        timer = setInterval(requestTimer, requestFrequencyMs);
      }
      let customizedDesc = ALERT_OBJECT.description;
      if (varName) {
        customizedDesc = `${ALERT_OBJECT.description} for the variable: ${varName}`;
      }
      // raise alert
      alert.raise({
        key: ALERT_OBJECT.key,
        msg: ALERT_OBJECT.msg,
        description: customizedDesc,
      });
      netConnectionAlertFlag = true;
    }
    return true;
  }

  function clearAlert(ALERT_OBJECT) {
    if (netConnectionAlertFlag) {
      alert.clear(ALERT_OBJECT.key);
      netConnectionAlertFlag = false;
    }
    return true;
  }

  function saveResultsToDb() {
    const nullDataFlag = _.findIndex(resultsArray, item => item === null);
    // if delivering combined result, create one variable
    if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
      const combinedResultArray = [];
      for (let iVar = 0; iVar < resultsArray.length; iVar += 1) {
        const value = resultsArray[iVar];
        if (value === null) {
          log.error(`Failed to get data for variable ${variableReadArray[iVar].name}`);
          raiseAlert(FAILED_TO_GET_DATA_ALERT, variableReadArray[iVar].name);
        }

        combinedResultArray.push({
          name: variableReadArray[iVar].name,
          value,
        });

        if (nullDataFlag === -1) {
          clearAlert(FAILED_TO_GET_DATA_ALERT);
        }
      }
      that.dataCb(that.machine, deliverEntireResultVariable, combinedResultArray, (err, res) => {
        if (err) {
          log.error(err);
        }
        if (res) log.debug(res);
      });
    } else {
      // process the array of results
      async.forEachOfSeries(resultsArray, (dataItem, index, callback) => {
        // if there wasn't a result
        if (dataItem === null) {
          // highlight that there was an error getting this variables data
          log.error(`Failed to get data for variable ${variableReadArray[index].name}`);
          // and just move onto next item
          raiseAlert(FAILED_TO_GET_DATA_ALERT, variableReadArray[index].name);
          return callback();
        }
        if (nullDataFlag === -1) {
          clearAlert(FAILED_TO_GET_DATA_ALERT);
        }

        // othewise update the database
        that.dataCb(that.machine, variableReadArray[index], dataItem, (err, res) => {
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
  }

  function processPublishedDataBinaryPacket(data) {
    const variables = variableReadArray;
    const dataLength = data.length;

    // reset results array
    resultsArray = [];

    // loop through the stored variable list
    for (let i = 0; i < variables.length; i += 1) {
      // start with a null value in case we do not have valid data for this variable,
      // or a way of extracting it
      let varValue = null;

      const variable = variables[i];
      // make sure we actually have enough bytes to handle the variable
      let enoughData = true;
      if (variable.packetIndexEndian === 'MSB') {
        if ((variable.packetIndexPosition + variable.packetIndexLength) > dataLength) {
          enoughData = false;
        }
      } else if (variable.packetIndexPosition >= dataLength) {
        enoughData = false;
      } else if ((variable.packetIndexPosition - variable.packetIndexLength + 1) < 0) {
        enoughData = false;
      }
      if (enoughData) {
        varValue = 0;
        let index = variable.packetIndexPosition;
        let indexCount = variable.packetIndexLength;
        if (variable.packetIndexEndian === 'LSB') {
          index = index + indexCount - 1;
        }
        while (indexCount > 0) {
          varValue *= 256;
          varValue += data[index];
          if (variable.packetIndexEndian === 'MSB') {
            index += 1;
          } else {
            index += 1;
          }
          indexCount -= 1;
        }
      }

      // if we had data for this variable, store it in the variable's results array
      resultsArray.push(varValue);
    }

    // save all results to the database
    saveResultsToDb();
  }

  function processPublishedData(dataString) {
    const variables = variableReadArray;

    // if xml then add line feeds to the buffer after each xml object
    // to make gloabal regex's work better
    let dataStringMod = dataString;
    if (that.machine.settings.model.newLinesForXml === true) {
      const xmlEndRegEx = new RegExp('/>', 'g');
      dataStringMod = dataString.replace(xmlEndRegEx, '/>\n');
    }

    // reset results array
    resultsArray = [];

    let csvList = null;

    // loop through the stored variable list
    for (let i = 0; i < variables.length; i += 1) {
      // start with a null value in case we do not have valid data for this variable,
      // or a way of extracting it
      let varValue = null;

      // if delivering entire reponse, set the value to all data, possibly starting
      // at a specified CSV position
      const variable = variables[i];
      if (variable.regex !== undefined) {
        // if we are extracting this variable from the published data using a regex
        let matchArray;

        // if we are writing (possibly) multiple values into an array
        if (variable.array === true) {
          // intialize the storage as an array
          varValue = [];
          // create a global version of the regex
          const regex = new RegExp(variable.regex, 'g');
          // and find all matches of the regex
          matchArray = regex.exec(dataStringMod);
          while (matchArray !== null) {
            // storing each in an array as correct data type
            varValue.push(convertType(variable.format, matchArray[matchArray.length - 1]));
            matchArray = regex.exec(dataStringMod);
          }
          // convert empty array back to null if no results were found
          if (varValue.length === 0) {
            varValue = null;
          }
        } else {
          // use the regex to get a match from the returned data
          matchArray = dataStringMod.match(variable.regex);
          // if a match is found store it as correct data type
          if (matchArray) {
            varValue = convertType(variable.format, matchArray[matchArray.length - 1]);
          }
        }
      } else if (variable.csvPos !== undefined) {
        // if extracting this variable from the published data using comma seperation position
        // create the csv list if not already created
        if (csvList === null) {
          csvList = dataStringMod.split(that.machine.settings.model.separator);
        }

        // check if we have the required position in this list
        if (csvList.length > variable.csvPos) {
          // if so store it as correct data type
          varValue = convertType(variable.format, csvList[variable.csvPos].trim());
        }
      } else {
        // for no csv position, just return the entire string
        varValue = dataStringMod;
      }

      // if we had data for this variable, store it in the variable's results array
      resultsArray.push(varValue);
    }

    // save all results to the database
    saveResultsToDb();
  }

  function concatPublishedData(newData, terminator) {
    // check we have enough room to append the new data to our buffer
    if (currentBufferSize + newData.length <= MAX_PUBLISH_BUFFER_SIZE) {
      // if so copy in at correct offset and update our buffer size
      newData.copy(rawConcatBuffer, currentBufferSize);
      currentBufferSize += newData.length;

      // extract last of buffer as a string so we can check against terminator
      const endChars = rawConcatBuffer.toString('ascii', currentBufferSize - terminator.length, currentBufferSize);

      // test for a match
      if (endChars === terminator) {
        // a match, we must have the whole published message

        // pass string version to process function
        processPublishedData(rawConcatBuffer.toString('ascii', 0, currentBufferSize).trim());
        // and clear the buffer size ready for the next message
        currentBufferSize = 0;
      } else {
        // do nothing with the buffer, we do not have all the data yet
      }
    } else {
      currentBufferSize = 0;
      log.info('Publish buffer grown too large, deleting');
    }
  }

  function processResponseData(dataString) {
    // will be triggered for each repsonse to a request, assumes response is for last sent request

    // only attempt processing if we are expecting it
    if (sendingActive === true) {
      const variables = variableReadArray;

      // store the data in the results array based on TYPE
      resultsArray.push(convertType(variables[requestIndex].format, dataString));

      // send request for next var (if any left, else process whole array result)
      requestIndex += 1;
      if (requestIndex === variables.length) {
        sendingActive = false;
        // save all results to the database
        saveResultsToDb();
      } else {
        client.write(variables[requestIndex].requestKey);
      }
    }
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
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

  function clientConnection(callback) {
    const terminator = unescapeJs(that.machine.settings.model.publishTerminator);
    //        dumpBuffer(Buffer.from(terminator));
    // try and connect to server
    client = net.createConnection(port, host, () => {
      // succesfully connected to server
      clearAlert(CONNECTIVITY_ALERT);
      connectionDetected();
      updateConnectionStatus(true);

      // if using req/res mode then set up a repeat task to trigger the requests
      if (currentMode === 'req/res as client') {
        timer = setInterval(requestTimer, requestFrequencyMs);
      }
      return callback(null);
    });

    client.on('error', () => {
      // failed to connect to server, trigger a callback error
      if (!netMachineShutdown) {
        client.destroy();
        raiseAlert(CONNECTIVITY_ALERT);
        disconnectionDetected();
        updateConnectionStatus(false);
        sendingActive = false;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        setTimeout(() => {
          clientConnection(() => {
            log.error({
              err: 'connection failed! retrying ...',
            });
          });
        }, connectionRetryFrequency);
      }
      // callback(error);
    });

    // subscribe to on 'data' events
    client.on('data', (data) => {
      // got data from server
      if ((currentMode === 'pub/sub as client') || (currentMode === 'pub/sub as server')) {
        // check if we are expecting a whole buffer or we will be testing for whole buffer using
        // a terminator string compare
        if (binaryPacket) {
          processPublishedDataBinaryPacket(data);
        } else if (terminator.length > 0) {
          // pass data straight to concat function
          concatPublishedData(data, terminator);
        } else {
          // pass string version to process function
          processPublishedData(data.toString().trim());
        }
      } else if (currentMode === 'req/res as client') {
        processResponseData(data.toString().trim());
      }
    });

    // subscribe to on 'end' events
    client.on('end', () => {
      // this is this getting called, when we stop the machine, but also when we kill the server
      log.info('Disconnected from machine.');
      // raising alert to notify disconnection
      raiseAlert(CONNECTIVITY_ALERT);
      disconnectionDetected();
      updateConnectionStatus(false);
      // stop the request timer task if applicable
      if ((currentMode === 'req/res as client') && (timer)) {
        clearInterval(timer);
        timer = null;
        sendingActive = false;
      }
      // nothing else to do. User will have to disable/re-enable to try reconnecting to the server
    });

    return true;
  }

  function open(callback) {
    // save current mode as required by close method where config may have changed
    currentMode = that.machine.settings.model.mode;
    ({ binaryPacket } = that.machine.settings.model);
    currentBufferSize = 0;
    requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
    ({ port } = that.machine.settings.model);
    host = that.machine.settings.model.ipAddress;
    const terminator = unescapeJs(that.machine.settings.model.publishTerminator);
    //        dumpBuffer(Buffer.from(terminator));
    connectionReported = false;

    // if running in 'binaryPacket' mode,
    if (binaryPacket) {
      // do an initial check that all variables have a packet index,
      // packet length and MSB/LSB choice
      for (let i = 0; i < variableReadArray.length; i += 1) {
        if (variableReadArray[i].packetIndexPosition === undefined) {
          // return with an error if this is not the case
          return callback(new Error('All variables require a packet index position in binary packet mode'));
        }
        if (variableReadArray[i].packetIndexLength === undefined) {
          // return with an error if this is not the case
          return callback(new Error('All variables require a packet index length in binary packet mode'));
        }
        if (variableReadArray[i].packetIndexEndian === undefined) {
          // return with an error if this is not the case
          return callback(new Error('All variables require a packet index MSB/LSB choice in binary packet mode'));
        }
      }
    }

    // if running in 'req/res as client' mode,
    if (currentMode === 'req/res as client') {
      // do an initial check that all variables have a request key (shouldn't need if
      // json schema fully tests)
      for (let i = 0; i < variableReadArray.length; i += 1) {
        if (variableReadArray[i].requestKey === undefined) {
          // return with an error if this is not the case
          return callback(new Error('All variables require a request key in req/res mode'));
        }
      }
    }

    // if acting as a client..
    if ((currentMode === 'pub/sub as client') || (currentMode === 'req/res as client')) {
      // create the connection
      clientConnection(() => {
        callback(null);
      });
    } else { // if acting as a server..
      // set a timer to set any machine connected status variables to false after a delay
      // (the longer of the disconnect report time and 10 seconds) if no connection
      let serverConnectionTimeout = _.has(that.machine.settings.model, 'disconnectReportTime')
        ? 1000 * that.machine.settings.model.disconnectReportTime : SERVER_CONNECTION_TIMEOUT;
      if (serverConnectionTimeout < SERVER_CONNECTION_TIMEOUT) {
        serverConnectionTimeout = SERVER_CONNECTION_TIMEOUT;
      }
      serverConnectionTimer = setTimeout(() => {
        disconnectionDetected();
        updateConnectionStatus(false);
      }, serverConnectionTimeout);

      // raise an alert for client not connected (when client connects the alert will be cleared)
      raiseAlert(WAITING_FOR_CLIENT_ALERT);
      // create the server
      server = net.createServer((socket) => {
        // clear server connection timer
        if (serverConnectionTimer) {
          clearTimeout(serverConnectionTimer);
          serverConnectionTimer = null;
        }

        // client succesfully connected our server
        clearAlert(WAITING_FOR_CLIENT_ALERT);

        // clear alert if we already raised one when the client disconnects
        clearAlert(CLIENT_DISCONNECT_ALERT);

        // set any machine connected status variables to true
        connectionDetected();
        updateConnectionStatus(true);

        // if we are already connected to a client, close it
        if (serverSocket !== null) {
          log.info(`closing socket with client: ${serverSocket.remoteAddress}`);
          serverSocket.destroy();
        }

        log.info(`Connected to client: ${socket.remoteAddress}`);

        // store a reference to the socket (so we can destroy it if we need to close the server)
        serverSocket = socket;

        // subscribe to on 'data' events
        socket.on('data', (data) => {
          // got data from client
          // check if we are expecting a whole buffer or we will be testing for whole buffer
          // using a terminator string compare
          if (binaryPacket) {
            processPublishedDataBinaryPacket(data);
          } else if (terminator.length > 0) {
            // pass data straight to concat function
            concatPublishedData(data, terminator);
          } else {
            // pass string version to process function
            processPublishedData(data.toString().trim());
          }
        });

        // subscribe to on 'error' events
        socket.on('error', (error) => {
          // emit a disconnect back to the spark machine layer
          log.info(`Server error: ${error.message}`);
          // raise alert to notify client disconnects
          raiseAlert(CLIENT_DISCONNECT_ALERT);
          // set any machine connected status variables to false
          disconnectionDetected();
          updateConnectionStatus(false);
          socket.destroy();
          serverSocket = null;
        });

        // subscribe to on 'end' events
        socket.on('end', () => {
          // emit a disconnect back to the spark machine layer
          log.info('Client disconnected');
          // raise alert to notify client disconnects
          raiseAlert(CLIENT_DISCONNECT_ALERT);
          // set any machine connected status variables to false
          disconnectionDetected();
          updateConnectionStatus(false);
          socket.destroy();
          serverSocket = null;
        });
      }).listen(port);

      // for server, the callback happens immediately, we do not wait for
      // a client connection to declare 'open' a success
      callback(null);
    }
    return undefined;
  }

  function close(callback) {
    // close the client or server port if open
    if ((client === null) && (server === null)) {
      return callback(new Error('No Net Device To Close'));
    }

    updateConnectionStatus(false);

    // if we are currently in a request/response cycle (for req/res client type)
    if ((sendingActive === true)) {
      // hold off on closing using an interval timer
      let waitCounter = 0;
      const activeWait = setInterval(() => {
        // until safe to do so
        if ((sendingActive === false) || (waitCounter > 20)) {
          sendingActive = false;
          clearInterval(activeWait);
          client.destroy();
          return callback();
        }
        waitCounter += 1;
        return undefined;
      }, 100); // interval set at 100 milliseconds
    } else {
      // otherwise close immeditalely
      if (currentMode !== 'pub/sub as server') {
        // for a client
        client.destroy();
        return callback();
      }
      // for a server
      server.close(callback); // callback only trigger when all sockets have been destroyed

      //  if server has an active connection, the socket used must also be destoyed for the
      // above close to be succesful
      if (serverSocket !== null) {
        serverSocket.destroy();
        serverSocket = null;
      }
    }
    return undefined;
  }


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

    netMachineShutdown = false;

    // build an array of variables to be read, including acces property
    variableReadArray = [];
    async.forEachSeries(that.machine.variables, (item, callback) => {
      // skip machine connected variables
      if (!_.has(item, 'machineConnected') || !item.machineConnected) {
        if (!(item.access === 'write' || item.access === 'read')) {
          const itemNoAccess = item;
          itemNoAccess.access = 'read';
          variableReadArray.push(itemNoAccess);
        } else if (item.access === 'read') {
          variableReadArray.push(item);
        }
      }
      return callback();
    });

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

    // stop the request timer task (if being used)
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }

    netMachineShutdown = true;
    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }

      // close client or server if either is open
      if (client || server) {
        close((closeErr) => {
          if (closeErr) {
            log.error(closeErr);
          }
          client = null;
          server = null;
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
  hpl: hplNet,
  defaults,
  schema,
};
