/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
let webdav = require('webdav');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

const LF = '\u000A';
const CR = '\u000D';
const ALARM_DATE_POS = 1;
const ALARM_TIME_POS = 2;
const ALARM_SET_POS = 4;
const ALARM_CODE_POS = 5;
const CLIENT_CMD_DELAY_TIME = 3000; // delay 3 seconds between processing initialization commands
const CLIENT_WAIT_CONNECT_RESPONSE = 1;
const CLIENT_WAIT_ABORT_REPORT_RESPONSE = 2;
const CLIENT_WAIT_ABORT_ALARMS_RESPONSE = 3;
const CLIENT_WAIT_REPORT_INIT_RESPONSE = 4;
const CLIENT_WAIT_ALARM_INIT_RESPONSE = 5;
const CLIENT_WAIT_DATA = 6;
const CLIENT_ABORT_COMPLETE = 7;
const CLIENT_ABORT_COMPLETE_CHECK_TIME = 100;
const CLIENT_ABORT_COMPLETE_MAX_CHECKS = 60000 / CLIENT_ABORT_COMPLETE_CHECK_TIME;
const MAX_NO_DATA_TIME = 15 * 60 * 1000;
const MIN_NO_DATA_TIME = 60 * 1000;
const MAX_NO_DATA_CYCLIC_TIME_FACTOR = 10;
const WEBDAV_INIT_TIMEOUT = 2 * 60 * 1000;

let timestampFieldIndex1 = '';
let timestampFieldIndex2 = '';
let fileTimestamp = 0;
let UTCOffset = 0;
let filePollingTime = 1000;

//-------------------------------------------------------------------------
//-------------------------------------------------------------------------
//-------------------------------------------------------------------------

const deliverEntireResultVariable = {
  name: 'CombinedResult',
  description: 'CombinedResult',
  format: 'char',
  array: true,
};

//-------------------------------------------------------------------------
//-------------------------------------------------------------------------
//-------------------------------------------------------------------------

