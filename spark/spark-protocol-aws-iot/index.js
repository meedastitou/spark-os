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

// let currentPublishTimestamp = 0;
// let lastPublishTimestamp = 0;
// let accumulatedTime = 0;
// let accumulatedPublishCount = 0;

const sparkAwsIotClient = new EventEmitter();
let log;
let db;
let conf;
let bStarted = false;
let alert = null;
let running = false;
let client = null;
const hostname = os.hostname();
let machineList = {};
let deliverEntireResponseMachineNameList = [];
let overrideVariableNameList = {};
let machineNameMap = {};
let stopCallback = null;
let endTimeoutTimer = null;
let doneCleanup = false;

if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line global-require
  awsIot = require('./test/aws-iot-tester');
  sparkAwsIotClient.awsIoTTester = awsIot;
}

function addExtraInfoIfVirtual(machine, cb) {
  // we need to get the machine details for all machines, as its a virtual
  // machine we need to get data out of the referenced machines
  conf.get('machines', (err, machines) => {
    // create a copy of the machine list keyed by machine name
    const machineObject = _.keyBy(machines, 'info.name');
    const machineName = machine.info.name;

    for (let j = 0; j < machine.variables.length; j += 1) {
      // find the machine in the 'machines' array that has the 'machine.info.name'
      //  that matches this one
      if (_.has(machine.variables[j], 'srcVariables')) {
        const referencedMachine = machineObject[machine.variables[j].srcVariables[0].srcMachine];

        // create a key list of the variables of this referenced machine
        const referencedMachineVariablesObject = _.keyBy(referencedMachine.variables, 'name');
        // get the referenced variable from the referenced machine
        const referencedVariable = referencedMachineVariablesObject[machine.variables[j]
          .srcVariables[0].srcVariable];

        // append the virtual machines variable info for the referenced
        // machine/variable that it uses
        machineList[machineName].variables[machine.variables[j].name]
          .referencedMachineInfo = referencedMachine.info;
        machineList[machineName].variables[machine.variables[j].name]
          .referencedMachineConfig = referencedMachine.settings.model;
        machineList[machineName].variables[machine.variables[j].name]
          .referencedVariable = referencedVariable;
      }
    }

    cb(null);
  });
}

function publishMachineVariablesMetaData(machineName, machineVariableMetaData) {
  // create the topic from the physical spark + machine
  const topic = `${hostname}/${_.get(machineNameMap, machineName, machineName)}`;
  // publish the machine's variable metadata with this topic
  client.publish(topic, JSON.stringify(machineVariableMetaData));
}

function subscribeToWriteVariables(machineName) {
  _.forOwn(machineList[machineName].variables, (variable) => {
    if (_.get(variable, 'access', 'read') === 'write') {
      client.subscribe(`${hostname}/${_.get(machineNameMap, machineName, machineName)}/${variable.name}`);
    }
  });
}

function unsubscribeToWriteVariables(machineName) {
  _.forOwn(machineList[machineName].variables, (variable) => {
    if (_.get(variable, 'access', 'read') === 'write') {
      client.unsubscribe(`${hostname}/${_.get(machineNameMap, machineName, machineName)}/${variable.name}`);
    }
  });
}

