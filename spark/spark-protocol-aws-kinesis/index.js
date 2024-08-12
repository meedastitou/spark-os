const { EventEmitter } = require('events');
const async = require('async');
const _ = require('lodash');
const os = require('os');
const awsKinesis = require('aws-sdk');
const pkg = require('./package.json');
const config = require('./config.json');

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};
config.info = info;

const sparkAwsKinesisProducer = new EventEmitter();
let log;
let db;
let conf;
let alert = null;
let running = false;
const hostname = os.hostname();
let machineList = {};
let stopCallback = null;
let doneCleanup = false;

// Helper Functions ==========================================================================

function regionNameToRegionId(regionName) {
  const awsRegions = {
    'us east (n. virginia)': 'us-east-1',
    'us east (ohio)': 'us-east-2',
    'us west (n. california)': 'us-west-1',
    'us west (oregon)': 'us-west-2',
    'asia pacific (tokyo)': 'ap-northeast-1',
    'asia pacific (seoul)': 'ap-northeast-2',
    'asia pacific (osaka-local)': 'ap-northeast-3',
    'asia pacific (mumbai)': 'ap-south-1',
    'asia pacific (singapore)': 'ap-southeast-1',
    'asia pacific (sydney)': 'ap-southeast-2',
    'canada (central)': 'ca-central-1',
    'china (beijing)': 'cn-north-1',
    'china (ningxia)': 'cn-northwest-1',
    'eu (frankfurt)': 'eu-central-1',
    'eu (ireland)': 'eu-west-1',
    'eu (london)': 'eu-west-2',
    'eu (paris)': 'eu-west-3',
    'south america (são paulo)': 'sa-east-1',
  };
  return _.get(awsRegions, regionName.toLowerCase(), 'invalid-region');
}

function produceDataToKinesis(data, partitionKey, callback = function checkForProducerError(err) { if (err) alert.raise({ key: 'produce-error', errorMsg: err.message }); }) {
  // connect to AWS Kinesis
  const kinesisParams = {
    region: regionNameToRegionId(config.settings.model.region),
  };
  let kinesis = new awsKinesis.Kinesis(kinesisParams);
  const stream = config.settings.model.kinesisStreamName;

  // if this is a unit test, connect to Kinesalite instead
  if (
    config.settings.model.accessKeyId === 'TEST'
    && config.settings.model.secretAccessKey === 'TEST'
    && config.settings.model.kinesisStreamName === 'TEST'
  ) {
    // set the Kinesis endpoint to Kinesalite
    kinesis = new awsKinesis.Kinesis({ endpoint: 'http://localhost:4567' });
  }

  // build params for Kinesis record
  const params = {
    Data: data,
    PartitionKey: partitionKey,
    StreamName: stream,
  };

  // produce the record to Kinesis
  kinesis.putRecord(params, err => callback(err));
}

function publishMachineVariablesMetaData(machineName, machineVariableMetaData) {
  // construct the wrapper for the metadata
  const data = {
    type: 'metadata',
    host: hostname,
    data: machineVariableMetaData,
  };

  // send the metadata to Kinesis
  produceDataToKinesis(JSON.stringify(data), (`${hostname}/${machineName}`));
}

function addExtraInfoIfVirtual(machine, cb) {
  // we need to get the machine details for all machines,
  // as its a virtual machine we need to get data out of the referenced machines
  conf.get('machines', (err, machines) => {
    // create a copy of the machine list keyed by machine name
    const machineObject = _.keyBy(machines, 'info.name');
    const machineName = machine.info.name;

    const machineVariablesArray = Object.keys(machine.variables);
    for (let i = 0; i < machineVariablesArray.length; i += 1) {
      const variable = machine.variables[machineVariablesArray[i]];
      // find the machine in the 'machines' array that has
      // the 'machine.info.name'  that matches this one
      const referencedMachineName = variable.srcVariables[0].srcMachine;
      const referencedMachine = machineObject[referencedMachineName];

      // create a key list of the variables of this referenced machine
      const referencedMachineVariablesObject = _.keyBy(referencedMachine.variables, 'name');

      // get the referenced variable from the referenced machine
      const referencedVariableName = variable.srcVariables[0].srcVariable;
      const referencedVariable = referencedMachineVariablesObject[referencedVariableName];

      // append the virtual machines variable info for the referenced machine/variable that it uses
      const virtualMachineVariable = machineList[machineName].variables[variable.name];
      virtualMachineVariable.referencedMachineInfo = referencedMachine.info;
      virtualMachineVariable.referencedMachineConfig = referencedMachine.settings.model;
      virtualMachineVariable.referencedVariable = referencedVariable;
    }

    cb(null);
  });
}

