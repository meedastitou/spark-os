const path = require('path');
const pkg = require(path.join(__dirname, 'package.json'));
var async = require('async');
let config = require(path.join(__dirname, 'config.json'));
const _ = require('lodash');
let EventEmitter = require("events").EventEmitter;
let nodeBle; // Module only required when not in test mode

let info = {
    name: pkg.name,
    fullname: pkg.fullname,
    version: pkg.version,
    description: pkg.description
};
config.info = info;

/* Constants */
const oldWacName = "TE Applicator Count"; //Old name, for testing
const newWacName = "TEWAC"; // For production models
const MAX_BAT_MV = 3200;
const BITMASK24 = 0x00ffffff;

const varForCompany = {"name": "-companyCode",  "description": "  Company Code",
                       "format": "int16"};
const varForSerial = {"name": "-serialNum",  "description": "  Serial Number",
                       "format": "int32"};
const varForCount = {"name": "-count",  "description": "  Counter",
                     "format": "int32"};
const varForNotif = {"name": "-notifications",  "description": "  Notifications",
                       "format": "int8"};
const varForPart = {"name": "-partNum",  "description": "  Part Number",
                       "format": "char"};
const varForDash = {"name": "-dashNum",  "description": "  Dash Number",
                       "format": "int8"};
const varForRev = {"name": "-revNum",  "description": "  Revision Number",
                       "format": "char"};
const varForBattery = {"name": "-batteryLevel",  "description": "  Battery Level",
                       "format": "float"};
const varForRssi = {"name": "-rssi",  "description": "  Signal Strength",
                       "format": "int8"};

/* Non-constant variables */
let sparkMachineWAC = new EventEmitter();
let filteredList = {};
let deviceArray = []; // Array of devices supplied by the config file
let WACInfo = {}; //object to store info for each WAC
let updateDb;
let devicesAvailable = false;
let running = false;
let log;
let db;
let conf;
var alert = null;
let firstStart = true;

/* Offset of the relevant data bits in the manufacturer data part of
   the advert. */
// for the latest version of the WAC
let newoffset = {
  companyCode: 0,
  serialNum: 2,
  count: 5,
  notifications: 8,
  partNum: 9,
  dashNum: 12,
  revNum: 13,
  battery_level: 15
};

// old wac model
let oldoffset = {
  companyCode: 0,
  serialNum: 16,
  count: 5,
  notifications: 8,
  partNum: 9,
  dashNum: 12,
  revNum: 14,
  batteryLevel: 3
};

/* Function to filter the list of bluetooth devices to only include WACs. */
function filterList(list)
{
  filteredList = {};

  /* Makes sure an empty list isn't passed in */
  if(_.isEmpty(list))
  {
      log.info("No devices currently available.");
  }
  else
  {
    //log.info("Filtering list...");

    for(var id in list)
    {
      if (!list.hasOwnProperty(id)) {
         continue;
      }
      for(let i = 0; i < deviceArray.length; i++)
      {
        /* First check whether the address exists in the supplied list... */
        if(id === deviceArray[i])
        {
          /* ... then check that the device is a WAC. */
          if(list[id].localName === newWacName || list[id].localName === oldWacName)
          {
            devicesAvailable = true; //WAC(s) are available!

            /* Finally add it to a filtered list. */
            filteredList[id] = list[id];
          }    //            //
        }    //  ahhh!     //
      }    //      \o/   //
    }    //      _//_  //
       //            //
    //log.info("List filtered.");
  }
}

/* Checks for changes in the machine configuration, and restarts if one is
   detected. */
function onSetListener(key) {
    /* Check if anything in the model changes */
    let re = new RegExp('machines:' + pkg.name + ':settings:model:*');

    if (re.test(key)) {
        conf.get('machines:' + pkg.name + ':settings:model', (err, model) => {
          log.debug('machines:' + pkg.name + ':settings:model', model);

            if (!_.isEqual(model, config.settings.model)) {
                /* If any of the settings have changed */
                log.debug('machines:' + pkg.name + ':settings:model changed from',
                          config.settings.model, 'to', model);

                /* update the local copy */
                config.settings.model = model;

                /* Request a restart */
                sparkMachineWAC.emit('restartRequest', info.name);
            }
        });
    }
}

/* Functions to get the data from the buffer into a desired form. */

function checkWacVersion(wacVersion)
{
  if(wacVersion === "new"){
    return newoffset;
  }
  else {
    return oldoffset;
  }
}