function onSetListener(key) {
  // check if anything in the model changes
  const reAwsIoTClientChanges = new RegExp(`protocols:${pkg.name}:settings:model:*`);
  // check if any machine's enable or publish state has changed
  const reMachineChanges = new RegExp('^machines:.*:settings:model:enable$|'
                                      + '^machines:.*:settings:model:publishDisabled$|'
                                      + '^machines:.*:settings:model:deliverEntireResponse$|'
                                      + '^machines:.*:settings:model:overrideVariableNameFlag$|'
                                      + '^machines:.*:settings:model:overrideVariableNameBase$|'
                                      + '^machines:.*:settings:model:genericNamespace$|'
                                      + '^machines:.*:info:genericNamespace$');
  // check if any machine's variables have changed
  const reMachineVariableChanges = new RegExp('^machines:.*:variables$');

  if (reAwsIoTClientChanges.test(key)) {
    conf.get(`protocols:${pkg.name}:settings:model`, (err, model) => {
      log.debug(`protocols:${pkg.name}:settings:model`, model);

      if (!_.isEqual(model, config.settings.model)) {
        // the enable key has changed
        log.debug(`protocols:${pkg.name}:settings:model changed from`, config.settings.model, 'to', model);

        config.settings.model = model;

        // request a restart
        sparkAwsIotClient.emit('restartRequest', info.name);
      }
    });
  }

  const machineEnableChanges = reMachineChanges.test(key);
  const variableChanges = reMachineVariableChanges.test(key);

  // if a machine has changed its enable state, or variables have changed
  if (machineEnableChanges || variableChanges) {
    // check we have already populated our list of machines and are fully up and running
    if (running === true) {
      // extract the machine name from the key
      const startIndex = key.indexOf(':') + 1;
      // end index will differ based on whether a machine or machine's variable has changed
      const endIndex = machineEnableChanges === true ? key.indexOf(':settings') : key.indexOf(':variables');
      const machineName = key.slice(startIndex, endIndex);

      // get the machine details
      conf.get(`machines:${machineName}`, (err, machine) => {
        const machineEnabled = machine.settings.model.enable;
        const publishingEnabled = !machine.settings.model.publishDisabled;

        // find if the machine already exists in the queue
        const machineExists = _.has(machineList, machineName);

        // if the machine has just been enabled and it is not in the queue
        if ((machineEnabled) && (publishingEnabled) && (!machineExists)) {
          log.info(`Adding Machine: ${machineName}`);

          // store the machine's info, variable information
          // (store variables as a key list for easier access)
          machineList[machineName] = { info: machine.info, variables: _.keyBy(machine.variables, 'name') };

          // map machine name to the generic name space if defined
          if ((_.has(machine.info, 'genericNamespace')) && (machine.info.genericNamespace !== 'NONE')) {
            machineNameMap[machineName] = machine.info.genericNamespace;
          } else if ((_.has(machine.settings.model, 'genericNamespace')) && (machine.settings.model.genericNamespace !== 'NONE')) {
            // use the genericNamespace setting from the machine schema (non-hpl)
            machineNameMap[machineName] = machine.settings.model.genericNamespace;
          } else {
            machineNameMap[machineName] = machineName;
          }

          // store info for delivering entire response (also allow variable name override)
          if (_.get(machine.settings.model, 'deliverEntireResponse', false)) {
            deliverEntireResponseMachineNameList.push(machineName);
          }
          if (_.get(machine.settings.model, 'overrideVariableNameFlag', false)
          && (_.get(machine.settings.model, 'overrideVariableNameBase', null) !== null)) {
            overrideVariableNameList[machineName] = machine.settings.model
              .overrideVariableNameBase;
          }

          // if machine is a virtual one
          if (machine.info.hpl === 'virtual') {
            addExtraInfoIfVirtual(machine, () => {
              // send list of variables for this newly enabled machine as published topic
              publishMachineVariablesMetaData(machineName, machineList[machineName]);

              // subscribe to any write variables
              subscribeToWriteVariables(machineName);
            });
          } else {
            // send list of variables for this newly enabled machine as published topic
            publishMachineVariablesMetaData(machineName, machineList[machineName]);

            // subscribe to any write variables
            subscribeToWriteVariables(machineName);
          }
        } else if (((!machineEnabled) || (!publishingEnabled)) && (machineExists)) {
          // else if machine has just been disabled and exists in the queue
          log.info(`Removing Machine: ${machineName}`);

          // unsubscribe to any write variables
          unsubscribeToWriteVariables(machineName);

          // delete the entry from the queue objects and array
          delete machineList[machineName];
          delete overrideVariableNameList[machineName];
          _.pull(deliverEntireResponseMachineNameList, machineName);
          delete machineNameMap[machineName];
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

          // before deleting see if the variable list has actually changed
          // (can get double enables - so this debounces)
          const updatedList = { info: machine.info, variables: _.keyBy(machine.variables, 'name') };

          // if the variables have changed
          if (_.isEqual(machineList[machineName], updatedList) === false) {
            log.info(`Updating Machine: ${machineName}`);

            // unsubscribe to any write variables
            unsubscribeToWriteVariables(machineName);

            // delete the old entry and re-create with the updated list
            delete machineList[machineName];
            machineList[machineName] = updatedList;

            // if machine is a virtual one
            if (machine.info.hpl === 'virtual') {
              addExtraInfoIfVirtual(machine, () => {
                // send list of updated variables for already enabled machine as published topic
                publishMachineVariablesMetaData(machineName, machineList[machineName]);

                // subscribe to any write variables
                subscribeToWriteVariables(machineName);
              });
            } else {
              // send list of updated variables for already enabled machine as published topic
              publishMachineVariablesMetaData(machineName, machineList[machineName]);

              // subscribe to any write variables
              subscribeToWriteVariables(machineName);
            }
          }

          // check for changes to the deliverEntireResponse field
          if (_.get(machine.settings.model, 'deliverEntireResponse', false)) {
            if (!deliverEntireResponseMachineNameList.includes(machineName)) {
              log.debug(`Enabling Deliver Entire Response for Machine: ${machineName}`);
              deliverEntireResponseMachineNameList.push(machineName);
            }
          } else {
            const index = deliverEntireResponseMachineNameList.indexOf(machineName);
            if (index !== -1) {
              log.debug(`Disabling Deliver Entire Response for Machine: ${machineName}`);
              deliverEntireResponseMachineNameList.splice(index, 1);
            }
          }

          // check for changes to the overrideVariableName fields
          if (_.get(machine.settings.model, 'overrideVariableNameFlag', false)
          && (_.get(machine.settings.model, 'overrideVariableNameBase', null) !== null)) {
            if (_.get(overrideVariableNameList, machineName, null)
                !== machine.settings.model.overrideVariableNameBase) {
              log.debug(`Enabling Override Variable Name for Machine: ${machineName}`);
              overrideVariableNameList[machineName] = machine.settings.model
                .overrideVariableNameBase;
            }
          } else if (_.has(overrideVariableNameList, machineName)) {
            log.debug(`Disabling Override Variable Name for Machine: ${machineName}`);
            delete overrideVariableNameList[machineName];
          }
        }
      });
    }
  }
}

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

