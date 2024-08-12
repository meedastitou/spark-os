/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const opcua = require('node-opcua');
// eslint-disable-next-line import/no-extraneous-dependencies
const { MessageSecurityMode, SecurityPolicy } = require('node-opcua-secure-channel');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplOpcua = function hplOpcua(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;
  let timer = null;
  let client = null;
  let session = null;
  let subscription = null;
  let connected = false;
  let operatingScheme;
  let anyEventVariables = false;
  let eventValueNames = [];
  let eventValueMemberNumbers = [];
  let sendingActive = false;
  let activeSubscriptions = false;
  let monitoredItems = [];
  let variableNodeIdList = [];
  let variablesObj = {};
  let variableReadArray = [];
  let opcuaMachineShutdown = false;
  let opcuaMachineConnectionAlertFlag;
  let disconnectedTimer = null;
  let connectionReported = false;
  let disconnectionReported = false;
  let disconnectReconnectTimer = null;

  let pubsubReportTimer = null;
  let pubsubCombinedResultDwellTime = 1000;
  let pubsubCombinedResultReportCountLimit = 20;
  let pubsubCombinedResultReportCount = 0;

  let lastPublishTimestamp = 0;
  const publishWarningTime = 100;

  let combinedResult = {};
  const combinedResultVariable = {
    name: 'CombinedResult',
    description: 'CombinedResult',
    format: 'char',
    array: true,
  };

  const RECONNECT_INTERVAL = 5000;
  const SERVER_NODE_ID = 'i=2253';

  // var reconnectionFlag = false;

  const clientOptions = {
    connectionStrategy: {
      maxRetry: 10,
    },
    endpointMustExist: false,
  };

  // Alert Objects
  const CONNECTIVITY_ALERT = {
    key: `${machine.info.name}-connectivity-alert`,
    msg: machine.info.name,
    description: 'not able to open connection. Please verify the connection configuration',
  };
  const DATA_LOST_ALERT = {
    key: `${machine.info.name}-connectivity-alert`,
    msg: machine.info.name,
    description: 'No response from the machine. Check the connection',
  };
  const BAD_NODE_ID_ALERT = {
    key: `${machine.info.name}-connectivity-alert`,
    msg: machine.info.name,
    description: 'The node id refers to a node that does not exist in the server address space',
  };
  const FAILED_TO_GET_DATA_ALERT = {
    key: `${machine.info.name}-connectivity-alert`,
    msg: machine.info.name,
    description: 'Failed to get data',
  };
  const BAD_INDEXRANGE_ALERT = {
    key: `${machine.info.name}-connectivity-alert`,
    msg: machine.info.name,
    description: 'Array Index provided is out of range',
  };

  // preload alert message that have known keys
  alert.preLoad({
    'bad-data-unavailable': {
      msg: `${machine.info.name}: DataUnavailable Error`,
      description: x => `Variable ${x.variableName}. Error: ${x.errorMsg} `,
    },
    'authentication-error': {
      msg: `${machine.info.name}: Authentication Error`,
      description: x => `Not able to open connection. ${x.errorMsg}`,
    },
    'status-code-uncertain-error': {
      msg: `${machine.info.name}: Status Code Uncertain`,
      description: x => `Received status code: Uncertain for monitored variable: ${x.variableName}`,
    },
    'unhandled-status-code-error': {
      msg: `${machine.info.name}: Unhandled Status Code`,
      description: x => `Received status code: ${x.errorMsg} for monitored variable: ${x.variableName}`,
    },
    'no-nodeId-error': {
      msg: `${machine.info.name}: No Node Id Error`,
      description: x => `The monitored variable ${x.variableName} does not have a node Id defined`,
    },
    'no-event-value-name-error': {
      msg: `${machine.info.name}: No Event Value Name Error`,
      description: x => `The event value variable ${x.variableName} does not have an event value name defined`,
    },
    'no-event-value-structure-members-error': {
      msg: `${machine.info.name}: No Event Value Structure Members Error`,
      description: x => `The structure event value variable ${x.variableName} does not have any members defined`,
    },
    'no-event-value-value-member-error': {
      msg: `${machine.info.name}: No Event Value Structure Value Member Error`,
      description: x => `The structure event value variable ${x.variableName} does not have a value member defined`,
    },
    'too-many-event-value-name-members-error': {
      msg: `${machine.info.name}: Too Many Event Value Structure Name Members Error`,
      description: x => `The structure event value variable ${x.variableName} has more than one name member defined`,
    },
    'too-many-event-value-match-members-error': {
      msg: `${machine.info.name}: Too Many Event Value Structure Match Value Members Error`,
      description: x => `The structure event value variable ${x.variableName} has more than one match value member defined`,
    },
  });

  // public variables
  that.eventMonitoringItem = null;
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine, {
    settings: {
      model,
    },
  });

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function updateConnectionStatus(connectedStatus) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connectedStatus, () => {});
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  updateConnectionStatus(false);

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function checkPublishTiming() {
      let currentPublishTimestamp = new Date();
      if (lastPublishTimestamp) {
        let elapsedSeconds = Math.round((currentPublishTimestamp - lastPublishTimestamp) / 1000);
        if (elapsedSeconds >= publishWarningTime) {
          console.log(`------- OPCUA Publish Gap = ${elapsedSeconds}`);
        }
      }
      lastPublishTimestamp = currentPublishTimestamp;
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function raiseAlert(ALERT_OBJECT, varName) {
    if (!opcuaMachineShutdown) {
      if (operatingScheme === 'req/res' && session) {
        if (timer) {
          clearInterval(timer);
        }
        const requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
        // eslint-disable-next-line no-use-before-define
        timer = setInterval(readTimer, requestFrequencyMs);
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
      opcuaMachineConnectionAlertFlag = true;
    }
    return true;
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function clearAlert(ALERT_OBJECT) {
    if (opcuaMachineConnectionAlertFlag) {
      alert.clear(ALERT_OBJECT.key);
      opcuaMachineConnectionAlertFlag = false;
    }
    return true;
  }

  // private methods
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function disconnectionDetected() {
    // ingore disconectiong if already know disconnected o rdisconnection already reported
    if (disconnectedTimer || disconnectionReported) return;

    // start a timer to set any machine connected variables to false
    disconnectedTimer = setTimeout(() => {
      disconnectedTimer = null;
      connectionReported = false;
      disconnectionReported = true;
      async.forEachSeries(that.machine.variables, (variable, callback) => {
        // set only machine connected variables to false
        if (_.has(variable, 'machineConnected') && variable.machineConnected) {
          checkPublishTiming();
          that.dataCb(that.machine, variable, false, (err, res) => {
            if (err) log.error(err);
            if (res) log.debug(res);
          });
        }

        callback();
      });
    }, _.has(that.machine.settings.model, 'disconnectReportTime') ? 1000 * that.machine.settings.model.disconnectReportTime : 0);
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function connectionDetected() {
    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = false;
    }

    // if connection alreay reported, don't report it again
    if (connectionReported) return;
    connectionReported = true;
    disconnectionReported = false;

    async.forEachSeries(that.machine.variables, (variable, callback) => {
      // set only machine connected variables to true
      if (_.has(variable, 'machineConnected') && variable.machineConnected) {
        checkPublishTiming();
        that.dataCb(that.machine, variable, true, (err, res) => {
          if (err) log.error(err);
          if (res) log.debug(res);
        });
      }

      callback();
    });
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function disconnectReconnect() {
    // prevent read timer event from occurring until reconnected
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    // first close the connectionStrategy
    // eslint-disable-next-line no-use-before-define
    close((closeError) => {
      if (closeError) {
        log.error(closeError);
      }
      client = null;
      session = null;
      connected = false;
      disconnectReconnectTimer = setTimeout(() => {
        // now reopend the connection
        // eslint-disable-next-line no-use-before-define
        open((openError) => {
          if (openError) {
            log.error(openError);
            disconnectReconnect();
          }
        });
      }, RECONNECT_INTERVAL);
    });
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function pubsubReportCombinedResult() {

    if (!_.has(combinedResult, "timestamp")) {
      combinedResult.timestamp = new Date(Date.now()).toISOString();
    }

    // the CombinedResults variable is expecting to see an array.  So even though we
    // only have a single entry, add it as an aray to normalize it for cloud processing.
    var combinedResultsArray = [];
    combinedResultsArray.push(combinedResult);

    console.log('>>>>> combinedResultsArray = ' + JSON.stringify(combinedResultsArray));

    checkPublishTiming();
    that.dataCb(that.machine, combinedResultVariable, combinedResultsArray,
                (err, res) => {
      if (err) {
        log.error(err);
      }
      if (res) log.debug(res);
    });

    // get ready for the next pub/sub combined delivery
    pubsubCombinedResultReportCount = 0;
    if (pubsubReportTimer !== null) {
      clearTimeout(pubsubReportTimer);
      pubsubReportTimer = null;
    }
    combinedResult = {};

  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  // helper function to update the database with the value
  // of the variable and any destination variables
  function updateDatabaseForVariable(variable, dataItem) {
    let value = null;
    if ((dataItem.statusCode.name === 'Good') || (dataItem.statusCode.name === 'Uncertain') ||
        (dataItem.statusCode.value === 0) || (dataItem.statusCode.value === 1073741824)) {
      ({ value } = dataItem);
      if (variable.array) {
        let content = null;
        const output = [];
        const checkDataValue = _.get(dataItem, 'value', null);
        if ((_.isEqual(checkDataValue.dataType.toString(), 'DataValue'))
            || (_.isEqual(checkDataValue.dataType.toString(), 'Variant'))
            || (checkDataValue.dataType === opcua.DataType.DataValue)
            || (checkDataValue.dataType === opcua.DataType.Variant)) {
          if ((_.isEqual(checkDataValue.dataType.toString(), 'DataValue'))
              || (checkDataValue.dataType === opcua.DataType.DataValue)) {
            const checkVariant = _.get(checkDataValue.value[0], 'value', null);
            if ((_.isEqual(checkVariant.dataType.toString(), 'Variant'))
                || (checkVariant.dataType === opcua.DataType.Variant)) {
              content = checkVariant.value;
            }
          } else if ((_.isEqual(checkDataValue.dataType.toString(), 'Variant'))
                     || (checkDataValue.dataType === opcua.DataType.Variant)) {
            content = checkDataValue.value;
          }
          async.forEachOfSeries(content, (item, index, cb) => {
            if (_.has(item, 'value.text')) {
              output.push(item.value.text);
            } else if (_.has(item, 'value')) {
              if (variable.format === 'char') {
                output.push(item.value.toString());
              } else {
                output.push(item.value);
              }
            } else {
              output.push(null);
            }
            cb();
          });
          value.value = output;
        } else {
          async.mapValuesSeries(dataItem.value.value, (mapValue, key, cb) => {
            output.push(mapValue);
            cb();
          });
          value.value = output;
        }
        // if not array handle 64-values: stored as 2-element array, [high, low]
      } else if ((variable.format === 'int64') || (variable.format === 'uint64')) {
        if (_.isArray(value.value) && (value.value.length === 2)) {
          value.value = value.value[1] + (0x100000000 * value.value[0]);
        }
      }

      // if there wasn't a result
      if (value.value === null) {
        // highlight that there was an error getting this variables data
        log.error(`Failed to get data for variable ${variable.name}`);
        // and just move onto next item
        if (value.dataType === 0) {
          raiseAlert(FAILED_TO_GET_DATA_ALERT, variable.name);
        }
      } else {
        // check whether the value is an array and this variable has array destination variables
        let bArrayDesinationVariables = false;
        if (_.has(variable, 'array') && _.has(variable, 'destVariables')) {
          if ((variable.array) && _.isArrayLikeObject(value.value)) {
            bArrayDesinationVariables = true;
          }
        }

        // if any destination variables, set them in the database
        if (bArrayDesinationVariables) {
          if ((operatingScheme === 'pub/sub') &&
              (_.get(that.machine.settings.model, 'deliverCombinedResult', false))) {
             // we're using pub/sub, reset our timer until all the destination variables are handled
            if (pubsubReportTimer !== null) {
              clearTimeout(pubsubReportTimer);
              pubsubReportTimer = null;
            }
          }

          async.forEachSeries(variable.destVariables, (destVariable, callback) => {
            // make sure array index within range of variable array
            if (destVariable.arrayIndex >= value.value.length) {
              log.error(`Array index out of range for destination variable ${destVariable.destVariable}`);
              // and just move onto next destination variable
              callback();
            } else { // if in range, update the database
//              if ((operatingScheme === 'pub/sub') ||
//                  (!_.get(that.machine.settings.model, 'deliverCombinedResult', false))) {

              // if we're not creating a combined-result, simply deliver the variable now
              if (!_.get(that.machine.settings.model, 'deliverCombinedResult', false)) {
                const destVarObj = {
                  name: destVariable.destVariable,
                  description: `Destination variable ${destVariable.destVariable}`,
                  format: variable.format,
                  access: variable.access,
                  arrayIndex: destVariable.arrayIndex,
                  onChange: _.get(destVariable, 'onChange', _.get(variable, 'onChange', false)),
                  onChangeDelta: destVariable.onChangeDelta,
                };
                checkPublishTiming();
                that.dataCb(that.machine, destVarObj, value.value[destVariable.arrayIndex],
                            (err, res) => {
                  if (err) {
                    log.error(err);
                  }
                  if (res) log.debug(res);
                  // move onto next destination variable once stored in db
                  callback();
                });
              } else {
                if (operatingScheme === 'pub/sub') {
                  console.log('>>>>> received pubsub destination variable: ' + destVariable.destVariable);
                }
                combinedResult[destVariable.destVariable] = value.value[destVariable.arrayIndex];
                callback();
              }
            }
          });

          if ((operatingScheme === 'pub/sub') &&
              (_.get(that.machine.settings.model, 'deliverCombinedResult', false))) {
             // we're using pub/sub, reset our timer and check our count to see if it's time to deliver the combined-result
            if (pubsubReportTimer !== null) {
              clearTimeout(pubsubReportTimer);
              pubsubReportTimer = null;
            }
            pubsubCombinedResultReportCount += 1;
            if (pubsubCombinedResultReportCount >= pubsubCombinedResultReportCountLimit) {
              // we've hit our limit of updates without seeing a break long enough to trigger our dwell timer,
              // so go ahead and sent the combined-result now
              pubsubReportCombinedResult();
            } else {
              pubsubReportTimer = setTimeout(pubsubReportCombinedResult, pubsubCombinedResultDwellTime);
            }
          }

        }

        // otherwise update the database
//        if ((operatingScheme === 'pub/sub') ||
//            (!_.get(that.machine.settings.model, 'deliverCombinedResult', false))) {
        if (!_.get(that.machine.settings.model, 'deliverCombinedResult', false)) {
          checkPublishTiming();
          that.dataCb(that.machine, variable, value.value, (err, res) => {
            if (err) {
              log.error(err);
            }
            if (res) log.debug(res);
          });
        } else {
          if (operatingScheme === 'pub/sub') {
            console.log('>>>>> received pubsub variable: ' + variable.name);
          }
          combinedResult[variable.name] = value.value;
          if (operatingScheme === 'pub/sub') {
             // we're using pub/sub, reset our timer and check our count to see if it's time to deliver the combined-result
            if (pubsubReportTimer !== null) {
              clearTimeout(pubsubReportTimer);
              pubsubReportTimer = null;
            }
            pubsubCombinedResultReportCount += 1;
            if (pubsubCombinedResultReportCount >= pubsubCombinedResultReportCountLimit) {
              // we've hit our limit of updates without seeing a break long enough to trigger our dwell timer,
              // so go ahead and sent the combined-result now
              pubsubReportCombinedResult();
            } else {
              pubsubReportTimer = setTimeout(pubsubReportCombinedResult, pubsubCombinedResultDwellTime);
            }
          }
        }

      }
    } else if (dataItem.statusCode.name === 'BadDataUnavailable') {
      alert.raise({ key: 'bad-data-unavailable', errorMsg: dataItem.statusCode.description, variableName: variable.name });
    }
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function readTimer() {
    // check we are not still processing last request
    if ((sendingActive === false) && (session)) {
      sendingActive = true;

      // read the latest data from each of the variables
      session.readVariableValue(variableNodeIdList, (err, dataArray) => {
        if (err) {
          log.error(err);
          sendingActive = false;
          disconnectionDetected();
          updateConnectionStatus(false);
          raiseAlert(DATA_LOST_ALERT);
          disconnectReconnect();
          return;
        }
        // checking if the status contains BadNodeIdUnknown, if it is then no need to clear alert
        // later(To Avoid: BadNodeId status and then Good status might clear BadNodeId alert)
        const badNodeIdIndex = _.findIndex(dataArray, item => item.statusCode.name === 'BadNodeIdUnknown');

        // clear the combinedResults object
        combinedResult = {};

        // process the array of results
        let reconnectRequiredFlag = false;
        let badNodeIDUnknownFlag = false;
        let statusCodeUncertainFlag = false;
        let unhandledStatusCodeFlag = false;
        async.forEachOfSeries(dataArray, (dataItem, index, callback) => {
          if (variableReadArray[index]) { // make sure we actually have a variable to process
            if (dataItem.statusCode.name === 'Good') {
              updateDatabaseForVariable(variableReadArray[index], dataItem);
              if (opcuaMachineConnectionAlertFlag && badNodeIdIndex === -1) {
                connectionDetected();
                updateConnectionStatus(true);
                clearAlert(DATA_LOST_ALERT);
              }
            } else if (dataItem.statusCode.name === 'BadNodeIdUnknown') {
              raiseAlert(BAD_NODE_ID_ALERT, variableReadArray[index].name);
              badNodeIDUnknownFlag = true;
            } else if (dataItem.statusCode.name === 'Uncertain') {
              // even though the varia ble is 'Uncertain', fill in the value we received.  But throw an alert
              updateDatabaseForVariable(variableReadArray[index], dataItem);
              alert.raise({ key: 'status-code-uncertain-error', variableName: variableReadArray[index].name });
              statusCodeUncertainFlag = true;
            } else {
              alert.raise({ key: 'unhandled-status-code-error', variableName: variableReadArray[index].name, errorMsg: dataItem.statusCode.name });
              unhandledStatusCodeFlag = true;
              // since we are reporting this unhandled status code, we don't have any reason to reconnect
              // reconnectRequiredFlag = true;
            }
          }
          callback();
        }, () => {
          // if we're handling a combined result delivery, send it now
          if ((operatingScheme === 'req/res') &&
              (_.get(that.machine.settings.model, 'deliverCombinedResult', false))) {
            // only add the timestamp field if we don't already have one
            if (!_.has(combinedResult, "timestamp")) {
              combinedResult.timestamp = new Date(Date.now()).toISOString();
            }

            // the CombinedResults variable is expecting to see an array.  So even though we
            // only have a single entry, add it as an aray to normalize it for cloud processing.
            var combinedResultsArray = [];
            combinedResultsArray.push(combinedResult);
            //console.log('combinedResultsArray = ' + JSON.stringify(combinedResultsArray));

            checkPublishTiming();
            that.dataCb(that.machine, combinedResultVariable, combinedResultsArray,
                        (err, res) => {
              if (err) {
                log.error(err);
              }
              if (res) log.debug(res);
            });
          }
          if (reconnectRequiredFlag) {
            disconnectionDetected();
            updateConnectionStatus(false);
            raiseAlert(FAILED_TO_GET_DATA_ALERT, variableReadArray[index].name);
            disconnectReconnect();
          }
          if (!badNodeIDUnknownFlag) {
            clearAlert(BAD_NODE_ID_ALERT);
          }
          if (!statusCodeUncertainFlag) {
            alert.clear('status-code-uncertain-error');
          }
          if (!unhandledStatusCodeFlag) {
            alert.clear('unhandled-status-code-error');
          }

          // done, so set active flag back to false
          sendingActive = false;
        });
      });
    }
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  // returns true if a variable already exists
  function variableExists(variableName) {
    const nVars = that.machine.variables.length;
    for (let iVar = 0; iVar < nVars; iVar += 1) {
      if (variableName === that.machine.variables[iVar].name) return true;
    }

    return false;
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function getClientOptions() {
    // set the security mode and policy
    switch (_.get(that.machine.settings.model, 'securityMode', 'None')) {
      case 'Sign':
        clientOptions.securityMode = MessageSecurityMode.Sign;
        break;
      case 'Sign & Encrypt':
        clientOptions.securityMode = MessageSecurityMode.SignAndEncrypt;
        break;
      default:
        clientOptions.securityMode = MessageSecurityMode.None;
    }

    switch (_.get(that.machine.settings.model, 'securityPolicy', 'None')) {
      case 'Basic128':
        clientOptions.securityPolicy = SecurityPolicy.Basic128;
        break;
      case 'Basic128Rsa15':
        clientOptions.securityPolicy = SecurityPolicy.Basic128Rsa15;
        break;
      case 'Basic192':
        clientOptions.securityPolicy = SecurityPolicy.Basic192;
        break;
      case 'Basic192Rsa15':
        clientOptions.securityPolicy = SecurityPolicy.Basic192Rsa15;
        break;
      case 'Basic256':
        clientOptions.securityPolicy = SecurityPolicy.Basic256;
        break;
      case 'Basic256Rsa15':
        clientOptions.securityPolicy = SecurityPolicy.Basic256Rsa15;
        break;
      case 'Basic256Sha256':
        clientOptions.securityPolicy = SecurityPolicy.Basic256Sha256;
        break;
      case 'Aes128_Sha256_RsaOaep':
        clientOptions.securityPolicy = SecurityPolicy.Aes128_Sha256_RsaOaep;
        break;
      default:
        clientOptions.securityPolicy = SecurityPolicy.None;
    }

    return clientOptions;
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function getEventValueMemberNumbers(variable) {
    const memberNumbers = {
      value: 0,
      name: -1,
      match: -1,
    };
    const members = _.get(variable, 'eventValueStructureMembers', []);
    let iMember;

    // search for a member with a Value special role
    for (iMember = 0; iMember < members.length; iMember += 1) {
      if (members[iMember].memberSpecialRole === 'Value') {
        memberNumbers.value = iMember;
        break;
      }
    }
    // if no memeber has a Value special role, seach for one with the name 'value'
    if (iMember === members.length) {
      for (iMember = 0; iMember < members.length; iMember += 1) {
        if (members[iMember].memberName.toLowerCase() === 'value') {
          memberNumbers.value = iMember;
          break;
        }
      }
    }

    // search for a member with a Name special role
    for (iMember = 0; iMember < members.length; iMember += 1) {
      if (members[iMember].memberSpecialRole === 'Name') {
        memberNumbers.name = iMember;
        break;
      }
    }
    // if no memeber has a Name special role, seach for one with the name 'name'
    if (iMember === members.length) {
      for (iMember = 0; iMember < members.length; iMember += 1) {
        if (members[iMember].memberName.toLowerCase() === 'name') {
          memberNumbers.name = iMember;
          break;
        }
      }
    }

    // search for a member with a Match Value  special role
    for (iMember = 0; iMember < members.length; iMember += 1) {
      if (members[iMember].memberSpecialRole === 'Match Value') {
        memberNumbers.match = iMember;
        break;
      }
    }

    return memberNumbers;
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  // function getEventValueMemberValues(variable, memberNumbers, buffer) {
  //   const memberValues = {
  //     value: null,
  //     name: null,
  //     match: null,
  //   };
  //   let lastMemberNumber = 0;
  //   if (memberNumbers.value > lastMemberNumber) lastMemberNumber = memberNumbers.value;
  //   if (memberNumbers.name > lastMemberNumber) lastMemberNumber = memberNumbers.name;
  //   if (memberNumbers.match > lastMemberNumber) lastMemberNumber = memberNumbers.match;
  //   const members = _.get(variable, 'eventValueStructureMembers', []);
  //   let iBuf = 4;
  //   for (let iMember = 0; iMember <= lastMemberNumber; iMember += 1) {
  //     let value = null;
  //     switch (members[iMember].memberFormat) {
  //       case 'float':
  //         value = buffer.readFloatLE(iBuf);
  //         iBuf += 4;
  //         break;
  //       case 'double':
  //         value = buffer.readDoubleLE(iBuf);
  //         iBuf += 8;
  //         break;
  //       case 'int8':
  //         value = buffer.readInt8(iBuf);
  //         iBuf += 1;
  //         break;
  //       case 'int16':
  //         value = buffer.readInt16LE(iBuf);
  //         iBuf += 2;
  //         break;
  //       case 'int32':
  //         value = buffer.readInt32LE(iBuf);
  //         iBuf += 4;
  //         break;
  //       case 'int64': {
  //         const low = buffer.readInt32LE(iBuf);
  //         value = (buffer.readInt32LE(iBuf + 4) * 4294967296.0) + low;
  //         if (low < 0) value += 4294967296;
  //         iBuf += 8;
  //         break;
  //       }
  //       case 'uint8':
  //         value = buffer.readUInt8(iBuf);
  //         iBuf += 1;
  //         break;
  //       case 'uint16':
  //         value = buffer.readUInt16LE(iBuf);
  //         iBuf += 2;
  //         break;
  //       case 'uint32':
  //         value = buffer.readUInt32LE(iBuf);
  //         iBuf += 4;
  //         break;
  //       case 'uint64':
  //         value = (buffer.readUInt32LE(iBuf + 4) * 4294967296.0) + buffer.readUInt32LE(iBuf);
  //         iBuf += 8;
  //         break;
  //       case 'char': {
  //         const len = buffer.readUInt32LE(iBuf);
  //         iBuf += 4;
  //         value = buffer.toString('utf8', iBuf, iBuf + len);
  //         iBuf += len;
  //         break;
  //       }
  //       case 'bool':
  //         value = buffer.readUInt8(iBuf) !== 0;
  //         iBuf += 1;
  //         break;
  //       default:
  //     }
  //
  //     if (iMember === memberNumbers.value) memberValues.value = value;
  //     if (iMember === memberNumbers.name) memberValues.name = value;
  //     if (iMember === memberNumbers.match) memberValues.match = value;
  //   }
  //   return memberValues;
  // }

  // function convertStringValue(stringValue, format) {
  //   let value = null;
  //   switch (format) {
  //     case 'float':
  //     case 'double':
  //       value = parseFloat(stringValue);
  //       break;
  //     case 'int8':
  //     case 'int16':
  //     case 'int32':
  //     case 'int64':
  //     case 'uint8':
  //     case 'uint16':
  //     case 'uint32':
  //     case 'uint64':
  //       value = parseInt(stringValue, 10);
  //       break;
  //     case 'char': {
  //       value = stringValue;
  //       break;
  //     }
  //     case 'bool': {
  //       const stringLower = stringValue.toLowerCase().trim();
  //       value = (stringLower === 'true') || (stringLower === '1');
  //       break;
  //     }
  //     default:
  //   }
  //
  //   return value;
  // }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function open(callback) {
    connectionReported = false;
    disconnectionReported = false;

    pubsubCombinedResultReportCount = 0;

    client = opcua.OPCUAClient.create(getClientOptions());

    // listen to backoff event to raise alert if OPC-UA server is not running initially
    const connectionDiscoveryError = function connectionDiscoveryError() {
      disconnectionDetected();
      updateConnectionStatus(false);
      raiseAlert(CONNECTIVITY_ALERT);
    };
    client.on('backoff', connectionDiscoveryError);

    operatingScheme = that.machine.settings.model.scheme;
    pubsubCombinedResultDwellTime = that.machine.settings.model.pubsubCombinedResultReportDwellTimeout;
    pubsubCombinedResultReportCountLimit = that.machine.settings.model.pubsubCombinedResultOverrideCount;
    pubsubCombinedResultReportCount = 0;


    const url = `opc.tcp://${that.machine.settings.model.opcuaHost}:${that.machine.settings.model.opcuaPort}`;

    async.series([

      // connect to the server (times out if failure as we have a maxRetry count above)
      (cb) => {
        // change current working directory to /tmp temporarily to allow opcua to write certificate
        const cwd = process.cwd();
        process.chdir('/tmp');
        client.connect(url, (err) => {
          process.chdir(cwd);
          if (!err) {
            connected = true;
            connectionDetected();
            updateConnectionStatus(true);
            clearAlert(CONNECTIVITY_ALERT);
          } else {
            disconnectionDetected();
            updateConnectionStatus(false);
            raiseAlert(CONNECTIVITY_ALERT);
          }
          if (client) client.removeListener('backoff', connectionDiscoveryError);
          cb(err);
        });
      },

      // create the session
      (cb) => {
        let authParams;
        if (that.machine.settings.model.authentication) {
          authParams = {
            userName: that.machine.settings.model.username,
            password: that.machine.settings.model.password,
          };
        }

        client.createSession(authParams, (err, newSession) => {
          if (!err) {
            session = newSession;
            log.info('OPC-UA Client Session created');
          } else if (_.includes(err.toString(), 'BadIdentityTokenRejected')) {
            alert.raise({ key: 'authentication-error', errorMsg: 'Please provide valid username and password' });
          } else if (_.includes(err.toString(), 'Cannot find USERNAME user token policy')) {
            alert.raise({ key: 'authentication-error', errorMsg: "Make sure you disable username and password if server doesn't require" });
          }
          cb(err);
        });
      },
      // create a subsciption if pub/sub mode or any event variables
      (cb) => {
        if (anyEventVariables || (operatingScheme === 'pub/sub')) {
          subscription = opcua.ClientSubscription.create(session, {
            // TODO set these options correctly
            requestedPublishingInterval: 1000,
            requestedLifetimeCount: 10,
            requestedMaxKeepAliveCount: 2,
            maxNotificationsPerPublish: 10,
            publishingEnabled: true,
            priority: 10,
          });

          subscription.on('started', () => {
            activeSubscriptions = true;

            log.info('subscription started, subscriptionId=', subscription.subscriptionId);
            console.log('subscription started, subscriptionId=', subscription.subscriptionId);
          }).on('keepalive', () => {
            // console.log("subscription - keepalive");
          }).on('terminated', () => {
            activeSubscriptions = false;
          });
        }

        // if any events, create and event monitored item
        if (anyEventVariables) {
          // build a list of unique event value names and optional structure infos
          eventValueNames = [];
          eventValueMemberNumbers = [];
          const nVars = that.machine.variables.length;
          for (let iVar = 0; iVar < nVars; iVar += 1) {
            const variable = that.machine.variables[iVar];
            if ((_.get(variable, 'type', 'Monitored') === 'Event Value')
                || (_.get(variable, 'type', 'Monitored') === 'Event Value-curves')) {
              if (!eventValueNames.includes(variable.eventValueName)) {
                eventValueNames.push(variable.eventValueName);
              }
              if (_.get(variable, 'eventValueStructure', false)) {
                eventValueMemberNumbers.push(getEventValueMemberNumbers(variable));
              } else {
                eventValueMemberNumbers.push({});
              }
            }
          }

          eventValueNames = ['EngelCycleParametersEventType'];
          let eventTypeIds = 'ns=1;i=21206';
          eventValueMemberNumbers = [];
console.log('-----eventValueNames = ' + JSON.stringify(eventValueNames));
console.log('-----eventValueMemberNumbers = ' + JSON.stringify(eventValueMemberNumbers));
          // create the event monitored item
          that.eventMonitoringItem = opcua.ClientMonitoredItem.create(subscription, {
            nodeId: SERVER_NODE_ID,
            attributeId: opcua.AttributeIds.EventNotifier,
          }, {
            queueSize: 100000,
            filter: opcua.constructEventFilter(eventValueNames, [opcua.resolveNodeId(eventTypeIds)]),
            discardOldest: true,
          });


          that.eventMonitoringItem.on('changed', (eventFields) => {
console.log('------eventMonitoringItem-changed: eventFields = ' + JSON.stringify(eventFields));
            // update the value of each event variable
            async.forEachOfSeries(that.machine.variables, (variable, index, cb2) => {
              if (_.get(variable, 'type', 'Monitored') === 'Event Value') {
                const iField = eventValueNames.indexOf(variable.eventValueName);
                if ((iField !== -1) && (iField < eventFields.length)) {
                  let value = null;
                  if (_.get(variable, 'eventValueStructure', false)) {
                    if (eventFields[iField].arrayType === 0) {
                      ({ value } = eventFields[iField]);
                    } else {
                      // if array of structures, find the one with correct name and/or match value
                      const nStruct = eventFields[iField].value.length;
                      for (let iStruct = 0; iStruct < nStruct; iStruct += 1) {
                        if (eventFields[iField].value[iStruct].name
                            === variable.eventValueSelectedStructureName) {
                          // check if this is the structure we're looking for
                          if (_.has(variable, 'eventValueSelectedStructureMatchField')) {
                            // check if there's a field we're supposed to use for a match
                            const field = variable.eventValueSelectedStructureMatchField;
                            if (_.has(eventFields[iField].value[iStruct], field)) {
                              // check that the structure HAS that field
                              if (variable.eventValueSelectedStructureMatchValue
                                  === eventFields[iField].value[iStruct][field].toString()) {
                                ({ value } = eventFields[iField].value[iStruct]);
                                break;
                              }
                            }
                          }
                        }
                      }
                    }
                  } else {
                    ({ value } = eventFields[iField]);
                  }

                  checkPublishTiming();
                  that.dataCb(that.machine, variable, value, (err, res) => {
                    if (err) {
                      log.error(err);
                    }
                    if (res) log.debug(res);
                  });
                }
              } else if ((_.get(variable, 'type', 'Monitored') === 'Event Value-curves')) {
                const iField = eventValueNames.indexOf(variable.eventValueName);
                if ((iField !== -1) && (iField < eventFields.length)) {
                  let value = null;
                  // if array of structures, find the one with correct name and/or match value
                  const nStruct = eventFields[iField].value.length;
                  for (let iStruct = 0; iStruct < nStruct; iStruct += 1) {
                    // check if this is the structure we're looking for
                    if (_.has(eventFields[iField].value[iStruct],
                      variable.eventValueSelectedStructureName)) {
                      if (_.has(variable, 'eventValueSelectedStructureMatchField')) {
                        // check if there's a field we're supposed to use for a match
                        const name = variable.eventValueSelectedStructureName;
                        const field = variable.eventValueSelectedStructureMatchField;
                        // adding these two variables just to get past the INSANE syntax checker.
                        // the line is too long if I use the variable. fields, but if I add
                        // a new line, it tells me "unexpected new line"
                        if (_.has(eventFields[iField].value[iStruct][name], field)) {
                          // check that the structure HAS that field
                          if (variable.eventValueSelectedStructureMatchValue
                              === eventFields[iField].value[iStruct][name][field].toString()) {
                            if (_.has(variable, 'curveDataSubfieldForValues')) {
                              if (_.has(eventFields[iField].value[iStruct].data[0],
                                variable.curveDataSubfieldForValues)) {
                                value = [];
                                const nData = eventFields[iField].value[iStruct].data.length;
                                const trimDecimalPlacesFlag = _.has(variable, 'curveDataDecimalPlaces');
                                const trimDecimalPLaces = _.get(variable, 'curveDataDecimalPlaces');
                                for (let iData = 0; iData < nData; iData += 1) {
                                  const valueElement = eventFields[iField]
                                    .value[iStruct]
                                    .data[iData][variable.curveDataSubfieldForValues];
                                  if (trimDecimalPlacesFlag) {
                                    value.push(parseFloat(valueElement.toFixed(trimDecimalPLaces)));
                                  } else {
                                    value.push(valueElement);
                                  }
                                }
                                break;
                              }
                            }
                          }
                        }
                      }
                    }
                  }

                  checkPublishTiming();
                  that.dataCb(that.machine, variable, value, (err, res) => {
                    if (err) {
                      log.error(err);
                    }
                    if (res) log.debug(res);
                  });
                }
              }
              cb2();
            });
          });
        }

        cb(null);
      },
      // create read variable event monitored items or star ttimer depending on mode
      (cb) => {
        if (operatingScheme === 'pub/sub') {
          async.forEachOfSeries(variableReadArray, (variable, index, cb2) => {
            // install monitored items to get the value for each variable
            try {
              monitoredItems[index] = opcua.ClientMonitoredItem.create(subscription, {
                nodeId: opcua.resolveNodeId(variable.nodeId),
                attributeId: opcua.AttributeIds.Value,
              }, {
                // TODO set correct options
                samplingInterval: 100,
                discardOldest: true,
                queueSize: 10,
              },
              opcua.TimestampsToReturn.Both);

              // if variable changed, update database with new values for it and
              // any destination variables
              monitoredItems[index].on('changed', (dataItem) => {
                updateDatabaseForVariable(variable, dataItem);
              });
              monitoredItems[index].on('err', (dataItem) => {
                disconnectionDetected();
                updateConnectionStatus(false);
                if (dataItem.lastIndexOf('BadNodeIdUnknown') !== -1) {
                  raiseAlert(BAD_NODE_ID_ALERT, variable.name);
                } else {
                  raiseAlert(FAILED_TO_GET_DATA_ALERT, variable.name);
                }
              });
            } catch (monitorErr) {
              log.error(monitorErr);
            }
            cb2(null);
          });


          // don't wait for subscriptions to start before returning
          cb(null);
        } else {
          // prepare an array holding each variables node id
          variableReadArray.forEach((variableToRead) => {
            variableNodeIdList.push(variableToRead.nodeId);
          });

          // set read timer at the chosen frequency
          timer = setInterval(readTimer, that.machine.settings.model.requestFrequency * 1000);
          cb(null);
        }
      },
    ], (err) => {
      // add any destination variables to the variable list so they appear in the UI
      const nVars = that.machine.variables.length;
      for (let iVar = 0; iVar < nVars; iVar += 1) {
        const variable = that.machine.variables[iVar];
        if (_.has(variable, 'array') && _.has(variable, 'destVariables') && variable.array) {
          for (let iDestVar = 0; iDestVar < variable.destVariables.length; iDestVar += 1) {
            const destVariable = variable.destVariables[iDestVar];

            // add destination variable only if it does not already exists
            if (!variableExists(destVariable.destVariable)) {
              const destVarObj = {
                name: destVariable.destVariable,
                nodeId: variable.nodeId,
                description: `Destination variable ${destVariable.destVariable}`,
                format: variable.format,
                access: variable.access,
                array: false,
                arrayIndex: destVariable.arrayIndex,
                destinationVariable: true,
              };
              that.machine.variables.push(destVarObj);
            }
          }
        }
      }

      // add in the combined variable if selected
//      if ((operatingScheme === 'req/res') &&
//          (_.get(that.machine.settings.model, 'deliverCombinedResult', false))) {
      if (_.get(that.machine.settings.model, 'deliverCombinedResult', false)) {
        that.machine.variables.push(combinedResultVariable);
      }

      // convert the variables array to an object for easy searching
      variablesObj = _.keyBy(that.machine.variables, 'name');
      if (err) {
        // close session if it open succesfully e.g. if error was afterwards
        if (session !== null) {
          session.close((closeErr) => {
            client.disconnect();
            connected = false;
            client = null;
            return callback(closeErr);
          });
        } else {
          if (connected) {
            client.disconnect();
            connected = false;
          }
          client = null;
          return callback(err);
        }
      } else {
        client.on('after_reconnection', (error) => {
          if (!error) {
            connectionDetected();
            updateConnectionStatus(true);
            clearAlert(CONNECTIVITY_ALERT);
            log.debug(`${that.machine.info.name} reconnected successfully`);
          }
        });
        client.on('start_reconnection', () => {
          disconnectionDetected();
          updateConnectionStatus(false);
          raiseAlert(DATA_LOST_ALERT);
        });
        return callback(null);
      }
      return undefined;
    });
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function close(callback) {
    // close the client if connected
    if ((client === null)) {
      return callback(new Error('No open connection to close'));
    }

    updateConnectionStatus(false);

    let waitCounter = 0;
    let activeWait;

    async.series([
      (cb) => {
        // if a subscription wes created, terminate it
        if (anyEventVariables || (operatingScheme === 'pub/sub')) {
          // cancel any subscriptions

          if (activeSubscriptions === true) {
            subscription.terminate();
            // hold off on closing using an interval timer
            activeWait = setInterval(() => {
              // until safe to do so
              if ((activeSubscriptions === false) || (waitCounter > 20)) {
                activeSubscriptions = false;
                monitoredItems = [];
                clearInterval(activeWait);
                return cb();
              }
              waitCounter += 1;
              return undefined;
            }, 100); // interval set at 100 milliseconds
          } else {
            monitoredItems = [];
            return cb();
          }
        } else {
          return cb();
        }

        return undefined;
      },
      (cb) => {
        // if req/res mode, end the request/response cycle
        if (operatingScheme === 'req/res') {
          if (sendingActive === true) {
            // hold off on closing until current request/response cycle is finished
            activeWait = setInterval(() => {
              // until safe to do so
              if ((sendingActive === false) || (waitCounter > 20)) {
                sendingActive = false;
                variableNodeIdList = [];
                clearInterval(activeWait);
                return cb();
              }
              waitCounter += 1;
              return undefined;
            }, 100); // interval set at 100 milliseconds
          } else {
            variableNodeIdList = [];
            return cb();
          }
        } else {
          return cb();
        }

        return undefined;
      },
      (cb) => {
        // close the session
        if (session) {
          session.close((err) => {
            if (err) {
              log.error('session closed failed ?');
            }
            cb();
          });
        } else {
          cb();
        }
      },
    ], () => {
      // once the session is closed, disconnect and return
      if (connected === true) {
        client.disconnect(() => {
          connected = false;
          callback();
        });
      } else {
        callback();
      }
    });

    return undefined;
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  function getdataType(dataFormat, value, callback) {
    const dataTypeOPCUA = {};
    switch (dataFormat) {
      case 'int8': dataTypeOPCUA.dataType = opcua.DataType.Byte; dataTypeOPCUA.dataValue = parseInt(value, 10); break;
      case 'int16': dataTypeOPCUA.dataType = opcua.DataType.Int16; dataTypeOPCUA.dataValue = parseInt(value, 10); break;
      case 'int32': dataTypeOPCUA.dataType = opcua.DataType.Int32; dataTypeOPCUA.dataValue = parseInt(value, 10); break;
      case 'int64': dataTypeOPCUA.dataType = opcua.DataType.Int64; dataTypeOPCUA.dataValue = parseInt(value, 10); break;
      case 'double': dataTypeOPCUA.dataType = opcua.DataType.Double; dataTypeOPCUA.dataValue = parseFloat(value); break;
      case 'float': dataTypeOPCUA.dataType = opcua.DataType.Float; dataTypeOPCUA.dataValue = parseFloat(value); break;
      case 'bool': dataTypeOPCUA.dataType = opcua.DataType.Boolean; dataTypeOPCUA.dataValue = (value === true); break;
      case 'char': dataTypeOPCUA.dataType = opcua.DataType.String; dataTypeOPCUA.dataValue = value; break;
      case 'uint8': dataTypeOPCUA.dataType = opcua.DataType.SByte; dataTypeOPCUA.dataValue = parseInt(value, 10); break;
      case 'uint16': dataTypeOPCUA.dataType = opcua.DataType.UInt16; dataTypeOPCUA.dataValue = parseInt(value, 10); break;
      case 'uint32': dataTypeOPCUA.dataType = opcua.DataType.UInt32; dataTypeOPCUA.dataValue = parseInt(value, 10); break;
      case 'uint64': dataTypeOPCUA.dataType = opcua.DataType.UInt64; dataTypeOPCUA.dataValue = parseInt(value, 10); break;

      default: return callback(new Error('Not a valid DataType for OPC-UA write-back'), null);
    }
    return callback(null, dataTypeOPCUA);
  }

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  this.writeData = (value, done) => {
    const variableName = value.variable;

    if (!(_.has(variablesObj, variableName))) {
      return done();
    }
    const data = variablesObj[variableName];

    // ignore machine connectivity status variable - read-only
    if (_.has(data, 'machineConnected') && data.machineConnected) {
      return done();
    }

    getdataType(data.format, value[variableName], (error, dataTypeOPCUA) => {
      if (error) {
        log.error({
          err: error,
        });
        return done(error);
      }
      const dataToWrite = [];
      // writing to the variable of the array with index value
      if (_.has(value, 'arrayIndex')) {
        const dataValue = [];
        dataValue.push(dataTypeOPCUA.dataValue);
        dataToWrite.push({
          nodeId: data.nodeId,
          attributeId: opcua.AttributeIds.Value,
          indexRange: new opcua.NumericRange(value.arrayIndex),
          value: new opcua.DataValue({
            value: new opcua.Variant({
              dataType: dataTypeOPCUA.dataType,
              arrayType: opcua.VariantArrayType.Array,
              value: dataValue,
            }),
          }),
        });
      } else {
        const { dataValue } = dataTypeOPCUA;
        dataToWrite.push({
          nodeId: data.nodeId,
          attributeId: opcua.AttributeIds.Value,
          indexRange: null,
          value: new opcua.DataValue({
            value: new opcua.Variant({
              dataType: dataTypeOPCUA.dataType,
              value: dataValue,
            }),
          }),
        });
      }

      session.write(dataToWrite, (writeError, statusCode) => {
        if (writeError) {
          log.error({
            err: writeError,
          }, `OPCUA writeback: Error in writing ${data.name}to ${value.machine}`);
          return done(writeError);
        }
        if (statusCode[0].name === 'BadIndexRangeNoData') {
          raiseAlert(BAD_INDEXRANGE_ALERT, data.name);
          return done(null);
        } if (statusCode[0].name === 'BadNodeIdUnknown') {
          raiseAlert(BAD_NODE_ID_ALERT, data.name);
          return done(null);
        }
        log.debug(`${data.name} has been written to the machine ${value.machine}`);
        return done(null);
      });
      return undefined;
    });
    return undefined;
  };

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

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
    anyEventVariables = false;
    let noNodeIdVariable = '';
    let noEventValueNameVariable = '';
    //    let noEventValueStructureMembersVariable = '';
    //    let noEventValueValueMemberVariable = '';
    const tooManyEventValueNameMembersVariable = '';
    const tooManyEventValueMatchMembersVariable = '';
    // add the access property if it is not defined explicitly
    async.forEachOfSeries(that.machine.variables, (variable, index, callback) => {
      // skip machine connected variables and destination variables
      if (!_.get(variable, 'machineConnected', false)
      && !_.get(variable, 'destinationVariable', false)) {
        // if event variable, don't add it to the read array (just set a flag)
        if ((_.get(variable, 'type', 'Monitored') === 'Event Value')
            || (_.get(variable, 'type', 'Monitored') === 'Event Value-curves')) {
          anyEventVariables = true;
          if (_.get(variable, 'eventValueName', '').trim().length === 0) {
            noEventValueNameVariable = variable.name;
          }
        } else {
          if (variable.name !== combinedResultVariable.name) {
            if (!(variable.access === 'write' || variable.access === 'read')) {
              const variableNoAccess = variable;
              variableNoAccess.access = 'read';
              variableReadArray.push(variableNoAccess);
            } else if (variable.access === 'read') {
              variableReadArray.push(variable);
            }
            if (_.get(variable, 'nodeId', '').trim().length === 0) {
              noNodeIdVariable = variable.name;
            }
          }
        }
      }
      return callback();
    });

    if (noNodeIdVariable.length !== 0) {
      alert.raise({ key: 'no-nodeId-error', variableName: noNodeIdVariable });
      return done(new Error(`The monitored variable ${noNodeIdVariable} does not have a node Id defined`));
    }
    alert.clear('no-nodeId-error');
    if (noEventValueNameVariable.length !== 0) {
      alert.raise({ key: 'no-event-value-name-error', variableName: noEventValueNameVariable });
      return done(new Error(`The event value variable ${noEventValueNameVariable} does not have an event value name defined`));
    }
    alert.clear('no-event-value-name-error');
    alert.clear('no-event-value-structure-members-error');
    alert.clear('no-event-value-value-member-error');
    if (tooManyEventValueNameMembersVariable.length !== 0) {
      alert.raise({ key: 'too-many-event-value-name-members-error', variableName: tooManyEventValueNameMembersVariable });
      return done(new Error(`The structure event value variable ${tooManyEventValueNameMembersVariable} has more than one name member defined`));
    }
    alert.clear('too-many-event-value-name-members-error');
    if (tooManyEventValueMatchMembersVariable.length !== 0) {
      alert.raise({ key: 'too-many-event-value-match-members-error', variableName: tooManyEventValueMatchMembersVariable });
      return done(new Error(`The structure event value variable ${tooManyEventValueMatchMembersVariable} has more than one match value member defined`));
    }
    alert.clear('too-many-event-value-match-members-error');

    opcuaMachineShutdown = false;
    open((err) => {
      // if connection error, return and retry later
      if (err) {
        disconnectReconnect();
        return done(err);
      }

      log.info('Started');
      return done(null);
    });
    return undefined;
  };

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  this.stop = (done) => {
    if (!that.machine) {
      return done('machine undefined');
    }

    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (disconnectReconnectTimer) {
      clearTimeout(disconnectReconnectTimer);
      disconnectReconnectTimer = null;
    }

    // if any pending disconnection detection, stop its timer
    if (disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }

    if (pubsubReportTimer) {
      clearTimeout(pubsubReportTimer);
      pubsubReportTimer = null;
    }

    opcuaMachineShutdown = true;
    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }

      // close opcua client connection if its open
      if (client) {
        close((closeErr) => {
          if (closeErr) {
            log.error(closeErr);
          }
          client = null;
          session = null;
          connected = false;
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

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  this.restart = (done) => {
    that.stop((err) => {
      if (err) return done(err);
      that.start(that.dataCb, that.configUpdateCb, startErr => done(startErr));
      return undefined;
    });
  };

  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------
  //----------------------------------------------------------------------------

  this.updateModel = function updateModel(newModel, done) {
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

//----------------------------------------------------------------------------
//----------------------------------------------------------------------------
//----------------------------------------------------------------------------

module.exports = {
  hpl: hplOpcua,
  defaults,
  schema,
};