/* parse the part number from the buffer data */
function parsePartNum(buff_data, wacVersion, offset)
{
  let output;
  let part;

  if(wacVersion === "new")
  {
    part = (buff_data.readUInt32BE(offset.partNum - 1) & BITMASK24);
  }
  else {
    part = buff_data.readUInt32LE(offset.partNum);
  }

  if(buff_data.readUInt8(offset.partNum + 4) > 9)
  {
    output = Math.floor(buff_data.readUInt8(offset.partNum + 4) / 10);
    output += '-' + part;
    output += '-' + buff_data.readUInt8(offset.partNum + 4) % 10;
  }
  else {
    output = part + '-' + buff_data.readUInt8(offset.partNum + 4) % 10;
  }

  return output;
}

/* parse the design revision from the buffer data */
function parseDesignRev(buff_data, offset)
{
  return buff_data.toString('ascii', offset.revNum, offset.revNum+2);
}

/* Parse the serial number from the buffer data */
function parseSerialNum(buff_data, wacVersion, offset)
{
  if(wacVersion === "new")
  {
    return (buff_data.readUInt32BE(offset.serialNum - 1) & BITMASK24);
  }
  else {
    return buff_data.readUInt32LE(offset.serialNum);
  }
}

/* Parse the number of counts from the buffer data */
function parseCounts(buff_data, wacVersion, offset)
{
  if(wacVersion === "new")
  {
    return (buff_data.readUInt32BE(offset.count - 1) & BITMASK24);
  }
  else {
    return buff_data.readUInt32LE(offset.count);
  }
}

/* Parse the battery level from the buffer data and return it as a percentage. */
function parseBatLevel(buff_data, wacVersion, offset)
{
  if(wacVersion === "new"){
    return buff_data.readUInt8(offset.batteryLevel);
  }
  else {
    let output = buff_data.readUInt16LE(offset.batteryLevel);
	  return (output/MAX_BAT_MV) * 100;
  }
}

/* Parse the company code from the buffer data */
function parseCompanyCode(buff_data, wacVersion, offset)
{
  if(wacVersion === "new") {
    return buff_data.readUInt16BE(offset.companyCode);
  }
  else {
    return buff_data.readUInt16LE(offset.companyCode);
  }
}

/* Parse the notifications setting from the buffer data */
function parseNotifs(buff_data, offset)
{
  return buff_data.readUInt8(offset.notifications);
}

/* Parse the dash number from the buffer data */
function parseDashNum(buff_data, offset)
{
  return buff_data.readUInt8(offset.dashNum);
}

////////////////////////////////////////////////////////////////////////////////

/* Creates a local list of variables for comparison with the list in the config
   file to detect any changes to the settingsmachine configuration. */
function createNewVariableList()
{
   let newVariables = [];

   /* check for no list */
   if(!config.settings.model.hasOwnProperty('deviceList') ) {
     return newVariables;
   }

   /* check for empty list */
   if(config.settings.model.deviceList.length === 0 ) {
     return newVariables;
   }

   /* Convert the supplied list of addresses to an array so a list
      of variables can be created. */
   deviceArray = _.split(config.settings.model.deviceList, ',').map((item) => item.trim());

   for(let i = 0; i < deviceArray.length; i++)
   {
     let tmpCompany = _.cloneDeep(varForCompany);
     tmpCompany.name = deviceArray[i] + varForCompany.name;
     tmpCompany.description = deviceArray[i] + varForCompany.description;
     tmpCompany.format = varForCompany.format;
     newVariables.push(tmpCompany);

     let tmpSerial = _.cloneDeep(varForSerial);
     tmpSerial.name = deviceArray[i] + varForSerial.name;
     tmpSerial.description = deviceArray[i] + varForSerial.description;
     tmpSerial.format = varForSerial.format;
     newVariables.push(tmpSerial);

     let tmpCount = _.cloneDeep(varForCount);
     tmpCount.name = deviceArray[i] + varForCount.name;
     tmpCount.description = deviceArray[i] + varForCount.description;
     tmpCount.format = varForCount.format;
     newVariables.push(tmpCount);

     let tmpNotif = _.cloneDeep(varForNotif);
     tmpNotif.name = deviceArray[i] + varForNotif.name;
     tmpNotif.description = deviceArray[i] + varForNotif.description;
     tmpNotif.format = varForNotif.format;
     newVariables.push(tmpNotif);

     let tmpPart = _.cloneDeep(varForPart);
     tmpPart.name = deviceArray[i] + varForPart.name;
     tmpPart.description = deviceArray[i] + varForPart.description;
     tmpPart.format = varForPart.format;
     newVariables.push(tmpPart);

     let tmpDash = _.cloneDeep(varForDash);
     tmpDash.name = deviceArray[i] + varForDash.name;
     tmpDash.description = deviceArray[i] + varForDash.description;
     tmpDash.format = varForDash.format;
     newVariables.push(tmpDash);

     let tmpRev = _.cloneDeep(varForRev);
     tmpRev.name = deviceArray[i] + varForRev.name;
     tmpRev.description = deviceArray[i] + varForRev.description;
     tmpRev.format = varForRev.format;
     newVariables.push(tmpRev);

     let tmpBat = _.cloneDeep(varForBattery);
     tmpBat.name = deviceArray[i] + varForBattery.name;
     tmpBat.description = deviceArray[i] + varForBattery.description;
     tmpBat.format = varForBattery.format;
     newVariables.push(tmpBat);

     let tmpRssi = _.cloneDeep(varForRssi);
     tmpRssi.name = deviceArray[i] + varForRssi.name;
     tmpRssi.description = deviceArray[i] + varForRssi.description;
     tmpRssi.format = varForRssi.format;
     newVariables.push(tmpRssi);
   }
   return newVariables;
}

