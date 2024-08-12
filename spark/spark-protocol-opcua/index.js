/* jshint esversion: 6 */
/* eslint no-bitwise: ["error", { "allow": ["&"] }] */
const { EventEmitter } = require('events');
const opcua = require('node-opcua');
const { OPCUACertificateManager } = require('node-opcua');
// eslint-disable-next-line import/no-extraneous-dependencies
const { StatusCodes } = require('node-opcua-status-code');
const async = require('async');
const _ = require('lodash');
const pkg = require('./package.json');
const config = require('./config.json');

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};
config.info = info;

const sparkOpcUa = new EventEmitter();
let log;
let db;
let conf;
let alert = null;
let server = null;
let addressSpace = null;
let rootFolder = null;
const machineList = {};
const machineVarDataCache = {};
let running = false;
let started = false;
const {
  OPCUAServer, Variant, DataType, VariantArrayType, DataValue,
} = opcua;

const MIN_UINT8 = 0;
const MAX_UINT8 = 255;
const MIN_UINT16 = 0;
const MAX_UINT16 = 65535;
const MIN_UINT32 = 0;
const MAX_UINT32 = 4294967295;
const MIN_INT8 = -128;
const MAX_INT8 = 127;
const MIN_INT16 = -32768;
const MAX_INT16 = 32767;
const MIN_INT32 = -2147483648;
const MAX_INT32 = 2147483647;

const ACCESS_LEVEL_READ_WRITE = 0x03;

const userManager = {
  isValidUser(userName, password) {
    if (userName === 'spark' && password === 'spark') {
      return true;
    }
    return false;
  },
};

const serverOptions = {
  port: 4334,
  // xx (not used: causes UAExpert to get confused) resourcePath: "UA/Server",
  maxAllowedSessionNumber: 1500,
  maxConnectionsPerEndpoint: 100,
  timeout: 20000,
  serverCertificateManager: new OPCUACertificateManager({
    automaticallyAcceptUnknownCertificate: true,
  }),
  nodeset_filename: [
    opcua.nodesets.standard_nodeset_file,
    opcua.nodesets.di_nodeset_filename,
  ],
  serverInfo: {
    applicationUri: opcua.makeApplicationUrn(opcua.getFullyQualifiedDomainName(), 'NodeOPCUA-Server'),
    productUri: 'NodeOPCUA-Server',
    applicationName: {
      text: 'NodeOPCUA',
      locale: 'en',
    },
    gatewayServerUri: null,
    discoveryProfileUri: null,
    discoveryUrls: [],
  },
  buildInfo: {
    buildNumber: '1234',
  },
  serverCapabilities: {
    operationLimits: {
      maxNodesPerRead: 1000,
      maxNodesPerBrowse: 2000,
    },
  },
  userManager,
};

// conversion object to generate opcua types from spark types
const sparkToOpcuaTypes = {
  float: 'Float',
  double: 'Double',
  int8: 'SByte',
  int16: 'Int16',
  int32: 'Int32',
  int64: 'Int64',
  uint8: 'Byte',
  uint16: 'UInt16',
  uint32: 'UInt32',
  uint64: 'UInt64',
  char: 'String',
  bool: 'Boolean',
  object: 'String',
};

function convertToTypedArray(result, dataTypeEnum) {
  let returnValue = result;

  // try and place in a typed array of the correct type otherwise node-opcua moans
  switch (dataTypeEnum) {
    case DataType.SByte:
      returnValue = new Int8Array(result);
      break;

    case DataType.Byte:
      returnValue = new Uint8Array(result);
      break;

    case DataType.Int16:
      returnValue = new Int16Array(result);
      break;

    case DataType.UInt16:
      returnValue = new Uint16Array(result);
      break;

    case DataType.Int32:
      returnValue = new Int32Array(result);
      break;

    case DataType.UInt32:
      returnValue = new Uint32Array(result);
      break;

    case DataType.Float:
      returnValue = new Float32Array(result);
      break;

    case DataType.Double:
      returnValue = new Float64Array(result);
      break;

    // javascript does not natively support 64bit ints, so just leave in normal array
    case DataType.Int64:
    case DataType.UInt64:
    case DataType.Boolean: // no typed array for boolean, leave it alone
    case DataType.String:
      returnValue = result;
      break;

    default:
      returnValue = null;
      break;
  }
  return returnValue;
}

