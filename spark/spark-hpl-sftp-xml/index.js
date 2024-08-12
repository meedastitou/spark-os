/* jshint esversion: 6 */
/* eslint-disable max-len */
const async = require('async');
const _ = require('lodash');
const Client = require('ssh2-sftp-client');
const xml2jsParseString = require('xml2js').parseString;

const defaults = require('./defaults.json');
const schema = require('./schema.json');

const deliverEntireResultVariable = {
  name: 'CombinedResult',
  description: 'CombinedResult',
  format: 'char',
  array: true,
};

// constructor
const hplSftpXML = function hplSftpXML(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  alert.preLoad({
    'duplicate-folder-names': {
      msg: `${machine.info.name}: Duplicate Folder Names`,
      description: x => `Archive Folder must be different from read folder: ${x.errorMsg}`,
    },
    'database-error': {
      msg: `${machine.info.name}: Error Writing to Database`,
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
  });

  let sftpClient = null;
  let readTimer = null;
  let username = '';
  let password = '';
  let autoParsePinData = false;
  let readFrequencyMs = 5000;
  let initialDirectoryRead = true;

  let serverUrl = '';
  let serverPort = 0;
  let serverFolder = '';

  let checkArchiveFolder = false;
  let moveProcessedFilesToArchiveFolder = false;
  let useOutputProtocolForFileOperationPermission = false;
  let readArchiveFlag = false;
  let readArchiveTimer = null;
  let readArchiveFrequencyMs = 50000;
  let lastArchiveFileReadTimestamp = 0;
  let serverArchiveFolder = '';
  let serverProcessedFilesArchiveFolder = '';
  let initialArchiveDirectoryRead = true;
  let newArchiveXmlFilenames = [];
  let processedXmlFiles = [];
  let fileToBeProcessed = [];
  const MAX_AGE_PROCESSED_XML_FILE = 24 * 60 * 60 * 1000;

  let lastFileReadTimestamp = 0;
  let latestXmlFilename = '';
  let latestXmlFileTimestamp = 0;
  let newXmlFilenames = [];
  let newPermissionFilenames = [];

  let machineName = '';

  let combinedResultArray = [];

  let autoparseValueObjectCount = 0;
  const maxAutoparseValueObject = 20;

  let directoryReadTimeoutTimer = null;
  const directoryReadTimeoutMs = 60000; // wait 1 minute for directory list response
  let fileReadTimeoutTimer = null;
  const fileReadTimeoutMs = 120000; // wait 2 minutes for file read response
  const maxConnectTimeout = 30000; // allow a maximum of 30 seconds for the automatic connection retry
  let sftpConnectTimeoutTimer = null;
  const sftpConnectTimeoutMs = 5 * 60 * 1000; // wait 5 minutes on a connect timeout

  // let startMilliseconds;
  // let endMilliseconds;

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function updateDatabase(variable, value) {
    that.dataCb(that.machine, variable, value, (err, res) => {
      if (err) {
        alert.raise({ key: 'database-error', errorMsg: err.message });
      } else {
        alert.clear('database-error');
      }
      if (res) log.debug(res);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function clearAlertsAndStop(callback) {
    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }

      log.info('Stopped');

      callback(null);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function createSFTPClientAndConnect() {
    if (readTimer) {
      clearTimeout(readTimer);
      readTimer = null;
    }

    if (readArchiveTimer) {
      clearTimeout(readArchiveTimer);
      readArchiveTimer = null;
    }

    readArchiveFlag = false;
    processedXmlFiles = [];
    fileToBeProcessed = [];

    // console.log(`--------------- ${machineName}: creating sftp client`);
    sftpClient = new Client();
    // console.log(`--------------- ${machineName}: sftp client created`);

    if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
      that.machine.variables.push(deliverEntireResultVariable);
    }

    const connectOptions = {
      host: serverUrl,
      port: serverPort,
      username,
      password,
      maxTimeout: maxConnectTimeout,
    };
    // console.log(`--- ${machineName}: connectOptions = ${JSON.stringify(connectOptions)}`);

    if (sftpConnectTimeoutTimer) {
      clearTimeout(sftpConnectTimeoutTimer);
      sftpConnectTimeoutTimer = null;
    }
    // eslint-disable-next-line no-use-before-define
    sftpConnectTimeoutTimer = setTimeout(sftpConnectTimeout, sftpConnectTimeoutMs);

    sftpClient.connect(connectOptions).then(() => {
      // console.log(`----- ${machineName}: sftpClient connected`);

      if (sftpConnectTimeoutTimer) {
        clearTimeout(sftpConnectTimeoutTimer);
        sftpConnectTimeoutTimer = null;
      }

      // schedule subsequent reads
      if (checkArchiveFolder) {
        readArchiveFlag = true;
        // eslint-disable-next-line no-use-before-define
        readTimer = setImmediate(readTimerFuncOriginal);
      } else if (moveProcessedFilesToArchiveFolder) {
        // eslint-disable-next-line no-use-before-define
        readTimer = setImmediate(readTimerFuncWithFileMove);
      } else {
        // eslint-disable-next-line no-use-before-define
        readTimer = setImmediate(readTimerFuncOriginal);
      }
    }).catch((connectErr) => {
      if (connectErr) {
        log.error(`--- ${machineName}: sftpClient.connect: connectErr = ${connectErr}`);
      }
    });


    initialDirectoryRead = true;
    initialArchiveDirectoryRead = true;
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function directoryReadTimeout() {
    // if this timer triggers, we have not received a response for our sftp.list
    // directory read.  So close the sftp socket, the ssh2 communication and re-open.
    directoryReadTimeoutTimer = null;

    // console.log('!!!!!!!! directory read timeout - delete and re-create sftp client !!!!!!!');

    sftpClient.end();

    createSFTPClientAndConnect();

    // open((err) => {
    //   if (err) {
    //     log.info('error in restarting connections after timeout.  err = ' + err);
    //     console.log('!!!!!!!! error in restarting connections after timeout.  err = ' + err);
    //   } else {
    //     log.info('Restarted connections after directory list timeout');
    //     console.log('!!!!!!!! detected and fixed directory read timeout !!!!!!!');
    //   }
    // });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function fileReadTimeout() {
    // if this timer triggers, we have not received a response for our sftp.list
    // directory read.  So close the sftp socket, the ssh2 communication and re-open.
    fileReadTimeoutTimer = null;

    // console.log('!!!!!!!! file read timeout - delete and re-create sftp client !!!!!!!');

    sftpClient.end();

    createSFTPClientAndConnect();

    // open((err) => {
    //   if (err) {
    //     log.info('error in restarting connections after file read timeout.  err = ' + err);
    //     console.log('!!!!!!!! error in restarting connections after file read timeout.  err = ' + err);
    //   } else {
    //     log.info('Restarted connections after file read timeout');
    //     console.log('!!!!!!!! detected and fixed file read timeout !!!!!!!');
    //   }
    // });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function sftpConnectTimeout() {
    // if this timer triggers, we have not received a response for our sftp.list
    // directory read.  So close the sftp socket, the ssh2 communication and re-open.
    sftpConnectTimeoutTimer = null;

    // console.log('!!!!!!!! sftp connect timeout - delete and re-create sftp client !!!!!!!');

    sftpClient.end();

    createSFTPClientAndConnect();

    // open((err) => {
    //   if (err) {
    //     log.info('error in restarting connections after file read timeout.  err = ' + err);
    //     console.log('!!!!!!!! error in restarting connections after file read timeout.  err = ' + err);
    //   } else {
    //     log.info('Restarted connections after file read timeout');
    //     console.log('!!!!!!!! detected and fixed file read timeout !!!!!!!');
    //   }
    // });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function findLatestXmlFile(callback) {
    // first, let's get the main year directories in the base folder

    latestXmlFilename = '';
    lastFileReadTimestamp = 0;

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    // console.log(`----- ${machineName}: checking folder: ${serverFolder}`);
    sftpClient.list(serverFolder).then((directoryList) => {
      //      console.log('----- ' + machineName + ' directoryList: ' + JSON.stringify(directoryList));
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on directory read'));
        return;
      }

      let fileIndex = 0;
      for (fileIndex = 0; fileIndex < directoryList.length; fileIndex += 1) {
        if (directoryList[fileIndex].type === '-') {
          if (directoryList[fileIndex].name.endsWith('.xml')) {
            if (directoryList[fileIndex].modifyTime > lastFileReadTimestamp) {
              latestXmlFilename = directoryList[fileIndex].name;
              latestXmlFileTimestamp = directoryList[fileIndex].modifyTime;
              lastFileReadTimestamp = latestXmlFileTimestamp;
            }
          }
        }
      }
      callback(null);
    }).catch((catchErr) => {
      if (catchErr) {
        log.error(`--- ${machineName}: sftpClient.list: catchErr = ${catchErr}`);
      }
      callback(catchErr);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function findLatestArchiveXmlFile(callback) {
    // first, let's get the main year directories in the base folder

    // let latestArchiveXmlFilename = '';
    lastArchiveFileReadTimestamp = 0;

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    // console.log(`----- ${machineName}: checking folder: ${serverArchiveFolder}`);
    sftpClient.list(serverArchiveFolder).then((directoryList) => {
      //      console.log('----- ' + machineName + ' directoryList: ' + JSON.stringify(directoryList));
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on directory read'));
        return;
      }

      let fileIndex = 0;
      for (fileIndex = 0; fileIndex < directoryList.length; fileIndex += 1) {
        if (directoryList[fileIndex].type === '-') {
          if (directoryList[fileIndex].name.endsWith('.xml')) {
            if (directoryList[fileIndex].modifyTime > lastArchiveFileReadTimestamp) {
              // latestArchiveXmlFilename = serverArchiveFolder + directoryList[fileIndex].name;
              lastArchiveFileReadTimestamp = directoryList[fileIndex].modifyTime;
            }
          }
        }
      }
      callback(null);
    }).catch((catchErr) => {
      if (catchErr) {
        log.error(`--- ${machineName}: sftpClient.list: catchErr = ${catchErr}`);
      }
      callback(catchErr);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function getNewXMLFiles(callback) {
    newXmlFilenames = [];
    newPermissionFilenames = [];

    // console.log(`----- ${machineName}: checking folder: ${serverFolder}`);

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    sftpClient.list(serverFolder).then((directoryList) => {
      // console.log('----- ' + machineName + ' directoryList: ' + JSON.stringify(directoryList));
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on directory read'));
        return;
      }

      let fileIndex = 0;
      for (fileIndex = 0; fileIndex < directoryList.length; fileIndex += 1) {
        if (directoryList[fileIndex].type === '-') {
          if (directoryList[fileIndex].name.endsWith('.xml')) {
            if (directoryList[fileIndex].modifyTime > lastFileReadTimestamp) {
              newXmlFilenames.push({
                name: directoryList[fileIndex].name,
                modifyTime: directoryList[fileIndex].modifyTime,
              });
            }
          } else if (directoryList[fileIndex].name.endsWith('.ok')) {
            newPermissionFilenames.push(directoryList[fileIndex].name);
          }
        }
      }

      callback(null);
    }).catch((catchErr) => {
      if (catchErr) {
        log.error(`--- ${machineName}: sftpClient.list: catchErr = ${catchErr}`);
      }
      callback(catchErr);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function getNewArchiveXMLFiles(callback) {
    // first, let's get the main year directories in the base folder

    newArchiveXmlFilenames = [];

    // console.log(`----- ${machineName}: checking ARCHIVE folder: ${serverArchiveFolder}`);

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    sftpClient.list(serverArchiveFolder).then((directoryList) => {
      //      console.log('----- ' + machineName + ' directoryList: ' + JSON.stringify(directoryList));
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on directory read'));
        return;
      }

      let fileIndex = 0;
      for (fileIndex = 0; fileIndex < directoryList.length; fileIndex += 1) {
        if (directoryList[fileIndex].type === '-') {
          if (directoryList[fileIndex].name.endsWith('.xml')) {
            if (directoryList[fileIndex].modifyTime > lastArchiveFileReadTimestamp) {
              newArchiveXmlFilenames.push({
                name: directoryList[fileIndex].name,
                modifyTime: directoryList[fileIndex].modifyTime,
              });
            }
          }
        }
      }

      callback(null);
    }).catch((catchErr) => {
      if (catchErr) {
        log.error(`--- ${machineName}: sftpClient.list catchErrr = ${catchErr}`);
      }
      callback(catchErr);
    });
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function getType(p) {
    if (Array.isArray(p)) return 'array';
    if (typeof p === 'string') return 'string';
    if (p != null && typeof p === 'object') return 'object';
    return 'other';
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function addVariableToCombinedResultsArray(variableName, variableValue) {
    const newData = {};
    let filteredVariableName = variableName;
    const autoParseVariableNamePrefixFilter = _.get(that.machine.settings.model, 'autoParseVariableNamePrefixFilter', '');

    if (autoParseVariableNamePrefixFilter !== '') {
      if (filteredVariableName.startsWith(autoParseVariableNamePrefixFilter)) {
        filteredVariableName = filteredVariableName.slice(autoParseVariableNamePrefixFilter.length);
      }
    }

    newData[filteredVariableName] = variableValue;

    if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
      combinedResultArray.push(newData);
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function autoparseValueObject(object, variableName) {
    if (_.has(object, '$')) {
      if (_.has(object.$, 'Name')) {
        if ((_.get(object.$, 'Value', '') !== '') || (_.get(object.$, 'Unit', '') !== '')) {
          addVariableToCombinedResultsArray(`${variableName}.${object.$.Name}`, object.$.Value);
          // let newVariableName = variableName + '.' + object['$'].Name;
          // let newData = {};
          // newData[newVariableName] = object['$'].Value;
          // combinedResultArray.push(newData);
        }
      }
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function autoparseFeatureObject(object, variableName) {
    // console.log('--autoparseFeatureObject');
    // console.log('--object = ' + JSON.stringify(object));
    let newVariableName;

    if (_.has(object, '$')) {
      if (_.has(object.$, 'Name')) {
        newVariableName = `${variableName}.${object.$.Name}`;
        if (_.has(object, 'Status')) {
          const statusObject = object.Status;
          if (Array.isArray(statusObject)) {
            if (_.has(statusObject[0], 'Inspection')) {
              const inspectionObject = statusObject[0].Inspection;
              if (_.has(inspectionObject[0].$, 'IsInspectionFailed')) {
                addVariableToCombinedResultsArray(`${newVariableName}.IsInspectionFailed`,
                  inspectionObject[0].$.IsInspectionFailed);
                // let newData = {};
                // newData[newVariableName + '.IsInspectionFailed'] = inspectionObject[0]['$'].IsInspectionFailed;
                // combinedResultArray.push(newData);
              }
            }
            if (_.has(statusObject[0], 'Classification')) {
              const classificationObject = statusObject[0].Classification;
              if (_.has(classificationObject[0].$, 'IsClassificationFailed')) {
                addVariableToCombinedResultsArray(`${newVariableName}.IsClassificationFailed`,
                  classificationObject[0].$.IsClassificationFailed);
                // let newData = {};
                // newData[newVariableName + '.IsClassificationFailed'] = classificationObject[0]['$'].IsClassificationFailed;
                // combinedResultArray.push(newData);
              }
            }
          }
        }

        if (_.has(object, 'Values')) {
          if (Array.isArray(object.Values)) {
            if (_.has(object.Values[0], 'Value')) {
              const valueObject = object.Values[0].Value;
              if (Array.isArray(valueObject)) {
                for (let index = 0; index < valueObject.length; index += 1) {
                  // comment out this limit for reporting the entire file
                  autoparseValueObject(valueObject[index], newVariableName);
                }
              }
            }
          }
        }
      }
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function autoparseObject(object, variableName, onBoardBranch, level) {
    let localOnBoardbranch = onBoardBranch;
    if (getType(object) === 'string') {
      return;
    }

    const keys = Object.keys(object);
    //  console.log('--- keys = ' + JSON.stringify(keys));
    // const values = Object.values(object);
    //  console.log('-------- values = ' + JSON.stringify(values));
    if (keys.length > 0) {
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const newObject = object[keys[keyIndex]];
        let newVariableName;
        if (keys[keyIndex] === 'Object') {
          if (Array.isArray(newObject)) {
            for (let index = 0; index < newObject.length; index += 1) {
              if (_.has(newObject[index], '$')) {
                if (_.has(newObject[index].$, 'Name')) {
                  const objectClass = _.get(newObject[index].$, 'Class', '');
                  if (objectClass === 'Board') {
                    localOnBoardbranch = true;
                  }
                  newVariableName = `${variableName}.${newObject[index].$.Name}`;
                  // console.log('--------calling autoparseObject    newVariableName = ' + newVariableName + '   level = ' + (level + 1));
                  autoparseObject(newObject[index], newVariableName, localOnBoardbranch, level + 1);
                }
              }
            }
          }
        } else if (keys[keyIndex] === 'Features') {
          if (localOnBoardbranch === false) {
            // console.log('----- Found Features but not on Board branch');
          } else if (Array.isArray(newObject)) {
            if (_.has(newObject[0], 'Feature')) {
              const featureObject = newObject[0].Feature;
              if (Array.isArray(featureObject)) {
                for (let index = 0; index < featureObject.length; index += 1) {
                  // console.log('--------calling autoparseObject    newVariableName = ' + newVariableName + '   level = ' + (level + 1));
                  if (autoparseValueObjectCount < maxAutoparseValueObject) {
                    // uncomment the following line to limit the number of value object returned as variables.
                    // autoparseValueObjectCount += 1;
                    autoparseFeatureObject(featureObject[index], variableName);
                  }
                }
              }
            }
          }
        } else {
          if (variableName === '') {
            newVariableName = keys[keyIndex];
          } else {
            newVariableName = `${variableName}.${keys[keyIndex]}`;
          }
          if (Array.isArray(newObject)) {
            for (let index = 0; index < newObject.length; index += 1) {
              // console.log('--------calling autoparseObject    newVariableName = ' + newVariableName + '   level = ' + (level + 1));
              autoparseObject(newObject[index], newVariableName, localOnBoardbranch, level + 1);
            }
          } else {
            // console.log('--------calling autoparseObject    newVariableName = ' + newVariableName + '   level = ' + (level + 1));
            autoparseObject(newObject, newVariableName, localOnBoardbranch, level + 1);
          }
        }
      }
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function parseJSON(object, jsonParseString) {
    // console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> parseJSON: jsonParseString = ' + jsonParseString);
    //  console.log('>>> JSON object = ' + JSON.stringify(object));

    if (jsonParseString === '') {
      return object;
    }

    const doneFlag = false;
    let charIndex = 0;
    while (!doneFlag) {
      if (jsonParseString.charAt(charIndex) === '[') {
        const rootString = jsonParseString.slice(0, charIndex);
        const endBracketIndex = jsonParseString.indexOf(']');
        const bracketString = jsonParseString.slice(charIndex + 1, endBracketIndex);
        const remainingParseString = jsonParseString.slice(endBracketIndex + 2);
        if (bracketString === '') {
          return parseJSON(object[rootString][0], remainingParseString);
        }
        // console.log('object[rootString].length = ' + object[rootString].length);
        // console.log('bracketString = ' + bracketString);
        for (let objectIndex = 0; objectIndex < object[rootString].length; objectIndex += 1) {
          // console.log('object[rootString][objectIndex].$[Name] = ' + object[rootString][objectIndex].$['Name']);
          if (object[rootString][objectIndex].$.Name === bracketString) {
            // console.log('found name');
            return parseJSON(object[rootString][objectIndex], remainingParseString);
          }
        }
        return '';
      } if (jsonParseString.charAt(charIndex) === '.') {
        const rootString = jsonParseString.slice(0, charIndex);
        const remainingParseString = jsonParseString.slice(charIndex + 1);

        // console.log('>>>> length = ' + object[rootString].length);
        if (Array.isArray(object[rootString])) {
          // console.log('----------------- is Array');
          return parseJSON(object[rootString][0], remainingParseString);
        } if (object[rootString]) {
          // console.log('----------------- object[rootString] !== null');
          return parseJSON(object[rootString], remainingParseString);
        } if (object.$[rootString]) {
          // console.log('----------------- object[$][rootString] !== null');
          return object.$[rootString];
        }
        // console.log('----------------- return empty string');
        return '';
      } if (charIndex < jsonParseString.length) {
        charIndex += 1;
      } else if (object[jsonParseString]) {
        // console.log('----------------- end-of-parseString: object[jsonParseString] !== null');
        // console.log('----object[jsonParseString] = ' + object[jsonParseString]);
        return object[jsonParseString];
      } else if (object.$[jsonParseString]) {
        // console.log('----------------- end-of-parseString: object.$[jsonParseString] !== null');
        // console.log('----object.$[jsonParseString] = ' + object.$[jsonParseString]);
        return object.$[jsonParseString];
      } else {
        return '';
      }
    }

    return '';
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function checkForNoFileToDeleteErr(err) {
    const errorString = err.toString(err);

    if (errorString.includes('No such file')) {
      return true;
    }
    return false;
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function deletePermissionFile(completePermissionFilepath, callback) {
    sftpClient.delete(completePermissionFilepath, true).then(() => {
      // console.log(`--------------- ${machineName}: file deleted: ${completePermissionFilepath}`);
      callback(null);
    }).catch((deleteCatchErr) => {
      if (deleteCatchErr) {
        log.error(`--- ${machineName}: sftpClient.delete deleteCatchErr = ${deleteCatchErr}`);
      }
      callback(deleteCatchErr);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function moveProcessedFile(fileFolder, fileName, callback) {
    const completeFilepath = fileFolder + fileName;

    // handle the file move if that option is selected
    const completeOutboundFilepath = serverProcessedFilesArchiveFolder + fileName;

    // console.log(`---- completeOutboundFilepath = ${completeOutboundFilepath}`);

    sftpClient.delete(completeOutboundFilepath, true).then(() => {
      // console.log(`--------------- ${machineName}: file deleted: ${completeOutboundFilepath}`);
      sftpClient.rename(completeFilepath, completeOutboundFilepath).then(() => {
        // console.log(`--------------- ${machineName}: file moved from: ${completeFilepath} to: ${completeOutboundFilepath}`);
        if (useOutputProtocolForFileOperationPermission) {
          const completePermissionFilepath = completeFilepath.replace('.xml', '.ok');
          deletePermissionFile(completePermissionFilepath, callback);
        } else {
          callback(null);
        }
      }).catch((renameCatchErr) => {
        if (renameCatchErr) {
          log.error(`--- ${machineName}: sftpClient.rename renameCatchErr = ${renameCatchErr}`);
        }
        callback(renameCatchErr);
      });
    }).catch((deleteCatchErr) => {
      if (deleteCatchErr) {
        log.error(`--- ${machineName}: sftpClient.delete deleteCatchErr = ${deleteCatchErr}`);
      }
      if (checkForNoFileToDeleteErr(deleteCatchErr)) {
        // no file in the destination folder, so go ahead and move
        sftpClient.rename(completeFilepath, completeOutboundFilepath).then(() => {
          // console.log(`--------------- ${machineName}: file moved from: ${completeFilepath} to: ${completeOutboundFilepath}`);
          if (useOutputProtocolForFileOperationPermission) {
            const completePermissionFilepath = completeFilepath.replace('.xml', '.ok');
            deletePermissionFile(completePermissionFilepath, callback);
          } else {
            callback(null);
          }
        }).catch((renameCatchErr) => {
          if (renameCatchErr) {
            log.error(`--- ${machineName}: sftpClient.rename renameCatchErr = ${renameCatchErr}`);
          }
          callback(renameCatchErr);
        });
      } else {
        callback(deleteCatchErr);
      }
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readAndProcessFile(fileFolder, fileName, fileTimestamp, callback) {
    const completeFilepath = fileFolder + fileName;
    // console.log(`>>>>>>>>>>> ${machineName}: reading file: ${completeFilepath}`);

    if (fileReadTimeoutTimer) {
      clearTimeout(fileReadTimeoutTimer);
      fileReadTimeoutTimer = null;
    }
    fileReadTimeoutTimer = setTimeout(fileReadTimeout, fileReadTimeoutMs);

    sftpClient.get(completeFilepath).then((data) => {
      if (fileReadTimeoutTimer) {
        clearTimeout(fileReadTimeoutTimer);
        fileReadTimeoutTimer = null;
      } else {
        // console.log(`!!!!!!! ${machineName}: timeout on file read: ${completeFilepath}`);
        callback(new Error('timeout on file read'));
        return;
      }

      if (checkArchiveFolder) {
        // add this to our processed file list
        const processedFileJSON = {
          folder: fileFolder,
          name: fileName,
          timestamp: fileTimestamp,
        };
        processedXmlFiles.push(processedFileJSON);
      }

      // console.log(`>>>>>>>>>>> ${machineName}: file transferred into memory.  Buffer size = ${data.length}`);
      // console.log('>>>>>>>>>>> ' + machineName + ': first 100 bytes = ' + data.slice(0,99));

      // var bufferString = data.toString();
      // console.log('buffersString.length = ' + bufferString.length);
      // console.log(bufferString);

      xml2jsParseString(data, (err, result) => {
        if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
          combinedResultArray = [];
        }
        if (autoParsePinData) {
          autoparseValueObjectCount = 0;
          autoparseObject(result, '', false, 0);
        }

        // extract the variable values
        that.machine.variables.forEach((variable) => {
          // console.log('searching for match to var ( ' + variable.name + ') schema: ' + variable.schemaMapString);

          if (typeof variable.schemaMapString !== 'undefined') {
            const value = parseJSON(result, variable.schemaMapString);
            if (value !== null) {
              const newData = {};
              newData[variable.name] = value;
              combinedResultArray.push(newData);
            }
          }
        });

        // let combinedResult = {};
        // combinedResult.FileName = filename;
        // combinedResult.FileData = data.toString();
        if (_.get(that.machine.settings.model, 'includeFilenameInCombinedData', false)) {
          combinedResultArray.push({ FileName: fileName });
        }

        const UTCOffset = _.get(that.machine.settings.model, 'utcOffset', 0);

        const adjustedUTCTimestamp = fileTimestamp + (UTCOffset * 60 * 60 * 1000);
        const adjustedDate = new Date(adjustedUTCTimestamp);

        const timestampValue = adjustedDate.toISOString();
        // add the timestamp field to the combinedResultArray
        combinedResultArray.push({ timestamp: timestampValue });

        // console.log(`combinedResultArray.length = ${combinedResultArray.length}`);
        // console.log('combinedResultArray = ' + JSON.stringify(combinedResultArray));

        // console.log(`--------------- ${machineName}: updating database`);

        if ((!checkArchiveFolder) && (moveProcessedFilesToArchiveFolder) && (useOutputProtocolForFileOperationPermission)) {
          // we're asking the ouput protocol to write out permission file, so give it the info to do that.
          const permissionFilename = fileName.replace('.xml', '.ok');
          const outputProtocolPermissionFileObject = {
            url: serverUrl,
            port: serverPort,
            username,
            password,
            folder: fileFolder,
            filename: permissionFilename,
          };
          combinedResultArray.push({ outputProtocolPermissionFile: outputProtocolPermissionFileObject });
        }

        updateDatabase(deliverEntireResultVariable, combinedResultArray);

        // handle the file move if that option is selected
        if ((!checkArchiveFolder) && (moveProcessedFilesToArchiveFolder) && (!useOutputProtocolForFileOperationPermission)) {
          moveProcessedFile(fileFolder, fileName, callback);
        } else {
          callback(null);
        }
      });
    }).catch((catchErr) => {
      if (catchErr) {
        log.error(`--- ${machineName}: sftpClient.get catchErrr = ${catchErr}`);
      }
      callback(catchErr);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function getProcessedXmlFileIndexByName(filename) {
    for (let index = 0; index < processedXmlFiles.length; index += 1) {
      if (processedXmlFiles[index].name === filename) {
        return index;
      }
    }
    return -1;
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function clearProcessedXmlFiles() {
    const purgeFileDate = new Date(Date.now() - MAX_AGE_PROCESSED_XML_FILE);
    let index = 0;
    while (index < processedXmlFiles.length) {
      if (processedXmlFiles[index].timestamp < purgeFileDate) {
        processedXmlFiles.splice(index, 1);
      } else {
        index += 1;
      }
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readArchiveTimerFunc() {
    readArchiveFlag = true;
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readTimerFuncOriginal() {
    // console.log(`!!!! ${machineName}: timer: readTimerFuncOriginal`);
    // startMilliseconds = Date.now();

    // first, go through our list of processed files and remove any past their expiration
    // date - if we're using the archive methodology
    if (checkArchiveFolder) {
      clearProcessedXmlFiles();
    }

    // check if we have any files stacked up to be processed
    if (fileToBeProcessed.length > 0) {
      let doneFlag = false;
      let fileToProcess;
      let processedListIndex;
      // make sure we have a file to process - that has not already been processed
      while ((!doneFlag) && (fileToBeProcessed.length > 0)) {
        fileToProcess = fileToBeProcessed.shift();
        processedListIndex = getProcessedXmlFileIndexByName(fileToProcess.name);
        if (processedListIndex === -1) {
          doneFlag = true;
        }
      }
      if (doneFlag) {
        // console.log(`processing previously found file: ${fileToProcess.folder}${fileToProcess.name}`);
        // console.log(`fileToBeProcessed.length = ${fileToBeProcessed.length}`);
        readAndProcessFile(fileToProcess.folder, fileToProcess.name, fileToProcess.timestamp, (err) => {
          if (err) {
            log.error(`--- ${machineName}: readAndProcessFile: err = ${err}`);
          }

          // endMilliseconds = Date.now();
          // console.log(`--- ${machineName}: total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
          readTimer = setTimeout(readTimerFuncOriginal, readFrequencyMs);
        });
        return;
      }
    }

    if (readArchiveFlag) {
      readArchiveFlag = false;
      if (initialArchiveDirectoryRead) {
        initialArchiveDirectoryRead = false;
        findLatestArchiveXmlFile((err) => {
          if (err) {
            log.error(`--- ${machineName}: getNewArchiveXMLFiles: err = ${err}`);
          }

          // console.log(`----- ${machineName}: after list`);
          // endMilliseconds = Date.now();
          // console.log(`--- ${machineName}: elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
          // if (latestArchiveXmlFilename === '') {
          //   console.log(`--- ${machineName}: NO ARCHIVE XML FILES FOUND`);
          // } else {
          //   console.log(`--- ${machineName}: latestArchiveXmlFilename = ${serverArchiveFolder}${latestArchiveXmlFilename}`);
          // }

          // to ensure timing between file processing, make sure we don't come back in here until readFrequence has passed.
          readTimer = setImmediate(readTimerFuncOriginal);
          readArchiveTimer = setTimeout(readArchiveTimerFunc, readArchiveFrequencyMs);
        });
      } else {
        getNewArchiveXMLFiles((err) => {
          if (err) {
            log.error(`--- ${machineName}: getNewArchiveXMLFiles: err = ${err}`);
          }

          // console.log(`----- ${machineName}: after list`);
          // endMilliseconds = Date.now();

          let numberOfNewFiles = newArchiveXmlFilenames.length;
          if (numberOfNewFiles > 0) {
            // console.log(`--- ${machineName}: found ${numberOfNewFiles} new archive xml files`);

            // eslint-disable-next-line no-nested-ternary
            newArchiveXmlFilenames.sort((a, b) => ((a.modifyTime < b.modifyTime) ? -1
              : ((a.modifyTime === b.modifyTime) ? 0 : 1)));

            // newest file should now be at the end of the array.

            // console.log(`--- ${machineName}: newArchiveXmlFilenames = ${JSON.stringify(newArchiveXmlFilenames)}`);

            lastArchiveFileReadTimestamp = newArchiveXmlFilenames[numberOfNewFiles - 1].modifyTime;
            // console.log(`--- ${machineName}: new lastArchiveFileReadTimestamp: ${lastArchiveFileReadTimestamp}`);
            //
            // console.log(`processedXmlFiles = ${JSON.stringify(processedXmlFiles)}`);
            // console.log(`newArchiveXmlFilenames = ${JSON.stringify(newArchiveXmlFilenames)}`);

            let checkForDuplicateIndex = 0;
            while (checkForDuplicateIndex < numberOfNewFiles) {
              const proccessedListIndex = getProcessedXmlFileIndexByName(newArchiveXmlFilenames[checkForDuplicateIndex].name);
              if (proccessedListIndex !== -1) {
                // found a match, remove this element from both arrays.
                processedXmlFiles.splice(proccessedListIndex, 1);
                newArchiveXmlFilenames.splice(checkForDuplicateIndex, 1);
                numberOfNewFiles -= 1;
              } else {
                checkForDuplicateIndex += 1;
              }
            }

            // console.log(`--- ${machineName}: of the new files, ${numberOfNewFiles} were unprocessed`);
            // console.log(`--- ${machineName}: elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
            if (numberOfNewFiles > 0) {
              // console.log('!!!!!!!!!!!!! FOUND UNPROCESSED FILE IN ARCHIVE FOLDER !!!!!!!!!!!!!!!');

              // for report timing, only process a single entry per cycle

              // console.log(`--- ${machineName}: first newXmlFilename = ${serverArchiveFolder}${newArchiveXmlFilenames[0].name}`);

              readAndProcessFile(serverArchiveFolder, newArchiveXmlFilenames[0].name, lastArchiveFileReadTimestamp, (readErr) => {
                if (readErr) {
                  log.error(`--- ${machineName}: readAndProcessFile: readErr = ${readErr}`);
                }

                // endMilliseconds = Date.now();
                // console.log(`--- ${machineName}: total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
                if (numberOfNewFiles > 1) {
                  // console.log(`---adding ${numberOfNewFiles - 1} new files for later processing`);
                  for (let newFileIndex = 1; newFileIndex < numberOfNewFiles; newFileIndex += 1) {
                    const newFileJSON = {
                      folder: serverArchiveFolder,
                      name: newArchiveXmlFilenames[newFileIndex].name,
                      timestamp: newArchiveXmlFilenames[newFileIndex].modifyTime,
                    };
                    fileToBeProcessed.push(newFileJSON);
                  }
                }
                readTimer = setTimeout(readTimerFuncOriginal, readFrequencyMs);
                readArchiveTimer = setTimeout(readArchiveTimerFunc, readArchiveFrequencyMs);
              });
            } else {
              // endMilliseconds = Date.now();
              // console.log(`--- ${machineName}: NO NEW UNPROCESSED ARCHIVE XML FILES: total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
              readTimer = setTimeout(readTimerFuncOriginal, readFrequencyMs);
              readArchiveTimer = setTimeout(readArchiveTimerFunc, readArchiveFrequencyMs);
            }
          } else {
            // endMilliseconds = Date.now();
            // console.log(`--- ${machineName}: NO NEW ARCHIVE XML FILES: total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
            readTimer = setTimeout(readTimerFuncOriginal, readFrequencyMs);
            readArchiveTimer = setTimeout(readArchiveTimerFunc, readArchiveFrequencyMs);
          }
        });
      }
    } else if (initialDirectoryRead) {
      initialDirectoryRead = false;
      findLatestXmlFile((err) => {
        if (err) {
          log.error(`--- ${machineName}: findLatestXmlFile: err = ${err}`);
        }

        // console.log(`----- ${machineName}: after list`);
        // endMilliseconds = Date.now();
        // console.log(`--- ${machineName}: elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
        if (latestXmlFilename === '') {
          // console.log(`--- ${machineName}: NO XML FILES FOUND`);
          readTimer = setTimeout(readTimerFuncOriginal, readFrequencyMs);
        } else {
          processedXmlFiles = [];

          // console.log(`--- ${machineName}: latestXmlFilename = ${serverFolder}${latestXmlFilename}`);
          readAndProcessFile(serverFolder, latestXmlFilename, latestXmlFileTimestamp, (readErr) => {
            if (readErr) {
              log.error(`--- ${machineName}: readAndProcessFile: readErr = ${readErr}`);
            }
            // console.log(`----- ${machineName}: timer function exit`);
            // endMilliseconds = Date.now();
            // console.log(`--- ${machineName}: total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
            readTimer = setTimeout(readTimerFuncOriginal, readFrequencyMs);
          });
        }
      });
    } else {
      getNewXMLFiles((err) => {
        if (err) {
          log.error(`--- ${machineName}: getNewXMLFiles: err = ${err}`);
        }
        // console.log(`----- ${machineName}: after list`);
        // endMilliseconds = Date.now();
        const numberOfNewFiles = newXmlFilenames.length;
        // console.log(`--- ${machineName}: found ${numberOfNewFiles} new xml files`);
        // console.log(`--- ${machineName}: elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
        if (numberOfNewFiles > 0) {
          // eslint-disable-next-line no-nested-ternary
          newXmlFilenames.sort((a, b) => ((a.modifyTime < b.modifyTime) ? -1
            : ((a.modifyTime === b.modifyTime) ? 0 : 1)));

          // newest file should now be at the end of the array.
          // console.log(`--- ${machineName}: newXmlFilenames = ${JSON.stringify(newXmlFilenames)}`);

          lastFileReadTimestamp = newXmlFilenames[numberOfNewFiles - 1].modifyTime;
          // console.log(`--- ${machineName}: new lastFileReadTimestamp: ${lastFileReadTimestamp}`);

          // for report timing, only process a single entry per cycle
          // console.log('--- ' + machineName + ': first newXmlFilename = ' + serverFolder + newXmlFilenames[0].name);
          readAndProcessFile(serverFolder, newXmlFilenames[0].name, newXmlFilenames[0].modifyTime, (readErr) => {
            if (readErr) {
              log.error(`--- ${machineName}: readAndProcessFile: readErr = ${readErr}`);
            }

            // console.log(`----- ${machineName}: timer function exit`);
            // endMilliseconds = Date.now();
            // console.log(`--- ${machineName}: total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
            if (numberOfNewFiles > 1) {
              // console.log(`---adding ${numberOfNewFiles - 1} new files for later processing`);
              for (let newFileIndex = 1; newFileIndex < numberOfNewFiles; newFileIndex += 1) {
                const newFileJSON = {
                  folder: serverFolder,
                  name: newXmlFilenames[newFileIndex].name,
                  timestamp: newXmlFilenames[newFileIndex].modifyTime,
                };
                fileToBeProcessed.push(newFileJSON);
              }
            }
            readTimer = setTimeout(readTimerFuncOriginal, readFrequencyMs);
          });
        } else {
          // endMilliseconds = Date.now();
          // console.log(`--- ${machineName}: NO NEW XML FILES: total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
          readTimer = setTimeout(readTimerFuncOriginal, readFrequencyMs);
        }
      });
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function checkXmlFilesForPermissionFileMatch(permissionFilename) {
    // console.log(`--- found permission file: ${permissionFilename}`);

    const matchingXmlFilename = permissionFilename.replace('.ok', '.xml');

    // console.log(`--- checking for matching xml file: ${matchingXmlFilename}`);

    for (let index = 0; index < newXmlFilenames.length; index += 1) {
      if (newXmlFilenames[index].name === matchingXmlFilename) {
        // console.log(`--- found matching xml file: ${matchingXmlFilename}`);
        return index;
      }
    }

    return -1;
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function processNewXmlFiles() {
    const numberOfNewFiles = newXmlFilenames.length;
    // console.log(`--- ${machineName}: found ${numberOfNewFiles} xml files`);
    // console.log(`--- ${machineName}: elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
    if (numberOfNewFiles > 0) {
      // eslint-disable-next-line no-nested-ternary
      newXmlFilenames.sort((a, b) => ((a.modifyTime < b.modifyTime) ? -1
        : ((a.modifyTime === b.modifyTime) ? 0 : 1)));

      // newest file should now be at the end of the array.
      // console.log(`--- ${machineName}: newXmlFilenames = ${JSON.stringify(newXmlFilenames)}`);

      // for report timing, only process a single entry per cycle
      readAndProcessFile(serverFolder, newXmlFilenames[0].name, newXmlFilenames[0].modifyTime, (err) => {
        if (err) {
          log.error(`--- ${machineName}: processNewXmlFiles: readAndProcessFile: err = ${err}`);
        }
        // endMilliseconds = Date.now();
        // console.log(`--- ${machineName}: total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
        if (numberOfNewFiles > 1) {
          // console.log(`---adding ${numberOfNewFiles - 1} xml files for later processing`);
          for (let newFileIndex = 1; newFileIndex < numberOfNewFiles; newFileIndex += 1) {
            const newFileJSON = {
              folder: serverFolder,
              name: newXmlFilenames[newFileIndex].name,
              timestamp: newXmlFilenames[newFileIndex].modifyTime,
            };
            fileToBeProcessed.push(newFileJSON);
          }
        }
        // eslint-disable-next-line no-use-before-define
        readTimer = setTimeout(readTimerFuncWithFileMove, readFrequencyMs);
      });
    } else {
      // endMilliseconds = Date.now();
      // console.log(`--- ${machineName}: NO XML FILES: total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
      // eslint-disable-next-line no-use-before-define
      readTimer = setTimeout(readTimerFuncWithFileMove, readFrequencyMs);
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readTimerFuncWithFileMove() {
    // console.log(`!!!! ${machineName}: timer: readTimerFuncWithFileMove`);
    // startMilliseconds = Date.now();

    // check if we have any files stacked up to be processed
    if (fileToBeProcessed.length > 0) {
      const fileToProcess = fileToBeProcessed.shift();
      // console.log(`processing previously found file: ${fileToProcess.folder}${fileToProcess.name}`);
      readAndProcessFile(fileToProcess.folder,
        fileToProcess.name,
        fileToProcess.timestamp, (readErr) => {
          if (readErr) {
            log.error(`!!!!!! ${machineName}: findLatestXmlFile : readErr = ${readErr}`);
            return;
          }
          // endMilliseconds = Date.now();
          // console.log(`--- ${machineName}: total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
          readTimer = setTimeout(readTimerFuncWithFileMove, readFrequencyMs);
        });
      return;
    }

    // we want all the xml files in this directory, so set our later-than timestamp to 0
    lastFileReadTimestamp = 0;
    getNewXMLFiles((err) => {
      if (err) {
        log.error(`!!!!!! ${machineName}: getNewXMLFiles : err = ${err}`);
        return;
      }

      // console.log(`----- ${machineName}: after list`);
      // endMilliseconds = Date.now();

      // if we are using the file operation permissions from the output protocol,
      // let's see if any files can be moved now.
      if ((!checkArchiveFolder)
          && (moveProcessedFilesToArchiveFolder)
          && (useOutputProtocolForFileOperationPermission)
          && (newPermissionFilenames.length > 0)) {
        // console.log(`--- found ${newPermissionFilenames.length} permission files.`);
        let permissionFileIndex = 0;
        async.whilst(
          () => (permissionFileIndex < newPermissionFilenames.length),
          (callback2) => {
            const permissionFilename = newPermissionFilenames[permissionFileIndex];
            const matchingXmlFileIndex = checkXmlFilesForPermissionFileMatch(permissionFilename);
            if (matchingXmlFileIndex < 0) {
              // no matching xml file, so just delete the permission file
              const completeFilepath = serverFolder + permissionFilename;
              deletePermissionFile(completeFilepath, (deleteErr) => {
                if (deleteErr) {
                  log.error(`----- ${machineName}: deletePermissionFile deleteErr = ${deleteErr}`);
                }
                permissionFileIndex += 1;
                callback2(null);
              });
            } else {
              // console.log(`---- moving processed file: ${serverFolder}${newXmlFilenames[matchingXmlFileIndex].name}`);
              moveProcessedFile(serverFolder,
                newXmlFilenames[matchingXmlFileIndex].name,
                (moveErr) => {
                  if (moveErr) {
                    log.error(`----- ${machineName}: moveProcessedFile moveErr = ${moveErr}`);
                    // } else {
                    //   console.log(`----- ${machineName}: file moved: ${newXmlFilenames[matchingXmlFileIndex].name}`);
                  }
                  newXmlFilenames.splice(matchingXmlFileIndex, 1);
                  permissionFileIndex += 1;
                  callback2(null);
                });
            }
          },
          (whilstErr) => {
            if (whilstErr) {
              log.error(`--- permission file check: getNewXMLFiles whilstErr = ${whilstErr}`);
            }
            processNewXmlFiles();
          },
        );
      } else {
        processNewXmlFiles();
      }
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function open(callback) {
    // console.log(`--------------- ${machineName}: sftp open`);

    ({ username } = that.machine.settings.model);
    ({ password } = that.machine.settings.model);
    ({ autoParsePinData } = that.machine.settings.model);
    readFrequencyMs = that.machine.settings.model.readFrequency * 1000;
    readArchiveFrequencyMs = that.machine.settings.model.sftpArchiveCheckFrequency * 1000;
    ({ checkArchiveFolder } = that.machine.settings.model);
    ({ moveProcessedFilesToArchiveFolder } = that.machine.settings.model);
    ({ useOutputProtocolForFileOperationPermission } = that.machine.settings.model);

    serverUrl = that.machine.settings.model.sftpUrl;
    serverPort = that.machine.settings.model.sftpPort;
    serverFolder = that.machine.settings.model.sftpFolder;
    serverArchiveFolder = that.machine.settings.model.sftpArchiveFolder;
    serverProcessedFilesArchiveFolder = that.machine.settings.model.sftpProcessedFilesArchiveFolder;

    if (checkArchiveFolder) {
      // if we're reading an archive folder, we cannot also move our processed
      // file to the archive folder
      moveProcessedFilesToArchiveFolder = false;
      if (serverFolder === serverArchiveFolder) {
        alert.raise({ key: 'duplicate-folder-names', errorMsg: serverFolder });
        checkArchiveFolder = false;
      }
    } else if (moveProcessedFilesToArchiveFolder) {
      if (serverFolder === serverProcessedFilesArchiveFolder) {
        alert.raise({ key: 'duplicate-folder-names', errorMsg: serverFolder });
        moveProcessedFilesToArchiveFolder = false;
      }
    }

    createSFTPClientAndConnect();

    callback(null);
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

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

    machineName = that.machine.info.name;

    open((err) => {
      if (err) {
        return done(err);
      }

      log.info('Started');
      return done(null);
    });
    return undefined;
  };

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  this.stop = function stop(done) {
    updateConnectionStatus(false);

    if (readTimer) {
      clearTimeout(readTimer);
      readTimer = null;
    }

    if (readArchiveTimer) {
      clearTimeout(readArchiveTimer);
      readArchiveTimer = null;
    }

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }

    if (fileReadTimeoutTimer) {
      clearTimeout(fileReadTimeoutTimer);
      fileReadTimeoutTimer = null;
    }

    if (sftpConnectTimeoutTimer) {
      clearTimeout(sftpConnectTimeoutTimer);
      sftpConnectTimeoutTimer = null;
    }

    clearAlertsAndStop(done);
  };

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  //------------------------------------------------------------------------------

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop((err) => {
      if (err) return done(err);
      that.start(that.dataCb, that.configUpdateCb, startErr => done(startErr));
      return undefined;
    });
  };


  //------------------------------------------------------------------------------

  this.updateModel = function updateModel(newModel, done) {
    log.debug('Updating');
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

//------------------------------------------------------------------------------
//------------------------------------------------------------------------------
//------------------------------------------------------------------------------

module.exports = {
  hpl: hplSftpXML,
  defaults,
  schema,
};