// constructor
// eslint-disable-next-line max-len
const hplEuromap63Multiclient = function hplEuromap63Multiclient(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'invalid-credentials': {
      msg: 'Euromap 63: Invalid  Username or Password',
      description: 'An invalid username or password was entered when the machine was configured.',
    },
    'invalid-pathname': {
      msg: 'Euromap 63 Invalid Pathname',
      description: 'An invalid pathname was provided by the client.',
    },
    'invalid-serverMachineNameList': {
      msg: 'Euromap 63 Invalid Server / Machine Name list',
      description: 'Format is Folder-1:MachineName-1, Folder-2:MachineName-2, ..., Folder-n:MachineName-n.  Note that if the MachineName is ommitted, it will be automatically generated as machine definition name, appended with the folder.',
    },
    'invalid-filename': {
      msg: 'Euromap 63: Invalid File Name',
      description: 'An invalid file name was provided by the client.',
    },
    'database-error': {
      msg: 'Euromap 63: Error Writing to Database',
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
    'server-error': {
      msg: 'Euromap 63: File Server Error Occurred',
      description: x => `A file server error occurred. Error: ${x.errorMsg}`,
    },
    'server-write-error': {
      msg: 'Euromap 63: File Could Not Be Written to Server',
      description: x => `File '${x.filename}' could not be written to the WebDAV server. Error: ${x.errorMsg}`,
    },
    'server-read-error': {
      msg: 'Euromap 63: File Could Not Be Read from Server',
      description: x => `File '${x.filename}' could not be read from the WebDAV server. Error: ${x.errorMsg}`,
    },
  });

  // if running test harness, get webdav test client
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line global-require
    webdav = require('./test/webdav-test-client');
    this.tester = webdav;
  }

  // Private variables
  const that = this;
  let webdavClient = null;
  // let webdavTimer = null;
  // let webdavClientState = 0;
  let webdavClientNoDataTimeout = MAX_NO_DATA_TIME;
  // let webdavClientWaitTimer = null;
  // let webdavClientDelayTimer = null;
  let webdavClientShuttingDown = false;
  let webdavUsername;
  let webdavPassword;
  let connectionStatusTimer = null;

  let variableReadArray = [];
  let currentAlarmCodes = [];
  let fileObjects = {};
  const clientFileOptions = {
    format: 'text',
    overwrite: true,
  };

  let sessionString = '0000';
  const connectReqString = `00000000 CONNECT;${CR}${LF}`;
  let sessionBaseFileName;
  let sessionReqFileName;
  let reportJobFileName;
  let reportDatFileName;
  let reportLogFileName;
  let alarmJobFileName;
  let alarmDatFileName;
  let alarmLogFileName;
  let setVariableJobFileName;
  let abortReportFileName;
  let abortAlarmsFileName;
  let abortReportReqString;
  let abortAlarmsReqString;
  let reportReqString;
  let alarmReqString;
  let abortReportString;
  let abortAlarmsString;
  let reportJobString;
  let alarmJobString;

  let webdavClientStateArray = [];
  let webdavTimerArray = [];
  let webdavInitTimerArray = [];
  let webdavClientWaitTimerArray = [];
  let webdavClientDelayTimerArray = [];
  let serverFolders = [];
  let machineNames = [];

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine, {
    settings: {
      model,
    },
  });

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  //    function checkForMatch(element) {
  //        return element === that.machine.variables[i].reportName;
  //    }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function getTimestampField(field, value) {
    // console.log('!!!!!!! value = ' + JSON.stringify(value));
    for (let index = 0; index < value.length; index += 1) {
      if (Object.keys(value[index])[0] === field) {
        return value[index][field];
      }
    }
    return '';
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function updateDatabase(serverIndex, variable, value) {
    // eslint-disable-next-line max-len
    // console.log(`!!!!!!!!! updateDatabase: machine: ${machineNames[serverIndex]}, variable: ${variable.name}, value: ${JSON.stringify(value)}`);
    // eslint-disable-next-line max-len
    // console.log(`!!!!!!!!! updateDatabase: machine: ${machineNames[serverIndex]}, variable: ${variable.name}`);

    const multiValue = { vmMachineName: machineNames[serverIndex] };
    multiValue.data = value;

    let timestamp = 0;
    if ((timestampFieldIndex1 !== '') && (timestampFieldIndex2 !== '')) {
      // console.log('!!!! getting dateValue');
      let dateValue = getTimestampField(timestampFieldIndex1, value);
      // console.log('!!!! getting timeValue');
      if (dateValue.length === 8) {
        dateValue = `${dateValue.substring(0, 4)}-${dateValue.substring(4, 6)}-${dateValue.substring(6, 8)}`;
      }
      const timeValue = getTimestampField(timestampFieldIndex2, value);
      if ((dateValue !== '') && (timeValue !== '')) {
        const dateTimeString = `${dateValue} ${timeValue}`;
        // console.log(`!!!!!! dateTimeString = ${dateTimeString}`);
        timestamp = Date.parse(dateTimeString);
        // console.log('!!!!! timestamp field1 and field2 = ' + timestamp);
      }
    } else if (timestampFieldIndex1 !== '') {
      const dateTimeValue = getTimestampField(timestampFieldIndex1, value);
      if (dateTimeValue !== '') {
        timestamp = Date.parse(`${dateTimeValue}`);
        // console.log('!!!!! timestamp field1 = ' + timestamp);
      }
    } else if (that.machine.settings.model.useFiledateForTimestampDate) {
      timestamp = fileTimestamp;
      // console.log('!!!!! timestamp file = ' + timestamp);
    }
    if (timestamp) {
      const existingTimestamp = getTimestampField('timestamp', value);
      if (existingTimestamp === '') {
        const adjustedUTCTimestamp = timestamp + UTCOffset;

        const adjustedDate = new Date(adjustedUTCTimestamp);
        // console.log(`!!!!!! adjustedDate = ${adjustedDate}`);
        const timestampObject = { timestamp: adjustedDate };
        multiValue.data.push(timestampObject);
      }
    }
    that.dataCb(that.machine, variable, multiValue, (err, res) => {
      if (err) {
        alert.raise({ key: 'database-error', errorMsg: err.message });
      } else {
        alert.clear('database-error');
      }
      if (res) log.debug(res);
    });
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function convertType(format, resultAsString) {
    if (resultAsString !== null) {
      let result;
      let isNumber;

      switch (format) {
        case 'char':
        {
          // remove any leading and trailing quotes
          result = resultAsString.replace(/^"(.*)"$/, '$1');
          break;
        }
        case 'int8':
        case 'int16':
        case 'int32':
        case 'int64':
        case 'uint8':
        case 'uint16':
        case 'uint32':
        case 'uint64':
        {
          isNumber = /^[0-9]+$/.test(resultAsString);
          if (isNumber) {
            result = parseInt(resultAsString, 10);
          } else {
            result = null;
          }
          break;
        }
        case 'float':
        case 'double':
        {
          isNumber = /^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$/.test(resultAsString);
          if (isNumber) {
            result = parseFloat(resultAsString);
          } else {
            result = null;
          }
          break;
        }
        case 'bool':
        {
          result = ((resultAsString === 'true') || (resultAsString === '1'));
          break;
        }
        default:
        {
          result = null;
          break;
        }
      }

      return result;
    }
    return null;
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function serverFileExists(directoryContents, fileName) {
    // console.log('----- serverFileExists: looking for fileName = ' + fileName);
    // return true if the file exists in the directory
    let iItem; const
      nItems = directoryContents.length;
    for (iItem = 0; iItem < nItems; iItem += 1) {
      // eslint-disable-next-line max-len
      // console.log(`----- serverFileExists: checking directoryContents[${iItem}]: ${JSON.stringify(directoryContents[iItem])}`);
      if ((directoryContents[iItem].type === 'file') && (directoryContents[iItem].filename === fileName)) {
        // console.log('----- FOUND IT');
        fileTimestamp = new Date(directoryContents[iItem].lastmod);
        return true;
      }
    }

    return false;
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function getIndexOfServerResponseFile(directoryContents, requestFileName) {
    // remove the file extension, since for requests it may see RSP or TRP or something else
    const reqBaseFileName = requestFileName.replace(/\.[^/.]+$/, '');

    // search directory for a file with same base name as request but a different extension
    let iItem; const
      nItems = directoryContents.length;
    for (iItem = 0; iItem < nItems; iItem += 1) {
      if (directoryContents[iItem].type === 'file') {
        // remove the file extension, since may see RSP or TRP or something else
        const fileName = directoryContents[iItem].basename;
        const baseFileName = fileName.replace(/\.[^/.]+$/, '');

        if ((baseFileName === reqBaseFileName) && (fileName !== requestFileName)) {
          return iItem;
        }
      }
    }

    // return -1 if not found
    return -1;
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function deleteServerFile(fileName) {
    webdavClient.deleteFile(fileName)
      .catch(() => {
      });
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function deleteServerFilesWithBaseName(serverIndex, baseFileName, deleteCB) {
    // get the current files on the server

    const serverFolder = `${serverFolders[serverIndex]}/`;

    // eslint-disable-next-line max-len
    // console.log(`----- deleteServerFilesWithBaseName: serverIndex = ${serverIndex}, serverFolder = ${serverFolder}`);
    //
    // console.log(`----- deleteServerFilesWithBaseName, baseFileName = ${baseFileName}`);
    //
    // console.log(``----- deleteServerFilesWithBaseName: getDirectoryContents: ${serverFolder}`);
    webdavClient
      .getDirectoryContents(serverFolder)
      .then((contents) => {
        // search the directory for all files with this base name and delete them
        // eslint-disable-next-line max-len
        // console.log(`----- deleteServerFilesWithBaseName: getDirectoryContents: contents = ${JSON.stringify(contents)}`);
        async.forEach(contents, (item, callback) => {
          if (item.type === 'file') {
            const baseName = item.basename.replace(/\.[^/.]+$/, '');
            if (baseName === baseFileName) {
              // eslint-disable-next-line max-len
              // console.log('----- deleteServerFilesWithBaseName, deleting file: ' + item.filename);
              webdavClient.deleteFile(item.filename)
                .then(() => {
                  // eslint-disable-next-line max-len
                  // console.log(`----- deleteServerFilesWithBaseName, deleting file: ${item.filename} SUCCESSFUL`);
                  callback(null);
                })
                .catch(() => {
                  // eslint-disable-next-line max-len
                  // console.log(`----- deleteServerFilesWithBaseName, deleting file: ${item.filename} FAILED!!!`);
                  callback(null);
                });
            } else {
              callback(null);
            }
          } else {
            callback(null);
          }
        },
        () => {
          deleteCB();
        });
      })
      .catch(() => {
        deleteCB();
      });
  }


  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function initializeAlarmCodes(serverIndex) {
    // set all alarm codes to zero
    const { variables } = that.machine;
    if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
      const combinedResultArray = [];
      for (let iVar = 0; iVar < variables.length; iVar += 1) {
        if (_.get(variables[iVar], 'alarmCode', false)) {
          if (_.get(variables[iVar], 'array', false)) {
            const newData = {};
            newData[`${variables[iVar].name}`] = '';
            combinedResultArray.push(newData);
            // updateDatabase(serverIndex, variables[iVar], []);
          } else {
            const newData = {};
            newData[`${variables[iVar].name}`] = 0;
            combinedResultArray.push(newData);
            // updateDatabase(serverIndex, variables[iVar], 0);
          }
        }
      }
      if (combinedResultArray.length > 0) {
        // eslint-disable-next-line max-len
        // console.log(`<><><><><><><> delivering CombinedResult: ${JSON.stringify(combinedResultArray)}`);
        updateDatabase(serverIndex, deliverEntireResultVariable, combinedResultArray);
      }
    } else {
      for (let iVar = 0; iVar < variables.length; iVar += 1) {
        if (_.get(variables[iVar], 'alarmCode', false)) {
          if (_.get(variables[iVar], 'array', false)) {
            updateDatabase(serverIndex, variables[iVar], []);
          } else {
            updateDatabase(serverIndex, variables[iVar], 0);
          }
        }
      }
    }
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function processReportData(serverIndex, reportData, callback) {
    if (!reportData) {
      log.debug('Report data undefined');
      return callback(null);
    }

    const lineArray = reportData.split(/\r?\n/);
    if (lineArray.length < 2) {
      return callback(null);
    }
    const firstLine = lineArray[0];
    const secondLine = lineArray[1];

    log.debug('firstline:', firstLine);
    log.debug('secondLine:', secondLine);

    const firstLineArray = firstLine.split(/,(?![^[]*\])/); // find only commas not in brackets
    const secondLineArray = secondLine.split(',');
    if (secondLineArray.length < firstLineArray.length) {
      return callback(null);
    }

    // console.log('---------- processReportData: reportData = ' + reportData);

    if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
      //      console.log('------ processReportData: deliverEntireResponse');
      const combinedResultArray = [];
      for (let i = 0; i < variableReadArray.length; i += 1) {
        // find a match
        const variableToMatch = variableReadArray[i].reportName;
        let index;
        for (index = 0; index < firstLineArray.length; index += 1) {
          if (firstLineArray[index] === variableToMatch) {
            break;
          }
        }
        if ((index < firstLineArray.length) && (firstLineArray[index] === variableToMatch)) {
          const varAsString = secondLineArray[index].trim();
          // console.log('found value for ', variableReadArray[i].name, ': ', varAsString);
          let varAsValue = null;
          if (varAsString.length > 0) {
            varAsValue = convertType(variableReadArray[i].format, varAsString);
          }
          if (varAsValue !== null) {
            const newData = {};
            newData[`${variableReadArray[i].name}`] = varAsValue;
            combinedResultArray.push(newData);
          } else {
            // console.log(`invalid response data for variable: ${variableReadArray[i].name}`);
          }
        }
      }
      if (combinedResultArray.length > 0) {
        // eslint-disable-next-line max-len
        // console.log(`<><><><><><><><><> delivering CombinedResult: ${JSON.stringify(combinedResultArray)}`);
        updateDatabase(serverIndex, deliverEntireResultVariable, combinedResultArray);
      }
    } else {
      for (let i = 0; i < variableReadArray.length; i += 1) {
        // find a match
        const variableToMatch = variableReadArray[i].reportName;
        let index;
        for (index = 0; index < firstLineArray.length; index += 1) {
          if (firstLineArray[index] === variableToMatch) {
            break;
          }
        }
        if ((index < firstLineArray.length) && (firstLineArray[index] === variableToMatch)) {
          const varAsString = secondLineArray[index].trim();
          log.debug('found value for ', variableReadArray[i].name, ': ', varAsString);
          let varAsValue = null;
          if (varAsString.length > 0) {
            varAsValue = convertType(variableReadArray[i].format, varAsString);
          }
          if (varAsValue !== null) {
            updateDatabase(serverIndex, variableReadArray[i], varAsValue);
          } else {
            log.error('invalid response data for variable: ', variableReadArray[i].name);
          }
        }
      }
    }

    return callback(null);
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function processAlarmData(serverIndex, alarmData, callback) {
    if (!alarmData) {
      log.debug('Alarm data undefined');
      return callback(null);
    }

    const lines = alarmData.split(/\r?\n/);

    // find the last alarm that has an alarm set value of 1 and
    // build array of alarm code, date/time objects
    let lastAlarmCode = 0;
    const alarmCodes = [];
    for (let iLine = lines.length - 1; iLine >= 0; iLine -= 1) {
      const alarmFields = lines[iLine].split(',');
      if (alarmFields.length > ALARM_CODE_POS) {
        if (alarmFields[ALARM_SET_POS] !== '0') {
          const alarmCode = parseInt(alarmFields[ALARM_CODE_POS], 10);
          if (lastAlarmCode === 0) {
            lastAlarmCode = alarmCode;
          }
          alarmCodes.push({
            datetime: alarmFields[ALARM_DATE_POS]
            + alarmFields[ALARM_TIME_POS],
            alarmCode,
          });
        }
      }
    }

    // create a sorted list of alarm code, newest first
    const { variables } = that.machine;
    const alarmCodesSorted = [];
    let iAlarm;
    alarmCodes.sort((alarm1, alarm2) => {
      if (alarm1.datetime > alarm2.datetime) return -1;
      if (alarm1.datetime < alarm2.datetime) return 1;
      return 0;
    });
    for (iAlarm = 0; iAlarm < alarmCodes.length; iAlarm += 1) {
      alarmCodesSorted.push(alarmCodes[iAlarm].alarmCode);
    }

    if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
      const combinedResultArray = [];
      // set the value of all alarm code variables, using sorted list if alarm codes
      for (let iVar = 0; iVar < variables.length; iVar += 1) {
        // set any last alarm cdoe or alarm code array variables
        if (_.get(variables[iVar], 'alarmCode', false)) {
          if (_.get(variables[iVar], 'array')) {
            const newData = {};
            newData[`${variables[iVar].name}`] = JSON.stringify(alarmCodesSorted);
            combinedResultArray.push(newData);
            //            updateDatabase(serverIndex, variables[iVar], alarmCodesSorted);
          } else {
            const newData = {};
            newData[`${variables[iVar].name}`] = lastAlarmCode;
            combinedResultArray.push(newData);
            //            updateDatabase(serverIndex, variables[iVar], lastAlarmCode);
          }
        } else if (_.has(variables[iVar], 'alarmCodeChanged')) {
          // set any alarm code activated or deactivated variables
          const alarmCodesToReport = [];
          if (variables[iVar].alarmCodeChanged === 'Activated') {
            for (iAlarm = alarmCodesSorted.length - 1; iAlarm >= 0; iAlarm -= 1) {
              if (!currentAlarmCodes[serverIndex].includes(alarmCodesSorted[iAlarm])) {
                alarmCodesToReport.push(alarmCodesSorted[iAlarm]);
                // updateDatabase(serverIndex, variables[iVar], alarmCodesSorted[iAlarm]);
              }
            }
          } else if (variables[iVar].alarmCodeChanged === 'Deactivated') {
            for (iAlarm = 0; iAlarm < currentAlarmCodes[serverIndex].length; iAlarm += 1) {
              if (!alarmCodesSorted.includes(currentAlarmCodes[serverIndex][iAlarm])) {
                alarmCodesToReport.push(currentAlarmCodes[serverIndex][iAlarm]);
                // eslint-disable-next-line max-len
                // updateDatabase(serverIndex, variables[iVar], currentAlarmCodes[serverIndex][iAlarm]);
              }
            }
          }
          if (alarmCodesToReport.length > 1) {
            const newData = {};
            newData[`${variables[iVar].name}`] = JSON.stringify(alarmCodesToReport);
            combinedResultArray.push(newData);
          } else if (alarmCodesToReport.length === 1) {
            const newData = {};
            // eslint-disable-next-line prefer-destructuring
            newData[`${variables[iVar].name}`] = alarmCodesToReport[0];
            combinedResultArray.push(newData);
          }
        }
      }
      if (combinedResultArray.length > 0) {
        // eslint-disable-next-line max-len
        // console.log(`<><><><><><><> delivering ALARM CombinedResult: ${JSON.stringify(combinedResultArray)}`);
        updateDatabase(serverIndex, deliverEntireResultVariable, combinedResultArray);
      }
    } else {
      // set the value of all alarm code variables, using sorted list if alarm codes
      for (let iVar = 0; iVar < variables.length; iVar += 1) {
        // set any last alarm cdoe or alarm code array variables
        if (_.get(variables[iVar], 'alarmCode', false)) {
          if (_.get(variables[iVar], 'array')) {
            updateDatabase(serverIndex, variables[iVar], alarmCodesSorted);
          } else {
            updateDatabase(serverIndex, variables[iVar], lastAlarmCode);
          }
        } else if (_.has(variables[iVar], 'alarmCodeChanged')) {
          // set any alarm code activated or deactivated variables
          if (variables[iVar].alarmCodeChanged === 'Activated') {
            for (iAlarm = alarmCodesSorted.length - 1; iAlarm >= 0; iAlarm -= 1) {
              if (!currentAlarmCodes[serverIndex].includes(alarmCodesSorted[iAlarm])) {
                updateDatabase(serverIndex, variables[iVar], alarmCodesSorted[iAlarm]);
              }
            }
          } else if (variables[iVar].alarmCodeChanged === 'Deactivated') {
            for (iAlarm = 0; iAlarm < currentAlarmCodes[serverIndex].length; iAlarm += 1) {
              if (!alarmCodesSorted.includes(currentAlarmCodes[serverIndex][iAlarm])) {
                updateDatabase(serverIndex,
                  variables[iVar],
                  currentAlarmCodes[serverIndex][iAlarm]);
              }
            }
          }
        }
      }
    }

    // save the alarm code so that we can see which ones are activated or deactivated
    currentAlarmCodes[serverIndex] = alarmCodesSorted.slice();

    return callback(null);
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function resetWebdavClientTimeout(serverIndex) {
    if (webdavClientWaitTimerArray[serverIndex]) {
      clearTimeout(webdavClientWaitTimerArray[serverIndex]);
    }

    // eslint-disable-next-line no-use-before-define
    webdavClientWaitTimerArray[serverIndex] = setTimeout(writeInitFilesToServer,
      webdavClientNoDataTimeout,
      serverIndex);
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function startPollingWebdavServer(serverIndex) {
    // eslint-disable-next-line no-use-before-define
    if (webdavTimerArray[serverIndex]) {
      clearInterval(webdavTimerArray[serverIndex]);
      webdavTimerArray[serverIndex] = null;
    }

    // eslint-disable-next-line no-use-before-define
    webdavTimerArray[serverIndex] = setInterval(pollWebdavServer, filePollingTime, serverIndex);
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function stopPollingWebdavServer(serverIndex) {
    if (webdavTimerArray[serverIndex]) {
      clearInterval(webdavTimerArray[serverIndex]);
      webdavTimerArray[serverIndex] = null;
    }
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function pollWebdavServer(serverIndex) {
    const serverFolder = `${serverFolders[serverIndex]}/`;

    // eslint-disable-next-line max-len
    // console.log(`----- pollWebdavServer: machine: ${machineNames[serverIndex]}, serverFolder: ${serverFolder}`);
    // get the current files on the server
    webdavClient
      .getDirectoryContents(serverFolder)
      .then((contents) => {
        let iResp;

        // console.log('----- getDirectoryContents: contents = ' + JSON.stringify(contents));
        // eslint-disable-next-line max-len
        // console.log(`----- pollWebdavServer: machine: ${machineNames[serverIndex]}, serverFolder: ${serverFolder}, state:${webdavClientStateArray[serverIndex]}`);

        // process the files based on the current state
        switch (webdavClientStateArray[serverIndex]) {
          // if connection response received, send report abort request
          case CLIENT_WAIT_CONNECT_RESPONSE:
            // console.log('----- CLIENT_WAIT_CONNECT_RESPONSE');
            iResp = getIndexOfServerResponseFile(contents, sessionReqFileName);
            if (iResp !== -1) {
              stopPollingWebdavServer(serverIndex);
              webdavClientDelayTimerArray[serverIndex] = setTimeout((localServerIndex) => {
                webdavClientDelayTimerArray[localServerIndex] = null;
                deleteServerFilesWithBaseName(localServerIndex, sessionBaseFileName, () => {
                  // eslint-disable-next-line max-len
                  console.log(`----- pollWebdavServer: putFileContents: ${serverFolder}${sessionReqFileName}`);
                  webdavClient.putFileContents(`${serverFolder}${sessionReqFileName}`, abortReportReqString, clientFileOptions)
                    .then(() => {
                      alert.clear('server-write-error');
                    })
                    .catch((error) => {
                      // eslint-disable-next-line max-len
                      console.log(`----- putFileContents error: file: ${serverFolder}${sessionReqFileName}, abortReportReqString = ${abortReportReqString}`);
                      alert.raise({ key: 'server-write-error', filename: `${serverFolder}${sessionReqFileName}`, errorMsg: error });
                    });
                });
                startPollingWebdavServer(localServerIndex);
                resetWebdavClientTimeout(localServerIndex);
                webdavClientStateArray[localServerIndex] = CLIENT_WAIT_ABORT_REPORT_RESPONSE;
              }, CLIENT_CMD_DELAY_TIME, serverIndex);
            }

            break;
            // if abort report response received, send report abort alarms request
          case CLIENT_WAIT_ABORT_REPORT_RESPONSE:
            // console.log('----- CLIENT_WAIT_ABORT_REPORT_RESPONSE');
            iResp = getIndexOfServerResponseFile(contents, sessionReqFileName);
            if (iResp !== -1) {
              stopPollingWebdavServer(serverIndex);
              webdavClientDelayTimerArray[serverIndex] = setTimeout((localServerIndex) => {
                webdavClientDelayTimerArray[localServerIndex] = null;
                deleteServerFilesWithBaseName(localServerIndex, sessionBaseFileName, () => {
                  // eslint-disable-next-line max-len
                  // console.log(`----- pollWebdavServer: putFileContents: ${serverFolder}${sessionReqFileName}`);
                  webdavClient.putFileContents(`${serverFolder}${sessionReqFileName}`, abortAlarmsReqString, clientFileOptions)
                    .then(() => {
                      alert.clear('server-write-error');
                    })
                    .catch((error) => {
                      // eslint-disable-next-line max-len
                      // console.log(`----- putFileContents error: file: ${serverFolder}${sessionReqFileName}, abortAlarmsReqString = ${abortAlarmsReqString}`);
                      alert.raise({ key: 'server-write-error', filename: `${serverFolder}${sessionReqFileName}`, errorMsg: error });
                    });
                });
                startPollingWebdavServer(localServerIndex);
                resetWebdavClientTimeout(localServerIndex);
                webdavClientStateArray[localServerIndex] = CLIENT_WAIT_ABORT_ALARMS_RESPONSE;
              }, CLIENT_CMD_DELAY_TIME, serverIndex);
            }

            break;
            // if abort alarms response received, send report init request if any read variables
          case CLIENT_WAIT_ABORT_ALARMS_RESPONSE:
            // console.log('----- CLIENT_WAIT_ABORT_ALARMS_RESPONSE');
            iResp = getIndexOfServerResponseFile(contents, sessionReqFileName);
            if (iResp !== -1) {
              // if shutting down, just note that the aborts are complete
              if (webdavClientShuttingDown) {
                webdavClientStateArray[serverIndex] = CLIENT_ABORT_COMPLETE;
              } else {
                stopPollingWebdavServer(serverIndex);
                webdavClientDelayTimerArray[serverIndex] = setTimeout((localServerIndex) => {
                  webdavClientDelayTimerArray[localServerIndex] = null;
                  deleteServerFilesWithBaseName(localServerIndex, sessionBaseFileName, () => {
                    // send report initialization only if some read variables
                    // console.log(`----- writing ${sessionReqFileName}`);
                    // console.log(`----- reportReqString = ${reportReqString}`);
                    if (variableReadArray.length !== 0) {
                      // eslint-disable-next-line max-len
                      // console.log(`----- pollWebdavServer: putFileContents: ${serverFolder}${sessionReqFileName}`);
                      webdavClient.putFileContents(`${serverFolder}${sessionReqFileName}`, reportReqString, clientFileOptions)
                        .then(() => {
                          alert.clear('server-write-error');
                        })
                        .catch((error) => {
                          // eslint-disable-next-line max-len
                          // console.log(`----- putFileContents error: file: ${serverFolder}${sessionReqFileName}, reportReqString = ${reportReqString}`);
                          alert.raise({ key: 'server-write-error', filename: `${serverFolder}${sessionReqFileName}`, errorMsg: error });
                        });
                    } else {
                      // if no read variables, send alarm initialization request instead
                      // eslint-disable-next-line max-len
                      // console.log(`----- pollWebdavServer: putFileContents: ${serverFolder}${sessionReqFileName}`);
                      webdavClient.putFileContents(`${serverFolder}${sessionReqFileName}`, alarmReqString, clientFileOptions)
                        .then(() => {
                          alert.clear('server-write-error');
                        })
                        .catch((error) => {
                          // eslint-disable-next-line max-len
                          // console.log(`----- putFileContents error: file: ${serverFolder}${sessionReqFileName}, alarmReqString = ${alarmReqString}`);
                          alert.raise({ key: 'server-write-error', filename: `${serverFolder}${sessionReqFileName}`, errorMsg: error });
                        });
                    }
                  });
                  startPollingWebdavServer(localServerIndex);
                  resetWebdavClientTimeout(localServerIndex);
                  webdavClientStateArray[localServerIndex] = variableReadArray.length !== 0
                    ? CLIENT_WAIT_REPORT_INIT_RESPONSE : CLIENT_WAIT_ALARM_INIT_RESPONSE;
                }, CLIENT_CMD_DELAY_TIME, serverIndex);
              }
            }

            break;
            // if report initialization response received, send alarm initialization request
          case CLIENT_WAIT_REPORT_INIT_RESPONSE:
            // console.log('----- CLIENT_WAIT_REPORT_INIT_RESPONSE');
            iResp = getIndexOfServerResponseFile(contents, sessionReqFileName);
            if (iResp !== -1) {
              stopPollingWebdavServer(serverIndex);
              webdavClientDelayTimerArray[serverIndex] = setTimeout((localServerIndex) => {
                webdavClientDelayTimerArray[localServerIndex] = null;
                deleteServerFilesWithBaseName(localServerIndex, sessionBaseFileName, () => {
                  // eslint-disable-next-line max-len
                  // console.log(`----- pollWebdavServer: putFileContents: ${serverFolder}${sessionReqFileName}`);
                  webdavClient.putFileContents(`${serverFolder}${sessionReqFileName}`, alarmReqString, clientFileOptions)
                    .then(() => {
                      alert.clear('server-write-error');
                    })
                    .catch((error) => {
                      // eslint-disable-next-line max-len
                      // console.log(`----- putFileContents error: file: ${serverFolder}${sessionReqFileName}, alarmReqString = ${alarmReqString}`);
                      alert.raise({ key: 'server-write-error', filename: `${serverFolder}${sessionReqFileName}`, errorMsg: error });
                    });
                });
                startPollingWebdavServer(localServerIndex);
                resetWebdavClientTimeout(localServerIndex);
                webdavClientStateArray[localServerIndex] = CLIENT_WAIT_ALARM_INIT_RESPONSE;
              }, CLIENT_CMD_DELAY_TIME, serverIndex);
            }

            break;
            // if alarm initialization response received, begin waiting for report and alarm data
          case CLIENT_WAIT_ALARM_INIT_RESPONSE:
            // console.log('----- CLIENT_WAIT_ALARM_INIT_RESPONSE');
            iResp = getIndexOfServerResponseFile(contents, sessionReqFileName);
            if (iResp !== -1) {
              resetWebdavClientTimeout(serverIndex);
              webdavClientStateArray[serverIndex] = CLIENT_WAIT_DATA;

              // clear the timeer that tells whether initialization takes too long
              if (webdavInitTimerArray[serverIndex]) {
                clearTimeout(webdavInitTimerArray[serverIndex]);
                webdavInitTimerArray[serverIndex] = null;
              }

              // set the connection status to true
              updateConnectionStatus(true);

              // set all alarm codes to zero
              initializeAlarmCodes(serverIndex);
            }

            break;

          // if  waiting for report and alarm data
          case CLIENT_WAIT_DATA:
            // console.log('----- CLIENT_WAIT_DATA');
            // if a report data file exists, process it
            if (serverFileExists(contents, `/${serverFolder}${reportDatFileName}`)) {
              // console.log(`------ found file ${serverFolder}${reportDatFileName}`);
              webdavClient
                .getFileContents(`${serverFolder}${reportDatFileName}`, 'text')
                .then((text) => {
                  alert.clear('server-read-error');
                  processReportData(serverIndex, text.toString(), () => {
                    deleteServerFile(`${serverFolder}${reportDatFileName}`);
                  });
                })
                .catch((error) => {
                  alert.raise({ key: 'server-read-error', filename: `${serverFolder}${reportDatFileName}`, errorMsg: error });
                });

              resetWebdavClientTimeout(serverIndex);
            }

            // if an alarm data file exists, process it
            if (serverFileExists(contents, `/${serverFolder}${alarmDatFileName}`)) {
              webdavClient
                .getFileContents(`${serverFolder}${alarmDatFileName}`, 'text')
                .then((text) => {
                  alert.clear('server-read-error');
                  processAlarmData(serverIndex, text.toString(), () => {
                    deleteServerFile(`${serverFolder}${alarmDatFileName}`);
                  });
                })
                .catch((error) => {
                  alert.raise({ key: 'server-read-error', filename: `${serverFolder}${alarmDatFileName}`, errorMsg: error });
                });

              resetWebdavClientTimeout(serverIndex);
            }

            break;
          default:
            break;
        }
      })
      .catch((error) => {
        log.debug('Error:', error);
      });
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function initializeFileObjects() {
    fileObjects = {};
    fileObjects[sessionReqFileName] = connectReqString;
    fileObjects[abortReportFileName] = abortReportString;
    fileObjects[abortAlarmsFileName] = abortAlarmsString;
    fileObjects[reportJobFileName] = reportJobString;
    fileObjects[alarmJobFileName] = alarmJobString;
    fileObjects[setVariableJobFileName] = '';
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function toHHMMSS(totalSeconds) {
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds - (hours * 3600)) / 60);
    let seconds = totalSeconds - (hours * 3600) - (minutes * 60);

    if (hours < 10) {
      hours = `0${hours}`;
    }
    if (minutes < 10) {
      minutes = `0${minutes}`;
    }
    if (seconds < 10) {
      seconds = `0${seconds}`;
    }
    return `${hours}:${minutes}:${seconds}`;
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function buildFileStrings() {
    sessionBaseFileName = `SESS${sessionString}`;
    sessionReqFileName = `${sessionBaseFileName}.REQ`;
    reportJobFileName = `REPORT${sessionString}.JOB`;
    reportDatFileName = `REPORT${sessionString}.DAT`;
    reportLogFileName = `REPORT${sessionString}.LOG`;
    alarmJobFileName = `GETALARMS${sessionString}.JOB`;
    alarmDatFileName = `GETALARMS${sessionString}.DAT`;
    alarmLogFileName = `GETALARMS${sessionString}.LOG`;
    setVariableJobFileName = `SETVARIABLE${sessionString}.JOB`;
    abortReportFileName = `ABORTREPORT${sessionString}.JOB`;
    abortAlarmsFileName = `ABORTALARMS${sessionString}.JOB`;

    abortReportReqString = `00000001 EXECUTE "${abortReportFileName}";${CR}${LF}`;
    abortAlarmsReqString = `00000002 EXECUTE "${abortAlarmsFileName}";${CR}${LF}`;
    reportReqString = `00000003 EXECUTE "${reportJobFileName}";${CR}${LF}`;
    alarmReqString = `00000004 EXECUTE "${alarmJobFileName}";${CR}${LF}`;
    abortReportString = `JOB AbortReport${sessionString} RESPONSE "ABORTREPORT${sessionString}.LOG";${CR}${LF
    }ABORT JOB Report${sessionString};${CR}${LF}`;
    abortAlarmsString = `JOB AbortAlarms${sessionString} RESPONSE "ABORTALARMS${sessionString}.LOG";${CR}${LF
    }ABORT JOB GetAlarms${sessionString};${CR}${LF}`;
    alarmJobString = `JOB GetAlarms${sessionString} RESPONSE "${alarmLogFileName}";${CR}${LF
    }EVENT GetAlarms${sessionString} CURRENT_ALARMS REWRITE "${alarmDatFileName}"${CR}${LF
    }START IMMEDIATE${CR}${LF
    }STOP NEVER${CR}${LF
    };${CR}${LF}`;

    reportJobString = `JOB Report${sessionString} RESPONSE "${reportLogFileName}";${CR}${LF
    }REPORT Report${sessionString} REWRITE "${reportDatFileName}"${CR}${LF
    }START IMMEDIATE${CR}${LF
    }STOP NEVER${CR}${LF}`;
    if (that.machine.settings.model.cyclicType === 'time') {
      reportJobString += `CYCLIC TIME ${toHHMMSS(that.machine.settings.model.cyclicTime)}${CR}${LF}`;
      // 'CYCLIC TIME 00:00:15' + CR + LF +
    } else {
      reportJobString += `CYCLIC SHOT ${that.machine.settings.model.cyclicShotCount}${CR}${LF}`;
      // 'CYCLIC SHOT 1' + CR + LF +
    }
    reportJobString += `PARAMETERS${CR}${LF}`;
    for (let i = 0; i < variableReadArray.length; i += 1) {
      reportJobString += variableReadArray[i].reportName;
      if ((i + 1) < variableReadArray.length) {
        reportJobString += ',';
      }
      reportJobString += CR + LF;
    }
    reportJobString += `;${CR}${LF}`;
    //    console.log('-------------------- reportJobString = ' + reportJobString);
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  // client write of initialization files to the WebDAV server

  function writeInitFilesToServer(serverIndex) {
    if (webdavTimerArray[serverIndex]) {
      clearInterval(webdavTimerArray[serverIndex]);
      webdavTimerArray[serverIndex] = null;
    }
    if (webdavInitTimerArray[serverIndex]) {
      clearTimeout(webdavInitTimerArray[serverIndex]);
      webdavInitTimerArray[serverIndex] = null;
    }
    if (webdavClientWaitTimerArray[serverIndex]) {
      clearTimeout(webdavClientWaitTimerArray[serverIndex]);
      webdavClientWaitTimerArray[serverIndex] = null;
    }
    if (webdavClientDelayTimerArray[serverIndex]) {
      clearTimeout(webdavClientDelayTimerArray[serverIndex]);
      webdavClientDelayTimerArray[serverIndex] = null;
    }

    const serverFolder = `${serverFolders[serverIndex]}/`;

    // delete and report if alarm data files
    deleteServerFile(`${serverFolder}${reportDatFileName}`);
    deleteServerFile(`${serverFolder}${alarmDatFileName}`);

    // console.log('------ writeInitFilesToServer');

    // write the abort, report and alarm job files
    //    console.log(`------ writing ${serverFolder}${abortReportFileName}`);
    webdavClient.putFileContents(`${serverFolder}${abortReportFileName}`, abortReportString, clientFileOptions)
      .then(() => {
        //        console.log(`------ writing ${serverFolder}${abortAlarmsFileName}`);
        webdavClient.putFileContents(`${serverFolder}${abortAlarmsFileName}`, abortAlarmsString, clientFileOptions)
          .then(() => {
            //            console.log(`------ writing ${serverFolder}${reportJobFileName}`);
            webdavClient.putFileContents(`${serverFolder}${reportJobFileName}`, reportJobString, clientFileOptions)
              .then(() => {
                //                console.log(`------ writing ${serverFolder}${alarmJobFileName}`);
                webdavClient.putFileContents(`${serverFolder}${alarmJobFileName}`, alarmJobString, clientFileOptions)
                  .then(() => {
                    // write the connection command file to the server nad delete any old response
                    // console.log('------ deleteServerFilesWithBaseName');
                    deleteServerFilesWithBaseName(serverIndex, sessionBaseFileName, () => {
                      // console.log(`------ writing ${serverFolder}${sessionReqFileName}`);
                      webdavClient.putFileContents(`${serverFolder}${sessionReqFileName}`, connectReqString, clientFileOptions)
                        .then(() => {
                          // console.log('----- writeInitFilesToServer COMPLETE');
                          alert.clear('server-write-error');
                          webdavClientStateArray[serverIndex] = CLIENT_WAIT_CONNECT_RESPONSE;
                          startPollingWebdavServer(serverIndex);
                        })
                        .catch((error) => {
                          // eslint-disable-next-line max-len
                          // console.log(`----- putFileContents error: sessionReqFileName = ${sessionReqFileName}, connectReqString = ${connectReqString}`);
                          alert.raise({ key: 'server-write-error', filename: `${serverFolder}${sessionReqFileName}`, errorMsg: error });
                        });
                    });
                  })
                  .catch((error) => {
                    // eslint-disable-next-line max-len
                    // console.log(`----- putFileContents error: alarmJobFileName = ${alarmJobFileName}, alarmJobString = ${alarmJobString}`);
                    alert.raise({ key: 'server-write-error', filename: `${serverFolder}${alarmJobFileName}`, errorMsg: error });
                  });
              })
              .catch((error) => {
                // eslint-disable-next-line max-len
                // console.log(`----- putFileContents error: reportJobFileName = ${reportJobFileName}, reportJobString = ${reportJobString}`);
                alert.raise({ key: 'server-write-error', filename: `${serverFolder}${reportJobFileName}`, errorMsg: error });
              });
          })
          .catch((error) => {
            // eslint-disable-next-line max-len
            // console.log(`----- putFileContents error: abortAlarmsFileName = ${abortAlarmsFileName}, abortAlarmsString = ${abortAlarmsString}`);
            alert.raise({ key: 'server-write-error', filename: `${serverFolder}${abortAlarmsFileName}`, errorMsg: error });
          });
      })
      .catch((error) => {
        // eslint-disable-next-line max-len
        // console.log(`----- putFileContents error: abortReportFileName = ${abortReportFileName}, abortReportString = ${abortReportString}`);
        alert.raise({ key: 'server-write-error', filename: `${serverFolder}${abortReportFileName}`, errorMsg: error });
      });

    // start the timer that times out if no date is received from the server
    resetWebdavClientTimeout(serverIndex);

    // start a timer to clear the connected status if the initialization takes too long
    webdavInitTimerArray[serverIndex] = setTimeout(() => {
      updateConnectionStatus(false);
    }, WEBDAV_INIT_TIMEOUT);

    // start wait for connection response
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  // client write of initialization files to the WebDAV server

  function writeAllInitFilesToServer() {
    let serverIndex = 0;

    // clear any timers
    webdavTimerArray.forEach((timer) => {
      if (timer) {
        clearInterval(timer);
      }
    });

    webdavInitTimerArray.forEach((timer) => {
      if (timer) {
        clearTimeout(timer);
      }
    });

    webdavClientWaitTimerArray.forEach((timer) => {
      if (timer) {
        clearTimeout(timer);
      }
    });

    webdavClientDelayTimerArray.forEach((timer) => {
      if (timer) {
        clearTimeout(timer);
      }
    });

    // initialize arrays
    webdavClientStateArray = [];
    webdavTimerArray = [];
    webdavInitTimerArray = [];
    webdavClientWaitTimerArray = [];
    webdavClientDelayTimerArray = [];
    for (serverIndex = 0; serverIndex < serverFolders.length; serverIndex += 1) {
      webdavClientStateArray.push(CLIENT_WAIT_CONNECT_RESPONSE);
      webdavTimerArray.push(null);
      webdavInitTimerArray.push(null);
      webdavClientWaitTimerArray.push(null);
      webdavClientDelayTimerArray.push(null);
    }


    // console.log(`----- serverFolders.length = ${serverFolders.length}`);
    for (serverIndex = 0; serverIndex < serverFolders.length; serverIndex += 1) {
      writeInitFilesToServer(serverIndex);
    }
  }


  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function open(callback) {
    let serverIndex = 0;

    ({ webdavUsername } = that.machine.settings.model);
    ({ webdavPassword } = that.machine.settings.model);

    filePollingTime = _.get(that.machine.settings.model, 'filePollingTime', 2) * 1000;
    if (filePollingTime < 1000) {
      filePollingTime = 1000;
    }

    sessionString = `000${_.get(that.machine.settings.model, 'sessionNumber', 0)}`.slice(-4);

    if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
      //      console.log('----- adding deliverEntireResultVariable');
      that.machine.variables.push(deliverEntireResultVariable);
      const timestampIndexVariables = _.get(that.machine.settings.model, 'timestampFields', '').split(',');
      timestampFieldIndex1 = '';
      timestampFieldIndex2 = '';
      if (timestampIndexVariables.length > 1) {
        // eslint-disable-next-line prefer-destructuring
        timestampFieldIndex1 = timestampIndexVariables[0];
        // eslint-disable-next-line prefer-destructuring
        timestampFieldIndex2 = timestampIndexVariables[1];
      } else if (timestampFieldIndex1 > 0) {
        // eslint-disable-next-line prefer-destructuring
        timestampFieldIndex1 = timestampIndexVariables[0];
      }

      UTCOffset = _.get(that.machine.settings.model, 'utcOffset', 0) * 60 * 60 * 1000;
    }

    // first, let's get the list of server folders and their associated machine names
    //    console.log('!!!!! setting up server folders and machine names');
    const serverMachineNameArray = that.machine.settings.model.serverMachineNameList.split(',');
    if (serverMachineNameArray.length < 1) {
      alert.raise({ key: 'invalid-serverMachineNameList' });
      callback(new Error('Euromap 63 Invalid Server / Machine Name list'));
      return;
    }
    serverFolders = [];
    machineNames = [];
    currentAlarmCodes = [];
    for (let index = 0; index < serverMachineNameArray.length; index += 1) {
      const serverMachineName = serverMachineNameArray[index].split(':');
      if (serverMachineName.length === 2) {
        serverFolders.push(serverMachineName[0]);
        machineNames.push(serverMachineName[1]);
        currentAlarmCodes.push([]);
      } else if (serverMachineName.length === 1) {
        serverFolders.push(serverMachineName[0]);
        machineNames.push(`${that.machine}-${serverMachineName[0]}`);
        currentAlarmCodes.push([]);
      } else {
        alert.raise({ key: 'invalid-serverMachineNameList' });
        callback(new Error('Euromap 63 Invalid Server / Machine Name list'));
        return;
      }
    }
    //    console.log('!!!!! serverFolders = ' + JSON.stringify(serverFolders));
    //    console.log('!!!!! machineNames = ' + JSON.stringify(machineNames));

    // from the variable array, form a new array of 'read' specific variables
    // i.e. filter out 'write' only variables and alarm code variables
    variableReadArray = [];
    that.machine.variables.forEach((variable) => {
      // ignore alarm code variables
      if ((!_.get(variable, 'alarmCode', false)) && (_.get(variable, 'alarmCodeChanged', 'None') === 'None')) {
        // if read or write not set, assume read
        if (variable.name !== deliverEntireResultVariable.name) {
          // don't ask for the combined array variable
          if (!(variable.access === 'write' || variable.access === 'read')) {
            const variableWithAccess = variable;
            variableWithAccess.access = 'read';
            variableReadArray.push(variableWithAccess);
          } else if (variable.access === 'read') {
            variableReadArray.push(variable);
          }
        }
      }
    });

    // console.log(`----- variableReadArray = ${JSON.stringify(variableReadArray)}`);

    // assume no alarm codes to start
    for (serverIndex = 0; serverIndex < serverFolders.length; serverIndex += 1) {
      currentAlarmCodes[serverIndex] = [];
    }

    // build the request strings
    buildFileStrings();

    // WebDAV client mode
    // create a client if necessary
    // console.log('------ starting webdav');
    if (!webdavClient) {
      // add http prefix if required
      let serverUrl = that.machine.settings.model.webdavUrl;
      const ipAddressRegEx = new RegExp(/^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/);
      // check if we have a x.x.x.x ip address for our serverUrl
      if (ipAddressRegEx.test(serverUrl)) {
        if (_.get(that.machine.settings.model, 'webdavUrlHTTPS', false)) {
          serverUrl = `https://${serverUrl}`;
        } else {
          serverUrl = `http://${serverUrl}`;
        }
      }
      console.log(`----- serverUrl = ${serverUrl}`);
      webdavClient = webdav(serverUrl, webdavUsername, webdavPassword);
    }

    // calculate the time after which the server is reinitialized if no data is received
    if (that.machine.settings.model.cyclicType === 'time') {
      webdavClientNoDataTimeout = MAX_NO_DATA_CYCLIC_TIME_FACTOR * 1000
       * that.machine.settings.model.cyclicTime;
      if (webdavClientNoDataTimeout > MAX_NO_DATA_TIME) {
        webdavClientNoDataTimeout = MAX_NO_DATA_TIME;
      }
      if (webdavClientNoDataTimeout < MIN_NO_DATA_TIME) {
        webdavClientNoDataTimeout = MIN_NO_DATA_TIME;
      }
    } else {
      webdavClientNoDataTimeout = MAX_NO_DATA_TIME;
    }

    // make sure we continue initialization after doing aborts
    webdavClientShuttingDown = false;

    // write initialization files to the WebDAV server
    writeAllInitFilesToServer();

    // // start the server polling timer
    // for (serverIndex = 0; serverIndex < serverFolders.length; serverIndex += 1) {
    //   startPollingWebdavServer(serverIndex);
    // }

    callback(null);
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function clearAlertsAndStop(callback) {
    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }

      log.info('Stopped');

      callback(null);
    });
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function stopWebdavTimers() {
    let serverIndex = 0;

    // stop polling
    for (serverIndex = 0; serverIndex < serverFolders.length; serverIndex += 1) {
      stopPollingWebdavServer(serverIndex);
    }

    // stop timer that makes sure still connected to server
    for (serverIndex = 0; serverIndex < serverFolders.length; serverIndex += 1) {
      if (webdavClientWaitTimerArray[serverIndex]) {
        clearTimeout(webdavClientWaitTimerArray[serverIndex]);
        webdavClientWaitTimerArray[serverIndex] = null;
      }
    }

    // stop the time used to delay command processing
    for (serverIndex = 0; serverIndex < serverFolders.length; serverIndex += 1) {
      if (webdavClientDelayTimerArray[serverIndex]) {
        clearTimeout(webdavClientDelayTimerArray[serverIndex]);
        webdavClientDelayTimerArray[serverIndex] = null;
      }
    }

    // stop the timer used to make sure identification  does bot take too long
    for (serverIndex = 0; serverIndex < serverFolders.length; serverIndex += 1) {
      if (webdavInitTimerArray[serverIndex]) {
        clearTimeout(webdavInitTimerArray[serverIndex]);
        webdavInitTimerArray[serverIndex] = null;
      }
    }
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

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

    open((err) => {
      if (err) {
        return done(err);
      }
      initializeFileObjects();

      log.info('Started');
      return done(null);
    });

    return undefined;
  };

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function chackAllStatesForAbort() {
    for (let serverIndex = 0; serverIndex < serverFolders.length; serverIndex += 1) {
      if (webdavClientStateArray[serverIndex] !== CLIENT_ABORT_COMPLETE) {
        return false;
      }
    }
    return true;
  }


  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  this.stop = function stop(done) {
    let serverIndex = 0;

    updateConnectionStatus(false);

    if (connectionStatusTimer) {
      clearTimeout(connectionStatusTimer);
      connectionStatusTimer = null;
    }

    if (webdavClient) { // if in WebDAV client mode
      // write the abort report request files to let the client know to stop sending reports
      webdavClientShuttingDown = true;
      serverIndex = 0;
      async.whilst(
        () => (serverIndex < serverFolders.length),
        (callback) => {
          deleteServerFilesWithBaseName(serverIndex, sessionBaseFileName, () => {
            const serverFolder = `${serverFolders[serverIndex]}/`;
            webdavClient.putFileContents(`${serverFolder}${abortReportFileName}`, abortReportString, clientFileOptions)
              .then(() => {
                // wait for the report abort to complete and then abort the alarms
                webdavClientStateArray[serverIndex] = CLIENT_WAIT_ABORT_REPORT_RESPONSE;
                webdavClient.putFileContents(`${serverFolder}${sessionReqFileName}`, abortReportReqString, clientFileOptions)
                  .then(() => {
                    serverIndex += 1;
                    callback(null);
                  })
                  .catch(() => {
                    serverIndex += 1;
                    callback(null);
                  });
              })
              .catch(() => {
                serverIndex += 1;
                callback(null);
              });
          });
        },
        (err, n) => {
          if (err) {
            console.log(`webdav client shutdown: err = ${err}, n = ${n}`);
          }

          // wait for abort alarm request to complete
          let checkCount = 0;

          const waitAbortTimer = setInterval(() => {
            const abortCompleteFlag = chackAllStatesForAbort();
            if ((abortCompleteFlag) || (checkCount >= CLIENT_ABORT_COMPLETE_MAX_CHECKS)) {
              console.log('------abort not complete');
              clearInterval(waitAbortTimer);
              webdavClient = null;
              stopWebdavTimers();
              clearAlertsAndStop(done);
            }
            checkCount += 1;
          }, CLIENT_ABORT_COMPLETE_CHECK_TIME);
        },
      );
    } else {
      clearAlertsAndStop(done);
    }
  };

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop((err) => {
      if (err) return done(err);
      that.start(that.dataCb, that.configUpdateCb, startErr => done(startErr));
      return undefined;
    });
  };

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  this.updateModel = function updateModel(newModel, done) {
    log.debug('Updating');
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

//-------------------------------------------------------------------------
//-------------------------------------------------------------------------
//-------------------------------------------------------------------------

module.exports = {
  hpl: hplEuromap63Multiclient,
  defaults,
  schema,
};