function checkValueMatchesType(value, isArray, dataTypeEnum, machineName, variableName) {
  let valueToCheck;
  let returnValue = value;
  let checkedOk = false;

  // console.log('----checkValueMatchesType: value = ' + JSON.stringify(value));
  // console.log('----checkValueMatchesType: isArray = ' + isArray);
  // console.log('----checkValueMatchesType: dataTypeEnum = ' + dataTypeEnum);

  // if dealing with an array
  if (isArray) {
    // check it is likely to be an array (can't use Array.isArray on typed arrays)
    if (_.isObject(value)) {
      // console.log('----checkValueMatchesType: _.isObject(value) = true');
      // don't raise an alert if the array is empty
      if (value.length === 0) return null;

      // just get the first value out to check
      ([valueToCheck] = value);
    } else {
      // console.log('----checkValueMatchesType: _.isObject(value) = false');
      alert.raise({
        key: `type-error-${machineName}-${variableName}`,
        msg: 'OPC-UA: Type error with data',
        description: `OPC-UA cannot match the value to the format for the variable ${variableName} in machine ${machineName}. Please check the format or outputFormat is correctly set for the variable.`,
      });
      return null;
    }
  } else {
    valueToCheck = value;
  }

  // console.log('----checkValueMatchesType: valueToCheck = ' + JSON.stringify(valueToCheck));

  switch (dataTypeEnum) {
    case DataType.Boolean: {
      // console.log('----checkValueMatchesType: dataTypeEnum = DataType.Boolean');
      if (_.isBoolean(valueToCheck)) {
        checkedOk = true;
      }
      break;
    }

    case DataType.SByte:
    case DataType.Byte:
    case DataType.Int16:
    case DataType.UInt16:
    case DataType.Int32:
    case DataType.UInt32:
    case DataType.Int64:
    case DataType.UInt64:
    case DataType.Float:
    case DataType.Double: {
      // console.log('----checkValueMatchesType: dataTypeEnum = DataType.(numeric)');
      if (_.isNumber(valueToCheck)) {
        // console.log('----checkValueMatchesType: _.isNumber(valueToCheck) = true');
        checkedOk = true;
      }
      break;
    }

    case DataType.String: {
      // console.log('----checkValueMatchesType: dataTypeEnum = DataType.String');
      if (!isArray) {
        if (_.isObject(valueToCheck)) {
          // console.log('----checkValueMatchesType: _.isObject(valueToCheck) = true');
          // console.log('----checkValueMatchesType: new valueToCheck = ' + valueToCheck);
          valueToCheck = JSON.stringify(value);
          returnValue = valueToCheck; // change to string for delivery
        }
      }
      if (_.isString(valueToCheck)) {
        // console.log('----checkValueMatchesType: _.isString(valueToCheck) = true');
        checkedOk = true;
      }
      break;
    }
    default: {
      // console.log('----checkValueMatchesType:   switch (dataTypeEnum): default');
      checkedOk = false;
      break;
    }
  }

  // console.log('----checkValueMatchesType: checkedOk = ' + checkedOk);

  if (checkedOk) {
    // alert.clear(`type-error-${machineName}-${variableName}`);
    return returnValue;
  }
  alert.raise({
    key: `type-error-${machineName}-${variableName}`,
    msg: 'OPC-UA: Type error with data',
    description: `OPC-UA cannot match the value to the format for the variable ${variableName} in machine ${machineName}. Please check the format or outputFormat is correctly set for the variable.`,
  });
  return null;
}