function cleanUp() {
  log.info('Stopped', pkg.name);

  // make sure we only clean up and call the stop callback once
  if (doneCleanup === false) {
    doneCleanup = true;
    machineList = {};
    running = false;
    alert.clearAll(() => stopCallback(null));
  }
}


// Listeners =================================================================================

function onSetListener(key) {
  // check if anything in the model changes
  const reAwsKinesisProducerChanges = new RegExp(`protocols:${pkg.name}:settings:model:*`);
  // check if any machine's enable or publish state has changed
  const reMachineChanges = new RegExp('^machines:.*:settings:model:enable$|^machines:.*:settings:model:publishDisabled$');
  // check if any machine's variables have changed
  const reMachineVariableChanges = new RegExp('^machines:.*:variables$');

  if (reAwsKinesisProducerChanges.test(key)) {
    conf.get(`protocols:${pkg.name}:settings:model`, (err, model) => {
      log.debug(`protocols:${pkg.name}:settings:model`, model);

      if (!_.isEqual(model, config.settings.model)) {
        // the enable key has changed
        log.debug(`protocols:${pkg.name}:settings:model changed from`, config.settings.model, 'to', model);

        config.settings.model = model;

        // request a restart
        sparkAwsKinesisProducer.emit('restartRequest', info.name);
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
        const machineExists = _.hasIn(machineList, machineName);

        // if the machine has just been enabled and it is not in the queue
        if ((machineEnabled) && (publishingEnabled) && (!machineExists)) {
          log.info(`Adding Machine: ${machineName}`);

          // store the machine's info and variable information
          // (store variables as a key list for easier access)
          machineList[machineName] = { info: machine.info, variables: _.keyBy(machine.variables, 'name') };

          // if machine is a virtual one
          if (machine.info.hpl === 'virtual') {
            addExtraInfoIfVirtual(machine, () => {
              // send variable metadata for this newly enabled machine
              publishMachineVariablesMetaData(machineName, machineList[machineName]);
            });
          } else {
            // send variable metadata for this newly enabled machine
            publishMachineVariablesMetaData(machineName, machineList[machineName]);
          }
        } else if (((!machineEnabled) || (!publishingEnabled)) && (machineExists)) {
          // else if machine has just been disabled and exists in the queue

          log.info(`Removing Machine: ${machineName}`);

          // delete the entry from the queue object
          delete machineList[machineName];
        } else if ((machineEnabled) && (publishingEnabled) && (machineExists)) {
          // if we see an enabled machine that already exists, the variables may have changed

          // before deleting see if the variable list has actually changed
          // (can get double enables - so this debounces)
          const updatedList = { info: machine.info, variables: _.keyBy(machine.variables, 'name') };

          // if the variables have changed
          if (_.isEqual(machineList[machineName], updatedList) === false) {
            log.info(`Updating Machine: ${machineName}`);

            // delete the old entry and re-create with the updated list
            delete machineList[machineName];
            machineList[machineName] = updatedList;

            // if machine is a virtual one
            if (machine.info.hpl === 'virtual') {
              addExtraInfoIfVirtual(machine, () => {
                // send updated variable metadata for this already enabled machine
                publishMachineVariablesMetaData(machineName, machineList[machineName]);
              });
            } else {
              // send updated variable metadata for this already enabled machine
              publishMachineVariablesMetaData(machineName, machineList[machineName]);
            }
          }
        }
      });
    }
  }
}

