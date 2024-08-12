/* jshint esversion: 6 */
const os = require('os');
const { EventEmitter } = require('events');

let sparkplug = require('sparkplug-client');
const moment = require('moment');
const async = require('async');
const _ = require('lodash');
const pkg = require('./package.json');
const config = require('./config.json');

//------------------------------------------------------------------------------

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};
config.info = info;

const sparkSparkplugClient = new EventEmitter();
let log;
let db;
let conf;
let alert = null;
let running = false;
let sparkplugClient = null;
let started = false;
let machineNameList = [];
let deliverEntireResponseMachineNameList = [];
const machineVariableList = {};
let machineVariableValueList = [];
let connectedToSparkplugFlag = false;
let utcOffset = 0;
let machineVariableSchema = {};
let machineVariableNameSchema = {};
let machineNameMap = {};
let overrideVariableNameList = {};

let mqttServerUrlArray = [];
let currentMqttServerIndex = 0;
let reconnectTimer = null;

let currentDeviceInfo = null;

if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line global-require
  sparkplug = require('./test/sparkplug-tester');
  sparkSparkplugClient.sparkplugTester = sparkplug;
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
    case 'object':
    case 'array':
      varType = 'string';
      break;
    default:
  }

  return varType;
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function getVariableType(variable) {
  let variableType = null;

  if (_.get(variable, 'array', false)) {
    variableType = 'array';
  } else if (_.has(variable, 'outputFormat')) {
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
  } else {
    const numberTestRegex = new RegExp('^[-0-9.]*$');

    if (numberTestRegex.test(newValueString)) {
      if (newValueString.indexOf('.') !== -1) {
        variableFormat = 'float';
      } else {
        variableFormat = 'int32';
      }
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
        if (utcOffset) {
          metricsElement.properties = {
            localTime: {
              type: 'uint64',
              value: (Date.now() + (utcOffset * 1000 * 60 * 60)),
            },
          };
        }
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
    if (utcOffset) {
      if (!_.has(metricsElement, 'properties')) {
        metricsElement.properties = {};
      }
      metricsElement.properties.localTime = {
        type: 'uint64',
        value: (Date.now() + (utcOffset * 1000 * 60 * 60)),
      };
    }

    metrics.push(metricsElement);

    listIndex += 1;
  }

  if (metrics.length > 0) {
    const payload = { timestamp: Date.now(), metrics };
    // Publish device birth
    if (_.has(machineNameMap, machineName)) {
      sparkplugClient.publishDeviceBirth(machineNameMap[machineName], payload);
    } else {
      sparkplugClient.publishDeviceBirth(machineName, payload);
    }
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
      const variableFormat = getVariableType(variable);
      if (variableFormat !== null) {
        const metricsElement = {
          name: variable.name,
          type: variableFormat,
        };
        if (utcOffset) {
          metricsElement.properties = {
            localTime: {
              type: 'uint64',
              value: (Date.now() + (utcOffset * 1000 * 60 * 60)),
            },
          };
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
    const payload = { timestamp: Date.now(), metrics };
    // Publish device birth
    if (_.has(machineNameMap, machineName)) {
      sparkplugClient.publishDeviceBirth(machineNameMap[machineName], payload);
    } else {
      sparkplugClient.publishDeviceBirth(machineName, payload);
    }
  }
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function sendSingleDeviceBirth(machineName) {
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
  connectedToSparkplugFlag = true;
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function getActiveMachines(done) {
//  return done(null, []);
  //     conf.redis.keys('machines:*:settings:model:enable', function(err, keys) {
  // console.log('err = ' + JSON.stringify(err));
  // console.log('keys = ' + JSON.stringify(keys));
  //         if (keys) {
  //             console.log(JSON.stringify(keys));
  //         }
  //     });
//  console.log('1: <><><><><><><>');
//  console.log(JSON.stringify(conf));
//  console.log('2: <><><><><><><>');

  const localMachineArray = [];
  conf.get('machines', (err, machines) => {
    if (err) {
      return done(err, []);
    }
    //  add each enabled machine in the array to the local machineList
    _.forOwn(machines, (machine) => {
      // check its a valid machine (must have an info section)
      // console.log('machine = ' + JSON.stringify(machine));
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
    console.log('++++++++++++++++++++++++++++++++++++++++++++++');
    console.log(`localMachineArray = ${JSON.stringify(localMachineArray)}`);
    console.log('++++++++++++++++++++++++++++++++++++++++++++++');

    return done(null, localMachineArray);
  });

  // if (!_.has(conf, 'redis')) {
  //   console.log('2a: <><><><><><><>');
  //   return done(null, []);
  // }
  //
  // conf.redis.keys('nconf:machines:*:settings:model:enable', (err, keys) => {
  //   if (err) {
  //     console.log(`err = ${JSON.stringify(err)}`);
  //     return done(err, []);
  //   }
  //
  //   if (_.isEmpty(keys)) {
  //     console.log('keys isEmpty');
  //     return done(null, []);
  //   }
  //
  //   console.log('3: <><><><><><><>');
  //   conf.redis.mget(keys, (err2, result) => {
  //     if (err2) {
  //       return done(err2, []);
  //     }
  //
  //     // loop through the results
  //     let machineInfoKeys = [];
  //     result.forEach((r, i) => {
  //       // parse the result.  It will either be "true" or "false"
  //       const isEnabled = JSON.parse(r);
  //
  //       // ignore machines which are disabled
  //       if (!isEnabled) {
  //         return;
  //       }
  //
  //       // extract the machine name from the key
  //       const machineName = keys[i].split(':')[2];
  //
  //       // construct a set of keys we now need to query
  //       // to get info on the enabled machines
  //       machineInfoKeys = machineInfoKeys.concat([
  //         `nconf:machines:${machineName}:info:description`,
  //         `nconf:machines:${machineName}:info:version`,
  //         `nconf:machines:${machineName}:info:fullname`,
  //         `nconf:machines:${machineName}:info:hpl`,
  //         `nconf:machines:${machineName}:info:name`,
  //       ]);
  //     });
  //
  //     if (machineInfoKeys.length === 0) {
  //       return done(null, []);
  //     }
  //
  //     // query all the info for the enabled machines
  //     conf.redis.mget(machineInfoKeys, (err3, machineInfoResult) => {
  //       if (err3) {
  //         return done(err3, []);
  //       }
  //
  //       // convert the machineInfoResult into an object
  //       const machines = {};
  //       machineInfoResult.forEach((r, i) => {
  //         const machineInfo = JSON.parse(r);
  //         if (machineInfo) {
  //           const machineName = machineInfoKeys[i].split(':')[2];
  //           const k = machineInfoKeys[i].split(':')[4];
  //           if (!(Object.prototype.hasOwnProperty.call(machines, machineName))) {
  //             machines[machineName] = {};
  //           }
  //           machines[machineName][k] = machineInfo;
  //         }
  //       });
  //
  //       // return the object as an array
  //       return done(null, _.values(machines));
  //     });
  //     return undefined;
  //   });
  //   return undefined;
  // });
  // return undefined;
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function getActiveProtocols(done) {
//  return done(null, []);

  //  console.log('1: <><><><><><><>');
  //  console.log(JSON.stringify(conf));
  //  console.log('2: <><><><><><><>');

  const localProtocolArray = [];
  conf.get('protocols', (err, protocols) => {
    if (err) {
      return done(err, []);
    }
    //  add each enabled protocol in the array to the local protocol list
    _.forOwn(protocols, (protocol) => {
      // check its a valid machine (must have an info section)
      //      console.log(`protocol = ${JSON.stringify(protocol)}`);
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
    console.log('++++++++++++++++++++++++++++++++++++++++++++++');
    console.log(`localProtocolArray = ${JSON.stringify(localProtocolArray)}`);
    console.log('++++++++++++++++++++++++++++++++++++++++++++++');

    return done(null, localProtocolArray);
  });


  //
  //
  //
  //
  //
  // if (!_.has(conf, 'redis')) {
  //   console.log('2a: <><><><><><><>');
  //   return done(null, []);
  // }
  //
  //
  // conf.redis.keys('nconf:protocols:*:settings:model:enable', (err, keys) => {
  //   if (err) {
  //     return done(err, []);
  //   }
  //
  //   if (_.isEmpty(keys)) {
  //     return done(null, []);
  //   }
  //   conf.redis.mget(keys, (err2, result) => {
  //     if (err2) {
  //       return done(err2, []);
  //     }
  //
  //     // loop through the results, completing the processing of each result sequentially
  //     let protocolInfoKeys = [];
  //     async.eachOfSeries(result, (r, i, cb) => {
  //       // parse the result.  It will either be "true" or "false"
  //       const isEnabled = JSON.parse(r);
  //
  //       // ignore protocols which are disabled
  //       if (!isEnabled) {
  //         return cb(null);
  //       }
  //
  //       // extract the protocol name from the key
  //       const protocolName = keys[i].split(':')[2];
  //
  //       // check whether the protocol has a schema (i.e., can be configured, unlike, e.g., REST)
  //       conf.redis.keys(`nconf:protocols:${protocolName}:settings:schema:*`,
  //                        (err3, schemaKeys) => {
  //         if (!err3 && !_.isEmpty(schemaKeys)) {
  //           // construct a set of keys we now need to query
  //           // to get info on the enabled protocols
  //           protocolInfoKeys = protocolInfoKeys.concat([
  //             `nconf:protocols:${protocolName}:info:description`,
  //             `nconf:protocols:${protocolName}:info:version`,
  //             `nconf:protocols:${protocolName}:info:fullname`,
  //             `nconf:protocols:${protocolName}:info:name`,
  //           ]);
  //         }
  //
  //         cb(null);
  //       });
  //       return undefined;
  //     }, (err3) => {
  //       if (err3) {
  //         return done(err3, []);
  //       }
  //
  //       // after getting keys for all enabled protocols with schemas, get and return their names
  //       if (protocolInfoKeys.length === 0) {
  //         return done(null, []);
  //       }
  //
  //       // query all the info for the enabled machines
  //       conf.redis.mget(protocolInfoKeys, (err4, protocolInfoResult) => {
  //         if (err4) {
  //           return done(err4, []);
  //         }
  //
  //         // convert the protocolInfoResult into an object
  //         const protocols = {};
  //         protocolInfoResult.forEach((r, i) => {
  //           const protocolInfo = JSON.parse(r);
  //           if (protocolInfo) {
  //             const protocolName = protocolInfoKeys[i].split(':')[2];
  //             const k = protocolInfoKeys[i].split(':')[4];
  //             if (!(Object.prototype.hasOwnProperty.call(protocols, protocolName))) {
  //               protocols[protocolName] = {};
  //             }
  //             protocols[protocolName][k] = protocolInfo;
  //           }
  //         });
  //
  //         // return the object as an array
  //         return done(null, _.values(protocols));
  //       });
  //       return undefined;
  //     });
  //     return undefined;
  //   });
  //   return undefined;
  // });
  // return undefined;
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function getNodeMetrics(done) {
  async.parallel(
    [
      // get SparkInfo data
      function (cb1) {
        async.waterfall([

          function (cb2) {
            return cb2(null, {
              Hostname: os.hostname(),
              PrettyHostname: os.hostname(),
              Location: 'string',
              Kernel: 'string',
              OS: 'string',
              Eth0Mac: 'string',
              Wlan0Mac: 'string',
            });
          },

          function (nodeBirthSparkInfoMetric, cb2) {
            getActiveMachines((err, machines) => {
              const localNodeBirthSparkInfoMetric = nodeBirthSparkInfoMetric;
              if (machines.length > 0) {
                console.log(`machines = ${JSON.stringify(machines)}`);
                localNodeBirthSparkInfoMetric.Machines = machines;
              } else {
                localNodeBirthSparkInfoMetric.Machines = [];
              }
              return cb2(err, localNodeBirthSparkInfoMetric);
            });
          },

          function (nodeBirthSparkInfoMetric, cb2) {
            getActiveProtocols((err, protocols) => {
              const localNodeBirthSparkInfoMetric = nodeBirthSparkInfoMetric;
              if (protocols.length > 0) {
                console.log(`protocols = ${JSON.stringify(protocols)}`);
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
            console.log(`nodeBirthSparkInfoMetric = ${JSON.stringify(nodeBirthSparkInfoMetric)}`);
            cb1(null, nodeBirthSparkInfoMetric);
          }
        });
      },

      // get DeviceInfo data
      function (cb1) {
        if (currentDeviceInfo === null) {
          // we haven't seend the deviceinfo variable come in, so return an empty json object
          cb1(null, {});


          // if (!_.has(conf, 'redis')) {
          //   console.log('2a: <><><><><><><>');
          //   cb1(null, {});
          // } else {
          //   // find the latest device-info data
          //   conf.redis.keys('machine:spark-machine-deviceinfo:read:data:*', (err, keys) => {
          //     console.log('conf.redis.keys: keys.length = ' + keys.length);
          //     if (!_.isEmpty(keys)) {
          //       keys.sort();
          //       console.log(`(*)(*)(*)(*)(*)(*)(*)(*)(*) keys = ${JSON.stringify(keys)}`);
          //
          //       db.get(keys[keys.length - 1], (dbgetErr, entry) => {
          //         console.log(`(*)(*)(*)(*)(*)(*)(*)(*)(*) entry = ${JSON.stringify(entry)}`);
          //         currentDeviceInfo = entry[entry.deviceinfo];
          //         console.log(`(*)(*)(*)(*)(*)(*)(*)(*)(*) currentDeviceInfo =
          //                      ${JSON.stringify(currentDeviceInfo)}`);
          //         cb1(null, currentDeviceInfo);
          //       });
          //     } else {
          //       cb1(null, {});
          //     }
          //   });
          // }
        } else {
          console.log(`<><><><><><><><><> currentDeviceInfo = ${JSON.stringify(currentDeviceInfo)}`);
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
    };

    console.log('-----------------------------------');
    console.log(`payload = ${JSON.stringify(payload)}`);
    console.log('-----------------------------------');

    // Publish Node BIRTH certificate
    sparkplugClient.publishNodeBirth(payload);
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
  const payload = { timestamp: Date.now() };

  // Publish device death
  if (_.has(machineNameMap, machineName)) {
    sparkplugClient.publishDeviceDeath(machineNameMap[machineName], payload);
  } else {
    sparkplugClient.publishDeviceDeath(machineName, payload);
  }
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function databaseListener(key) {
  if (connectedToSparkplugFlag) {
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
          };

          console.log(`++++++++++++ NODE DATA payload = ${JSON.stringify(payload)}`);
          sparkplugClient.publishNodeData(payload);
        });
      }

      // check we have a variable list for this machine
      if (_.has(machineVariableList, entry.machine)) {
        const variableTimestamp = moment(entry.createdAt).valueOf();

        // first check if variableName exists in the list before proceding
        // (as may have been added before we have updated our internal list)
        if (machineVariableList[entry.machine].variables[entry.variable] === undefined) {
          return;
        }

        const deviceId = entry.machine;
        const variableName = entry.variable;

        let variableValue = entry[variableName];
        const metricsArray = [];

        const deliverEntireResponseIndex = deliverEntireResponseMachineNameList.indexOf(deviceId);

        if (((_.has(machineVariableList[deviceId].variables[variableName], 'deliverEntireResponse'))
          && (machineVariableList[deviceId].variables[variableName].deliverEntireResponse === true))
                    || (deliverEntireResponseIndex > -1)) {
          // we're being given an entire response's worth of variable data.
          //  need to parse and send a combined DeveiceData message
          if (isArray(variableValue)) { // ensure it's an array before parsing
            const variableListSchema = [];
            const variableNameSchema = [];
            let variableGenericNameIndex = 1;
            for (let listIndex = 0; listIndex < variableValue.length; listIndex += 1) {
              const variableListName = variableValue[listIndex].name;
              let variableListValue = variableValue[listIndex].value;
              const variableLowerLimit = variableValue[listIndex].lowerLimit;
              const variableUpperLimit = variableValue[listIndex].upperLimit;
              let variableListType;

              if (typeof (variableListValue) === 'object') {
                variableListValue = JSON.stringify(variableListValue);
                variableListType = 'string';
              } else {
                variableListType = GetVariableFormatFromValue(variableListValue);
              }

              if (_.has(overrideVariableNameList, deviceId)) {
                variableListSchema.push({
                  name: overrideVariableNameList[deviceId] + variableGenericNameIndex,
                  type: variableListType,
                  lowerLimit: variableLowerLimit,
                  upperLimit: variableUpperLimit,
                });
                variableNameSchema.push(variableListName);
                metricsArray.push({
                  name: overrideVariableNameList[deviceId] + variableGenericNameIndex,
                  value: variableListValue,
                  type: variableListType,
                  'Engineering Low Limit': variableLowerLimit,
                  'Engineering High Limit': variableUpperLimit,
                });
                variableGenericNameIndex += 1;
              } else {
                variableListSchema.push({
                  name: variableListName,
                  type: variableListType,
                  lowerLimit: variableLowerLimit,
                  upperLimit: variableUpperLimit,
                });
                metricsArray.push({
                  name: variableListName,
                  value: variableListValue,
                  type: variableListType,
                  'Engineering Low Limit': variableLowerLimit,
                  'Engineering High Limit': variableUpperLimit,
                });
              }
              if (utcOffset) {
                metricsArray[listIndex].properties = {
                  localTime: {
                    type: 'uint64',
                    value: (variableTimestamp + (utcOffset * 1000 * 60 * 60)),
                  },
                };
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
          let variableType = getVariableType(machineVariableList[entry.machine]
            .variables[entry.variable]);
          if (variableType === null) {
            return;
          }

          // sparkplug doesn't handle array of strings properly when outputFormat is set to 'char'
          // so converting array of strings to array
          // (which will be stringified by JSON.stringify by the following block)
          const variableSchema = machineVariableList[entry.machine].variables[entry.variable];
          if (isArray(variableValue) && _.isEqual(_.get(variableSchema, 'outputFormat', false), 'char') && !_.isEqual(variableSchema.format, 'char')) {
            variableValue = _.map(variableValue, _.toNumber);
          }

          if (typeof (variableValue) === 'object') {
            variableValue = JSON.stringify(variableValue);
            variableType = 'string';
          }

          // if publish only on value change, return if value has not changed
          if (_.has(config.settings.model, 'onChangeOnly') && config.settings.model.onChangeOnly) {
            if (_.has(machineVariableValueList, entry.machine)) {
              if (_.has(machineVariableValueList[entry.machine], variableName)) {
                if (machineVariableValueList[entry.machine][variableName] === variableValue) return;
              }

              machineVariableValueList[entry.machine][variableName] = variableValue;
            }
          }

          metricsArray.push({
            name: variableName,
            value: variableValue,
            type: variableType,
          });
          if (utcOffset) {
            metricsArray[0].properties = {
              localTime: {
                type: 'uint64',
                value: (variableTimestamp + (utcOffset * 1000 * 60 * 60)),
              },
            };
          }
        }

        const payload = {
          timestamp: variableTimestamp,
          metrics: metricsArray,
        };

        // Publish device data
        if (sparkplugClient !== null) {
          if (_.has(machineNameMap, deviceId)) {
            sparkplugClient.publishDeviceData(machineNameMap[deviceId], payload);
          } else {
            sparkplugClient.publishDeviceData(deviceId, payload);
          }
        }
      }
    });
  }
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function DisconnectFromSparkplugServer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  sparkplugClient.stop();
  sparkplugClient.removeAllListeners();
  sparkplugClient = null;
  log.debug('stopping sparkplugClient in offline handler');
  currentMqttServerIndex += 1;
  connectedToSparkplugFlag = false;
  // eslint-disable-next-line no-use-before-define
  reconnectTimer = setTimeout(ConnectToSparkplugServer, 1000);
}
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function ConnectToSparkplugServer() {
  connectedToSparkplugFlag = false;

  if (mqttServerUrlArray.length === 0) {
    return; // can't try to connect if we don't have any servers defined.
  }

  if (currentMqttServerIndex >= mqttServerUrlArray.length) {
    currentMqttServerIndex = 0; // rollover to the first server
  }

  //    var mqttServerUrl = 'tcp://' + config.settings.model.mqttServer1Hostname;
  //    if (config.settings.model.mqttServer1Port) {
  //        mqttServerUrl += ':' + config.settings.model.mqttServer1Port;
  //    }

  const clientConfig = {
    serverUrl: mqttServerUrlArray[currentMqttServerIndex],
    username: config.settings.model.username,
    password: config.settings.model.password,
    groupId: config.settings.model.groupId,
    edgeNode: os.hostname(),
    clientId: `SparkEdgeNode-${os.hostname()}`,
    connectionTimeout: 5,
    publishDeath: true,
    version: 'spBv1.0',
  };

  log.debug('clientConfig: ', clientConfig);

  if (sparkplugClient) {
    log.debug('stopping sparkplugClient in ConnectToSparkplugServer');
    sparkplugClient.stop();
  }

  sparkplugClient = sparkplug.newClient(clientConfig);

  //--------------------------------------------------------------

  sparkplugClient.on('connect', () => {
    log.debug("received 'connect' event.  Sparkplug server: ", sparkplugClient);
    // listen for changes to the machine variables
    // but only add the listener once
    if (db.listeners('added').indexOf(databaseListener) === -1) {
      db.on('added', databaseListener);
    }
    alert.clear('connection-error');
  });

  //--------------------------------------------------------------

  sparkplugClient.on('birth', () => {
    log.debug("received 'birth' event");
    sendBirthData();
  });

  //--------------------------------------------------------------

  sparkplugClient.on('ncmd', (payload) => {
    log.debug("received 'ncmd' event, payload: ", payload);

    // handle received 'Node Control/Rebirth' message:
    //     debug: Message arrived
    //     debug:  topic: spBv1.0/Sparkplug B Devices/NCMD/us140-spark008
    //     debug:  payload: {"timestamp":1510161029711,"metrics":[{"name":"Node Control/Rebirth",
    //                       "type":"Boolean","value":true}],"seq":18446744073709552000}
    if (_.has(payload, 'metrics')) {
      const { metrics } = payload;
      if (Array.isArray(metrics)) { // verify it's an array before indexing it.
        for (let metricsIndex = 0; metricsIndex < metrics.length; metricsIndex += 1) {
          const metricElement = metrics[metricsIndex];
          if ((_.has(metricElement, 'name'))
                        && (_.has(metricElement, 'type'))
                        && (_.has(metricElement, 'value'))) {
            if ((metricElement.name === 'Node Control/Rebirth')
                            && (metricElement.type === 'Boolean')
                            && (metricElement.value === true)) {
              sendBirthData();
              break; // exit the loop.  Note that this may need to be changed if we find
              // that several commands are issued in a single 'metrics' payload.
              // But for now, we're only looking for the 'Node Control/Rebirth', so
              // we're ok to stop processing.
            }
          }
        }
      }
    }
  });

  //--------------------------------------------------------------

  sparkplugClient.on('dcmd', (payload) => {
    log.debug("received 'dcmd' event, payload: ", payload);
  });

  //--------------------------------------------------------------

  sparkplugClient.on('reconnect', () => {
    log.debug("received 'reconnect' event");
    connectedToSparkplugFlag = false;
  });

  //--------------------------------------------------------------

  sparkplugClient.on('error', (error) => {
    alert.raise({ key: 'connection-error', errorMsg: error.message });
    DisconnectFromSparkplugServer();
  });

  //--------------------------------------------------------------

  sparkplugClient.on('offline', () => {
    alert.raise({ key: 'connection-error', errorMsg: 'Server appears offline. Check server hostname is set correctly and that the server is running.' });
    DisconnectFromSparkplugServer();
  });

  //--------------------------------------------------------------

  sparkplugClient.on('close', () => {
    log.debug("received 'close' event");
    connectedToSparkplugFlag = false;
  });
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

function loadMqttServerArray() {
  mqttServerUrlArray = [];

  let mqttServerUrl;
  if (config.settings.model.mqttServer1Hostname) {
    mqttServerUrl = `tcp://${config.settings.model.mqttServer1Hostname}`;
    if (config.settings.model.mqttServer1Port) {
      mqttServerUrl += `:${config.settings.model.mqttServer1Port}`;
    }
    mqttServerUrlArray.push(mqttServerUrl);
  }
  if (config.settings.model.mqttServer2Hostname) {
    mqttServerUrl = `tcp://${config.settings.model.mqttServer2Hostname}`;
    if (config.settings.model.mqttServer2Port) {
      mqttServerUrl += `:${config.settings.model.mqttServer2Port}`;
    }
    mqttServerUrlArray.push(mqttServerUrl);
  }
  if (config.settings.model.mqttServer3Hostname) {
    mqttServerUrl = `tcp://${config.settings.model.mqttServer3Hostname}`;
    if (config.settings.model.mqttServer3Port) {
      mqttServerUrl += `:${config.settings.model.mqttServer3Port}`;
    }
    mqttServerUrlArray.push(mqttServerUrl);
  }
  if (config.settings.model.mqttServer4Hostname) {
    mqttServerUrl = `tcp://${config.settings.model.mqttServer4Hostname}`;
    if (config.settings.model.mqttServer4Port) {
      mqttServerUrl += `:${config.settings.model.mqttServer4Port}`;
    }
    mqttServerUrlArray.push(mqttServerUrl);
  }
  if (config.settings.model.mqttServer5Hostname) {
    mqttServerUrl = `tcp://${config.settings.model.mqttServer5Hostname}`;
    if (config.settings.model.mqttServer5Port) {
      mqttServerUrl += `:${config.settings.model.mqttServer5Port}`;
    }
    mqttServerUrlArray.push(mqttServerUrl);
  }
  currentMqttServerIndex = 0;
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

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
        sparkSparkplugClient.emit('restartRequest', info.name);
      }
    });
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

      // get the machines details
      conf.get(`machines:${machineName}`, (err, machine) => {
        if ((!err) && (machine)) {
          const machineEnabled = machine.settings.model.enable && (_.get(machine.settings.model, 'connectionStatus', true));
          const publishingEnabled = !machine.settings.model.publishDisabled;

          // find if the machine already exists in the queue
          const machineExists = _.has(machineVariableList, machineName);

          let index;

          if ((machineEnabled) && (publishingEnabled) && (!machineExists)) {
            // if the machine has just been enabled and it is not in the queue

            log.info(`Adding Machine: ${machineName}`);

            // store the machine's variable information as a key list (from input array)
            // don't need to store variable info, currently just need to have created an object
            // of machineName in the machineVariableList (but may be handy in the future)
            machineNameList.push(machineName);

            if ((_.has(machine.info, 'genericNamespace')) && (machine.info.genericNamespace !== 'NONE')) {
              machineNameMap[machineName] = machine.info.genericNamespace;
            } else if ((_.has(machine.settings.model, 'genericNamespace')) && (machine.settings.model.genericNamespace !== 'NONE')) {
              // use the genericNamespace setting from the machine schema (non-hpl)
              machineNameMap[machineName] = machine.settings.model.genericNamespace;
            } else {
              machineNameMap[machineName] = machineName;
            }

            machineVariableList[machineName] = { variables: _.keyBy(machine.variables, 'name') };
            machineVariableValueList = [];
            if ((_.has(machine.settings.model, 'deliverEntireResponse'))
                            && (machine.settings.model.deliverEntireResponse === true)) {
              deliverEntireResponseMachineNameList.push(machineName);
              if ((_.has(machine.settings.model, 'overrideVariableNameFlag'))
                                && (machine.settings.model.overrideVariableNameFlag === true)
                                && (_.has(machine.settings.model, 'overrideVariableNameBase'))
                                && (machine.settings.model.overrideVariableNameBase !== null)) {
                overrideVariableNameList[machineName] = machine.settings.model
                  .overrideVariableNameBase;
              }
            }
            if (connectedToSparkplugFlag) {
              sendSingleDeviceBirth(machineName);
            }
          } else if (((!machineEnabled) || (!publishingEnabled)) && (machineExists)) {
            // else if machine has just been disabled and exists in the queue

            log.info(`Removing Machine: ${machineName}`);

            index = machineNameList.indexOf(machineName);
            if (index > -1) {
              machineNameList.splice(index, 1);
            }
            index = deliverEntireResponseMachineNameList.indexOf(machineName);
            if (index > -1) {
              // since the machine is gone, remove it from this list also.
              deliverEntireResponseMachineNameList.splice(index, 1);
            }

            delete machineNameMap[machineName];

            // delete the entry from the queue object
            delete machineVariableList[machineName];
            delete machineVariableValueList[machineName];
            delete machineVariableSchema[machineName];
            delete machineVariableNameSchema[machineName];
            delete overrideVariableNameList[machineName];

            if (connectedToSparkplugFlag) {
              sendDeviceDeath(machineName);
            }
          } else if ((machineEnabled) && (publishingEnabled) && (machineExists)) {
            // if we see an enabled machine that already exists, the variables may have changed

            // or the namespace may have changed
            if ((_.has(machine.info, 'genericNamespace')) && (machine.info.genericNamespace !== 'NONE')) {
              machineNameMap[machineName] = machine.info.genericNamespace;
            } else if ((_.has(machine.settings.model, 'genericNamespace')) && (machine.settings.model.genericNamespace !== 'NONE')) {
              // use the genericNamespace setting from the machine schema (non-hpl)
              machineNameMap[machineName] = machine.settings.model.genericNamespace;
            } else {
              machineNameMap[machineName] = machineName;
            }

            // before deleting see if the variable list has actually changed
            // (can get double enables - so this debounces)
            const updatedList = { variables: _.keyBy(machine.variables, 'name') };

            let sendNewDeviceBirthFlag = false;

            // if the variables have changed
            if (_.isEqual(machineVariableList[machineName], updatedList) === false) {
              log.info(`Updating Machine: ${machineName}`);

              // delete the old entry and re-create with the updated list
              delete machineVariableList[machineName];
              machineVariableList[machineName] = updatedList;
              delete machineVariableValueList[machineName];
              delete machineVariableSchema[machineName];
              delete machineVariableNameSchema[machineName];
              sendNewDeviceBirthFlag = true;
            }
            // check for changes to the deliverEntireResponse field
            if ((_.has(machine.settings.model, 'deliverEntireResponse'))
                            && (machine.settings.model.deliverEntireResponse === true)) {
              index = deliverEntireResponseMachineNameList.indexOf(machineName);
              if (index <= -1) {
                // we didn't find it in our list, but it DOES have this feature, so add it.
                deliverEntireResponseMachineNameList.push(machineName);
                sendNewDeviceBirthFlag = true;
              }
            } else {
              index = deliverEntireResponseMachineNameList.indexOf(machineName);
              if (index > -1) {
                // we found this machine in our list, but it no longer has this feature - remove it
                deliverEntireResponseMachineNameList.splice(index, 1);
                sendNewDeviceBirthFlag = true;
              }
            }
            // check for changes to the overrideVariableName fields
            if ((_.has(machine.settings.model, 'overrideVariableNameFlag'))
                            && (machine.settings.model.overrideVariableNameFlag === true)
                            && (_.has(machine.settings.model, 'overrideVariableNameBase'))
                            && (machine.settings.model.overrideVariableNameBase !== null)) {
              if ((!_.has(overrideVariableNameList, machineName))
                                || (overrideVariableNameList[machineName]
                                   !== machine.settings.model.overrideVariableNameBase)) {
                // if we didn't hae an override variable name before, or if it had changed
                overrideVariableNameList[machineName] = machine.settings.model
                  .overrideVariableNameBase;
                sendNewDeviceBirthFlag = true;
              }
            } else if (_.has(overrideVariableNameList, machineName)) {
              // we had an override previously, but it is now disabled.
              delete overrideVariableNameList[machineName];
              sendNewDeviceBirthFlag = true;
            }
            if ((sendNewDeviceBirthFlag) && (connectedToSparkplugFlag)) {
              sendSingleDeviceBirth(machineName);
            }
          }
        }
      });
    }
  }
}

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

sparkSparkplugClient.start = function start(modules, done) {
  if (started) {
    return done(new Error('already started'));
  }

  log = modules['spark-logging'].exports.getLogger(pkg.name);
  db = modules['spark-db'].exports;
  conf = modules['spark-config'].exports;
  alert = modules['spark-alert'].exports.getAlerter(pkg.name);

  alert.preLoad({
    'connection-error': {
      msg: 'SparkPlug Client: Connection Error',
      description: x => `Client is not able to connect to Mqtt server. Error: ${x.errorMsg}`,
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
          ({ utcOffset } = config.settings.model);
          loadMqttServerArray();
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
          started = true;
          return done(null, config.info);
        }

        // get a list of machines from the config
        conf.get('machines', (err, machines) => {
          if (err) {
            cb(err);
            return;
          }

          //  add each enabled machine in the array to the local machineVariableList
          machineNameList = [];
          deliverEntireResponseMachineNameList = [];
          overrideVariableNameList = {};

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

                if ((_.has(machine.info, 'genericNamespace')) && (machine.info.genericNamespace !== 'NONE')) {
                  // use the genericNamespace setting from the hpl schema
                  machineNameMap[machineName] = machine.info.genericNamespace;
                } else if ((_.has(machine.settings.model, 'genericNamespace')) && (machine.settings.model.genericNamespace !== 'NONE')) {
                  // use the genericNamespace setting from the machine schema (non-hpl)
                  machineNameMap[machineName] = machine.settings.model.genericNamespace;
                } else {
                  machineNameMap[machineName] = machineName;
                }

                // store the machine's variable information as a key list (from input array)
                // don't need to store variable info, currently just need to have created an object
                // of machineName in the machineVariableList (but may be handy in the future)
                machineVariableList[machineName] = { variables: _.keyBy(machine.variables, 'name') };

                machineVariableValueList[machineName] = [];

                if ((_.has(machine.settings.model, 'deliverEntireResponse')) && (machine.settings.model.deliverEntireResponse === true)) {
                  deliverEntireResponseMachineNameList.push(machineName);
                  if ((_.has(machine.settings.model, 'overrideVariableNameFlag'))
                      && (machine.settings.model.overrideVariableNameFlag === true)
                      && (_.has(machine.settings.model, 'overrideVariableNameBase'))
                      && (machine.settings.model.overrideVariableNameBase !== null)) {
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
        ConnectToSparkplugServer();
        cb(null);
      },
    ],
    (err) => {
      // once all async task are completed, check for error
      if (err) {
        return done(err);
      }

      started = true;
      running = true;
      log.info('Started', pkg.name);
      return done(null, config.info);
    },
  );

  return undefined;
};

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

sparkSparkplugClient.stop = function stop(done) {
  if (!started) {
    return done(new Error('not started'));
  }

  // need to cancel the listen event that causes the publishes
  db.removeListener('added', databaseListener);

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (sparkplugClient) {
    sparkplugClient.stop();
    sparkplugClient = null;
  }
  log.info('Stopped', pkg.name);
  started = false;
  running = false;
  alert.clearAll(() => done(null));

  return undefined;
};

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

sparkSparkplugClient.require = function require() {
  return ['spark-logging',
    'spark-db',
    'spark-alert',
    'spark-config',
  ];
};

module.exports = sparkSparkplugClient;