function checkValueNotOutOfBounds(value, isArray, dataTypeEnum, machineName, variableName) {
  let valueToCheck;
  let checkedOk;

  // console.log(`----checkValueNotOutOfBounds: value = ${JSON.stringify(value)}`);
  // console.log(`----checkValueNotOutOfBounds: isArray = ${isArray}`);
  // console.log(`----checkValueNotOutOfBounds: dataTypeEnum = ${dataTypeEnum}`);

  // if dealing with an array
  if (isArray) {
    // check it is likely to be an array (can't use Array.isArray on typed arrays)
    if (_.isObject(value)) {
      // console.log('----checkValueNotOutOfBounds: _.isObject(value) = true');
      // just get the first value out to check
      ([valueToCheck] = value);
    } else {
      // console.log('----checkValueNotOutOfBounds: _.isObject(value) = false');
      alert.raise({
        key: `bounds-error-${machineName}-${variableName}`,
        msg: 'OPC-UA: Data out of bounds',
        description: `OPC-UA detected an out of bounds value of ${value} for variable ${variableName} in machine ${machineName}. Try using an unsigned type format or changing to a larger one. If you are manipulating the data you made need to set an output format.`,
      });
      return null;
    }
  } else {
    valueToCheck = value;
  }

  switch (dataTypeEnum) {
    case DataType.Boolean:
    case DataType.String:
    case DataType.Int64:
    case DataType.UInt64:
    case DataType.Float:
    case DataType.Double: {
      checkedOk = true;
      break;
    }

    case DataType.SByte: {
      if (valueToCheck <= MAX_INT8 && valueToCheck >= MIN_INT8) {
        checkedOk = true;
      }
      break;
    }
    case DataType.Byte: {
      if (valueToCheck <= MAX_UINT8 && valueToCheck >= MIN_UINT8) {
        checkedOk = true;
      }
      break;
    }
    case DataType.Int16: {
      if (valueToCheck <= MAX_INT16 && valueToCheck >= MIN_INT16) {
        checkedOk = true;
      }
      break;
    }
    case DataType.UInt16: {
      if (valueToCheck <= MAX_UINT16 && valueToCheck >= MIN_UINT16) {
        checkedOk = true;
      }
      break;
    }
    case DataType.Int32: {
      if (valueToCheck <= MAX_INT32 && valueToCheck >= MIN_INT32) {
        checkedOk = true;
      }
      break;
    }
    case DataType.UInt32: {
      if (valueToCheck <= MAX_UINT32 && valueToCheck >= MIN_UINT32) {
        checkedOk = true;
      }
      break;
    }
    default: {
      checkedOk = false;
      break;
    }
  }

  if (checkedOk) {
    alert.clear(`bounds-error-${machineName}-${variableName}`);
    return value;
  }
  alert.raise({
    key: `bounds-error-${machineName}-${variableName}`,
    msg: 'OPC-UA: Data out of bounds',
    description: `OPC-UA detected an out of bounds value of ${value} for variable ${variableName} in machine ${machineName}. Try using an unsigned type format or changing to a larger one. If you are manipulating the data you made need to set an output format.`,
  });
  return null;
}

function areVariableNamesInMachineUnique(machine) {
  // get an array of all the variable names
  const variableNames = machine.variables.map(v => v.name);
  // filter out any unique variable names and leave any duplicates behind
  const dupes = variableNames.filter((v, i) => variableNames.indexOf(v) !== i);
  // if we have no duplicates return true (variable names are unique) else false
  return dupes.length === 0;
}

function getInitialVariableValue(variable) {
  let initialValue = _.get(variable, 'initialValue', null);
  if (initialValue === null) {
    switch (variable.format) {
      case 'char':
        initialValue = '';
        break;
      case 'bool':
        initialValue = false;
        break;
      default:
        initialValue = 0;
    }
  }

  return initialValue;
}