// record object must persist over multiple invocations of databaseListener
let record = {};

function databaseListener(key) {
  // get the new data for the key
  db.get(key, (err, entry) => {
    // check we have a variable list for this machine
    if (_.hasIn(machineList, entry.machine)) {
      try {
        const machineName = entry.machine;
        const timestamp = entry.createdAt;
        const machineVariablesMutable = machineList[machineName].variables;

        // create a deep copy of the variables object to prevent side-effects
        const machineVariables = JSON.parse(JSON.stringify(machineVariablesMutable));

        if (record.machine === undefined) {
          // define the machine name in the record if it is undefined
          record.machine = machineName;
        } else if (record.machine !== machineName) {
          // log an error if the machine name in the record
          // does not match the machine name in the entry
          log.info(`Failed to create record for ${record.machine}`);

          // start the next record
          record = { machine: machineName };
        }

        if (record.time === undefined) {
          // define the timestamp in the record if it is undefined
          record.time = timestamp;
        }

        if (record.attributes === undefined) {
          // define the attributes in the record if they are undefined
          record.attributes = machineVariables;

          // clear any existing attribute values
          const attributesArray = Object.keys(record.attributes);
          for (let i = 0; i < attributesArray.length; i += 1) {
            record.attributes[attributesArray[i]].value = undefined;
          }
        }

        // assume the record is complete
        let recordComplete = true;

        const machineVariablesArray = Object.keys(machineVariables);
        for (let i = 0; i < machineVariablesArray.length; i += 1) {
          const attribute = machineVariablesArray[i];
          // if the attribute is the variable queried in this entry, define its value in the record
          if (entry.variable === attribute) {
            record.attributes[attribute].value = entry[attribute];
          }

          // if any attribute's value is undefined in the record, then the record is not complete
          if (record.attributes[attribute].value === undefined) {
            recordComplete = false;
          }
        }

        // if the record is complete, send it to Kinesis
        if (recordComplete) {
          // construct the wrapper for the record
          const data = {
            type: 'record',
            host: hostname,
            data: record,
          };

          // send the record to Kinesis
          produceDataToKinesis(JSON.stringify(data), (`${hostname}/${machineName}`));

          // clear the record
          record = {};
        }
      } catch (e) {
        log.info(`error occurred: ${e.message}`);
      }
    }
  });
}


// Export Functions ==========================================================================