function dbAddResult(err, res)
{
    if (err) {
        alert.raise({ key: 'db-add-error', errorMsg: err.message });
    } else {
        alert.clear('db-add-error');
    }
    if (res) log.debug(res);
}

/* Function to create a new object of WACS containing desired data. */
function getWACData()
{
  let wacVersion;

  /* Protects against potential errors caused by trying to
     parse non-existent data. */
  if(devicesAvailable)
  {
    //log.info("Parsing data from the advertisement...");
    WACInfo = {};

    /* Iterate through the filtered list to get data from the advertisement and
       create a new list of WACS and their data, identified by each one's id. */
   for(var id in filteredList)
   {
      if (!filteredList.hasOwnProperty(id)) {
          continue;
      }

      if(filteredList[id].localName === newWacName){
        wacVersion = "new";
      }
      else {
        wacVersion = "old";
      }


     let currentWACBufferData = filteredList[id].advertisement.manufacturerData;
     let macName = filteredList[id].id;

     if(currentWACBufferData.byteLength >= 16){
       let currentWAC = {
         "companyCode": {data: parseCompanyCode(currentWACBufferData, wacVersion, checkWacVersion(wacVersion)),
                         varName: macName + "-companyCode"},
         "serialNum": {data: parseSerialNum(currentWACBufferData, wacVersion, checkWacVersion(wacVersion)),
                       varName: macName + "-serialNum"},
         "count": {data: parseCounts(currentWACBufferData, wacVersion, checkWacVersion(wacVersion)), varName: macName + "-count"},
         "notifications": {data: parseNotifs(currentWACBufferData, checkWacVersion(wacVersion)),
                           varName: macName + "-notifications"},
         "partNum": {data: parsePartNum(currentWACBufferData, wacVersion, checkWacVersion(wacVersion)), varName: macName +
                      "-partNum"},
         "dashNum": {data: parseDashNum(currentWACBufferData, checkWacVersion(wacVersion)), varName: macName +
                      "-dashNum"},
         "revNum": {data: parseDesignRev(currentWACBufferData, checkWacVersion(wacVersion)), varName: macName +
                      "-revNum"},
         "batteryLevel": {data: parseBatLevel(currentWACBufferData, wacVersion, checkWacVersion(wacVersion)),
                          varName: macName + "-batteryLevel"},
         "rssi": {data: filteredList[id].rssi, varName: macName + "-rssi"}
       };

       WACInfo[macName] = currentWAC;
     }
   }

   //log.info("Data successfully parsed from the advertisement.");
 }
 else
 {
   //log.info("No data to parse.");
 }
}

/* Function to publish parsed data to the spark database */
function publishDataToDb()
{
  /* Only writes to the database if there is stuff to write, i.e. if devices
     are present */
  if(devicesAvailable)
  {
   //log.info("Writing to database...");
   for(var wac in WACInfo)
   {
       if (!WACInfo.hasOwnProperty(wac)) {
         continue;
       }

     for(var variable in WACInfo[wac])
     {
        if (!WACInfo[wac].hasOwnProperty(variable)) {
           continue;
        }

       let data = {
         machine: config.info.name,
         variable: WACInfo[wac][variable].varName,
       };

     data[data.variable] = WACInfo[wac][variable].data;
     db.add(data, dbAddResult);
    }
   }
  }
  else
  {
    //log.info("Nothing to write to the database...");
  }
}

/* Callback function used to get the list emitted by a node-ble 'newList' event */
function newListRecieved(list)
{
  //log.info("New List Received.");
  filterList(list);
  getWACData();
}