function addVariableToServer(thisMachine, localMachineName, variable) {
  const localVariableName = variable.name;

  // if an outputFormat is supplied use that over the 'input' format
  const format = _.get(variable, 'outputFormat', _.get(variable, 'format'));
  const dataType = _.get(sparkToOpcuaTypes, format);

  if (!dataType) {
    log.info('No datatype - unable to add Variable: ', localVariableName);
    return;
  }
  // see if optional setting about storing as arrays is included
  // set to either A for Array or S for Scalar
  let arrayType = 'S';
  let isArray = false;
  if (_.get(variable, 'array', false)) {
    if (dataType === 'String') {
      // if an actual string, leave it as a scalar, rather than an array of characters.
      // But if an array of objects, still needs to be set as an array.
      if (format === 'object') {
        arrayType = 'A';
        isArray = true;
      }
    } else {
      // all non-string arrays
      arrayType = 'A';
      isArray = true;
    }
  }

  // set the value rank to array or scaler based on arrayType
  const valueRank = isArray ? 1 : -1;

  let accessLevel = opcua.makeAccessLevelFlag('CurrentRead');
  if (_.get(variable, 'access') === 'write') {
    if (_.get(variable, 'enableReadWrite', false)) {
      accessLevel = opcua.makeAccessLevelFlag('CurrentRead | CurrentWrite');
    } else {
      accessLevel = opcua.makeAccessLevelFlag('CurrentWrite');
    }
  }

  // add each opcua variable to the opcua server in the correct folder
  log.info('Adding Variable: ', localVariableName);
  addressSpace.getNamespace(2).addVariable({
    organizedBy: thisMachine,
    browseName: localVariableName,
    minimumSamplingInterval: 500, // ms (dropped this from 100. See SPARK-845)
    dataType,
    valueRank,
    // bit order -0 & 1 represent current read & write access
    // (eg: 0001 - only currrent read access, 0010 - only current write access).
    // bit order- 2 & 3 represent history read/write)
    accessLevel,
    userAccessLevel: accessLevel,
    description: variable.description,
    // construct using machine name and variable name to,
    // 1. make unique
    // 2. allow reference back to database
    // 3. also declare if array
    nodeId: `s=${localMachineName},${localVariableName},${arrayType}`,
    value: {
      // use refreshFunc instead of get, as due to db look-up needs to be asyncrounous
      refreshFunc(callback) {
        // store datatype for when we create the new data value
        const dataTypeEnum = this.dataType.value;

        // get the lastest value from the database (for the correct machine/variable)
        db.getLatest(localMachineName, localVariableName, (err, result) => {
          if (err) {
            alert.raise({
              key: 'db-read-error',
              msg: 'OPC-UA: Error reading from database',
              description: `Error: ${err.message}`,
            });
            // don't pass error back as can cause assert, instead just pass no data
            callback(null, {
              statusCode: StatusCodes.GoodNoData,
              value: new Variant({ value: null }),
            });
          } else {
            alert.clear('db-read-error');
            const createdAt = _.get(result, 'createdAt');

            // double check the data in the result is actually valid
            // (db of values may have emptied for this device, and so may get back an empty object)
            if (_.isNil(result) || _.isNil(createdAt)) {
              log.debug('Undefined data return from db');
              // if data is not changing much (when using 'onChange') then we may
              // exhaust the database store. e.g. the last value can drop out of the database,
              // meaning we have nothing to send if we have a last historic value for this
              // data item then keep sending it rather than null
              const cachedData = _.get(machineVarDataCache, [localMachineName, localVariableName]);
              if (cachedData) {
                callback(null, cachedData);
              } else if ((_.get(variable, 'access', 'read') === 'write')
                         && (_.get(variable, 'enableReadWrite', false))) {
                // if write with read before/after write, return specified initial
                // value until in database or cache
                const initialValue = getInitialVariableValue(variable);
                const dataValue = new DataValue({
                  value: new Variant({
                    dataType: dataTypeEnum.valueOf(),
                    arrayType: isArray ? VariantArrayType.Array : VariantArrayType.Scalar,
                    value: initialValue,
                  }),
                  statusCode: StatusCodes.Good,
                  sourceTimestamp: new Date(),
                });

                callback(null, dataValue);
              } else {
                // don't pass error back as can cause assert, instead just pass no data
                callback(null, {
                  statusCode: StatusCodes.GoodNoData,
                  value: new Variant({ value: null }),
                });
              }
            } else {
              const value = _.get(result, _.get(result, 'variable'));
              log.debug(`Client requested value of ${localMachineName} of ${localVariableName} value = ${value}`);

              let valueToSend = value;

              // if object or array of objects, stringify value or elements
              if (format === 'object') {
                if (isArray) {
                  valueToSend = _.map(valueToSend, JSON.stringify);
                } else {
                  valueToSend = JSON.stringify(valueToSend);
                }
              } else if (isArray) {
                // if an array, process into a typed array for opcua efficency reasons
                valueToSend = convertToTypedArray(valueToSend, dataTypeEnum);
              }

              // check the value matches its type
              if (valueToSend !== null) {
                valueToSend = checkValueMatchesType(valueToSend, isArray,
                  dataTypeEnum, localMachineName, localVariableName);
              }

              // check the value to send is in bounds of its data type
              if (valueToSend !== null) {
                valueToSend = checkValueNotOutOfBounds(valueToSend, isArray,
                  dataTypeEnum, localMachineName, localVariableName);
              }

              // if there was a problem with the data, callback with no data
              if (valueToSend === null) {
                // don't pass error back as can cause assert, instead just pass no data
                callback(null, {
                  statusCode: StatusCodes.GoodNoData,
                  value: new Variant({ value: null }),
                });
              } else {
                // otherwise fill in the dataValue object and send back
                const dataValue = new DataValue({
                  value: new Variant({
                    dataType: dataTypeEnum.valueOf(),
                    arrayType: isArray ? VariantArrayType.Array : VariantArrayType.Scalar,
                    value: valueToSend,
                  }),
                  statusCode: StatusCodes.Good,
                  sourceTimestamp: new Date(createdAt),
                });

                // store the last value sent for each variable in a data cache object
                _.set(machineVarDataCache, [localMachineName, localVariableName], dataValue);
                callback(null, dataValue);
              }
            }
          }
        });
      },

      // Function set will receive the write request from the client
      set(requestReceived, callback) {
        let newData = requestReceived.value;
        if (_.isTypedArray(requestReceived.value)) {
          // convert TypedArray to Array
          newData = Array.from(requestReceived.value);
        }

        /* create the data object */
        const data = {
          machine: localMachineName,
          variable: localVariableName,
          access: 'write',
          arrayIndex: _.get(variable.arrayIndex),
        };
        data[localVariableName] = newData;

        /* write the data to the database */
        db.add(data, (error) => {
          if (error) {
            alert.raise({
              key: `db-add-error-${localMachineName}-${localVariableName}`,
              msg: 'OPC-UA: Error attempting to add to database',
              description: `Database set failed for ${localVariableName} in machine ${localMachineName}`,
            });
            return callback(null, StatusCodes.GoodNoData);
          }

          alert.clear(`db-add-error-${localMachineName}-${localVariableName}`);
          // if write with read before/after write, also write a read value to the database
          if ((accessLevel & ACCESS_LEVEL_READ_WRITE) === ACCESS_LEVEL_READ_WRITE) {
            data.access = 'read';
            db.add(data, () => callback(null, StatusCodes.Good));
            return undefined;
          }
          return callback(null, StatusCodes.Good);
        });
      },
    },
  });
}