sparkAwsKinesisProducer.start = function initializeProtocol(modules, done) {
  log = modules['spark-logging'].exports.getLogger(pkg.name);
  db = modules['spark-db'].exports;
  conf = modules['spark-config'].exports;
  alert = modules['spark-alert'].exports.getAlerter(pkg.name);

  alert.preLoad({
    'initialization-error': {
      msg: 'AWS-Kinesis: Initialization Error',
      description: x => `AWS-Kinesis is not able to initialize correctly. Error: ${x.errorMsg}`,
    },
    'produce-error': {
      msg: 'AWS-Kinesis: Failed to produce record to stream',
      description: x => `Protocol was unable to produce a record to the stream. Error: ${x.errorMsg}`,
    },
  });

  // do the following steps one after another using async
  async.series([
    (cb) => {
      // listen for changes to the config but only add the listener once
      if (conf.listeners('set').indexOf(onSetListener) === -1) {
        log.debug('config.settings.model.enable', config.settings.model.enable);
        conf.on('set', onSetListener);
      }

      // check the config to see if we are disabled
      conf.get(`protocols:${pkg.name}:settings:model`, (err, model) => {
        // if no result, use our local config settings - deep copy for unit testing
        if (model) config.settings.model = JSON.parse(JSON.stringify(model));
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
        return done(null, config.info);
      }

      // get a list of machines from the config
      return conf.get('machines', (err, machines) => {
        if (err) return cb(err);

        // create a copy of the machine list keyed by machine name
        const machineObject = _.keyBy(machines, 'info.name');

        //  add each enabled machine in the array to the local machineList
        const machinesArray = Object.keys(machines);
        for (let i = 0; i < machinesArray.length; i += 1) {
          const machine = machines[machinesArray[i]];

          // ensure it is a valid machine (must have an info section)
          if (_.hasIn(machine, 'info')) {
            // also check if it is enabled and wants to be published
            if (
              (machine.settings.model.enable === true)
                && (machine.settings.model.publishDisabled === false)
            ) {
              const machineName = machine.info.name;
              log.info('Adding Machine: ', machineName);

              // store the machine's info and variable information
              // (store variables as a key list for easier access)
              machineList[machineName] = { info: machine.info, variables: _.keyBy(machine.variables, 'name') };

              // if machine is a virtual one
              if (machine.info.hpl === 'virtual') {
                const machineVariablesArray = Object.keys(machine.variables);
                for (let j = 0; j < machineVariablesArray.length; j += 1) {
                  const variable = machine.variables[machineVariablesArray[j]];

                  // find the machine in the 'machines' array that has
                  // the 'machine.info.name'  that matches this one
                  const referencedMachineName = variable.srcVariables[0].srcMachine;
                  const referencedMachine = machineObject[referencedMachineName];

                  // create a key list of the variables of this referenced machine
                  const referencedMachineVariablesObject = _.keyBy(referencedMachine.variables, 'name');

                  // get the referenced variable from the referenced machine
                  const refVariableName = variable.srcVariables[0].srcVariable;
                  const referencedVariable = referencedMachineVariablesObject[refVariableName];

                  // append the virtual machines variable info for
                  // the referenced machine/variable that it uses
                  const virtualMachineVariable = machineList[machineName].variables[variable.name];
                  virtualMachineVariable.referencedMachineInfo = referencedMachine.info;
                  virtualMachineVariable.referencedMachineConfig = referencedMachine.settings.model;
                  virtualMachineVariable.referencedVariable = referencedVariable;
                }
              }
            }
          }
        }
        return cb(null);
      });
    },
    (cb) => {
      // convert the AWS region name into its corresponding region ID
      const regionId = regionNameToRegionId(config.settings.model.region);
      if (regionId === 'region-not-set') {
        return cb(new Error('The region has not been set. Please select a region.'));
      } if (regionId === 'invalid-region') {
        return cb(new Error(`There is a problem in the region conversion function for region ${config.settings.model.region}; please report this to the developers and try a different region until the issue is resolved.`));
      }

      // configure Kinesis to use the given region and access keys
      awsKinesis.config.region = regionId;
      awsKinesis.config.credentials = new awsKinesis.Credentials({
        accessKeyId: config.settings.model.accessKeyId,
        secretAccessKey: config.settings.model.secretAccessKey,
      });

      // test that the credentials were created successfully
      return awsKinesis.config.credentials.get(err => cb(err));
    },
    (cb) => {
      // construct the wrapper for the connection test
      const data = {
        type: 'connection_test',
        host: hostname,
        data: 'CONNECTION_TEST',
      };

      // test the connection with Kinesis
      produceDataToKinesis(JSON.stringify(data), 'key', err => cb(err));
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

    // if we get here there have been no initialization issues,
    // so clear alert just in case it was raised
    alert.clear('initialization-error');
    db.on('added', databaseListener);

    running = true;
    log.info('Started', pkg.name);

    return done(null, config.info);
  });
};

sparkAwsKinesisProducer.stop = function terminateProducer(done) {
  stopCallback = done;
  doneCleanup = false;
  // need to cancel the listen event that causes the publishes
  db.removeListener('added', databaseListener);

  cleanUp();
};

sparkAwsKinesisProducer.require = () => ['spark-logging',
  'spark-db',
  'spark-alert',
  'spark-config',
];

module.exports = sparkAwsKinesisProducer;
