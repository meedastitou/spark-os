/* jshint esversion: 6 */
const _ = require('lodash');
const async = require('async');
const Ftpd = require('simple-ftpd');
let webdav = require('webdav');

const { Writable } = require('stream');
const { Readable } = require('stream');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

const LF = '\u000A';
const CR = '\u000D';
const MAX_LENGTH_RECEIVED_FILE = (10 * 1024);
const ALARM_DATE_POS = 1;
const ALARM_TIME_POS = 2;
const ALARM_SET_POS = 4;
const ALARM_CODE_POS = 5;
const CLIENT_POLL_TIME = 1000; // client polls for server file changes once every second
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
const FTP_CONNECT_TIMEOUT = 20 * 1000;
const CONNECTION_STATUS_TIMEOUT = 60 * 1000;
const WEBDAV_INIT_TIMEOUT = 2 * 60 * 1000;


//-------------------------------------------------------------------------
//-------------------------------------------------------------------------
//-------------------------------------------------------------------------

// constructor
const hplEuromap63 = function hplEuromap63(log, machine, model, conf, db, alert) {
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
      description: x => `A file could not be written to the WebDAV server. Error: ${x.errorMsg}`,
    },
    'server-read-error': {
      msg: 'Euromap 63: File Could Not Be Read from Server',
      description: x => `A file could not be read fromthe WebDAV server. Error: ${x.errorMsg}`,
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
  let serverConnectionMode = false;
  let ftpServer = null;
  const sockets = {};
  let destroyFtpServer = false;
  let webdavClient = null;
  let webdavTimer = null;
  let webdavClientState = 0;
  let webdavClientNoDataTimeout = MAX_NO_DATA_TIME;
  let webdavClientWaitTimer = null;
  let webdavClientDelayTimer = null;
  let webdavClientShuttingDown = false;
  let ftpNoReportTimeout = MAX_NO_DATA_TIME;
  let ftpWaitTimer = null;
  let ftpUsername;
  let ftpPassword;
  let connectionStatusTimer = null;
  let connectionStatusTimedOut = false;
  let webdavInitTimer = false;

  let receivingFileTimer = null;
  let receivingFileList = [];
  const alarmFileContentList = [];
  let variableReadArray = [];
  let variablesWriteObj = {};
  let currentAlarmCodes = [];
  let destroyFtpServerTimer = null;
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
  let setVariableLogFileName;
  let abortReportFileName;
  let abortAlarmsFileName;
  let abortReportReqString;
  let abortAlarmsReqString;
  let reportReqString;
  let alarmReqString;
  let setVariableReqString;
  let abortReportString;
  let abortAlarmsString;
  let reportJobString;
  let alarmJobString;

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

  function restartConnectionStatusTimer() {
    if (connectionStatusTimer) {
      clearTimeout(connectionStatusTimer);
    }
    if (connectionStatusTimedOut) {
      connectionStatusTimedOut = false;
      updateConnectionStatus(true);
    }
    connectionStatusTimer = setTimeout(() => {
      connectionStatusTimedOut = true;
      updateConnectionStatus(false);
    }, CONNECTION_STATUS_TIMEOUT);
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  function serverFileExists(directoryContents, fileName) {
    // return true if the file exists in the directory
    let iItem; const
      nItems = directoryContents.length;
    for (iItem = 0; iItem < nItems; iItem += 1) {
      if ((directoryContents[iItem].type === 'file') && (directoryContents[iItem].filename === fileName)) {
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
  function deleteServerFilesWithBaseName(baseFileName, deleteCB) {
    // get the current files on the server
    webdavClient
      .getDirectoryContents('/')
      .then((contents) => {
        // search the directory for all files with this base name and delete them
        async.forEach(contents, (item, callback) => {
          if (item.type === 'file') {
            const baseName = item.basename.replace(/\.[^/.]+$/, '');
            if (baseName === baseFileName) {
              webdavClient.deleteFile(item.filename)
                .then(() => {
                  callback(null);
                })
                .catch(() => {
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
  function initializeAlarmCodes() {
    // set all alarm codes to zero
    const { variables } = that.machine;
    for (let iVar = 0; iVar < variables.length; iVar += 1) {
      if (_.get(variables[iVar], 'alarmCode', false)) {
        if (_.get(variables[iVar], 'array', false)) {
          updateDatabase(variables[iVar], []);
        } else {
          updateDatabase(variables[iVar], 0);
        }
      }
    }
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function processReportData(reportData, callback) {
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
          updateDatabase(variableReadArray[i], varAsValue);
        } else {
          log.error('invalid response data for variable: ', variableReadArray[i].name);
        }
      }
    }

    return callback(null);
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function processAlarmData(alarmData, callback) {
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

    // set the value of all alarm code variables, using sorted list if alarm codes
    for (let iVar = 0; iVar < variables.length; iVar += 1) {
      // set any last alarm cdoe or alarm code array variables
      if (_.get(variables[iVar], 'alarmCode', false)) {
        if (_.get(variables[iVar], 'array')) {
          updateDatabase(variables[iVar], alarmCodesSorted);
        } else {
          updateDatabase(variables[iVar], lastAlarmCode);
        }
      } else if (_.has(variables[iVar], 'alarmCodeChanged')) {
        // set any alarm code activated or deactivated variables
        if (variables[iVar].alarmCodeChanged === 'Activated') {
          for (iAlarm = alarmCodesSorted.length - 1; iAlarm >= 0; iAlarm -= 1) {
            if (!currentAlarmCodes.includes(alarmCodesSorted[iAlarm])) {
              updateDatabase(variables[iVar], alarmCodesSorted[iAlarm]);
            }
          }
        } else if (variables[iVar].alarmCodeChanged === 'Deactivated') {
          for (iAlarm = 0; iAlarm < currentAlarmCodes.length; iAlarm += 1) {
            if (!alarmCodesSorted.includes(currentAlarmCodes[iAlarm])) {
              updateDatabase(variables[iVar], currentAlarmCodes[iAlarm]);
            }
          }
        }
      }
    }

    // save the alarm code so that we can see which ones are activated or deactivated
    currentAlarmCodes = alarmCodesSorted.slice();

    return callback(null);
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function resetWebdavClientTimeout() {
    if (webdavClientWaitTimer) {
      clearTimeout(webdavClientWaitTimer);
    }

    // eslint-disable-next-line no-use-before-define
    webdavClientWaitTimer = setTimeout(writeInitFilesToServer, webdavClientNoDataTimeout);
  }

  function startPollingWebdavServer() {
    // eslint-disable-next-line no-use-before-define
    webdavTimer = setInterval(pollWebdavServer, CLIENT_POLL_TIME);
  }

  function stopPollingWebdavServer() {
    if (webdavTimer) {
      clearInterval(webdavTimer);
      webdavTimer = null;
    }
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function pollWebdavServer() {
    // get the current files on the server
    webdavClient
      .getDirectoryContents('/')
      .then((contents) => {
        let iResp;

        // process the files based on the current state
        switch (webdavClientState) {
          // if connection response received, send report abort request
          case CLIENT_WAIT_CONNECT_RESPONSE:
            iResp = getIndexOfServerResponseFile(contents, sessionReqFileName);
            if (iResp !== -1) {
              stopPollingWebdavServer();
              webdavClientDelayTimer = setTimeout(() => {
                webdavClientDelayTimer = null;
                deleteServerFilesWithBaseName(sessionBaseFileName, () => {
                  webdavClient.putFileContents(`/${sessionReqFileName}`, abortReportReqString, clientFileOptions)
                    .then(() => {
                      alert.clear('server-write-error');
                    })
                    .catch((error) => {
                      alert.raise({ key: 'server-write-error', errorMsg: error });
                    });
                });
                startPollingWebdavServer();
                resetWebdavClientTimeout();
                webdavClientState = CLIENT_WAIT_ABORT_REPORT_RESPONSE;
              }, CLIENT_CMD_DELAY_TIME);
            }

            break;
            // if abort report response received, send report abort alarms request
          case CLIENT_WAIT_ABORT_REPORT_RESPONSE:
            iResp = getIndexOfServerResponseFile(contents, sessionReqFileName);
            if (iResp !== -1) {
              stopPollingWebdavServer();
              webdavClientDelayTimer = setTimeout(() => {
                webdavClientDelayTimer = null;
                deleteServerFilesWithBaseName(sessionBaseFileName, () => {
                  webdavClient.putFileContents(`/${sessionReqFileName}`, abortAlarmsReqString, clientFileOptions)
                    .then(() => {
                      alert.clear('server-write-error');
                    })
                    .catch((error) => {
                      alert.raise({ key: 'server-write-error', errorMsg: error });
                    });
                });
                startPollingWebdavServer();
                resetWebdavClientTimeout();
                webdavClientState = CLIENT_WAIT_ABORT_ALARMS_RESPONSE;
              }, CLIENT_CMD_DELAY_TIME);
            }

            break;
            // if abort alarms response received, send report init request if any read variables
          case CLIENT_WAIT_ABORT_ALARMS_RESPONSE:
            iResp = getIndexOfServerResponseFile(contents, sessionReqFileName);
            if (iResp !== -1) {
              // if shutting down, just note that the aborts are complete
              if (webdavClientShuttingDown) {
                webdavClientState = CLIENT_ABORT_COMPLETE;
              } else {
                stopPollingWebdavServer();
                webdavClientDelayTimer = setTimeout(() => {
                  webdavClientDelayTimer = null;
                  deleteServerFilesWithBaseName(sessionBaseFileName, () => {
                    // send report initialization only if some read variables
                    if (variableReadArray.length !== 0) {
                      webdavClient.putFileContents(`/${sessionReqFileName}`, reportReqString, clientFileOptions)
                        .then(() => {
                          alert.clear('server-write-error');
                        })
                        .catch((error) => {
                          alert.raise({ key: 'server-write-error', errorMsg: error });
                        });
                    } else {
                      // if no read variables, send alarm initialization request instead
                      webdavClient.putFileContents(`/${sessionReqFileName}`, alarmReqString, clientFileOptions)
                        .then(() => {
                          alert.clear('server-write-error');
                        })
                        .catch((error) => {
                          alert.raise({ key: 'server-write-error', errorMsg: error });
                        });
                    }
                  });
                  startPollingWebdavServer();
                  resetWebdavClientTimeout();
                  webdavClientState = variableReadArray.length !== 0
                    ? CLIENT_WAIT_REPORT_INIT_RESPONSE : CLIENT_WAIT_ALARM_INIT_RESPONSE;
                }, CLIENT_CMD_DELAY_TIME);
              }
            }

            break;
            // if report initialization response received, send alarm initialization request
          case CLIENT_WAIT_REPORT_INIT_RESPONSE:
            iResp = getIndexOfServerResponseFile(contents, sessionReqFileName);
            if (iResp !== -1) {
              stopPollingWebdavServer();
              webdavClientDelayTimer = setTimeout(() => {
                webdavClientDelayTimer = null;
                deleteServerFilesWithBaseName(sessionBaseFileName, () => {
                  webdavClient.putFileContents(`/${sessionReqFileName}`, alarmReqString, clientFileOptions)
                    .then(() => {
                      alert.clear('server-write-error');
                    })
                    .catch((error) => {
                      alert.raise({ key: 'server-write-error', errorMsg: error });
                    });
                });
                startPollingWebdavServer();
                resetWebdavClientTimeout();
                webdavClientState = CLIENT_WAIT_ALARM_INIT_RESPONSE;
              }, CLIENT_CMD_DELAY_TIME);
            }

            break;
            // if alarm initialization response received, begin waiting for report and alarm data
          case CLIENT_WAIT_ALARM_INIT_RESPONSE:
            iResp = getIndexOfServerResponseFile(contents, sessionReqFileName);
            if (iResp !== -1) {
              resetWebdavClientTimeout();
              webdavClientState = CLIENT_WAIT_DATA;

              // clear the timeer that tells whether initialization takes too long
              if (webdavInitTimer) {
                clearTimeout(webdavInitTimer);
                webdavInitTimer -= null;
              }

              // set the connection status to true
              updateConnectionStatus(true);

              // set all alarm codes to zero
              initializeAlarmCodes();
            }

            break;
            // if  waiting for report and alarm data
          case CLIENT_WAIT_DATA:
            // if a report data file exists, process it
            if (serverFileExists(contents, `/${reportDatFileName}`)) {
              webdavClient
                .getFileContents(`/${reportDatFileName}`, 'text')
                .then((text) => {
                  alert.clear('server-read-error');
                  processReportData(text.toString(), () => {
                    deleteServerFile(`/${reportDatFileName}`);
                  });
                })
                .catch((error) => {
                  alert.raise({ key: 'server-read-error', errorMsg: error });
                });

              resetWebdavClientTimeout();
            }

            // if an alarm data file exists, process it
            if (serverFileExists(contents, `/${alarmDatFileName}`)) {
              webdavClient
                .getFileContents(`/${alarmDatFileName}`, 'text')
                .then((text) => {
                  alert.clear('server-read-error');
                  processAlarmData(text.toString(), () => {
                    deleteServerFile(`/${alarmDatFileName}`);
                  });
                })
                .catch((error) => {
                  alert.raise({ key: 'server-read-error', errorMsg: error });
                });

              resetWebdavClientTimeout();
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
    receivingFileList = []; // clear out the received file list, getting ready for the next writes.

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

  function resetFtpTimeout(ftpTimeout) {
    const timeout = ftpTimeout || ftpNoReportTimeout;
    if (ftpWaitTimer) {
      clearTimeout(ftpWaitTimer);
    }

    // eslint-disable-next-line no-use-before-define
    ftpWaitTimer = setTimeout(restartFTPServer, timeout);
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function clearReportDatFilename() {
    fileObjects[reportDatFileName] = ''; // clear string for next response.
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function handleResponseFile() {
    alert.clear('server-error');
    for (let fileListIndex = 0; fileListIndex < receivingFileList.length; fileListIndex += 1) {
      if (receivingFileList[fileListIndex] === reportDatFileName) {
        processReportData(fileObjects[reportDatFileName], () => {
          clearReportDatFilename();
          // fileObjects[reportDatFileName] = ''; // clear string for next response.

          resetFtpTimeout();
        });
      } else if (receivingFileList[fileListIndex] === alarmDatFileName) {
        if (alarmFileContentList.length > 0) {
          processAlarmData(alarmFileContentList.shift(), () => {
            resetFtpTimeout();
          });
        }
      } else {
        // remove the file extension, since may see RSP or TRP or something else
        const baseFileName = receivingFileList[fileListIndex].replace(/\.[^/.]+$/, '');
        if (baseFileName === sessionBaseFileName) {
          // get the session command identifier to tell which session response this is
          const sessionCmdID = parseInt(fileObjects[receivingFileList[fileListIndex]], 10);
          if (sessionCmdID === 0) {
            // if connection complete, now do report abort
            fileObjects[sessionReqFileName] = abortReportReqString;

            resetFtpTimeout();
          } else if (sessionCmdID === 1) {
            // if abort report complete, now do alarm abort
            fileObjects[sessionReqFileName] = abortAlarmsReqString;

            resetFtpTimeout();
          } else if (sessionCmdID === 2) {
            // if abort complete, now do report initialization
            // send report initialization only if some read variables
            if (variableReadArray.length !== 0) {
              fileObjects[sessionReqFileName] = reportReqString;
            } else {
              // if no read variables, send alarm initialization request instead
              fileObjects[sessionReqFileName] = alarmReqString;

              // set all alarm codes to zero
              initializeAlarmCodes();
            }

            // if abort command processed and need to destroy the FTP server, destroy it
            if (destroyFtpServer && ftpServer) {
              // make sure "just in case" destroy does not happen in close()
              if (destroyFtpServerTimer) {
                clearTimeout(destroyFtpServerTimer);
                destroyFtpServerTimer = null;
              }

              destroyFtpServer = false;
              ftpServer.destroy();
            }

            resetFtpTimeout();
          } else if (sessionCmdID === 3) {
            // if report initialization complete, now do alarm initialization
            fileObjects[sessionReqFileName] = alarmReqString;

            // set all alarm codes to zero
            initializeAlarmCodes();

            resetFtpTimeout();
          } // else if (sessionCmdID === 3) {
        }
      }
    } // for (let fileListIndex = 0; fileListIndex < receivingFileList.length; fileListIndex += 1) {

    receivingFileList = []; // clear out the received file list, getting ready for the next writes.
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  // private methods

  function allowWriteToFile(pathName, additionalStringLength) {
    let stringLength = 0;
    const basePathName = pathName.split('.')[0];
    if ((basePathName === sessionBaseFileName)
            || (pathName === reportDatFileName)
            || (pathName === reportLogFileName)
            || (pathName === alarmDatFileName)
            || (pathName === alarmLogFileName)
            || (pathName === setVariableLogFileName)) {
      if (_.has(fileObjects, pathName)) {
        stringLength = fileObjects[pathName].length;
      }
      // only allow this data to be appended if we stay below the max string length
      if ((stringLength + additionalStringLength) < MAX_LENGTH_RECEIVED_FILE) {
        return true;
      }
    }

    return false;
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function handleFtpSession(ftpSession) {
    const session = ftpSession;
    session.on('pass', (username, password, cb) => {
      log.debug('username: ', username, '    password: ', password);
      if (username === ftpUsername && password === ftpPassword) {
        session.readOnly = false;
        session.root = '';
        //                  authOk = true;
        alert.clear('invalid-credentials');
        cb(null, 'Welcome admin');
      } else {
        //                  authOk = false;
        alert.raise({ key: 'invalid-credentials' });
        cb({ message: 'Invalid username/password' });
      }
    });

    session.on('stat', (pathName, cb) => {
      //            if (authOk) {
      let localStats;
      const nowDate = Date.now();

      log.debug('stat: ', pathName);
      if (pathName.endsWith('/')) {
        localStats = {
          mode: 16893, nlink: 3, size: 1234, atime: nowDate, mtime: nowDate, ctime: nowDate,
        };
        alert.clear('invalid-pathname');
        cb(null, localStats);
      } else {
        const pathNameUpper = pathName.substr(1).toUpperCase();
        if (_.has(fileObjects, pathNameUpper)) {
          localStats = {
            mode: 33204,
            nlink: 1,
            size: fileObjects[pathNameUpper].length,
            atime: nowDate,
            mtime: nowDate,
            ctime: nowDate,
          };
          alert.clear('invalid-pathname');
          cb(null, localStats);
        } else {
          alert.raise({ key: 'invalid-pathname' });
          cb({ message: 'Invalid pathName' });
        }
      }
      //            } else {
      //                cb({message: 'Invalid username/password'});
      //            }
    });

    session.on('readdir', (pathName, cb) => {
      //            if (authOk) {
      restartConnectionStatusTimer();
      const fileList = [];
      Object.keys(fileObjects).forEach((key) => {
        if (fileObjects[key] !== '') {
          fileList.push(key);
        }
      });
      cb(null, fileList);
      //            } else {
      //                cb({message: 'Invalid username/password'});
      //            }
    });

    session.on('read', (pathName, offset, cb) => {
      const pathNameUpper = pathName.substr(1).toUpperCase();
      log.debug('read pathName: ', pathNameUpper);
      //            if (authOk) {
      const rs = Readable();
      if (_.has(fileObjects, pathNameUpper)) {
        // eslint-disable-next-line no-underscore-dangle
        rs._read = function read() {
          log.debug('file: ', pathNameUpper, `:\n${fileObjects[pathNameUpper]}`);
          rs.push(fileObjects[pathNameUpper]);
          rs.push(null);
        };
        alert.clear('invalid-filename');
        cb(null, rs);
      } else {
        // respond with an empty file - this seems to prevent a client error condition
        // eslint-disable-next-line no-underscore-dangle
        rs._read = function read() {
          rs.push(null);
        };
        // raise an alert only if the filename is not '.REQ'
        if (pathNameUpper !== '.REQ') {
          alert.raise({ key: 'invalid-filename' });
          cb({ message: 'Invalid filename' });
        } else {
          alert.clear('invalid-filename');
          cb(null, rs);
        }
      }
      //            } else {
      //                cb({message: 'Invalid username/password'});
      //            }
    });

    session.on('write', (pathName, offset, cb) => {
      const pathNameUpper = pathName.substr(1).toUpperCase();
      log.debug('write pathName: ', pathNameUpper);
      //            if (authOk) {
      log.debug('offset: ', offset);
      receivingFileList.push(pathNameUpper);
      let fileContents = '';
      const ws = Writable();
      // eslint-disable-next-line no-underscore-dangle
      ws._write = function write(chunk, enc, next) {
        log.debug('chunk.length: ', chunk.length);
        //                    log.debug('chunk:\n', chunk);
        log.debug('chunk(string):\n', chunk.toString('binary'));
        // only use the data if it's writing to an acceptable file.
        if (allowWriteToFile(pathNameUpper, chunk.toString().length) === true) {
          fileContents += chunk.toString('binary');
        }
        next();
      };

      if (receivingFileTimer) {
        clearTimeout(receivingFileTimer);
      }

      receivingFileTimer = setTimeout(() => {
        if (pathNameUpper === alarmDatFileName) {
          alarmFileContentList.push(fileContents);
        } else {
          fileObjects[pathNameUpper] = fileContents;
        }
        handleResponseFile();
      }, 500);

      cb(null, ws);
      //            } else {
      //                cb({message: 'Invalid username/password'});
      //            }
    });

    session.on('append', (pathName, offset, cb) => {
      const pathNameUpper = pathName.substr(1).toUpperCase();
      log.debug('append pathName: ', pathNameUpper);
      //            if (authOk) {
      log.debug('offset: ', offset);
      receivingFileList.push(pathNameUpper);
      let fileContents = '';
      const ws = Writable();
      // eslint-disable-next-line no-underscore-dangle
      ws._write = function write(chunk, enc, next) {
        log.debug('chunk.length: ', chunk.length);
        log.debug('chunk:\n', chunk);
        log.debug('chunk(string):\n', chunk.toString());
        // only use the data if it's writing to our report file.
        if (allowWriteToFile(pathNameUpper, chunk.toString().length) === true) {
          fileContents += chunk.toString();
        }
        next();
      };

      if (receivingFileTimer) {
        clearTimeout(receivingFileTimer);
      }

      receivingFileTimer = setTimeout(() => {
        if (pathNameUpper === alarmDatFileName) {
          alarmFileContentList.push(fileContents);
        } else {
          fileObjects[pathNameUpper] += fileContents;
        }
        handleResponseFile();
      }, 500);

      cb(null, ws);
      //            } else {
      //                cb({message: 'Invalid username/password'});
      //            }
    });

    // session.on('mkdir', fs.mkdir);

    session.on('unlink', (pathName, cb) => {
      const pathNameUpper = pathName.substr(1).toUpperCase();
      if (_.has(fileObjects, pathNameUpper)) {
        fileObjects[pathNameUpper] = '';
      }
      cb(null, 'deleted');
    });

    // session.on('rename', fs.rename);
    // session.on('remove', require('rimraf'));
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
    setVariableLogFileName = `SETVARIABLE${sessionString}.LOG`;
    abortReportFileName = `ABORTREPORT${sessionString}.JOB`;
    abortAlarmsFileName = `ABORTALARMS${sessionString}.JOB`;

    abortReportReqString = `00000001 EXECUTE "${abortReportFileName}";${CR}${LF}`;
    abortAlarmsReqString = `00000002 EXECUTE "${abortAlarmsFileName}";${CR}${LF}`;
    reportReqString = `00000003 EXECUTE "${reportJobFileName}";${CR}${LF}`;
    alarmReqString = `00000004 EXECUTE "${alarmJobFileName}";${CR}${LF}`;
    setVariableReqString = `00000005 EXECUTE "${setVariableJobFileName}";${CR}${LF}`;
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
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  // client write of initialization files to the WebDAV server

  function writeInitFilesToServer() {
    // delete and report if alarm data files
    deleteServerFile(`/${reportDatFileName}`);
    deleteServerFile(`/${alarmDatFileName}`);

    // write the abort, report and alarm job files
    webdavClient.putFileContents(`/${abortReportFileName}`, abortReportString, clientFileOptions)
      .then(() => {
        webdavClient.putFileContents(`/${abortAlarmsFileName}`, abortAlarmsString, clientFileOptions)
          .then(() => {
            webdavClient.putFileContents(`/${reportJobFileName}`, reportJobString, clientFileOptions)
              .then(() => {
                webdavClient.putFileContents(`/${alarmJobFileName}`, alarmJobString, clientFileOptions)
                  .then(() => {
                    // write the connection command file to the server nad delete any old response
                    deleteServerFilesWithBaseName(sessionBaseFileName, () => {
                      webdavClient.putFileContents(`/${sessionReqFileName}`, connectReqString, clientFileOptions)
                        .then(() => {
                          alert.clear('server-write-error');
                        })
                        .catch((error) => {
                          alert.raise({ key: 'server-write-error', errorMsg: error });
                        });
                    });
                  })
                  .catch((error) => {
                    alert.raise({ key: 'server-write-error', errorMsg: error });
                  });
              })
              .catch((error) => {
                alert.raise({ key: 'server-write-error', errorMsg: error });
              });
          })
          .catch((error) => {
            alert.raise({ key: 'server-write-error', errorMsg: error });
          });
      })
      .catch((error) => {
        alert.raise({ key: 'server-write-error', errorMsg: error });
      });

    // start the timer that times out if no date is received from the server
    resetWebdavClientTimeout();

    // start a timer to clear the connected status if the initialization takes too long
    webdavInitTimer = setTimeout(() => {
      updateConnectionStatus(false);
    }, WEBDAV_INIT_TIMEOUT);

    // start wait for connection response
    webdavClientState = CLIENT_WAIT_CONNECT_RESPONSE;
  }

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function open(callback) {
    const { ftpIp } = that.machine.settings.model;
    const { ftpPort } = that.machine.settings.model;
    ({ ftpUsername } = that.machine.settings.model);
    ({ ftpPassword } = that.machine.settings.model);
    serverConnectionMode = !_.has(that.machine.settings.model, 'connectionMode') || (that.machine.settings.model.connectionMode === 'FTP server');
    sessionString = `000${_.get(that.machine.settings.model, 'sessionNumber', 0)}`.slice(-4);

    // from the variable array, form a new array of 'read' specific variables
    // i.e. filter out 'write' only variables and alarm code variables
    variableReadArray = [];
    that.machine.variables.forEach((variable) => {
      // ignore alarm code variables
      if ((!_.get(variable, 'alarmCode', false)) && (_.get(variable, 'alarmCodeChanged', 'None') === 'None')) {
        // if read or write not set, assume read
        if (!(variable.access === 'write' || variable.access === 'read')) {
          const variableWithAccess = variable;
          variableWithAccess.access = 'read';
          variableReadArray.push(variableWithAccess);
        } else if (variable.access === 'read') {
          variableReadArray.push(variable);
        }
      }
    });

    // convert the variables array to an object for easy searching when writing variables
    // and filter it down to just 'write' variables
    variablesWriteObj = _.keyBy(_.filter(that.machine.variables, variable => (variable.access === 'write')), 'name');

    // assume no alarm codes to start
    currentAlarmCodes = [];

    // build the request strings
    buildFileStrings();

    destroyFtpServer = false;

    // if in ftp server mode
    if (serverConnectionMode) {
      if (destroyFtpServerTimer) {
        clearTimeout(destroyFtpServerTimer);
        destroyFtpServerTimer = null;
      }

      if (!ftpServer) {
        ftpServer = new Ftpd({ host: ftpIp, port: ftpPort, root: '/home/sparkadmin' }, handleFtpSession);
        ftpServer.on('error', (err) => {
          alert.raise({ key: 'server-error', errorMsg: err.message });
          log.debug('received error: ', err);
          resetFtpTimeout(FTP_CONNECT_TIMEOUT);
        });
        ftpServer.on('connection', (socket) => {
          updateConnectionStatus(true);
          restartConnectionStatusTimer();
          const key = `${socket.remoteAddress}:${socket.remotePort}`;
          sockets[key] = socket;
          socket.on('close', () => {
            delete sockets[key];
          });
        });
        ftpServer.destroy = function destroy() {
          Object.keys(sockets).forEach((key) => {
            sockets[key].destroy();
          });
        };
      }

      // calculate the time after which ftp files are reinitialized if no report is received
      if (that.machine.settings.model.cyclicType === 'time') {
        ftpNoReportTimeout = MAX_NO_DATA_CYCLIC_TIME_FACTOR * 1000
         * that.machine.settings.model.cyclicTime;
        if (ftpNoReportTimeout > MAX_NO_DATA_TIME) ftpNoReportTimeout = MAX_NO_DATA_TIME;
        if (ftpNoReportTimeout < MIN_NO_DATA_TIME) ftpNoReportTimeout = MIN_NO_DATA_TIME;
      } else {
        ftpNoReportTimeout = MAX_NO_DATA_TIME;
      }
    } else { // if in WebDAV client mode
      // create a client if necessary
      if (!webdavClient) {
        // add http prefix if required
        let serverUrl = that.machine.settings.model.webdavUrl;
        if (!serverUrl.startsWith('http')) serverUrl = `http://${serverUrl}`;

        webdavClient = webdav(serverUrl, ftpUsername, ftpPassword);
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
      writeInitFilesToServer();

      // start the server polling timer
      startPollingWebdavServer();
    }

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

  function stopWebdavTimers() {
    // stop polling
    stopPollingWebdavServer();

    // stop timer that makes sure still connected to server
    if (webdavClientWaitTimer) {
      clearTimeout(webdavClientWaitTimer);
      webdavClientWaitTimer = null;
    }

    // stop the time used to delay command processing
    if (webdavClientDelayTimer) {
      clearTimeout(webdavClientDelayTimer);
      webdavClientDelayTimer = null;
    }

    // stop the timer used to make sure identification  does bot take too long
    if (webdavInitTimer) {
      clearTimeout(webdavInitTimer);
      webdavInitTimer -= null;
    }
  }

  function restartFTPServer() {
    ftpServer.close(() => {
      ftpServer = null;
      open(() => {
        initializeFileObjects();
      });
    });
  }


  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  // Privileged methods
  this.writeData = function writeData(value, done) {
    // get the variable name and make sure it exists and is writable
    const variableName = value.variable;
    if (!_.has(variablesWriteObj, variableName)) {
      // create 'write' specific variable alert
      alert.raise({
        key: `var-write-error-${variableName}`,
        msg: `${machine.info.name}: Error Writing Variable`,
        description: `Error in writing ${variableName}. Variable does not exist or is not writable`,
      });
      done();
      return;
    }

    // get the variable definition
    const variable = variablesWriteObj[variableName];

    // make sure variable had report name
    if (!_.has(variable, 'reportName') || (variable.reportName.length === 0)) {
      alert.raise({
        key: `var-write-error-${variableName}`,
        msg: `${machine.info.name}: Error Writing Variable`,
        description: `Error in writing ${variableName}. Variable does not have a report name`,
      });
      done();
      return;
    }

    // build the request string to write the variable
    let writeVariableRequest = `JOB SetVariable RESPONSE "${setVariableLogFileName}";${CR}${LF
    }SET ${variable.reportName} `;

    switch (variable.format) {
      case 'char':
        writeVariableRequest += `"${value[value.variable]}"`;
        break;
      case 'bool':
        writeVariableRequest += value[value.variable] === true ? '1' : '0';
        break;
      default:
        writeVariableRequest += value[value.variable].toString();
        break;
    }

    writeVariableRequest += `;${CR}${LF}`;

    // if FTP server connection mode, set file object entries to write the value
    if (!_.has(that.machine.settings.model, 'connectionMode') || (that.machine.settings.model.connectionMode === 'FTP server')) {
      fileObjects[setVariableJobFileName] = writeVariableRequest;
      fileObjects[sessionReqFileName] = setVariableReqString;
      done();
    } else {
      // if WebDAV client connection mode, write SETVARIABLE.JOB file and the request
      webdavClient.putFileContents(`/${setVariableJobFileName}`, writeVariableRequest, clientFileOptions)
        .then(() => {
          webdavClient.putFileContents(`/${sessionReqFileName}`, setVariableReqString, clientFileOptions)
            .then(() => {
              alert.clear('server-write-error');
              done();
            })
            .catch((error) => {
              alert.raise({ key: 'server-write-error', errorMsg: error });
              done();
            });
        })
        .catch((error) => {
          alert.raise({ key: 'server-write-error', errorMsg: error });
          done();
        });
    }

    // clear variable write alert
    alert.clear(`var-write-error-${variable.name}`);
  };

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

  this.stop = function stop(done) {
    updateConnectionStatus(false);

    if (connectionStatusTimer) {
      clearTimeout(connectionStatusTimer);
      connectionStatusTimer = null;
    }
    serverConnectionMode = !_.has(that.machine.settings.model, 'connectionMode') || (that.machine.settings.model.connectionMode === 'FTP server');

    // if in ftp server mode
    if (serverConnectionMode) {
      // publish the ABORTREPORT request to let the client know to stop sending reports
      fileObjects[abortReportFileName] = abortReportString;
      fileObjects[sessionReqFileName] = abortReportReqString;

      // destroy the FTP server when the abort command finishes
      destroyFtpServer = true;

      // just in case, start a timer to destroy the FTP server of the abort is not executed
      // properly (should be destroyed in handleResponseFile() above)
      destroyFtpServerTimer = setTimeout(() => {
        if (ftpServer) {
          destroyFtpServer = false;
          ftpServer.destroy();
        }
      }, 30000);


      if (receivingFileTimer) {
        clearTimeout(receivingFileTimer);
        receivingFileTimer = null;
      }

      if (ftpWaitTimer) {
        clearTimeout(ftpWaitTimer);
        ftpWaitTimer = null;
      }

      if (ftpServer) {
        ftpServer.close(() => {
          ftpServer = null;

          // the machine has Stopped so clear all the alerts we might have raised
          clearAlertsAndStop(done);
        });
      } else {
        clearAlertsAndStop(done);
      }
    } else if (webdavClient) { // if in WebDAV client mode
      // write the abort report request files to let the client know to stop sending reports
      webdavClientShuttingDown = true;
      deleteServerFilesWithBaseName(sessionBaseFileName, () => {
        webdavClient.putFileContents(`/${abortReportFileName}`, abortReportString, clientFileOptions)
          .then(() => {
            // wait for the report abort to complete and then abort the alarms
            webdavClientState = CLIENT_WAIT_ABORT_REPORT_RESPONSE;
            webdavClient.putFileContents(`/${sessionReqFileName}`, abortReportReqString, clientFileOptions)
              .then(() => {
                // wait for abort alarm request to complete
                let checkCount = 0;

                const waitAbortTimer = setInterval(() => {
                  if ((webdavClientState === CLIENT_ABORT_COMPLETE)
                                || (checkCount >= CLIENT_ABORT_COMPLETE_MAX_CHECKS)) {
                    clearInterval(waitAbortTimer);
                    webdavClient = null;
                    stopWebdavTimers();
                    clearAlertsAndStop(done);
                  }
                  checkCount += 1;
                }, CLIENT_ABORT_COMPLETE_CHECK_TIME);
              })
              .catch(() => {
                webdavClient = null;
                stopWebdavTimers();
                clearAlertsAndStop(done);
              });
          })
          .catch(() => {
            webdavClient = null;
            stopWebdavTimers();
            clearAlertsAndStop(done);
          });
      });
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
  hpl: hplEuromap63,
  defaults,
  schema,
};