function addMachine(machineName, machine, updatedList) {
  // store a list of the enabled machines (key their variables by name)
  _.set(machineList, machineName, updatedList);

  // create a folder for this machine
  const thisMachine = addressSpace.getNamespace(2).addFolder(rootFolder.objects, {
    browseName: machineName,
    nodeId: `s=${machineName}`,
  });

  // add each variable of this machine into the opc-ua server
  machine.variables.forEach((variable) => {
    addVariableToServer(thisMachine, machineName, variable);
  });
}

function deleteMachine(machineName) {
  // delete the entry from the reference list
  _.unset(machineList, machineName);
  // and also remove the variable data cache entry for this machine
  _.unset(machineVarDataCache, machineName);

  // remove its folder (which will remove all of its child nodes, which are the machines variables)
  const nodeOfMachine = addressSpace.findNode(`ns=2;s=${machineName}`);
  if (nodeOfMachine) {
    addressSpace.deleteNode(nodeOfMachine.nodeId);
  }
}

function constructMyAddressSpace(callback) {
  ({ addressSpace } = server.engine);
  rootFolder = addressSpace.findNode('RootFolder');

  // get a list of machines from the config
  conf.get('machines', (err, machines) => {
    if (err) {
      callback(err);
      return;
    }

    Object.keys(machines).forEach((m) => {
      const machine = machines[m];
      // check the machine has a name and is enabled
      const machineName = _.get(machine, 'info.name');
      if (!_.isNil(machineName) && _.get(machine, 'settings.model.enable')) {
        // store a list of the enabled machines (key their variables by name)
        const updatedList = { variables: _.keyBy(machine.variables, 'name') };

        // check if all variables in the array are unique
        if (areVariableNamesInMachineUnique(machine)) {
          log.info('Adding Machine: ', machineName);

          addMachine(machineName, machine, updatedList);

          alert.clear(`invalid-machine-${machineName}`);
        } else {
          alert.raise({
            key: `invalid-machine-${machineName}`,
            msg: 'OPC-UA: Machine contains non-unique variable names',
            description: `OPC-UA is not able to add the ${machineName} machine to its list as it contains non-unique variable names. Please fix its machine definition.`,
          });
        }
      }
    });

    callback(null);
  });
}

