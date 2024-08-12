/* jshint esversion: 6 */
/* eslint-disable max-len */
const async = require('async');
const _ = require('lodash');
const Client = require('ssh2-sftp-client');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

const deliverEntireResultVariable = {
  name: 'CombinedResult',
  description: 'CombinedResult',
  format: 'char',
  array: true,
};

// constructor
const hplSftpCleanlaser = function hplSftpCleanlaser(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  // Private variables
  let sftpClient = null;
  let checkTimer = null;
  let directoryReadTimeoutTimer = null;
  const directoryReadTimeoutMs = 60000; // wait 1 minute for directory list response
  let fileReadTimeoutTimer = null;
  const fileReadTimeoutMs = 120000; // wait 2 minutes for directory list response

  let username = '';
  let password = '';
  let readFrequencyMs = 60000;
  let readingFile = false;
  let initialDirectoryRead = true;

  let serverUrl = '';
  let serverPort = 0;
  let serverFolder = '';

  let sftpClientConnectedFlag = false;

  // let startMilliseconds = 0;
  // let endMilliseconds = 0;

  let machineName = '';

  let combinedResultArray = [];

  let latestYearInt = 0;
  let latestMonthInt = 0;
  // let latestDateInt = 0;
  let latestModifyTime = 0;
  let newCleanlaserTxtFilenames = [];

  const maxNumberOfReportsPerCycle = 20;
  let continueProcessingPreviousList = false;
  let continueProcessingPreviousListIndex = 0;

  // const maxCombinedResultArray = 70;

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

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

  // function updateAllVariablesWithCombinedResult(updateString) {
  //   // extract the variable values
  //   that.machine.variables.forEach((variable) => {
  //     updateDatabase(variable, updateString);
  //   });
  // }

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

  function directoryReadTimeout() {
    // if this timer triggers, we have not received a response for our sftp.list
    // directory read.  So close the sftp socket, the ssh2 communication and re-open.
    directoryReadTimeoutTimer = null;

    sftpClient.end();
    sftpClientConnectedFlag = false;

    // eslint-disable-next-line no-use-before-define
    open((err) => {
      if (err) {
        log.info(`error in restarting connections after directory list timeout.  err = ${err}`);
      } else {
        log.info('Restarted connections after directory list timeout');
        // console.log('!!!!!!!! detected and fixed directory read timeout !!!!!!!');
      }
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function fileReadTimeout() {
    // if this timer triggers, we have not received a response for our sftp.list
    // directory read.  So close the sftp socket, the ssh2 communication and re-open.
    fileReadTimeoutTimer = null;

    sftpClient.end();
    sftpClientConnectedFlag = false;

    // eslint-disable-next-line no-use-before-define
    open((err) => {
      if (err) {
        log.info(`error in restarting connections after file read timeout.  err = ${err}`);
      } else {
        log.info('Restarted connections after file read timeout');
        // console.log('!!!!!!!! detected and fixed file read timeout !!!!!!!');
      }
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function parseCleanlaserTxtFile(pathname, callback) {
    // console.log(`parsing file: ${pathname}`);

    if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
      combinedResultArray = [];
    }

    if (fileReadTimeoutTimer) {
      clearTimeout(fileReadTimeoutTimer);
      fileReadTimeoutTimer = null;
    }
    fileReadTimeoutTimer = setTimeout(fileReadTimeout, fileReadTimeoutMs);

    sftpClient.get(pathname).then((data) => {
      if (fileReadTimeoutTimer) {
        clearTimeout(fileReadTimeoutTimer);
        fileReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on file read'));
        return;
      }

      const bufferString = data.toString();
      const bufferStringArray = bufferString.split('\n');

      // console.log(`buffersStringArray.length = ${bufferStringArray.length}`);

      let DMCCodeValueString = '';
      let ladeJobDateiValueString = '';
      let scriptFinishedFlag = false;
      let jobFinishedFlag = false;
      let stringIndex;
      for (let lineIndex = 0; lineIndex < bufferStringArray.length; lineIndex += 1) {
        // first, check for the job filed DMCCode
        if (bufferStringArray[lineIndex].includes('DMCCode')) {
          stringIndex = bufferStringArray[lineIndex].indexOf('->');
          if (stringIndex > 0) {
            DMCCodeValueString = bufferStringArray[lineIndex].substring(stringIndex + 2);
            DMCCodeValueString = DMCCodeValueString.trim();
            // console.log(`DMCCode = ${DMCCodeValueString}`);
            lineIndex += 1;
          }
        } else if (bufferStringArray[lineIndex].includes('DMC_Code')) {
          stringIndex = bufferStringArray[lineIndex].indexOf(':');
          if (stringIndex > 0) {
            DMCCodeValueString = bufferStringArray[lineIndex].substring(stringIndex + 2);
            DMCCodeValueString = DMCCodeValueString.trim();
            // console.log(`DMCCode = ${DMCCodeValueString}`);
            lineIndex += 1;
          }
        } else if (bufferStringArray[lineIndex].includes('Lade Job Datei')) {
          stringIndex = bufferStringArray[lineIndex].indexOf('->');
          if (stringIndex > 0) {
            ladeJobDateiValueString = bufferStringArray[lineIndex].substring(stringIndex + 2);
            ladeJobDateiValueString = ladeJobDateiValueString.trim();
            // console.log(`Lade-Job-Datei = ${ladeJobDateiValueString}`);
            lineIndex += 1;
          }
        } else if (bufferStringArray[lineIndex].includes('Job Finished')) {
          jobFinishedFlag = true;
        } else if (bufferStringArray[lineIndex].includes('Script Finished')) {
          scriptFinishedFlag = true;
        } else if (bufferStringArray[lineIndex].startsWith('----New Object---')) {
          stringIndex = bufferStringArray[lineIndex + 1].indexOf('Name:');
          if (stringIndex > 0) {
            lineIndex += 1;
            let nameString = bufferStringArray[lineIndex].substring(stringIndex + 5);
            nameString = nameString.trim().replace(/\s+/g, '-');
            // console.log('found new object: ' + nameString);
            lineIndex += 1;
            // console.log('bufferStringArray[lineIndex].trim().length = ' + bufferStringArray[lineIndex].trim().length);
            // find the first non-blank line after the new object name
            while ((bufferStringArray[lineIndex].trim().length === 0) && (lineIndex < bufferStringArray.length)) {
              lineIndex += 1;
            }

            // continue parsing lines until we hit the NEXT blank line
            while ((bufferStringArray[lineIndex].trim().length > 0) && (lineIndex < bufferStringArray.length)) {
              stringIndex = bufferStringArray[lineIndex].indexOf(':');
              if (stringIndex > 0) {
                let propertyString = bufferStringArray[lineIndex].substring(0, stringIndex);
                propertyString = propertyString.trim().replace(/\s+/g, '-');
                let valueString = bufferStringArray[lineIndex].substring(stringIndex + 1);
                valueString = valueString.trim();
                const newData = {};
                newData[`${nameString}-${propertyString}`] = valueString;
                // comment out this limit for reporting the entire file
                // if (combinedResultArray.length < maxCombinedResultArray) {
                combinedResultArray.push(newData);
                // console.log(nameString + '-' + propertyString + ' = ' + valueString);
                // }
              }
              lineIndex += 1;
            }
          }
        }
      }
      if (combinedResultArray.length > 0) {
        let newData = {};
        newData.DMCCode = DMCCodeValueString;
        combinedResultArray.push(newData);
        newData = {};
        newData['Lade-Job-Datei'] = ladeJobDateiValueString;
        combinedResultArray.push(newData);
        newData = {};
        newData.ScriptFinished = scriptFinishedFlag;
        combinedResultArray.push(newData);
        newData = {};
        newData.JobFinished = jobFinishedFlag;
        combinedResultArray.push(newData);

        if (_.get(that.machine.settings.model, 'includeFilenameInCombinedData', false)) {
          combinedResultArray.push({ FileName: pathname });
        }

        callback(null, true);
      } else {
        callback(null, false);
      }
    }).catch((getErr) => {
      if (getErr) {
        log.error(`--- parseCleanlaserTxtFile: sftpClient.get: getErr = ${getErr}`);
      }
      callback(getErr);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function findLatestCleanlaserTxtFileInDateFolder(pathname, yearInt, monthInt, dateInt, callback) {
    // const updateString = `----- checking folder: ${serverUrl}: ${pathname}`;
    // // updateAllVariablesWithCombinedResult(updateString);
    // console.log(updateString);

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    sftpClient.list(pathname).then((fileList) => {
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on MonthDate directory read'));
        return;
      }

      const fileArray = [];

      let fileIndex = 0;
      for (fileIndex = 0; fileIndex < fileList.length; fileIndex += 1) {
        if (fileList[fileIndex].type === '-') {
          fileArray.push({
            name: fileList[fileIndex].name,
            modifyTime: fileList[fileIndex].modifyTime,
          });
        }
      }
      // eslint-disable-next-line no-nested-ternary
      fileArray.sort((a, b) => ((a.modifyTime > b.modifyTime) ? -1
        : ((a.modifyTime === b.modifyTime) ? 0 : 1)));
      // newest file should be in index 0

      let doneFlag = false;
      fileIndex = 0;

      async.whilst(
        () => (!doneFlag) && (fileIndex < fileArray.length),
        (callback2) => {
          const newPathname = pathname + fileArray[fileIndex].name;
          // save the information on this file to use for finding newer files on future reads
          latestYearInt = yearInt;
          latestMonthInt = monthInt;
          // latestDateInt = dateInt;
          latestModifyTime = fileArray[fileIndex].modifyTime;
          parseCleanlaserTxtFile(newPathname, (err, done) => {
            if (err) {
              callback2(err);
            } else {
              if (done) {
                doneFlag = true;
              }
              fileIndex += 1;
              callback2(null);
            }
          });
        },
        (whilstErr) => {
          if (whilstErr) {
            log.error(`--- findLatestCleanlaserTxtFileInDateFolder: whilstErr = ${whilstErr}`);
            callback(whilstErr);
          } else {
            callback(null, doneFlag);
          }
        },
      );
    }).catch((listErr) => {
      if (listErr) {
        log.error(`--- findLatestCleanlaserTxtFileInDateFolder: sftpClient.list: listErr = ${listErr}`);
      }
      callback(listErr);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function findLatestCleanlaserTxtFileInYearMonth(pathname, yearInt, monthInt, callback) {
    // const updateString = `----- checking folder: ${serverUrl}: ${pathname}`;
    // // updateAllVariablesWithCombinedResult(updateString);
    // console.log(updateString);

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    sftpClient.list(pathname).then((dateList) => {
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on MonthDate directory read'));
        return;
      }

      // console.log('dateList = ' + JSON.stringify(dateList));

      const dateArray = [];
      let dateIndex = 0;
      for (dateIndex = 0; dateIndex < dateList.length; dateIndex += 1) {
        if (dateList[dateIndex].type === 'd') {
          const folderName = dateList[dateIndex].name;
          // eslint-disable-next-line no-restricted-globals
          if (!isNaN(folderName)) {
            dateArray.push(folderName);
          }
        }
      }
      dateArray.sort();

      // console.log('dateArray = ' + JSON.stringify(dateArray));

      dateIndex = dateArray.length - 1;
      let doneFlag = false;

      async.whilst(
        () => (!doneFlag) && (dateIndex >= 0),
        (callback2) => {
          const newPathname = `${pathname + dateArray[dateIndex]}/`;
          const dateInt = parseInt(dateArray[dateIndex], 10);
          findLatestCleanlaserTxtFileInDateFolder(newPathname, yearInt, monthInt, dateInt, (err, done) => {
            if (err) {
              callback2(err);
            } else {
              if (done) {
                doneFlag = true;
              }
              dateIndex -= 1;
              callback2(null);
            }
          });
        },
        (whilstErr) => {
          if (whilstErr) {
            log.error(`--- findLatestCleanlaserTxtFileInYearMonth: whilstErr = ${whilstErr}`);
            callback(whilstErr);
          } else {
            callback(null, doneFlag);
          }
        },
      );
    }).catch((listErr) => {
      if (listErr) {
        log.error(`--- findLatestCleanlaserTxtFileInYearMonth: sftpClient.list: listErr = ${listErr}`);
      }
      callback(listErr);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function findLatestCleanlaserTxtFile(pathname, callback) {
    // let updateString = `----- checking folder: ${serverUrl}: ${pathname}`;
    // //    updateAllVariablesWithCombinedResult(updateString);
    // console.log(updateString);

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    // start with the year
    // format should be YYYY_MM
    sftpClient.list(pathname).then((yearMonthList) => {
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on Year_Month directory read'));
        return;
      }

      // console.log('----yearMonthList = ' + JSON.stringify(yearMonthList));

      const yearMonthArray = [];
      let yearMonthIndex = 0;
      let yearMonth = [];
      let folderName = '';
      for (yearMonthIndex = 0; yearMonthIndex < yearMonthList.length; yearMonthIndex += 1) {
        if (yearMonthList[yearMonthIndex].type === 'd') {
          folderName = yearMonthList[yearMonthIndex].name;
          yearMonth = folderName.split('_');
          // eslint-disable-next-line no-restricted-globals
          if ((yearMonth.length === 2) && (!isNaN(yearMonth[0])) && (!isNaN(yearMonth[1]))) {
            yearMonthArray.push(folderName);
          }
        }
      }
      yearMonthArray.sort();

      yearMonthIndex = yearMonthArray.length - 1; // start at the newest year and work backwards
      let doneFlag = false;

      async.whilst(
        () => (!doneFlag) && (yearMonthIndex >= 0),
        (callback2) => {
          folderName = yearMonthArray[yearMonthIndex];
          yearMonth = folderName.split('_');
          const yearInt = parseInt(yearMonth[0], 10);
          const monthInt = parseInt(yearMonth[1], 10);
          const newPathname = `${pathname + folderName}/`;
          findLatestCleanlaserTxtFileInYearMonth(newPathname, yearInt, monthInt, (err, done) => {
            if (err) {
              callback2(err);
            } else {
              if (done) {
                doneFlag = true;
              }
              yearMonthIndex -= 1;
              callback2(null);
            }
          });
        },
        (whilstErr) => {
          if (whilstErr) {
            log.error(`--- findLatestCleanlaserTxtFile: whilstErr = ${whilstErr}`);
            callback(whilstErr);
          } else {
            // updateString = `----- done with folder: ${serverUrl}: ${pathname}`;
            // // updateAllVariablesWithCombinedResult(updateString);
            // console.log(updateString);

            callback(null, doneFlag);
          }
        },
      );
    }).catch((listErr) => {
      if (listErr) {
        log.error(`--- findLatestCleanlaserTxtFile: sftpClient.list: listErr = ${listErr}`);
      }
      callback(listErr);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function findNewCleanlaserTxtFileInDateFolder(pathname, yearInt, monthInt, dateInt, callback) {
    // const updateString = `----- checking folder: ${serverUrl}: ${pathname}`;
    // // updateAllVariablesWithCombinedResult(updateString);
    // console.log(updateString);

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    sftpClient.list(pathname).then((fileList) => {
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on MonthDate directory read'));
        return;
      }

      // console.log('fileList = ' + JSON.stringify(fileList));

      const newFiles = [];
      let fileIndex = 0;
      for (fileIndex = 0; fileIndex < fileList.length; fileIndex += 1) {
        if (fileList[fileIndex].type === '-') {
          if (fileList[fileIndex].modifyTime > latestModifyTime) {
            const filenameWithPath = pathname + fileList[fileIndex].name;
            newFiles.push({
              name: filenameWithPath,
              modifyTime: fileList[fileIndex].modifyTime,
              yearInt,
              monthInt,
              dateInt,
            });
          }
        }
      }
      if (newFiles.length > 0) {
        // eslint-disable-next-line no-nested-ternary
        newFiles.sort((a, b) => ((a.modifyTime > b.modifyTime) ? -1
          : ((a.modifyTime === b.modifyTime) ? 0 : 1)));
        // newest file should be in index 0
        for (fileIndex = newFiles.length - 1; fileIndex >= 0; fileIndex -= 1) {
          newCleanlaserTxtFilenames.push(newFiles[fileIndex]);
        }
      }
      callback(null);
    }).catch((listErr) => {
      if (listErr) {
        log.error(`--- findNewCleanlaserTxtFileInDateFolder: sftpClient.list: listErr = ${listErr}`);
      }
      callback(listErr);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function findNewCleanlaserTxtFileInYearMonthFolder(pathname, yearInt, monthInt, callback) {
    // const updateString = `----- checking folder: ${serverUrl}: ${pathname}`;
    // // updateAllVariablesWithCombinedResult(updateString);
    // console.log(updateString);

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    sftpClient.list(pathname).then((dateList) => {
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on MonthDate directory read'));
        return;
      }

      // console.log('dateList = ' + JSON.stringify(dateList));

      const dateArray = [];
      let dateIndex = 0;
      for (dateIndex = 0; dateIndex < dateList.length; dateIndex += 1) {
        if (dateList[dateIndex].type === 'd') {
          const folderName = dateList[dateIndex].name;
          // eslint-disable-next-line no-restricted-globals
          if (!isNaN(folderName)) {
            if (yearInt > latestYearInt) {
              // if we're finding folders in a later year that the last one we foiund, must be new
              dateArray.push(folderName);
            } else if (monthInt >= latestMonthInt) {
              dateArray.push(folderName);
            }
          }
        }
      }
      dateArray.sort();

      // console.log('dateArray = ' + JSON.stringify(dateArray));

      dateIndex = 0; // start at the oldest folder and work forward to the newest
      let doneFlag = false;

      async.whilst(
        () => (!doneFlag) && (dateIndex < dateArray.length),
        (callback2) => {
          const newPathname = `${pathname + dateArray[dateIndex]}/`;
          const dateInt = parseInt(dateArray[dateIndex], 10);
          findNewCleanlaserTxtFileInDateFolder(newPathname, yearInt, monthInt, dateInt, (err, done) => {
            if (err) {
              callback2(err);
            } else {
              if (done) {
                doneFlag = true;
              }
              dateIndex += 1;
              callback2(null);
            }
          });
        },
        (whilstErr) => {
          if (whilstErr) {
            log.error(`--- findNewCleanlaserTxtFileInYearMonthFolder whilstErr = ${whilstErr}`);
            callback(whilstErr);
          } else {
            callback(null, doneFlag);
          }
        },
      );
    }).catch((listErr) => {
      if (listErr) {
        log.error(`--- findNewCleanlaserTxtFileInYearMonthFolder: sftpClient.list: listErr = ${listErr}`);
      }
      callback(listErr);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function findNewCleanlaserTxtFiles(pathname, callback) {
    newCleanlaserTxtFilenames = [];

    // const updateString = `----- checking folder: ${serverUrl}: ${pathname}`;
    // //    updateAllVariablesWithCombinedResult(updateString);
    // console.log(updateString);

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    // start with the year
    sftpClient.list(pathname).then((yearMonthList) => {
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on Year directory read'));
        return;
      }

      // console.log('----yearMonthList = ' + JSON.stringify(yearMonthList));

      const yearMonthArray = [];
      let yearMonthIndex = 0;
      let yearMonth = [];
      let folderName = '';
      let yearInt = 0;
      let monthInt = 0;
      for (yearMonthIndex = 0; yearMonthIndex < yearMonthList.length; yearMonthIndex += 1) {
        if (yearMonthList[yearMonthIndex].type === 'd') {
          folderName = yearMonthList[yearMonthIndex].name;
          yearMonth = folderName.split('_');
          // eslint-disable-next-line no-restricted-globals
          if ((yearMonth.length === 2) && (!isNaN(yearMonth[0])) && (!isNaN(yearMonth[1]))) {
            yearInt = parseInt(yearMonth[0], 10);
            monthInt = parseInt(yearMonth[1], 10);
            if (yearInt > latestYearInt) {
              yearMonthArray.push(folderName);
            } else if (yearInt === latestYearInt) {
              if (monthInt >= latestMonthInt) {
                yearMonthArray.push(folderName);
              }
            }
          }
        }
      }
      yearMonthArray.sort();

      yearMonthIndex = 0; // start at the oldest folder and work forward to the newest
      let doneFlag = false;

      async.whilst(
        () => (!doneFlag) && (yearMonthIndex < yearMonthArray.length),
        (callback2) => {
          yearMonth = folderName.split('_');
          yearInt = parseInt(yearMonth[0], 10);
          monthInt = parseInt(yearMonth[1], 10);
          const newPathname = `${pathname + yearMonthArray[yearMonthIndex]}/`;
          findNewCleanlaserTxtFileInYearMonthFolder(newPathname, yearInt, monthInt, (err, done) => {
            if (err) {
              callback2(err);
            } else {
              if (done) {
                doneFlag = true;
              }
              yearMonthIndex += 1;
              callback2(null);
            }
          });
        },
        (whilstErr) => {
          if (whilstErr) {
            log.error(`--- findNewCleanlaserTxtFiles whilstErr = ${whilstErr}`);
            callback(whilstErr);
          } else {
            // updateString = `----- done with folder: ${serverUrl}: ${pathname}`;
            // //    updateAllVariablesWithCombinedResult(updateString);
            // console.log(updateString);

            callback(null, doneFlag);
          }
        },
      );
    }).catch((listErr) => {
      if (listErr) {
        log.error(`--- findNewCleanlaserTxtFiles: sftpClient.list: listErr = ${listErr}`);
      }
      callback(listErr);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function processNewCleanlaserTxtFiles(fileIndex, callback) {
    let numberOfFilesReported = 0;
    let localFileIndex = fileIndex;

    async.whilst(
      () => ((localFileIndex >= 0) && (numberOfFilesReported < maxNumberOfReportsPerCycle)),
      (callback2) => {
        parseCleanlaserTxtFile(newCleanlaserTxtFilenames[localFileIndex].name, (err, done) => {
          if (err) {
            callback2(err);
            return;
          } if (done) { // we have data to report
            // console.log(`combinedResultArray.length = ${combinedResultArray.length}`);
            // console.log('combinedResultArray = ' + JSON.stringify(combinedResultArray));
            updateDatabase(deliverEntireResultVariable, combinedResultArray);
            localFileIndex -= 1;
            numberOfFilesReported += 1;
            // endMilliseconds = Date.now();
            // console.log(`--- ${machineName}: elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
            callback2(null);
          } else {
            localFileIndex -= 1;
            callback2(null);
          }
        });
      },
      (whilstErr) => {
        if (whilstErr) {
          log.error(`--- processNewCleanlaserTxtFiles whilstErr = ${whilstErr}`);
          callback(whilstErr);
          return;
        }
        if (localFileIndex >= 0) {
          // we were not able to handle all of the files we found this cycle.
          // tag our spot to continue on next cycle.
          continueProcessingPreviousList = true;
          continueProcessingPreviousListIndex = localFileIndex;
        } else {
          continueProcessingPreviousList = false;
        }
        latestYearInt = newCleanlaserTxtFilenames[0].yearInt;
        latestMonthInt = newCleanlaserTxtFilenames[0].monthInt;
        // latestDateInt = newCleanlaserTxtFilenames[0].dateInt;
        latestModifyTime = newCleanlaserTxtFilenames[0].modifyTime;
        callback(null);
      },
    );
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function checkTimerFunc() {
    if (readingFile) {
      if (continueProcessingPreviousList) {
        continueProcessingPreviousList = false;
        // console.log('----- checkTimerFunc: continue processing previously found cleanlaser txt files.');
        // console.log(`----- fileIndex = ${continueProcessingPreviousListIndex}`);
        processNewCleanlaserTxtFiles(continueProcessingPreviousListIndex, (err) => {
          if (err) {
            log.error(`--- ${machineName}: checkTimerFunc: processNewCleanlaserTxtFiles: err = ${err}`);
          }

          // console.log('----- timer function exit');
          // endMilliseconds = Date.now();
          // console.log(`--- total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
          if (!continueProcessingPreviousList) {
            readingFile = false;
          // } else {
          //   console.log('----- checkTimerFunc: max number of files reported.');
          //   console.log(`----- fileIndex = ${continueProcessingPreviousListIndex}`);
          }
        });
      } else {
        // console.log(`----still working on previous file operation: ${serverUrl}`);
        return;
      }
    }
    readingFile = true;

    //    console.log('!!!! timer: checkTimerFunc: ' + serverUrl);
    // startMilliseconds = Date.now();

    if (initialDirectoryRead) {
      findLatestCleanlaserTxtFile(serverFolder, (err, done) => {
        if (err) {
          log.error(`--- ${machineName}: checkTimerFunc: findLatestCleanlaserTxtFile: err = ${err}`);
        } else if (done) {
          // console.log('--- found latest cleanlaser txt file');
          // console.log(`combinedResultArray.length = ${combinedResultArray.length}`);
          // console.log('combinedResultArray = ' + JSON.stringify(combinedResultArray));
          updateDatabase(deliverEntireResultVariable, combinedResultArray);
          initialDirectoryRead = false;
        // } else {
        //   console.log('--- no cleanlaser txt file found');
        }
        // endMilliseconds = Date.now();
        // const updateString = `--- TOTAL elapsed milliseconds = ${endMilliseconds - startMilliseconds}: ${serverUrl}`;
        // console.log(updateString);
        readingFile = false;
      });
    } else {
      findNewCleanlaserTxtFiles(serverFolder, (err) => {
        if (err) {
          log.error(`--- ${machineName}: checkTimerFunc: findNewCleanlaserTxtFiles: err = ${err}`);
        }
        // console.log('----- findLatestCleanlaserTxtFile: after list');
        // endMilliseconds = Date.now();
        const numberOfNewFiles = newCleanlaserTxtFilenames.length;
        // console.log(`--- found ${numberOfNewFiles} new cleanlaser txt files`);
        // console.log(`--- elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);

        if (numberOfNewFiles > 0) {
          // eslint-disable-next-line no-nested-ternary
          newCleanlaserTxtFilenames.sort((a, b) => ((a.modifyTime > b.modifyTime) ? -1
            : ((a.modifyTime === b.modifyTime) ? 0 : 1)));
          // newest file should be in index 0

          const fileIndex = numberOfNewFiles - 1; // start at the end to deliver newest last
          processNewCleanlaserTxtFiles(fileIndex, (processErr) => {
            if (processErr) {
              log.error(`--- ${machineName}: checkTimerFunc: processNewCleanlaserTxtFiles: processErr = ${processErr}`);
            }
            // console.log('----- timer function exit');
            // endMilliseconds = Date.now();
            // console.log(`--- total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
            if (!continueProcessingPreviousList) {
              readingFile = false;
            // } else {
            //   console.log('----- checkTimerFunc: max nubmer of files reported.');
            //   console.log(`----- fileIndex = ${continueProcessingPreviousListIndex}`);
            }
          });
        } else {
          // endMilliseconds = Date.now();
          // console.log(`--- ${machineName}: NO NEW CLEANLASER TXT FILES: total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
          readingFile = false;
        }
      });
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function open(callback) {
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }

    ({ username } = that.machine.settings.model);
    ({ password } = that.machine.settings.model);
    readFrequencyMs = that.machine.settings.model.readFrequency * 1000;

    serverUrl = that.machine.settings.model.sftpUrl;
    serverPort = that.machine.settings.model.sftpPort;
    serverFolder = that.machine.settings.model.sftpFolder;
    log.info('--------------- creating sftp client');
    sftpClient = new Client();
    log.info('--------------- sftp client created');

    if (_.get(that.machine.settings.model, 'deliverEntireResponse', false)) {
      that.machine.variables.push(deliverEntireResultVariable);
    }

    const connectOptions = {
      host: serverUrl,
      port: serverPort,
      username,
      password,
    };
    log.info(`--- connectOptions = ${JSON.stringify(connectOptions)}`);

    sftpClient.connect(connectOptions).then(() => {
      log.info('sftpClient connected');
      sftpClientConnectedFlag = true;

      setImmediate(checkTimerFunc); // initial check to start immediately.
      // schedule subsequent reads
      checkTimer = setInterval(checkTimerFunc, readFrequencyMs);
    }).catch((connectErr) => {
      if (connectErr) {
        log.error(`--- ${machineName}: sftpClient.connect: connectErr = ${connectErr}`);
      }
    });


    readingFile = false;
    initialDirectoryRead = true;

    callback(null);
  }

  //------------------------------------------------------------------------------

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

  //------------------------------------------------------------------------------

  this.stop = function stop(done) {
    updateConnectionStatus(false);
    readingFile = false;
    continueProcessingPreviousList = false;

    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }

    if (fileReadTimeoutTimer) {
      clearTimeout(fileReadTimeoutTimer);
      fileReadTimeoutTimer = null;
    }

    if (sftpClientConnectedFlag) {
      // shut down our sftp client
      log.info('--- sftpClient.end()');
      sftpClient.end();
      sftpClientConnectedFlag = false;
    }

    clearAlertsAndStop(done);
  };

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
  hpl: hplSftpCleanlaser,
  defaults,
  schema,
};
