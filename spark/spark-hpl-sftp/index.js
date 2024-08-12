/* jshint esversion: 6 */
const async = require('async');
const _ = require('lodash');
const Client = require('ssh2-sftp-client');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplSftp = function hplSftp(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  let sftpClient = null;
  let readTimer = null;
  let username = '';
  let password = '';
  let readFrequencyMs = 5000;
  let readingFile = false;
  let initialDirectoryRead = true;

  let directoryReadTimeoutTimer = null;
  const directoryReadTimeoutMs = 300000; // wait 5 minute for directory list response
  let fileReadTimeoutTimer = null;
  const fileReadTimeoutMs = 300000; // wait 2 minutes for directory list response

  let yearArray = [];
  let xmlFolderString = '';

  let serverUrl = '';
  let serverPort = 0;
  let serverFolder = '';

  let lastFileReadTimestamp = 0;
  let latestXmlFolder = '';
  let latestXmlFilename = '';
  let newXmlFilenames = [];

  let machineName = '';

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

  function updateAllVariablesWithCombinedResult(value) {
    // extract the variable values
    that.machine.variables.forEach((variable) => {
      updateDatabase(variable, value);
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

  function directoryReadTimeout() {
    // if this timer triggers, we have not received a response for our sftp.list
    // directory read.  So close the sftp socket and re-open.

    directoryReadTimeoutTimer = null;

    sftpClient.end();

    // eslint-disable-next-line no-use-before-define
    open((err) => {
      if (err) {
        log.info(`error in restarting connections after directory list timeout.  err = ${err}`);
      } else {
        log.info('Restarted connections after directory list timeout');
        log.info(`!!!!! ${machineName}!!!!!!!! detected and fixed directory read timeout !!!!!!!`);
      }
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function fileReadTimeout() {
    // if this timer triggers, we have not received a response for our sftp.list
    // directory read.  So close the sftp socket and re-open.

    fileReadTimeoutTimer = null;

    sftpClient.end();

    // eslint-disable-next-line no-use-before-define
    open((err) => {
      if (err) {
        log.info(`error in restarting connections after file read timeout.  err = ${err}`);
      } else {
        log.info('Restarted connections after file read timeout');
        log.info(`!!!!! ${machineName}!!!!!!!! detected and fixed file read timeout !!!!!!!`);
      }
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function findLatestXmlFile(callback) {
    // first, let's get the main year directories in the base folder

    latestXmlFilename = '';
    lastFileReadTimestamp = 0;

    const yearFolderString = '/Images/';
    // console.log('----- ' + machineName + ': checking folder: ' + yearFolderString);

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    sftpClient.list(yearFolderString).then((yearList) => {
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        // console.log('!!! timeout on yearFolder: ' + yearFolderString + ' directory read');
        callback(new Error(`timeout on yearFolder: ${yearFolderString} directory read`));
        return;
      }

      yearArray = [];
      let yearIndex = 0;
      for (yearIndex = 0; yearIndex < yearList.length; yearIndex += 1) {
        if (yearList[yearIndex].type === 'd') {
          const folderName = yearList[yearIndex].name;
          // eslint-disable-next-line no-restricted-globals
          if (!isNaN(folderName)) {
            yearArray.push(folderName);
          }
        }
      }
      yearArray.sort();
      yearIndex = yearArray.length - 1;
      let monthDayArray = [];
      let monthDayIndex = -1; // we need to read the year folder to get the monthDay folders
      let hourArray = [];
      let hourIndex = -1; // we need to read the monthDay folder to get the hour folders
      let monthDayFolderString = '';
      let hourFolderString = '';
      let doneFlag = false;

      async.whilst(
        () => !doneFlag,
        (callback2) => {
          if (monthDayIndex === -1) {
            monthDayFolderString = `/Images/${yearArray[yearIndex]}/`;
            // console.log('----- ' + machineName + ': checking folder: ' + monthDayFolderString);
            hourIndex = -1;

            if (directoryReadTimeoutTimer) {
              clearTimeout(directoryReadTimeoutTimer);
              directoryReadTimeoutTimer = null;
            }
            directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

            sftpClient.list(monthDayFolderString).then((monthDayList) => {
              if (directoryReadTimeoutTimer) {
                clearTimeout(directoryReadTimeoutTimer);
                directoryReadTimeoutTimer = null;
              } else {
                // console.log('!!! timeout on monthDayFolder: ' + monthDayFolderString +
                //             ' directory read');
                callback(new Error(`timeout on monthDayFolder: ${monthDayFolderString} directory read`));
                return;
              }

              monthDayArray = [];
              for (monthDayIndex = 0; monthDayIndex < monthDayList.length; monthDayIndex += 1) {
                if (monthDayList[monthDayIndex].type === 'd') {
                  const folderName = monthDayList[monthDayIndex].name;
                  // eslint-disable-next-line no-restricted-globals
                  if (!isNaN(folderName)) {
                    monthDayArray.push(folderName);
                  }
                }
              }
              monthDayArray.sort();
              monthDayIndex = monthDayArray.length - 1;
              if (monthDayIndex < 0) { // no monthDays folders found for this year
                yearIndex -= 1;
                if (yearIndex < 0) {
                  doneFlag = true;
                  xmlFolderString = 'not found';
                }
              }
              callback2(null);
            }).catch((err) => {
              if (err) {
                log.error(`--- ${machineName}: error in read of year directory.  err = ${err}`);
              }
              if (directoryReadTimeoutTimer) {
                clearTimeout(directoryReadTimeoutTimer);
                directoryReadTimeoutTimer = null;
              }
              yearIndex -= 1;
              if (yearIndex < 0) {
                doneFlag = true;
                xmlFolderString = 'not found';
              }
              callback2(null);
            });
          } else if (hourIndex === -1) {
            hourFolderString = `/Images/${yearArray[yearIndex]}/${monthDayArray[monthDayIndex]}/`;
            // console.log('----- ' + machineName + ': checking folder: ' + hourFolderString);

            if (directoryReadTimeoutTimer) {
              clearTimeout(directoryReadTimeoutTimer);
              directoryReadTimeoutTimer = null;
            }
            directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

            sftpClient.list(hourFolderString).then((hourList) => {
              if (directoryReadTimeoutTimer) {
                clearTimeout(directoryReadTimeoutTimer);
                directoryReadTimeoutTimer = null;
              } else {
                // console.log('!!! timeout on hourFolder: ' + hourFolderString +
                //             ' directory read');
                callback(new Error(`timeout on hourFolder: ${hourFolderString} directory read`));
                return;
              }

              hourArray = [];
              for (hourIndex = 0; hourIndex < hourList.length; hourIndex += 1) {
                if (hourList[hourIndex].type === 'd') {
                  const folderName = hourList[hourIndex].name;
                  // eslint-disable-next-line no-restricted-globals
                  if (!isNaN(folderName)) {
                    hourArray.push(folderName);
                  }
                }
              }
              hourArray.sort();
              hourIndex = hourArray.length - 1;
              if (hourIndex < 0) { // no monthDays folders found for this year
                monthDayIndex -= 1;
                if (monthDayIndex < 0) {
                  yearIndex -= 1;
                  if (yearIndex < 0) {
                    doneFlag = true;
                    xmlFolderString = 'not found';
                  }
                }
              }
              callback2(null);
            }).catch((err) => {
              if (err) {
                log.error(`--- ${machineName}: error in read of monthDay directory.  err = ${err}`);
              }
              if (directoryReadTimeoutTimer) {
                clearTimeout(directoryReadTimeoutTimer);
                directoryReadTimeoutTimer = null;
              }
              monthDayIndex -= 1;
              if (monthDayIndex < 0) {
                yearIndex -= 1;
                if (yearIndex < 0) {
                  doneFlag = true;
                  xmlFolderString = 'not found';
                }
              }
              callback2(null);
            });
          } else {
            // have a valid year/monthDay/hour folder - see if has an xml folder
            xmlFolderString = `/Images/${yearArray[yearIndex]}/${monthDayArray[monthDayIndex]}/${hourArray[hourIndex]}/${serverFolder}`;
            // console.log('----- ' + machineName + ': checking folder: ' + xmlFolderString);

            // eslint-disable-next-line no-useless-escape
            const xmlRegex = new RegExp('^.*\.xml$');

            if (directoryReadTimeoutTimer) {
              clearTimeout(directoryReadTimeoutTimer);
              directoryReadTimeoutTimer = null;
            }
            directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

            sftpClient.list(xmlFolderString, xmlRegex).then((latestFolderData) => {
              if (directoryReadTimeoutTimer) {
                clearTimeout(directoryReadTimeoutTimer);
                directoryReadTimeoutTimer = null;
              } else {
                // console.log('!!! timeout on xmlFolder: ' + xmlFolderString + ' directory read');
                callback(new Error(`timeout on xmlFolder: ${xmlFolderString} directory read`));
                return;
              }

              // console.log('--- ' + machineName + ': found latest xml folder: ' +
              //             xmlFolderString);
              // console.log('--- ' + machineName + ': latestFolderData = ' +
              //             JSON.stringify(latestFolderData));

              // search the folder list to find the newest file
              for (let fileIndex = 0; fileIndex < latestFolderData.length; fileIndex += 1) {
                if (latestFolderData[fileIndex].type === '-') { // entry is a file
                  if (latestFolderData[fileIndex].modifyTime > lastFileReadTimestamp) {
                    latestXmlFilename = `${xmlFolderString}/${latestFolderData[fileIndex].name}`;
                    // save the folder where the latest xml file was found.  From now on,
                    // ONLY check this folder and newer for additional files.
                    latestXmlFolder = `/Images/${yearArray[yearIndex]}/${monthDayArray[monthDayIndex]}/${hourArray[hourIndex]}`;
                    lastFileReadTimestamp = latestFolderData[fileIndex].modifyTime;
                  }
                }
              }
              doneFlag = true;
              callback2(null);
            }).catch((err) => {
              if (err) {
                log.error(`error in read of monthDay directory.  err = ${err}`);
              }
              if (directoryReadTimeoutTimer) {
                clearTimeout(directoryReadTimeoutTimer);
                directoryReadTimeoutTimer = null;
              }
              hourIndex -= 1;
              if (hourIndex < 0) { // no monthDays folders found for this year
                monthDayIndex -= 1;
                if (monthDayIndex < 0) {
                  yearIndex -= 1;
                  if (yearIndex < 0) {
                    doneFlag = true;
                    xmlFolderString = 'not found';
                  }
                }
              }
              callback2(null);
            });
          }
        },
        (err, n) => {
          if (err) {
            log.error(`---- ${machineName}: end of whilst, err = ${err}, n = ${n}`);
          }
          // console.log('------- ' + machineName + ': xmlFolderString = ' + xmlFolderString);
          callback(null);
        },
      );
    }).catch((err) => {
      if (err) {
        log.error(`------ ${machineName}: error in read of year directory.  err = ${err}`);
      }
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      }
      callback(err);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function getNewXMLFiles(callback) {
    // first, let's get the main year directories in the base folder

    newXmlFilenames = [];
    let newLatestXmlFolder = '';

    const yearFolderString = '/Images/';
    // console.log('----- ' + machineName + ': checking folder: ' + yearFolderString);

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    sftpClient.list(yearFolderString).then((yearList) => {
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        // console.log('!!! timeout on yearFolder: ' + yearFolderString + ' directory read');
        callback(new Error(`timeout on yearFolder: ${yearFolderString} directory read`));
        return;
      }

      yearArray = [];
      let yearIndex = 0;
      for (yearIndex = 0; yearIndex < yearList.length; yearIndex += 1) {
        if (yearList[yearIndex].type === 'd') {
          const folderName = yearList[yearIndex].name;
          // eslint-disable-next-line no-restricted-globals
          if (!isNaN(folderName)) {
            yearArray.push(folderName);
          }
        }
      }
      yearArray.sort();
      yearIndex = yearArray.length - 1;
      let monthDayArray = [];
      let monthDayIndex = -1; // we need to read the year folder to get the monthDay folders
      let hourArray = [];
      let hourIndex = -1; // we need to read the monthDay folder to get the hour folders
      let monthDayFolderString = '';
      let hourFolderString = '';
      let doneFlag = false;

      async.whilst(
        () => !doneFlag,
        (callback2) => {
          if (monthDayIndex === -1) {
            monthDayFolderString = `/Images/${yearArray[yearIndex]}/`;
            // console.log('----- ' + machineName + ': checking folder: ' + monthDayFolderString);
            hourIndex = -1;

            if (directoryReadTimeoutTimer) {
              clearTimeout(directoryReadTimeoutTimer);
              directoryReadTimeoutTimer = null;
            }
            directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

            sftpClient.list(monthDayFolderString).then((monthDayList) => {
              if (directoryReadTimeoutTimer) {
                clearTimeout(directoryReadTimeoutTimer);
                directoryReadTimeoutTimer = null;
              } else {
                // console.log('!!! timeout on monthDayFolder: ' + monthDayFolderString +
                //             ' directory read');
                callback(new Error(`timeout on monthDayFolder: ${monthDayFolderString} directory read`));
                return;
              }

              monthDayArray = [];
              for (monthDayIndex = 0; monthDayIndex < monthDayList.length; monthDayIndex += 1) {
                if (monthDayList[monthDayIndex].type === 'd') {
                  const folderName = monthDayList[monthDayIndex].name;
                  // eslint-disable-next-line no-restricted-globals
                  if (!isNaN(folderName)) {
                    monthDayArray.push(folderName);
                  }
                }
              }
              monthDayArray.sort();
              monthDayIndex = monthDayArray.length - 1;
              if (monthDayIndex < 0) { // no monthDays folders found for this year
                yearIndex -= 1;
                if (yearIndex < 0) {
                  doneFlag = true;
                }
              }
              callback2(null);
            }).catch((err) => {
              if (err) {
                log.error(`---- ${machineName}: error in read of year directory.  err = ${err}`);
              }
              if (directoryReadTimeoutTimer) {
                clearTimeout(directoryReadTimeoutTimer);
                directoryReadTimeoutTimer = null;
              }
              yearIndex -= 1;
              if (yearIndex < 0) {
                doneFlag = true;
              }
              callback2(null);
            });
          } else if (hourIndex === -1) {
            hourFolderString = `/Images/${yearArray[yearIndex]}/${monthDayArray[monthDayIndex]}/`;
            // console.log('----- ' + machineName + ': checking folder: ' + hourFolderString);

            if (directoryReadTimeoutTimer) {
              clearTimeout(directoryReadTimeoutTimer);
              directoryReadTimeoutTimer = null;
            }
            directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

            sftpClient.list(hourFolderString).then((hourList) => {
              if (directoryReadTimeoutTimer) {
                clearTimeout(directoryReadTimeoutTimer);
                directoryReadTimeoutTimer = null;
              } else {
                // console.log('!!! timeout on hourFolder: ' + hourFolderString +
                //             ' directory read');
                callback(new Error(`timeout on hourFolder: ${hourFolderString} directory read`));
                return;
              }

              hourArray = [];
              for (hourIndex = 0; hourIndex < hourList.length; hourIndex += 1) {
                if (hourList[hourIndex].type === 'd') {
                  const folderName = hourList[hourIndex].name;
                  // eslint-disable-next-line no-restricted-globals
                  if (!isNaN(folderName)) {
                    hourArray.push(folderName);
                  }
                }
              }
              hourArray.sort();
              hourIndex = hourArray.length - 1;
              if (hourIndex < 0) { // no monthDays folders found for this year
                monthDayIndex -= 1;
                if (monthDayIndex < 0) {
                  yearIndex -= 1;
                  if (yearIndex < 0) {
                    doneFlag = true;
                  }
                }
              }
              callback2(null);
            }).catch((err) => {
              if (err) {
                log.error(`---- ${machineName}: error in read of monthDay directory.  err = ${err}`);
              }
              if (directoryReadTimeoutTimer) {
                clearTimeout(directoryReadTimeoutTimer);
                directoryReadTimeoutTimer = null;
              }
              monthDayIndex -= 1;
              if (monthDayIndex < 0) {
                yearIndex -= 1;
                if (yearIndex < 0) {
                  doneFlag = true;
                }
              }
              callback2(null);
            });
          } else {
            const baseFolderString = `/Images/${yearArray[yearIndex]}/${monthDayArray[monthDayIndex]}/${hourArray[hourIndex]}`;
            if (baseFolderString >= latestXmlFolder) {
              // have a valid year/monthDay/hour folder - see if has an xml folder
              xmlFolderString = `${baseFolderString}/${serverFolder}`;
              // console.log('----- ' + machineName + ': checking folder: ' + xmlFolderString);

              // eslint-disable-next-line no-useless-escape
              const xmlRegex = new RegExp('^.*\.xml$');

              if (directoryReadTimeoutTimer) {
                clearTimeout(directoryReadTimeoutTimer);
                directoryReadTimeoutTimer = null;
              }
              directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

              sftpClient.list(xmlFolderString, xmlRegex).then((latestFolderData) => {
                if (directoryReadTimeoutTimer) {
                  clearTimeout(directoryReadTimeoutTimer);
                  directoryReadTimeoutTimer = null;
                } else {
                  // console.log('!!! timeout on xmlFolder: ' + xmlFolderString +
                  //             ' directory read');
                  callback(new Error(`timeout on xmlFolder: ${xmlFolderString} directory read`));
                  return;
                }

                // console.log('--- ' + machineName + ': found xml folder: ' + xmlFolderString);
                // search the folder list to find the newest file
                for (let fileIndex = 0; fileIndex < latestFolderData.length; fileIndex += 1) {
                  if (latestFolderData[fileIndex].type === '-') { // entry is a file
                    if (latestFolderData[fileIndex].modifyTime > lastFileReadTimestamp) {
                      newXmlFilenames.push({
                        name: `${xmlFolderString}/${latestFolderData[fileIndex].name}`,
                        modifyTime: latestFolderData[fileIndex].modifyTime,
                      });
                      if (newLatestXmlFolder === '') {
                        // since we're working backwards through the directories,
                        // the first one we find becomes out new latest.
                        newLatestXmlFolder = baseFolderString;
                      }
                    }
                  }
                }
                hourIndex -= 1;
                if (hourIndex < 0) { // no monthDays folders found for this year
                  monthDayIndex -= 1;
                  if (monthDayIndex < 0) {
                    yearIndex -= 1;
                    if (yearIndex < 0) {
                      doneFlag = true;
                    }
                  }
                }
                callback2(null);
              }).catch((err) => {
                if (err) {
                  log.error(`error in read of monthDay directory.  err = ${err}`);
                }
                if (directoryReadTimeoutTimer) {
                  clearTimeout(directoryReadTimeoutTimer);
                  directoryReadTimeoutTimer = null;
                }
                hourIndex -= 1;
                if (hourIndex < 0) { // no monthDays folders found for this year
                  monthDayIndex -= 1;
                  if (monthDayIndex < 0) {
                    yearIndex -= 1;
                    if (yearIndex < 0) {
                      doneFlag = true;
                    }
                  }
                }
                callback2(null);
              });
            } else {
              doneFlag = true;
              callback2(null);
            }
          }
        },
        (err, n) => {
          if (err) {
            log.error(`---- ${machineName}: end of whilst, err = ${err}, n = ${n}`);
          }
          // if (newXmlFilenames.length > 0) {
          // eslint-disable-next-line max-len
          //   console.log(`--- ${machineName}: new xml files found: ${JSON.stringify(newXmlFilenames)}`);
          // }
          if (newLatestXmlFolder !== '') {
            latestXmlFolder = newLatestXmlFolder;
          }
          callback(null);
        },
      );
    }).catch((err) => {
      log.error(`---- ${machineName}: error in read of year directory.  err = ${err}`);
      if (directoryReadTimeoutTimer) {
        // console.log('>>> ' + machineName + ': getNewXMLFiles - clearing directoryReadTimeout');
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      }
      callback(err);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readAndProcessFile(filename, callback) {
    // console.log(`>>>>> ${machineName}: reading file: ${filename}`);

    if (fileReadTimeoutTimer) {
      clearTimeout(fileReadTimeoutTimer);
      fileReadTimeoutTimer = null;
    }
    fileReadTimeoutTimer = setTimeout(fileReadTimeout, fileReadTimeoutMs);

    sftpClient.get(filename).then((data) => {
      // console.log(`>>>>> ${machineName}: finished reading file: ${filename}`);
      if (fileReadTimeoutTimer) {
        clearTimeout(fileReadTimeoutTimer);
        fileReadTimeoutTimer = null;
      } else {
        callback(new Error(`timeout on file: ${filename} read`));
        return;
      }

      // console.log('>>>>> ' + machineName + ': file transferred into memory.  Buffer size = ' +
      //             data.length);
      // console.log('>>>>> ' + machineName + ': first 100 bytes = ' + data.slice(0,99));

      const combinedResultArray = [];
      const combinedResult = {};
      combinedResult.FileName = filename;
      combinedResult.FileData = data.toString();
      combinedResultArray.push(combinedResult);

      // console.log('--------------- ' + machineName + ': updating database');

      updateAllVariablesWithCombinedResult(combinedResultArray);
      callback(null);
    }).catch((err) => {
      log.error(`--- ${machineName}: sftpClient.get err = ${err}`);
      callback(err);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readTimerFunc() {
    if (readingFile) {
      log.info(`---- ${machineName}: still working on previous file read`);
      return;
    }

    readingFile = true;

    // console.log(`!!!! ${machineName}: timer: readTimerFunc`);
    // const startMilliseconds = Date.now();
    // let endMilliseconds;

    if (initialDirectoryRead) {
      initialDirectoryRead = false;
      findLatestXmlFile((err) => {
        if (err) {
          log.error(`!!!!!! ${machineName}: findLatestXmlFile : err = ${err}`);
          return;
        }

        // console.log('----- ' + machineName + ': after list');
        // endMilliseconds = Date.now();
        // console.log('--- ' + machineName + ': elapsed milliseconds = ' +
        //             (endMilliseconds - startMilliseconds));
        if (latestXmlFilename === '') {
          // console.log('--- ' + machineName + ': NO XML FILES FOUND');
          readingFile = false;
        } else {
          // console.log('--- ' + machineName + ': latestXmlFilename = ' + latestXmlFilename);
          readAndProcessFile(latestXmlFilename, (readErr) => {
            if (readErr) {
              log.error(`!!!!!! ${machineName}: findLatestXmlFile : readErr = ${readErr}`);
              return;
            }
            readingFile = false;
            // console.log('----- ' + machineName + ': timer function exit');
            // endMilliseconds = Date.now();
            // console.log('--- ' + machineName + ': total elapsed milliseconds = ' +
            //             (endMilliseconds - startMilliseconds));
          });
        }
      });
    } else {
      getNewXMLFiles((err) => {
        if (err) {
          log.error(`!!!!!! ${machineName}: getNewXMLFiles : err = ${err}`);
          return;
        }

        // console.log('----- ' + machineName + ': after list');
        // endMilliseconds = Date.now();
        const numberOfNewFiles = newXmlFilenames.length;
        // console.log('--- ' + machineName + ': found ' + numberOfNewFiles + ' new xml files');
        // console.log('--- ' + machineName + ': elapsed milliseconds = ' +
        //             (endMilliseconds - startMilliseconds));
        if (numberOfNewFiles > 0) {
          // eslint-disable-next-line no-nested-ternary
          newXmlFilenames.sort((a, b) => ((a.modifyTime > b.modifyTime) ? -1
            : ((a.modifyTime === b.modifyTime) ? 0 : 1)));
          // console.log('--- ' + machineName + ': latest newXmlFilename = ' +
          //             JSON.stringify(newXmlFilenames[0]));
          lastFileReadTimestamp = newXmlFilenames[0].modifyTime;
          // console.log('--- ' + machineName + ': new lastFileReadTimestamp: ' +
          //             lastFileReadTimestamp);
          let fileIndex = numberOfNewFiles - 1; // start at the end to deliver newest last
          async.whilst(
            () => (fileIndex >= 0),
            (callback) => {
              readAndProcessFile(newXmlFilenames[fileIndex].name, (readErr) => {
                if (readErr) {
                  log.error(`!!!!!! ${machineName}: getNewXMLFiles : readErr = ${readErr}`);
                  callback(readErr);
                } else {
                  fileIndex -= 1;
                  // endMilliseconds = Date.now();
                  // console.log('--- ' + machineName + ': elapsed milliseconds = ' +
                  //             endMilliseconds - startMilliseconds');
                  callback(null);
                }
              });
            },
            (whilstErr, n) => {
              if (whilstErr) {
                log.error(`--- getNewXMLFiles whilstErr = ${whilstErr}, n = ${n}`);
              }
              // console.log('----- ' + machineName + ': timer function exit');
              // endMilliseconds = Date.now();
              // console.log('--- ' + machineName + ': total elapsed milliseconds = ' +
              //             (endMilliseconds - startMilliseconds));
              readingFile = false;
            },
          );
        } else {
          // endMilliseconds = Date.now();
          // console.log('--- ' + machineName + ': total elapsed milliseconds = ' +
          //             (endMilliseconds - startMilliseconds));
          readingFile = false;
        }
      });
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function open(callback) {
    log.info(`--------------- ${machineName}: sftp open`);

    if (readTimer) {
      clearInterval(readTimer);
      readTimer = null;
    }

    ({ username } = that.machine.settings.model);
    ({ password } = that.machine.settings.model);
    readFrequencyMs = that.machine.settings.model.readFrequency * 1000;

    serverUrl = that.machine.settings.model.sftpUrl;
    serverPort = that.machine.settings.model.sftpPort;
    serverFolder = that.machine.settings.model.sftpFolder;

    log.info(`--------------- ${machineName}: creating sftp client`);
    sftpClient = new Client();
    log.info(`--------------- ${machineName}: sftp client created`);

    const connectOptions = {
      host: serverUrl,
      port: serverPort,
      username,
      password,
    };
    log.info(`--- ${machineName}: connectOptions = ${JSON.stringify(connectOptions)}`);

    sftpClient.connect(connectOptions).then(() => {
      log.info(`----- ${machineName}: sftpClient connected`);
      // schedule subsequent reads
      readTimer = setInterval(readTimerFunc, readFrequencyMs);
    }).catch((err) => {
      log.error(`${machineName}: sftpClient.connect catch err = ${err}`);
    });


    readingFile = false;
    initialDirectoryRead = true;

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

    readingFile = false;

    if (readTimer) {
      clearInterval(readTimer);
      readTimer = null;
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
  hpl: hplSftp,
  defaults,
  schema,
};
