/* jshint esversion: 6 */

const { EventEmitter } = require('events');

const async = require('async');
const _ = require('lodash');
const fs = require('fs');
const os = require('os');
let awsIot = require('aws-iot-device-sdk');
const pkg = require('./package.json');
const config = require('./config.json');

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};
config.info = info;

const sparkAwsIotAdvancedClient = new EventEmitter();
let log;
let db;
let conf;
let bStarted = false;
let alert = null;
let running = false;
let client = null;
const hostname = os.hostname();
let machineVariableList = {};
let machineNameList = [];
let deliverEntireResponseMachineNameList = [];
let machineVariableValueList = [];
let stopCallback = null;
let endTimeoutTimer = null;
let doneCleanup = false;
let machineVariableSchema = {};
let machineVariableNameSchema = {};
let machineNameMap = {};
let overrideVariableNameList = {};

let AWSConnected = false;
let AWSDataAllowed = false;
let sparkplugSequenceNumber = 0;

let currentDeviceInfo = null;

if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line global-require
  awsIot = require('./test/aws-iot-tester');
  sparkAwsIotAdvancedClient.awsIoTTester = awsIot;
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function isArray(a) {
  return (!!a) && (a.constructor === Array);
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function convertToSparkplugType(variableType) {
  // convert format to allowed sparkplug types
  let varType = variableType;
  switch (varType) {
    case 'char':
      varType = 'string';
      break;
    case 'bool':
      varType = 'boolean';
      break;
      //    case 'object':
      //    case 'array':
      //      varType = 'string';
      //      break;
    default:
  }

  return varType;
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function getVariableType(variable) {
  let variableType = null;

  //  if (_.get(variable, 'array', false)) {
  //    variableType = 'array';
  //  } else if (_.has(variable, 'outputFormat')) {
  if (_.has(variable, 'outputFormat')) {
    variableType = variable.outputFormat;
  } else if (_.has(variable, 'format')) {
    variableType = variable.format;
  }

  // convert format to allowed sparkplug types
  variableType = convertToSparkplugType(variableType);

  return variableType;
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function GetVariableFormatFromValue(newValue) {
  let variableFormat = 'string';

  const newValueString = String(newValue);
  if ((newValueString.toLowerCase() === 'true') || (newValueString.toLowerCase() === 'false')) {
    variableFormat = 'boolean';
  } else if ((!Number.isNaN(newValueString)) && (!Number.isNaN(parseFloat(newValueString)))) {
    if (newValueString.indexOf('.') !== -1) {
      variableFormat = 'float';
    } else {
      variableFormat = 'int32';
    }
  }
  return variableFormat;
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function sendDeviceBirthForCombinedData(machineName) {
  const variableList = machineVariableSchema[machineName];
  if (!variableList) { // exit if we don't have any variables yet.
    return;
  }

  const variableNames = machineVariableNameSchema[machineName];
  const metrics = []; // clear array for next machine's variable list.
  let listIndex = 0;
  let metricsElement;
  while (listIndex < variableList.length) {
    if (_.has(overrideVariableNameList, machineName)) {
      if (listIndex < variableNames.length) {
        metricsElement = {
          name: `${overrideVariableNameList[machineName] + (listIndex + 1)}Name`,
          type: 'string',
          value: variableNames[listIndex],
        };
        metrics.push(metricsElement);
      }

      metricsElement = {
        name: overrideVariableNameList[machineName] + (listIndex + 1),
        type: variableList[listIndex].type,
      };
    } else {
      metricsElement = {
        name: variableList[listIndex].name,
        type: variableList[listIndex].type,
      };
    }

    if (variableList[listIndex].lowerLimit) {
      if (!_.has(metricsElement, 'properties')) {
        metricsElement.properties = {};
      }
      metricsElement.properties['Engineering Low Limit'] = {
        type: 'float',
        value: variableList[listIndex].lowerLimit,
      };
    }
    if (variableList[listIndex].upperLimit) {
      if (!_.has(metricsElement, 'properties')) {
        metricsElement.properties = {};
      }
      metricsElement.properties['Engineering High Limit'] = {
        type: 'float',
        value: variableList[listIndex].upperLimit,
      };
    }
    if (variableList[listIndex].nominalValue) {
      if (!_.has(metricsElement, 'properties')) {
        metricsElement.properties = {};
      }
      metricsElement.properties['Nominal Value'] = {
        type: 'float',
        value: variableList[listIndex].nominalValue,
      };
    }
    if (variableList[listIndex].engineeringUnits) {
      if (!_.has(metricsElement, 'properties')) {
        metricsElement.properties = {};
      }
      metricsElement.properties['Engineering Units'] = {
        type: 'string',
        value: variableList[listIndex].engineeringUnits,
      };
    }

    metrics.push(metricsElement);

    listIndex += 1;
  }

  if (metrics.length > 0) {
    const payload = {
      timestamp: Date.now(),
      metrics,
      seq: sparkplugSequenceNumber,
    };
    sparkplugSequenceNumber += 1;
    if (sparkplugSequenceNumber > 255) {
      sparkplugSequenceNumber = 0;
    }

    // Publish device birth

    let topic = `spBv1.0/${config.settings.model.groupId}/DBIRTH/${os.hostname()}/`;
    if (_.has(machineNameMap, machineName)) {
      topic += machineNameMap[machineName];
    } else {
      topic += machineName;
    }
    console.log(`>>>> client.publish: topic = ${topic}`);
    console.log(`                     payload = ${JSON.stringify(payload)}`);
    client.publish(topic, JSON.stringify(payload));
  }
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function sendDeviceBirth(machineName) {
  let metrics;
  let variableList;

  //--------------------------------------------------------------------------

  function addMetricsElement(key) {
    const variable = variableList.variables[key];

    if ((_.has(variable, 'deliverEntireResponse')) && (variable.deliverEntireResponse === true)) {
      // skip this variable - it will come to us as csv pairs
    } else if (_.has(variable, 'name')) {
      let variableFormat = getVariableType(variable);
      if (variableFormat !== null) {
        if (variableFormat === 'object') {
          variableFormat = 'string';
        }
        const metricsElement = {
          name: variable.name,
          type: variableFormat,
        };
        if (_.get(variable, 'array', false)) {
          metricsElement.isArray = true;
          metricsElement.ArraySize = _.get(variable, 'length', 1);
        }
        metrics.push(metricsElement);
      }
    }
  }

  //--------------------------------------------------------------------------

  variableList = machineVariableList[machineName];
  metrics = []; // clear array for next machine's variable list.
  Object.keys(variableList.variables).forEach(addMetricsElement);

  if (metrics.length > 0) {
    const payload = {
      timestamp: Date.now(),
      metrics,
      seq: sparkplugSequenceNumber,
    };
    sparkplugSequenceNumber += 1;
    if (sparkplugSequenceNumber > 255) {
      sparkplugSequenceNumber = 0;
    }

    // Publish device birth
    let topic = `spBv1.0/${config.settings.model.groupId}/DBIRTH/${os.hostname()}/`;
    if (_.has(machineNameMap, machineName)) {
      topic += machineNameMap[machineName];
    } else {
      topic += machineName;
    }
    console.log(`>>>> client.publish: topic = ${topic}`);
    console.log(`                     payload = ${JSON.stringify(payload)}`);
    client.publish(topic, JSON.stringify(payload));
  }
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function sendSingleDeviceBirth(machineName) {
  if (!AWSConnected) {
    return;
  }

  const index = deliverEntireResponseMachineNameList.indexOf(machineName);
  if ((_.has(machineVariableSchema, machineName)) || (index > -1)) {
    sendDeviceBirthForCombinedData(machineName);
  } else {
    sendDeviceBirth(machineName);
  }
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function sendAllDeviceBirth() {
  for (let machineIndex = 0; machineIndex < machineNameList.length; machineIndex += 1) {
    const machineName = machineNameList[machineIndex];

    sendSingleDeviceBirth(machineName);
  }
  AWSDataAllowed = true;
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function getActiveMachines(done) {
  const localMachineArray = [];
  conf.get('machines', (err, machines) => {
    if (err) {
      return done(err, []);
    }
    //  add each enabled machine in the array to the local machine list
    _.forOwn(machines, (machine) => {
      // check its a valid machine (must have an info section)
      // log.debug('machine = ' + JSON.stringify(machine));
      if (_.has(machine, 'info')) {
        // also check if it is enabled and wants to be published
        if ((machine.settings.model.enable === true)
            && (machine.settings.model.publishDisabled === false)) {
          const localMachineJSON = {
            description: machine.info.description,
            version: machine.info.version,
            fullname: machine.info.fullname,
            name: machine.info.name,
          };
          if (_.has(machine.info, 'hpl')) {
            localMachineJSON.hpl = machine.info.hpl;
          }
          localMachineArray.push(localMachineJSON);
        }
      }
    });
    log.debug(`localMachineArray = ${JSON.stringify(localMachineArray)}`);

    return done(null, localMachineArray);
  });
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function getActiveProtocols(done) {
  const localProtocolArray = [];
  conf.get('protocols', (err, protocols) => {
    if (err) {
      return done(err, []);
    }
    //  add each enabled protocol in the array to the local protocol list
    _.forOwn(protocols, (protocol) => {
      // check its a valid machine (must have an info section)
      //      log.debug(`protocol = ${JSON.stringify(protocol)}`);
      if (_.has(protocol, 'info')) {
        // also check if it is enabled and wants to be published
        if (protocol.settings.model.enable === true) {
          const localProtocolJSON = {
            description: protocol.info.description,
            version: protocol.info.version,
            fullname: protocol.info.fullname,
            name: protocol.info.name,
          };
          localProtocolArray.push(localProtocolJSON);
        }
      }
    });
    log.debug(`localProtocolArray = ${JSON.stringify(localProtocolArray)}`);

    return done(null, localProtocolArray);
  });
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function getNodeMetrics(done) {
  async.parallel(
    [
      // get SparkInfo data
      (cb1) => {
        async.waterfall([

          cb2 => cb2(null, {
            Hostname: os.hostname(),
            PrettyHostname: os.hostname(),
            Location: 'string',
            Kernel: 'string',
            OS: 'string',
            Eth0Mac: 'string',
            Wlan0Mac: 'string',
          }),

          (nodeBirthSparkInfoMetric, cb2) => {
            getActiveMachines((err, machines) => {
              const localNodeBirthSparkInfoMetric = nodeBirthSparkInfoMetric;
              if (machines.length > 0) {
                log.debug(`machines = ${JSON.stringify(machines)}`);
                localNodeBirthSparkInfoMetric.Machines = machines;
              } else {
                localNodeBirthSparkInfoMetric.Machines = [];
              }
              return cb2(err, localNodeBirthSparkInfoMetric);
            });
          },

          (nodeBirthSparkInfoMetric, cb2) => {
            getActiveProtocols((err, protocols) => {
              const localNodeBirthSparkInfoMetric = nodeBirthSparkInfoMetric;
              if (protocols.length > 0) {
                log.debug(`protocols = ${JSON.stringify(protocols)}`);
                localNodeBirthSparkInfoMetric.Protocols = protocols;
              } else {
                localNodeBirthSparkInfoMetric.Protocols = [];
              }
              return cb2(err, localNodeBirthSparkInfoMetric);
            });
          },

        ], (err, nodeBirthSparkInfoMetric) => {
          if (err) {
            log.error({ err });
            cb1(err);
          } else {
            log.debug(`nodeBirthSparkInfoMetric = ${JSON.stringify(nodeBirthSparkInfoMetric)}`);
            cb1(null, nodeBirthSparkInfoMetric);
          }
        });
      },

      // get DeviceInfo data
      (cb1) => {
        if (currentDeviceInfo === null) {
          // we haven't seend the deviceinfo variable come in, so return an empty json object
          cb1(null, {});


          // if (!_.has(conf, 'redis')) {
          //   log.debug('2a: <><><><><><><>');
          //   cb1(null, {});
          // } else {
          //   // find the latest device-info data
          //   conf.redis.keys('machine:spark-machine-deviceinfo:read:data:*', (err, keys) => {
          //     log.debug('conf.redis.keys: keys.length = ' + keys.length);
          //     if (!_.isEmpty(keys)) {
          //       keys.sort();
          //       log.debug(`(*)(*)(*)(*)(*)(*)(*)(*)(*) keys = ${JSON.stringify(keys)}`);
          //
          //       db.get(keys[keys.length - 1], (dbgetErr, entry) => {
          //         log.debug(`(*)(*)(*)(*)(*)(*)(*)(*)(*) entry = ${JSON.stringify(entry)}`);
          //         currentDeviceInfo = entry[entry.deviceinfo];
          //         log.debug(`(*)(*)(*)(*)(*)(*)(*)(*)(*) currentDeviceInfo =
          //                      ${JSON.stringify(currentDeviceInfo)}`);
          //         cb1(null, currentDeviceInfo);
          //       });
          //     } else {
          //       cb1(null, {});
          //     }
          //   });
          // }
        } else {
          log.debug(`<><><><><><><><><> currentDeviceInfo = ${JSON.stringify(currentDeviceInfo)}`);
          cb1(null, currentDeviceInfo);
        }
      },

    ],
    (err, metrics) => {
      if (err) {
        done(err, null);
      } else {
        done(err, metrics);
      }
    },
  );


  // var nodeBirthSparkInfoMetric = {
  //     "Hostname" : "SparkName",
  //     "PrettyHostname" : os.hostname(),
  //     "Location" : "string",
  //     "Kernel" : "string",
  //     "OS" : "string",
  //     "Eth0Mac" : "string",
  //     "Wlan0Mac" : "string",
  //     "Machines" : machineListArray,
  //     "Protocols" : protocolListArray,
  //     "Hardware" : hardwareListArray,
  //     "Network" : networkListArray,
  //     "NumberOfAlerts" : numberOfAlerts,
  //     "Alerts" : alertListArray
  // };
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function sendBirthData() {
  if (!AWSConnected) {
    return;
  }

  getNodeMetrics((err, metrics) => {
    const payload = {
      timestamp: Date.now(),
      metrics: [
        {
          name: 'SparkName',
          value: os.hostname(),
          type: 'string',
        },
        {
          name: 'NodeInfo',
          value: JSON.stringify(metrics[0]),
          type: 'string',
        },
        {
          name: 'DeviceInfo',
          value: JSON.stringify(metrics[1]),
          type: 'string',
        },
      ],
      seq: 0,
    };
    sparkplugSequenceNumber = 1;

    // Publish Node BIRTH certificate
    const topic = `spBv1.0/${config.settings.model.groupId}/NBIRTH/${os.hostname()}`;
    console.log(`>>>> client.publish: topic = ${topic}`);
    console.log(`                     payload = ${JSON.stringify(payload)}`);
    client.publish(topic, JSON.stringify(payload));
    // Publish Device BIRTH certificate
    sendAllDeviceBirth();
  });


  // var nodeBirthSparkInfoMetric = {
  //     "Hostname" : "SparkName",
  //     "PrettyHostname" : os.hostname(),
  //     "Location" : "string",
  //     "Kernel" : "string",
  //     "OS" : "string",
  //     "Eth0Mac" : "string",
  //     "Wlan0Mac" : "string",
  //     "Machines" : machineListArray,
  //     "Protocols" : protocolListArray,
  //     "Hardware" : hardwareListArray,
  //     "Network" : networkListArray,
  //     "NumberOfAlerts" : numberOfAlerts,
  //     "Alerts" : alertListArray
  // };
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function sendDeviceDeath(machineName) {
  if (!AWSConnected) {
    return;
  }
  const payload = {
    timestamp: Date.now(),
    seq: sparkplugSequenceNumber,
  };
  sparkplugSequenceNumber += 1;
  if (sparkplugSequenceNumber > 255) {
    sparkplugSequenceNumber = 0;
  }

  // Publish device death
  let topic = `spBv1.0/${config.settings.model.groupId}/DDEATH/${os.hostname()}/`;
  if (_.has(machineNameMap, machineName)) {
    topic += machineNameMap[machineName];
  } else {
    topic += machineName;
  }
  console.log(`>>>> client.publish: topic = ${topic}`);
  console.log(`                     payload = ${JSON.stringify(payload)}`);
  client.publish(topic, JSON.stringify(payload));
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

// function publishMachineVariablesMetaData(machineName, machineVariableMetaData) {
//   // create the topic from the physical spark + machine
//   const topic = `${hostname}/${_.get(machineNameMap, machineName, machineName)}`;
//   // publish the machine's variable metadata with this topic
//   client.publish(topic, JSON.stringify(machineVariableMetaData));
// }

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function subscribeToWriteVariables(machineName) {
  _.forOwn(machineVariableList[machineName].variables, (variable) => {
    if (_.get(variable, 'access', 'read') === 'write') {
      client.subscribe(`${hostname}/${_.get(machineNameMap, machineName, machineName)}/${variable.name}`);
    }
  });
}

function unsubscribeToWriteVariables(machineName) {
  _.forOwn(machineVariableList[machineName].variables, (variable) => {
    if (_.get(variable, 'access', 'read') === 'write') {
      client.unsubscribe(`${hostname}/${_.get(machineNameMap, machineName, machineName)}/${variable.name}`);
    }
  });
}

function onSetListener(key) {
  // check if anything in the model changes
  const reSettingsChanges = new RegExp(`protocols:${pkg.name}:settings:model:*`);
  // check if any machine's enable or publish state has changed
  const reMachineChanges = new RegExp('^machines:.*:settings:model:enable$|^machines:.*:settings:model:publishDisabled$|^machines:.*:settings:model:connectionStatus$');
  // check if any machine's namespace has changed
  const reNamespaceChanges = new RegExp('^machines:.*:settings:model:genericNamespace$');
  // check if any machine's publish options have changed
  const rePublishOptionChanges = new RegExp('^machines:.*:settings:model:deliverEntireResponse$|^machines:.*:settings:model:overrideVariableNameFlag$|^machines:.*:settings:model:overrideVariableNameBase$');
  // check if any machine's variables have changed
  const reMachineVariableChanges = new RegExp('^machines:.*:variables$');

  if (reSettingsChanges.test(key)) {
    conf.get(`protocols:${pkg.name}:settings:model`, (err, model) => {
      log.debug(`protocols:${pkg.name}:settings:model`, model);

      if (!_.isEqual(model, config.settings.model)) {
        // the enable key has changed
        log.debug(`protocols:${pkg.name}:settings:model changed from`, config.settings.model, 'to', model);

        config.settings.model = model;

        // request a restart
        sparkAwsIotAdvancedClient.emit('restartRequest', info.name);
      }
    });
  }

  if (!AWSConnected) {
    return;
  }

  const machineEnableChanges = reMachineChanges.test(key);
  const namespaceChanges = reNamespaceChanges.test(key);
  const publishOptionChanges = rePublishOptionChanges.test(key);
  const variableChanges = reMachineVariableChanges.test(key);

  // if a machine has changed its enable state, or variables have changed
  if (machineEnableChanges || namespaceChanges || publishOptionChanges || variableChanges) {
    // check we have already populated our list of machines and are fully up and running
    if (running === true) {
      // extract the machine name from the key
      const startIndex = key.indexOf(':') + 1;
      // end index will differ based on whether a machine or machine's variable has changed
      const endIndex = variableChanges ? key.indexOf(':variables') : key.indexOf(':settings');
      const machineName = key.slice(startIndex, endIndex);

      // get the machine details
      conf.get(`machines:${machineName}`, (err, machine) => {
        const machineEnabled = machine.settings.model.enable;
        const publishingEnabled = !machine.settings.model.publishDisabled;

        // find if the machine already exists in the queue
        const machineExists = _.has(machineVariableList, machineName);

        if ((machineEnabled) && (publishingEnabled) && (!machineExists)) {
          // if the machine has just been enabled and it is not in the queue
          log.info(`Adding Machine: ${machineName}`);

          // store the machine's info, variable information
          machineNameList.push(machineName);

          // map machine name to the generic name space if defined
          if ((_.has(machine.info, 'genericNamespace')) && (machine.info.genericNamespace !== 'NONE')) {
            machineNameMap[machineName] = machine.info.genericNamespace;
          } else if ((_.has(machine.settings.model, 'genericNamespace')) && (machine.settings.model.genericNamespace !== 'NONE')) {
            // use the genericNamespace setting from the machine schema (non-hpl)
            machineNameMap[machineName] = machine.settings.model.genericNamespace;
          } else {
            machineNameMap[machineName] = machineName;
          }

          machineVariableValueList = [];

          // store info for delivering entire response (also allow variable name override)
          if (_.get(machine.settings.model, 'deliverEntireResponse', false)) {
            machineVariableList[machineName] = { variables: {} };
            deliverEntireResponseMachineNameList.push(machineName);
            if ((_.get(machine.settings.model, 'overrideVariableNameFlag', false)
             && (_.get(machine.settings.model, 'overrideVariableNameBase', null) !== null))) {
              overrideVariableNameList[machineName] = machine.settings.model
                .overrideVariableNameBase;
            }
          } else {
            machineVariableList[machineName] = { info: machine.info, variables: _.keyBy(machine.variables, 'name') };
          }

          // send list of variables for this newly enabled machine as published topic
          // with new changes to match sparkplug-type packets, remove this for now.
          //    publishMachineVariablesMetaData(machineName, machineVariableList[machineName]);

          sendSingleDeviceBirth(machineName);

          // subscribe to any write variables
          subscribeToWriteVariables(machineName);
        } else if (((!machineEnabled) || (!publishingEnabled)) && (machineExists)) {
          // else if machine has just been disabled and exists in the queue
          log.info(`Removing Machine: ${machineName}`);

          // unsubscribe to any write variables
          unsubscribeToWriteVariables(machineName);

          // delete the entry from the queue objects and array
          _.pull(machineNameList, machineName);
          _.pull(deliverEntireResponseMachineNameList, machineName);

          delete machineNameMap[machineName];

          delete machineVariableList[machineName];
          delete machineVariableValueList[machineName];
          delete machineVariableSchema[machineName];
          delete machineVariableNameSchema[machineName];
          delete overrideVariableNameList[machineName];

          sendDeviceDeath(machineName);
        } else if ((machineEnabled) && (publishingEnabled) && (machineExists)) {
          // if we see an enabled machine that already exists, the variables may have changed

          // map machine name to the generic name space if defined
          if ((_.has(machine.info, 'genericNamespace')) && (machine.info.genericNamespace !== 'NONE')) {
            machineNameMap[machineName] = machine.info.genericNamespace;
          } else if ((_.has(machine.settings.model, 'genericNamespace')) && (machine.settings.model.genericNamespace !== 'NONE')) {
            // use the genericNamespace setting from the machine schema (non-hpl)
            machineNameMap[machineName] = machine.settings.model.genericNamespace;
          } else {
            machineNameMap[machineName] = machineName;
          }

          let sendNewDeviceBirthFlag = false;

          if (!_.get(machine.settings.model, 'deliverEntireResponse', false)) {
            // before deleting see if the variable list has actually changed
            // (can get double enables - so this debounces)
            const updatedList = { info: machine.info, variables: _.keyBy(machine.variables, 'name') };

            // if the variables have changed
            if (_.isEqual(machineVariableList[machineName], updatedList) === false) {
              log.info(`Updating Machine: ${machineName}`);

              // unsubscribe to any write variables
              unsubscribeToWriteVariables(machineName);

              // delete the old entry and re-create with the updated list
              delete machineVariableList[machineName];
              machineVariableList[machineName] = updatedList;
              delete machineVariableValueList[machineName];
              delete machineVariableSchema[machineName];
              delete machineVariableNameSchema[machineName];
              sendNewDeviceBirthFlag = true;

              // send list of updated variables for already enabled machine as published topic
              // with new changes to match sparkplug-type packets, remove this for now.
              //   publishMachineVariablesMetaData(machineName, machineVariableList[machineName]);

              // subscribe to any write variables
              subscribeToWriteVariables(machineName);
            }
          }

          // check for changes to the deliverEntireResponse field
          if (_.get(machine.settings.model, 'deliverEntireResponse', false)) {
            if (!deliverEntireResponseMachineNameList.includes(machineName)) {
              log.debug(`Enabling Deliver Entire Response for Machine: ${machineName}`);
              // need to wait for a data delivery to fill in the variables.
              machineVariableList[machineName] = { variables: {} };
              deliverEntireResponseMachineNameList.push(machineName);
              // the birth announcement will have to wait until we get a data delivery
              // with the names, types and values
              sendNewDeviceBirthFlag = false;
            }
          } else {
            const index = deliverEntireResponseMachineNameList.indexOf(machineName);
            if (index !== -1) {
              // we found this machine in our list, but it no longer has this feature - remove it
              log.debug(`Disabling Deliver Entire Response for Machine: ${machineName}`);
              deliverEntireResponseMachineNameList.splice(index, 1);
              sendNewDeviceBirthFlag = true;
            }
          }

          // check for changes to the overrideVariableName fields
          if ((_.get(machine.settings.model, 'overrideVariableNameFlag', false)
           && (_.get(machine.settings.model, 'overrideVariableNameBase', null) !== null))) {
            if (_.get(overrideVariableNameList, machineName, null)
                !== machine.settings.model.overrideVariableNameBase) {
              log.debug(`Enabling Override Variable Name for Machine: ${machineName}`);
              overrideVariableNameList[machineName] = machine.settings.model
                .overrideVariableNameBase;
              sendNewDeviceBirthFlag = true;
            }
          } else if (_.has(overrideVariableNameList, machineName)) {
            log.debug(`Disabling Override Variable Name for Machine: ${machineName}`);
            delete overrideVariableNameList[machineName];
            sendNewDeviceBirthFlag = true;
          }
          if (sendNewDeviceBirthFlag) {
            sendSingleDeviceBirth(machineName);
          }
        }
      });
    }
  }
}

function databaseListener(key) {
  if (!AWSDataAllowed) {
    return;
  }

  // get the new data for the key
  db.get(key, (err, entry) => {
    if ((entry.machine === 'spark-machine-deviceinfo') && (entry.variable === 'deviceinfo')) {
      currentDeviceInfo = entry.deviceinfo;

      getNodeMetrics((nodeMetricsErr, metrics) => {
        const payload = {
          timestamp: Date.now(),
          metrics: [
            {
              name: 'NodeInfo',
              value: JSON.stringify(metrics[0]),
              type: 'string',
            },
            {
              name: 'DeviceInfo',
              value: JSON.stringify(metrics[1]),
              type: 'string',
            },
          ],
          seq: sparkplugSequenceNumber,
        };

        sparkplugSequenceNumber += 1;
        if (sparkplugSequenceNumber > 255) {
          sparkplugSequenceNumber = 0;
        }

        // Publish Node DATA
        const topic = `spBv1.0/${config.settings.model.groupId}/NDATA/${os.hostname()}`;
        console.log(`>>>> client.publish: topic = ${topic}`);
        console.log(`                     payload = ${JSON.stringify(payload)}`);
        client.publish(topic, JSON.stringify(payload));
      });
    }

    // check we have a variable list for this machine
    if (_.has(machineVariableList, entry.machine)) {
      // extract the required data from the returned entry
      const variableTimestamp = entry.createdAt;
      const deviceId = entry.machine;
      const variableName = entry.variable;

      // first check if variableName exists in the list before calling
      // (as may have been added before we have updated our internal list)
      const variable = machineVariableList[deviceId].variables[variableName];
      if ((!_.get(variable, 'deliverEntireResponse', false))
       && (!deliverEntireResponseMachineNameList.includes(deviceId))) {
        if (variable === undefined) {
          return;
        }

        // do not publish write variables`
        if (_.get(variable, 'access', 'read') === 'write') {
          return;
        }
      }

      let variableValue = entry[variableName];
      const metricsArray = [];

      // if delivering entire response, construct an value that is an array of objects
      if ((_.get(variable, 'deliverEntireResponse', false))
       || (deliverEntireResponseMachineNameList.includes(deviceId))) {
        // we're being given an entire response's worth of variable data.
        //  need to parse and send a combined DeveiceData message
        if (_.isArray(variableValue)) {
          const variableListSchema = [];
          const variableNameSchema = [];
          let variableGenericNameIndex = 1;
          for (let iVal = 0; iVal < variableValue.length; iVal += 1) {
            const variableListName = variableValue[iVal].name;
            let variableListValue = variableValue[iVal].value;
            const variableLowerLimit = variableValue[iVal].lowerLimit;
            const variableUpperLimit = variableValue[iVal].upperLimit;
            const variableNominalValue = variableValue[iVal].nominalValue;
            const variableEngineeringUnits = variableValue[iVal].engineeringUnits;
            let variableListType;
            let variableIsArrayFlag = false;
            let variableArraySize = 0;

            if (isArray(variableListValue)) {
              variableIsArrayFlag = true;
              variableArraySize = variableListValue.length;
              // use the first element in the array for the type.
              variableListType = GetVariableFormatFromValue(variableListValue[0]);
              // stringify the value, since strict sparkplug typing doesn't
              // allow for obejcts or arrays
              variableListValue = JSON.stringify(variableListValue);
            } else if (typeof (variableListValue) === 'object') {
              variableListValue = JSON.stringify(variableListValue);
              variableListType = 'string';
            } else {
              variableListType = GetVariableFormatFromValue(variableListValue);
            }

            // if overriding variable name
            if (_.has(overrideVariableNameList, deviceId)) {
              if (variableIsArrayFlag) {
                variableListSchema.push({
                  name: overrideVariableNameList[deviceId] + variableGenericNameIndex,
                  type: variableListType,
                  isArray: true,
                  arraySize: variableArraySize,
                  lowerLimit: variableLowerLimit,
                  upperLimit: variableUpperLimit,
                  nominalValue: variableNominalValue,
                  engineeringUnits: variableEngineeringUnits,
                });
                variableNameSchema.push(variableListName);
                metricsArray.push({
                  name: overrideVariableNameList[deviceId] + variableGenericNameIndex,
                  value: variableListValue,
                  type: variableListType,
                  isArray: true,
                  arraySize: variableArraySize,
                  'Engineering Low Limit': variableLowerLimit,
                  'Engineering High Limit': variableUpperLimit,
                  'Nominal Value': variableNominalValue,
                  'Engineering Units': variableEngineeringUnits,
                });
              } else {
                variableListSchema.push({
                  name: overrideVariableNameList[deviceId] + variableGenericNameIndex,
                  type: variableListType,
                  lowerLimit: variableLowerLimit,
                  upperLimit: variableUpperLimit,
                  nominalValue: variableNominalValue,
                  engineeringUnits: variableEngineeringUnits,
                });
                variableNameSchema.push(variableListName);
                metricsArray.push({
                  name: overrideVariableNameList[deviceId] + variableGenericNameIndex,
                  value: variableListValue,
                  type: variableListType,
                  'Engineering Low Limit': variableLowerLimit,
                  'Engineering High Limit': variableUpperLimit,
                  'Nominal Value': variableNominalValue,
                  'Engineering Units': variableEngineeringUnits,
                });
              }
              variableGenericNameIndex += 1;
            } else if (variableIsArrayFlag) {
              variableListSchema.push({
                name: variableListName,
                type: variableListType,
                isArray: true,
                arraySize: variableArraySize,
                lowerLimit: variableLowerLimit,
                upperLimit: variableUpperLimit,
                nominalValue: variableNominalValue,
                engineeringUnits: variableEngineeringUnits,
              });
              metricsArray.push({
                name: variableListName,
                value: variableListValue,
                type: variableListType,
                isArray: true,
                arraySize: variableArraySize,
                'Engineering Low Limit': variableLowerLimit,
                'Engineering High Limit': variableUpperLimit,
                'Nominal Value': variableNominalValue,
                'Engineering Units': variableEngineeringUnits,
              });
            } else {
              variableListSchema.push({
                name: variableListName,
                type: variableListType,
                lowerLimit: variableLowerLimit,
                upperLimit: variableUpperLimit,
                nominalValue: variableNominalValue,
                engineeringUnits: variableEngineeringUnits,
              });
              metricsArray.push({
                name: variableListName,
                value: variableListValue,
                type: variableListType,
                'Engineering Low Limit': variableLowerLimit,
                'Engineering High Limit': variableUpperLimit,
                'Nominal Value': variableNominalValue,
                'Engineering Units': variableEngineeringUnits,
              });
            }
          }
          log.debug(`variableListSchema = ${JSON.stringify(variableListSchema)}`);
          let publishNewBirthCertificateFlag = false;
          if (!_.has(machineVariableSchema, deviceId)) {
            publishNewBirthCertificateFlag = true;
          } else if (!(_.isEqual(variableListSchema, machineVariableSchema[deviceId]))) {
            publishNewBirthCertificateFlag = true;
          } else if (!(_.isEqual(variableNameSchema, machineVariableNameSchema[deviceId]))) {
            publishNewBirthCertificateFlag = true;
          }
          if (publishNewBirthCertificateFlag) {
            machineVariableSchema[deviceId] = variableListSchema;
            machineVariableNameSchema[deviceId] = variableNameSchema;
            log.debug('NEW SCHEMA!!!!!!');
            sendDeviceBirthForCombinedData(deviceId);
          }
        }
      } else {
        let variableType = getVariableType(machineVariableList[deviceId].variables[variableName]);
        //        console.log('__________------- variableType = ' + variableType);
        if (variableType === null) {
          return;
        }

        // sparkplug doesn't handle array of strings properly when outputFormat is set to 'char'
        // so converting array of strings to array
        // (which will be stringified by JSON.stringify by the following block)
        const variableSchema = machineVariableList[deviceId].variables[variableName];
        if (isArray(variableValue) && _.isEqual(_.get(variableSchema, 'outputFormat', false), 'char') && !_.isEqual(variableSchema.format, 'char')) {
          variableValue = _.map(variableValue, _.toNumber);
        }

        let variableIsArrayFlag = false;
        let variableArraySize = 0;

        if (isArray(variableValue)) {
          variableIsArrayFlag = true;
          variableArraySize = variableValue.length;
          // stringify the value, since strict sparkplug typing doesn't allow for obejcts or arrays
          variableValue = JSON.stringify(variableValue);
        } else if (typeof (variableValue) === 'object') {
          variableValue = JSON.stringify(variableValue);
          variableType = 'string';
        }

        // if publish only on value change, return if value has not changed
        if (_.has(config.settings.model, 'onChangeOnly') && config.settings.model.onChangeOnly) {
          if (_.has(machineVariableValueList, deviceId)) {
            if (_.has(machineVariableValueList[deviceId], variableName)) {
              if (machineVariableValueList[deviceId][variableName] === variableValue) return;
            }

            machineVariableValueList[deviceId][variableName] = variableValue;
          }
        }

        if (variableIsArrayFlag) {
          metricsArray.push({
            name: variableName,
            value: variableValue,
            type: variableType,
            isArray: true,
            arraySize: variableArraySize,
          });
        } else {
          metricsArray.push({
            name: variableName,
            value: variableValue,
            type: variableType,
          });
        }
      }

      const payload = {
        timestamp: variableTimestamp,
        metrics: metricsArray,
        seq: sparkplugSequenceNumber,
      };
      sparkplugSequenceNumber += 1;
      if (sparkplugSequenceNumber > 255) {
        sparkplugSequenceNumber = 0;
      }

      // create the topic from the physical spark + machine + variable
      let topic = `spBv1.0/${config.settings.model.groupId}/DDATA/${os.hostname()}/`;
      if (_.has(machineNameMap, deviceId)) {
        topic += machineNameMap[deviceId];
      } else {
        topic += deviceId;
      }

      // publish the new data value with this topic
      console.log(`>>>> client.publish: topic = ${topic}`);
      console.log(`                     payload = ${JSON.stringify(payload)}`);
      client.publish(topic, JSON.stringify(payload));
    }
  });
}

sparkAwsIotAdvancedClient.start = function start(modules, done) {
  if (bStarted) {
    return done(new Error('already started'));
  }

  let privateKey; let clientCert; let
    caCert;

  log = modules['spark-logging'].exports.getLogger(pkg.name);
  db = modules['spark-db'].exports;
  conf = modules['spark-config'].exports;
  alert = modules['spark-alert'].exports.getAlerter(pkg.name);

  alert.preLoad({
    'connection-error': {
      msg: 'AWS-IoT: Unable to connect to AWS-IoT service',
      description: 'Protocol is not able to connect to the AWS-IoT service. Check the supplied credentials are correct.',
    },
    'connection-offline': {
      msg: 'AWS-IoT: Unable to connect to AWS-IoT service',
      description: 'Protocol is not able to connect to the AWS-IoT service. Check there is an active ethernet connection.',
    },
    'initialization-error': {
      msg: 'AWS-IoT: Initialization Error',
      description: x => `AWS-IoT is not able to initialize correctly. Error: ${x.errorMsg}`,
    },
  });

  machineVariableSchema = {}; // clear out any schemas to force a device birth.
  machineVariableNameSchema = {}; // clear out any schemas to force a device birth.
  machineNameMap = {}; // clear our machine name map, since we're re-populating it.

  // do the following steps one after another using async
  async.series(
    [
      (cb) => {
      // listen for changes to the config
      // but only add the listener once
        if (conf.listeners('set').indexOf(onSetListener) === -1) {
          log.debug('config.settings.model.enable', config.settings.model.enable);
          conf.on('set', onSetListener);
        }

        // check the config to see if we are disabled
        conf.get(`protocols:${pkg.name}:settings:model`, (err, model) => {
        // if no result, use our local config settings
          if (model) config.settings.model = model;
          cb(null);
        });
      },
      (cb) => {
      // update config based on local config settings
        conf.set(`protocols:${pkg.name}`, config, cb);
      },
      (cb) => {
      // check enable state before continuing
        if (!config.settings.model.enable) {
          log.info('Disabled');
          // return early but with no error
          bStarted = true;
          return done(null, config.info);
        }

        // get a list of machines from the config
        conf.get('machines', (err, machines) => {
          if (err) {
            cb(err);
            return;
          }

          //  add each enabled machine in the array to the local machineNameList
          machineNameList = [];
          deliverEntireResponseMachineNameList = [];
          overrideVariableNameList = {};

          //  add each enabled machine in the array to the local machine list
          _.forOwn(machines, (machine) => {
          // check its a valid machine (must have an info section)
            if (_.has(machine, 'info')) {
            // also check if it is enabled and wants to be published
              if ((machine.settings.model.enable === true)
             && (_.get(machine.settings.model, 'connectionStatus', true) === true)
             && (machine.settings.model.publishDisabled === false)) {
                const machineName = machine.info.name;
                log.info('Adding Machine: ', machineName);

                machineNameList.push(machineName);

                // map machine name to the generic name space if defined
                if ((_.has(machine.info, 'genericNamespace')) && (machine.info.genericNamespace !== 'NONE')) {
                // use the genericNamespace setting from the hpl schema
                  machineNameMap[machineName] = machine.info.genericNamespace;
                } else if ((_.has(machine.settings.model, 'genericNamespace')) && (machine.settings.model.genericNamespace !== 'NONE')) {
                // use the genericNamespace setting from the machine schema (non-hpl)
                  machineNameMap[machineName] = machine.settings.model.genericNamespace;
                } else {
                  machineNameMap[machineName] = machineName;
                }

                // store the machine's info and variable information
                // (store variables as a key list for easier access)
                machineVariableList[machineName] = { info: machine.info, variables: _.keyBy(machine.variables, 'name') };

                machineVariableValueList[machineName] = [];

                // store info for delivering entire response (also allow variable name override)
                if (_.get(machine.settings.model, 'deliverEntireResponse', false)) {
                  deliverEntireResponseMachineNameList.push(machineName);
                  if (_.get(machine.settings.model, 'overrideVariableNameFlag', false)
                && (_.get(machine.settings.model, 'overrideVariableNameBase', null) !== null)) {
                    overrideVariableNameList[machineName] = machine.settings.model
                      .overrideVariableNameBase;
                  }
                }
              }
            }
          });
          cb(null);
        });

        return undefined;
      },
      (cb) => {
      // if auth is done via file
        if (config.settings.model.authMethod === 'File') {
        // check if the private key file exists
          privateKey = config.settings.model.keyFilePath;
          fs.access(privateKey, fs.F_OK, cb);
        } else { // if auth is done via string buffer
        // create a buffer object from the private key string input
          privateKey = Buffer.from(config.settings.model.keyBuffer);
          cb(null);
        }
      },
      (cb) => {
      // if auth is done via file
        if (config.settings.model.authMethod === 'File') {
        // check if the client cert file exists
          clientCert = config.settings.model.certFilePath;
          fs.access(clientCert, fs.F_OK, cb);
        } else { // if auth is done via string buffer
        // create a buffer object from the cert string input
          clientCert = Buffer.from(config.settings.model.certBuffer);
          cb(null);
        }
      },
      (cb) => {
      // if auth is done via file
        if (config.settings.model.authMethod === 'File') {
        // check if the CA cert file exists
          caCert = config.settings.model.caFilePath;
          fs.access(caCert, fs.F_OK, cb);
        } else { // if auth is done via string buffer
        // create a buffer object from the CA string input
          caCert = Buffer.from(config.settings.model.caBuffer);
          cb(null);
        }
      },
    ],
    (err) => {
    // once all async task are completed, check for error
      if (err) {
      // raise an initialization alert including the error message
        alert.raise({ key: 'initialization-error', errorMsg: err.message });
        // don't return error as this will cause a constant protocol reboot
        return done(null);
      }

      try {
        client = awsIot.device({
          privateKey,
          clientCert,
          caCert,
          clientId: hostname,
          host: config.settings.model.host,
          offlineQueueing: false,
        });
        // if we get here there have been no initialization issues,
        // so clear alert just in case it was raised
        alert.clear('initialization-error');
      } catch (e) {
      // raise an initialization alert including the error message
        alert.raise({ key: 'initialization-error', errorMsg: e.message });
        // don't return error as this will cause a constant protocol reboot
        return done(null);
      }

      client.on('connect', () => {
        log.info('Connected to AWS IoT');
        AWSConnected = true;

        // clear connection related alerts
        alert.clear('connection-error');
        alert.clear('connection-offline');

        // listen for data being added to the database
        db.on('added', databaseListener);

        async.series(
          [
            (cb) => {
              sendBirthData();
              cb(null);
            },
            (cb) => {
            // send list of variables for each enabled machine as published topics
              _.forOwn(machineVariableList, (value, machineName) => {
              // with new changes to match sparkplug-type packets, remove this for now.
              //   publishMachineVariablesMetaData(machineName, machineVariableList[machineName]);

                // subscribe to any write variables
                subscribeToWriteVariables(machineName);
              });
              cb(null);
            },
          ],
          (err2) => {
            if (err2) {
              log.debug('no errors able to be returned currently, but stubbed in for later');
            }
          },
        );
        return undefined;
      });

      client.on('message', (topic, payload) => {
      // get the host (0), machine (1), and variable name (2)
        const topicSplit = topic.split('/');
        if (topicSplit.length !== 3) return;
        const [, machineName, variableName] = topicSplit;

        // reverse map machine name if set to generic namespace
        const reverseMachineNameMap = _.invert(machineNameMap);
        const actualMachineName = _.get(reverseMachineNameMap, machineName, machineName);

        // get the variable being written to
        const variable = machineVariableList[actualMachineName].variables[variableName];
        if (variable === undefined) return;

        // get the payload as an object
        const payloadObject = JSON.parse(payload.toString());
        if (!_.has(payloadObject, 'value')) return;

        // create the data object
        const data = {
          machine: actualMachineName,
          variable: variableName,
          access: 'write',
          arrayIndex: _.get(variable.arrayIndex),
        };
        data[data.variable] = payloadObject.value;

        // write the data to the database
        db.add(data, (error) => {
          if (error) {
            alert.raise({
              key: `db-add-error-${machineName}-${variableName}`,
              msg: 'AWS-IoT: Error attempting to add to database',
              description: `Database set failed for ${variableName} in machine ${machineName}`,
            });
          }

          alert.clear(`db-add-error-${machineName}-${variableName}`);
        });
      });

      client.on('error', () => {
      // raise alert
        alert.raise({ key: 'connection-error' });
        // remove database listener
        db.removeListener('added', databaseListener);
      });

      client.on('offline', () => {
      // raise alert
        alert.raise({ key: 'connection-offline' });
        // remove database listener
        db.removeListener('added', databaseListener);
      });

      client.on('close', () => {
      // remove database listener
        db.removeListener('added', databaseListener);
      });

      bStarted = true;
      running = true;
      log.info('Started', pkg.name);
      return done(null, config.info);
    },
  );

  return undefined;
};

function cleanUp() {
  bStarted = false;
  log.info('Stopped', pkg.name);
  AWSConnected = false;
  AWSDataAllowed = false;

  // we are cleaning up, so if there is a timer, we don't need it to call us any more
  if (endTimeoutTimer !== null) {
    clearInterval(endTimeoutTimer);
    endTimeoutTimer = null;
  }

  // make sure we only clean up and call the stop callback once
  if (doneCleanup === false) {
    doneCleanup = true;
    machineVariableList = {};
    client = null;
    running = false;
    alert.clearAll(() => stopCallback(null));
  }
}

sparkAwsIotAdvancedClient.stop = function stop(done) {
  if (!bStarted) {
    return done(new Error('not started'));
  }

  stopCallback = done;
  doneCleanup = false;
  // need to cancel the listen event that causes the publishes
  db.removeListener('added', databaseListener);

  if (client) {
    client.end(cleanUp);
    // 'end' function fails to call the callback under certain conditions,
    // so start a timer that will trigger the clean up in case
    endTimeoutTimer = setInterval(cleanUp, 2000);
  } else {
    cleanUp();
  }

  return undefined;
};

sparkAwsIotAdvancedClient.require = function require() {
  return ['spark-logging',
    'spark-db',
    'spark-alert',
    'spark-config',
  ];
};

module.exports = sparkAwsIotAdvancedClient;