function databaseListener(key) {
  // get the new data for the key
  db.get(key, (err, entry) => {
    // check we have a variable list for this machine
    if (_.has(machineList, entry.machine)) {
      // extract the required data from the returned entry
      const machineName = entry.machine;
      const variableName = entry.variable;
      const variableTimestamp = entry.createdAt;

      // first check if variableName exists in the list before calling
      // (as may have been added before we have updated our internal list)
      const variable = machineList[machineName].variables[variableName];
      if ((!_.get(variable, 'deliverEntireResponse', false))
        && (!deliverEntireResponseMachineNameList.includes(machineName))
        && (variable === undefined)) {
        return;
      }

      // do not publish write variables`
      if (_.get(variable, 'access', 'read') === 'write') return;

      let variableValue = entry[variableName];

      let newData = {};

      // if delivering entire response, construct an value that is an array of objects
      if (_.get(variable, 'deliverEntireResponse', false)
       || deliverEntireResponseMachineNameList.includes(machineName)) {
        let valueArray = [];
        let variableGenericNameIndex = 1;
        if (_.isArray(variableValue)) {
          if ((_.has(variableValue[0], 'name')) && (_.has(variableValue[0], 'value'))) {
            /* eslint-disable max-len */
            // this value, name configuration should be unique to the otto machine's
            // specific mechanism of delivering cavity information.
            // [
            //   {name: var1name. value: var1Value, lowerLimit: var1LowerLimit, upperLimit: var1UpperLimit, ...},
            //   {name: var2name. value: var2Value, lowerLimit: var2LowerLimit, upperLimit: var2UpperLimit, ...},
            //   {name: var3name. value: var3Value, lowerLimit: var3LowerLimit, upperLimit: var3UpperLimit, ...},
            //    ...   ,
            //   {name: varNname. value: varNValue, lowerLimit: varNLowerLimit, upperLimit: varNUpperLimit, ...},
            // ]
            /* eslint-enable max-len */
            for (let iVal = 0; iVal < variableValue.length; iVal += 1) {
              const variableListValue = variableValue[iVal].value;

              let cavityValue = _.get(variableValue[iVal], 'cavity', 0);
              cavityValue = cavityValue.toString();

              // if overriding variable name
              if (_.has(overrideVariableNameList, machineName)) {
                // first add an object containing the orignal name
                valueArray.push({
                  name: `${overrideVariableNameList[machineName] + variableGenericNameIndex}Name`,
                  type: 'string',
                  value: variableValue[iVal].name,
                });
                valueArray.push({
                  name: overrideVariableNameList[machineName] + variableGenericNameIndex,
                  value: variableListValue,
                  type: GetVariableFormatFromValue(variableListValue),
                  lowerLimit: variableValue[iVal].lowerLimit,
                  upperLimit: variableValue[iVal].upperLimit,
                  nominalValue: variableValue[iVal].nominalValue,
                  engineeringUnits: variableValue[iVal].engineeringUnits,
                  cavity: cavityValue.toString(),
                });
                variableGenericNameIndex += 1;
              } else {
                valueArray.push({
                  name: variableValue[iVal].name,
                  value: variableListValue,
                  type: GetVariableFormatFromValue(variableListValue),
                  lowerLimit: variableValue[iVal].lowerLimit,
                  upperLimit: variableValue[iVal].upperLimit,
                  nominalValue: variableValue[iVal].nominalValue,
                  engineeringUnits: variableValue[iVal].engineeringUnits,
                  cavity: cavityValue.toString(),
                });
              }
            }
          } else {
            // otherwise, this is an array configured like:
            // [
            //   {var1Name: var1Value},
            //   {var2Name: var2Value},
            //   {var3Name: var3Value},
            //    ...   ,
            //   {varNName: varNValue}
            // ]
            valueArray = variableValue;
          }
        } else if (_.isString(variableValue)) {
          variableValue = variableValue.replace(/^"(.*)"$/, '$1'); // remove lead/trail quotes
          const csvList = variableValue.split(',');
          for (let iPos = 0; iPos < csvList.length; iPos += 2) {
            const variableListValue = csvList[iPos + 1];
            // if overriding variable name
            const engineeringUnitsString = _.get(variable, 'engineeringUnits', '');
            if (_.has(overrideVariableNameList, machineName)) {
              // first add an object containing the orignal name
              valueArray.push({
                name: `${overrideVariableNameList[machineName] + variableGenericNameIndex}Name`,
                type: 'string',
                value: csvList[iPos],
              });
              if (engineeringUnitsString !== '') {
                valueArray.push({
                  name: overrideVariableNameList[machineName] + variableGenericNameIndex,
                  value: variableListValue,
                  type: GetVariableFormatFromValue(variableListValue),
                  engineeringUnits: engineeringUnitsString,
                });
              } else {
                valueArray.push({
                  name: overrideVariableNameList[machineName] + variableGenericNameIndex,
                  value: variableListValue,
                  type: GetVariableFormatFromValue(variableListValue),
                });
              }
              variableGenericNameIndex += 1;
            } else if (engineeringUnitsString !== '') {
              valueArray.push({
                name: csvList[iPos],
                value: variableListValue,
                type: GetVariableFormatFromValue(variableListValue),
                engineeringUnits: engineeringUnitsString,
              });
            } else {
              valueArray.push({
                name: csvList[iPos],
                value: variableListValue,
                type: GetVariableFormatFromValue(variableListValue),
              });
            }
          }
        }

        // set the payload object
        newData = {
          value: valueArray,
          timestamp: variableTimestamp,
        };
      } else {
        const engineeringUnitsString = _.get(variable, 'engineeringUnits', '');
        if (engineeringUnitsString !== '') {
          // set the payload object
          newData = {
            value: variableValue,
            timestamp: variableTimestamp,
            engineeringUnits: engineeringUnitsString,
          };
        } else {
          // set the payload object
          newData = {
            value: variableValue,
            timestamp: variableTimestamp,
          };
        }
      }

      // create the topic from the physical spark + machine + variable
      let topic = `${hostname}/${_.get(machineNameMap, machineName, machineName)}/${variableName}`;
      if ((_.has(config.settings.model, 'basicIngestEnable'))
                && (_.has(config.settings.model, 'AWSIoTAct'))
                && (config.settings.model.basicIngestEnable === true)) {
        topic = `$aws/rules/${config.settings.model.AWSIoTAct}/${topic}`;
      }
      // publish the new data value with this topic
      // console.log('-----publishing to topic: ' + topic);
      // console.log('-----payload = ' + JSON.stringify(newData));

      // currentPublishTimestamp = new Date();
      // if (lastPublishTimestamp !== 0) {
      //   var elapsedSeconds = currentPublishTimestamp - lastPublishTimestamp;
      //   if (elapsedSeconds > 250) {
      //     console.log('elapsed time since last publish = ' + elapsedSeconds + 'msec');
      //     console.log('   pubished ' + (accumulatedPublishCount + 1) +
      //                 ' topics, average time = ' +
      //                 Math.round(accumulatedTime / accumulatedPublishCount) + 'msec');
      //     accumulatedTime = 0;
      //     accumulatedPublishCount = 0;
      //     if (elapsedSeconds > 5000) {
      //       console.log('------------------------------ GREATER THAN 5 SECONDS');
      //     } else if (elapsedSeconds > 3000) {
      //       console.log('-------------------- GREATER THAN 3 SECONDS');
      //     } else if (elapsedSeconds > 2000) {
      //       console.log('---------- GREATER THAN 2 SECONDS');
      //     }
      //   } else {
      //     accumulatedTime += elapsedSeconds;
      //     accumulatedPublishCount += 1;
      //   }
      // }
      // lastPublishTimestamp = currentPublishTimestamp;

      client.publish(topic, JSON.stringify(newData));
    }
  });
}