sparkMachineWAC.start = function(modules, done)
{
  db = modules['spark-db'].exports;
  conf = modules['spark-config'].exports;
  log = modules['spark-logging'].exports.getLogger(pkg.name);
  alert = modules['spark-alert'].exports.getAlerter(pkg.name);

  alert.preLoad({
      'db-add-error' : {
          msg: 'WAC Machine: Database Add Error',
          description: x => `Error adding to the database. Error: ${x.errorMsg}`
      },
      'initialization-error' : {
          msg: 'WAC Machine: Initialization Error',
          description: x => `WAC Machine is not able to initialize correctly. Error: ${x.errorMsg}`
      }
  });

  log.info("Starting WAC Machine.");

  /* Check if in test mode */
  if(process.env.NODE_ENV === 'test')
  {
    log.debug("In Test Mode.");
    nodeBle = modules['node-ble'].exports;
  }
  else
  {
    nodeBle = require('node-ble');
  }

  /* Listen for changes to the enable key but only add the listener once */
  if(conf.listeners('set').indexOf(onSetListener) === -1)
  {
    conf.on('set', onSetListener);
  }

  // do the following steps one after another using async
  async.series([
          function(cb) {
              // read the current settings from the database model
              conf.get('machines:' + pkg.name + ':settings:model', (err, model) => {
                  // if there is model data in the db, update to it (e.g. overwrite what was read from readonly file)
                  if (model) {
                      config.settings.model = model;
                  }
                  cb(null);
              });
          },
          function(cb) {
              // read the current variable list
              conf.get('machines:' + pkg.name + ':variables', (err, currentVariables) => {
                  // and write it to our local copy
                  if(currentVariables) {
                      config.variables = currentVariables;
                  }
                  cb(null);
              });
          },
          function(cb) {
              // if process has just started up
              if( firstStart === true ) {
                  firstStart = false;
                  // write back config incase config json file has newer data than config database
                  conf.set('machines:' + pkg.name, config, cb);
              } else {
                  // otherwise no need to update
                  return cb(null);
              }
          },
          function(cb) {

              log.info("Creating a new variable list...");

              /*  Create a variable list from settings data */
              let newVars = createNewVariableList();

              log.info("New variable list created.");
              log.info("Checking whether the variable list is the " +
                         "same as in the configuration file...");

              /* Check the variable lists don't match (i.e. not the same as before) */
              if(!_.isEqual(newVars, config.variables))
              {
                  log.info("Different variables detected.");
                  config.variables = newVars;

                  /* Write the updated list to config variable database */
                  conf.set('machines:' + pkg.name + ':variables',
                            config.variables, (err, model) => {
                      if (err)
                      {
                        return done(err);
                      }
                      return cb(null);
                  });
              } else {
                  log.info("No changes detected in variable list.");
                  return cb(null);
              }
          }
      ],
      function(err, result) {
          // once all async task are completed, check for error
          if (err) {
              alert.raise({ key: 'initialization-error', errorMsg: err.message });
              return done(err);
          }
          alert.clear('initialization-error');

          /* Check if the machine is disabled or not. */
          log.info("Checking if disabled:");

          if (!config.settings.model.enable)
          {
            log.info("WAC machine is disabled");
            return done(null, config.info);
          }
          else
          {
            log.info("WAC machine is not disabled.");
            running = true;

            /* If in test mode */
            if(process.env.NODE_ENV !== 'test')
            {
                /* Start an instance of the node-btle module */
                log.info("Starting node-ble module...");
                nodeBle.start();
                log.info("node-ble module started.");
            }

            log.info("Listening for lists...");

            nodeBle.on('newList', newListRecieved);

            /* Set the update rate to whatever the user has specified. */
            updateDb = setInterval(publishDataToDb,
                              config.settings.model.updateRate * 1000);

            return done(null, config.info);
          }
      });
};

sparkMachineWAC.stop = function(done)
{
  if(!running)
  {
    return done(null);
  }

  /* Clean up */
  running = false;
  devicesAvailable = false;
  WACInfo = {};
  filteredList = {};

  /* Stop publishing data to the database. */
  clearInterval(updateDb);

  log.info("Unsubscribing from nodeBle.");
  /* Unsubscribe from the node-ble module but only if a listener has been registered. */
  nodeBle.removeListener('newList', newListRecieved);

  nodeBle.stop();
  log.info("Spark WAC Machine stopped.");

  alert.clearAll(function(){
      return done(null);
  });
};

sparkMachineWAC.require = function()
{
    return ['spark-db',
        'spark-config',
        'spark-alert',
        'spark-logging'
    ];
};

/* Functions for testing -may be useful externally too. */

sparkMachineWAC.getFilteredList = function()
{
  return filteredList;
};

sparkMachineWAC.getWacInfo = function()
{
  return WACInfo;
};

sparkMachineWAC.getState = function()
{
  return running;
};

module.exports = sparkMachineWAC;