function onSetListener(key) {
  // check if anythiing in the model changes
  const reOpcuaChanges = new RegExp(`protocols:${pkg.name}:settings:model:*`);
  if (reOpcuaChanges.test(key)) {
    conf.get(`protocols:${pkg.name}:settings:model`, (err, model) => {
      log.debug(`protocols:${pkg.name}:settings:model`, model);

      if (!_.isEqual(model, config.settings.model)) {
        // the enable key has changed
        log.debug(`protocols:${pkg.name}:settings:model changed from`, config.settings.model, 'to', model);
        config.settings.model = model;
        // request a restart
        alert.clearAll((alertErr) => {
          if (alertErr) {
            log.error(`onSetListener: alert.clearAllvalertErr = ${alertErr}`);
          }
          sparkOpcUa.emit('restartRequest', info.name);
        });
      }
    });
  }

  // check we have already populated our list of machines and are fully up and running
  if (!running) {
    return;
  }

  let machineName;

  // check if any machine's enable state has changed
  const machineEnableChanges = /^machines:(.*):settings:model:enable$/.exec(key);
  if (machineEnableChanges) {
    // get the machine name from the match
    ([, machineName] = machineEnableChanges);
  }

  // check if any machine's variables have changed
  const variableChanges = /^machines:(.*):variables$/.exec(key);
  if (variableChanges) {
    // get the machine name from the match
    ([, machineName] = variableChanges);
  }

  // if a machine has changed its enable state, or variables have changed
  if (!machineName) {
    return;
  }

  // get the machines details
  conf.get(`machines:${machineName}`, (err, machine) => {
    const enabled = machine.settings.model.enable;

    if (enabled) {
      // check if all variables in the array are unique
      if (!areVariableNamesInMachineUnique(machine)) {
        alert.raise({
          key: `invalid-machine-${machineName}`,
          msg: 'OPC-UA: Machine contains non-unique variable names',
          description: `OPC-UA is not able to add the ${machineName} machine to its list as it contains non-unique variable names. Please fix its machine definition.`,
        });
        return;
      }
      alert.clear(`invalid-machine-${machineName}`);

      // get a list of the enabled machines keyed by their variables by name
      const updatedList = { variables: _.keyBy(machine.variables, 'name') };

      // only update if the variables have changed
      if (_.isEqual(_.get(machineList, machineName), updatedList)) {
        log.info(`No update needed for Machine: ${machineName}`);
      } else {
        log.info(`Updating Machine: ${machineName}`);

        // delete the current entry
        deleteMachine(machineName);

        // and add it back again
        addMachine(machineName, machine, updatedList);
      }
    } else {
      log.info('Removing Machine: ', machineName);
      deleteMachine(machineName);
    }
  });
}

sparkOpcUa.start = function start(modules, done) {
  if (started) {
    return done(new Error('already started'));
  }

  log = modules['spark-logging'].exports.getLogger(pkg.name);
  db = modules['spark-db'].exports;
  conf = modules['spark-config'].exports;
  alert = modules['spark-alert'].exports.getAlerter(pkg.name);

  // do the following steps one after another using async
  return async.series([
    (cb) => {
      // listen for changes to the enable key
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
        started = true;
        return done(null, config.info);
      }

      // update the server options with the configured port
      serverOptions.port = config.settings.model.opcuaPort;

      // call the opc-ua server's constructor
      server = new OPCUAServer(serverOptions);

      // wait for server to initialize before moving on
      return server.initialize(cb);
    },
    (cb) => {
      // now add any active machines variables to the opcua address space
      constructMyAddressSpace(cb);
    },
    (cb) => {
      // start the opc-ua server
      server.start((startErr) => {
        started = true;
        cb(startErr);
      });
    },
  ],
  (err) => {
    // once all task are completed, check for error
    if (err) {
      alert.raise({
        key: 'initialization-error',
        msg: 'OPC-UA: Error whilst Initializing',
        description: `Error: ${err.message}`,
      });
      // don't return error as this will cause a constant protocol reboot
      return done(null);
    }
    // if we get here there have been no initialization issues,
    // so clear alert just in case it was raised
    alert.clear('initialization-error');

    // create some log information
    log.info('Server is now listening ..');
    log.info('port ', server.endpoints[0].port.toString());

    const { endpointUrl } = server.endpoints[0].endpointDescriptions()[0];
    log.info(' the primary server endpoint url is ', endpointUrl);

    log.info('Started', pkg.name);
    running = true;
    // and return back as expected by plugin system
    return done(null, config.info);
  });
};

function doCleanUp(done) {
  log.info('Stopped', pkg.name);
  server = null;
  running = false;
  started = false;
  alert.clearAll(() => done(null));
}

sparkOpcUa.stop = function stop(done) {
  if (!started) {
    return done(new Error('not started'));
  }

  // stop the node-opcua server if setup
  if (server) {
    return server.shutdown(() => doCleanUp(done));
  }
  return doCleanUp(done);
};

sparkOpcUa.require = function require() {
  return ['spark-logging',
    'spark-db',
    'spark-alert',
    'spark-config',
  ];
};

module.exports = sparkOpcUa;