sparkAwsIotClient.start = function start(modules, done) {
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

  // do the following steps one after another using async
  async.series([
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

        // create a copy of the machine list keyed by machine name
        const machineObject = _.keyBy(machines, 'info.name');

        deliverEntireResponseMachineNameList = [];
        overrideVariableNameList = {};
        machineNameMap = {};

        //  add each enabled machine in the array to the local machineList
        _.forOwn(machines, (machine) => {
          // check its a valid machine (must have an info section)
          if (_.has(machine, 'info')) {
            // also check if it is enabled and wants to be published
            if ((machine.settings.model.enable === true)
             && (machine.settings.model.publishDisabled === false)) {
              const machineName = machine.info.name;
              log.info('Adding Machine: ', machineName);

              // store the machine's info and variable information
              // (store variables as a key list for easier access)
              machineList[machineName] = { info: machine.info, variables: _.keyBy(machine.variables, 'name') };

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

              // store info for delivering entire response (also allow variable name override)
              if (_.get(machine.settings.model, 'deliverEntireResponse', false)) {
                deliverEntireResponseMachineNameList.push(machineName);
              }
              if (_.get(machine.settings.model, 'overrideVariableNameFlag', false)
              && (_.get(machine.settings.model, 'overrideVariableNameBase', null) !== null)) {
                overrideVariableNameList[machineName] = machine.settings.model
                  .overrideVariableNameBase;
              }

              // if machine is a virtual one
              if (machine.info.hpl === 'virtual') {
                // console.log(`---------- machine.variables.length = ${machine.variables.length}`);

                for (let j = 0; j < machine.variables.length; j += 1) {
                  // find the machine in the 'machines' array that has the
                  // 'machine.info.name'  that matches this one
                  if (_.has(machine.variables[j], 'srcVariables')) {
                    // eslint-disable-next-line max-len
                    // console.log(`--- machine.variables[${j}] = ${JSON.stringify(machine.variables[j])}`);
                    // console.log('--- machine:');
                    // console.log(JSON.stringify(machine));
                    // if (j>=1) break;

                    const referencedMachine = machineObject[machine.variables[j]
                      .srcVariables[0].srcMachine];

                    // create a key list of the variables of this referenced machine
                    const referencedMachineVariablesObject = _.keyBy(referencedMachine.variables, 'name');
                    // get the referenced variable from the referenced machine
                    const referencedVariable = referencedMachineVariablesObject[machine.variables[j]
                      .srcVariables[0].srcVariable];

                    // append the virtual machines variable info for the
                    // referenced machine/variable that it uses
                    machineList[machineName].variables[machine.variables[j].name]
                      .referencedMachineInfo = referencedMachine.info;
                    machineList[machineName].variables[machine.variables[j].name]
                      .referencedMachineConfig = referencedMachine.settings.model;
                    machineList[machineName].variables[machine.variables[j].name]
                      .referencedVariable = referencedVariable;
                  }
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

      // clear connection related alerts
      alert.clear('connection-error');
      alert.clear('connection-offline');

      // listen for data being added to the database
      db.on('added', databaseListener);

      // send list of variables for each enabled machine as published topics
      _.forOwn(machineList, (value, machineName) => {
        publishMachineVariablesMetaData(machineName, machineList[machineName]);

        // subscribe to any write variables
        subscribeToWriteVariables(machineName);
      });
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
      const variable = machineList[actualMachineName].variables[variableName];
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
  });

  return undefined;
};

function cleanUp() {
  bStarted = false;
  log.info('Stopped', pkg.name);

  // we are cleaning up, so if there is a timer, we don't need it to call us any more
  if (endTimeoutTimer !== null) {
    clearInterval(endTimeoutTimer);
    endTimeoutTimer = null;
  }

  // make sure we only clean up and call the stop callback once
  if (doneCleanup === false) {
    doneCleanup = true;
    machineList = {};
    client = null;
    running = false;
    alert.clearAll(() => stopCallback(null));
  }
}

sparkAwsIotClient.stop = function stop(done) {
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

sparkAwsIotClient.require = function require() {
  return ['spark-logging',
    'spark-db',
    'spark-alert',
    'spark-config',
  ];
};

module.exports = sparkAwsIotClient;
