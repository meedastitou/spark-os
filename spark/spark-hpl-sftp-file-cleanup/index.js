/* jshint esversion: 6 */
const async = require('async');
const _ = require('lodash');
const Client = require('ssh2-sftp-client');
const ssh2Client = require('ssh2').Client;

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplSftpFileCleanup = function hplSftpFileCleanup(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine);
  if (model) {
    that.machine.settings.model = _.cloneDeep(model);
  }

  let ssh2Connection = null;

  // Private variables
  let sftpClient = null;
  let checkTimer = null;
  let directoryReadTimeoutTimer = null;
  const directoryReadTimeoutMs = 60000; // wait 1 minute for directory list response

  let username = '';
  let password = '';
  let checkFrequencyMs = 60000;
  let readingFile = false;

  let serverUrl = '';
  let serverPort = 0;
  let serverFolder = '';

  let sftpClientConnectedFlag = false;
  // for testing, uncomment the next line - and where it is used - and we will
  // NOT actually issue the delete folder command
  // const fileCount = 0;

  let cleanupAgeLimitMs = 0;
  let folderPurgedFlag = false;
  let purgeFileDate = 0;
  let lastPurgeFileDay = 0;

  let startMilliseconds = 0;
  let endMilliseconds = 0;

  let deleteFailedList = [];
  const deleteFailedRetryList = {};
  const RETRY_FOLDER_DELETE_LIMIT = 3;

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

  function updateAllVariablesWithCombinedResult(updateString) {
    // extract the variable values
    that.machine.variables.forEach((variable) => {
      updateDatabase(variable, updateString);
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
    // directory read.  So close the sftp socket, the ssh2 communication and re-open.
    directoryReadTimeoutTimer = null;

    sftpClient.end();
    sftpClientConnectedFlag = false;

    if (ssh2Connection !== null) {
      ssh2Connection.end();
    }

    // eslint-disable-next-line no-use-before-define
    open((err) => {
      if (err) {
        log.info(`error in restarting connections after timeout.  err = ${err}`);
      } else {
        log.info('Restarted connections after directory list timeout');
        log.info('--detected and fixed directory read timeout');
      }
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function sendRemoveRemoteDirectoryCommand(pathname, callback) {
    folderPurgedFlag = true;

    let updateString = `---------- removing folder: ${serverUrl}: ${pathname}`;
    updateAllVariablesWithCombinedResult(updateString);
    // console.log(updateString);

    let commandString;
    if (_.get(that.machine.settings.model, 'stripLeadingSlashForDeleteDirectoryPath', true)) {
      commandString = `rmdir ${pathname.substring(1).replace(/\//g, '\\')} /s /q`;
    } else {
      commandString = `rmdir ${pathname.replace(/\//g, '\\')} /s /q`;
    }
    // commandString = 'dir';
    // console.log('>>>>>>>>>>>>>>>>>>>> commandString = ' + commandString);

    // for testing, uncomment the next two lines and we will NOT actually
    // issue the delete folder command
    // fileCount += 1;
    // if (fileCount <= 0) {

    // console.log('checking ssh2 client ready');
    // connect our ssh2 session
    // eslint-disable-next-line new-cap
    ssh2Connection = new ssh2Client();
    ssh2Connection.on('ready', () => {
      log.info('Client :: ready');
      ssh2Connection.exec(commandString, (err, stream) => {
        if (err) {
          log.error(`ssh2Connection.exec: err = ${err}`);
          callback(err);
        }
        stream.on('close', (code, signal) => {
          log.info(`stream.on close: code = ${code}   signal = ${signal}`);
          endMilliseconds = Date.now();
          if (deleteFailedList.includes(pathname)) {
            updateString = `---------- file server error, retry limit exceeded: folder: ${serverUrl}: ${pathname}   total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`;
          } else {
            const retryCount = _.get(deleteFailedRetryList, pathname, 0);
            if (retryCount > 0) {
              updateString = `---------- file server error, retry count: ${retryCount}, folder: ${serverUrl}: ${pathname}   total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`;
            } else {
              updateString = `---------- folder removed: ${serverUrl}: ${pathname}   total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`;
            }
          }
          updateAllVariablesWithCombinedResult(updateString);
          // console.log(updateString);
          ssh2Connection.end();
          callback(null);
        }).on('data', (data) => {
          log.info(`STDOUT: ${data}`);
        }).stderr.on('data', (data) => {
          let retryCount = _.get(deleteFailedRetryList, pathname, 0);
          retryCount += 1;
          if (retryCount > RETRY_FOLDER_DELETE_LIMIT) {
            if (!deleteFailedList.includes(pathname)) {
              deleteFailedList.push(pathname);
            }
            delete (deleteFailedRetryList[pathname]);
          } else {
            deleteFailedRetryList[pathname] = retryCount;
          }
          log.error(`STDERR: ${data}`);
        });
      });
    }).on('error', (err) => {
      if (err) {
        log.error(`ssh2Connection.on error err = ${err}`);
      }
      ssh2Connection = null;
    }).connect({
      host: serverUrl,
      port: serverPort,
      username,
      password,
    });

    // for testing, uncomment the following else block to annouce the deletion
    //  without actually doing the delete
    // } else {
    //   endMilliseconds = Date.now();
    //   updateString = '---------- folder WOULD HAVE BEEN removed: ' + serverUrl + ': ' +
    //                   pathname + '   total elapsed milliseconds = ' +
    //                   (endMilliseconds - startMilliseconds);
    //   updateAllVariablesWithCombinedResult(updateString);
    //   console.log(updateString);
    //   // add this pathname to the failed list, so we don't try it again for another day
    //   if (!deleteFailedList.includes(pathname)) {
    //     deleteFailedList.push(pathname);
    //   }
    //   callback(null);
    // }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function removeRemoteDirectory(pathname, callback) {
    startMilliseconds = Date.now();
    let updateString;

    // only try to delete if we have not already failed to delete the folder
    if (!deleteFailedList.includes(pathname)) {
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      }
      directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

      // if the folder is completely empty, try to delete it
      sftpClient.list(pathname).then((dayFolderList) => {
        if (directoryReadTimeoutTimer) {
          clearTimeout(directoryReadTimeoutTimer);
          directoryReadTimeoutTimer = null;
        } else {
          callback(new Error('timeout on MonthDate directory read to check for empty folder'));
          return;
        }

        if (dayFolderList.length === 0) {
          updateString = `---------- found empty folder prior to purge date: ${serverUrl}: ${pathname}`;
          updateAllVariablesWithCombinedResult(updateString);
          // console.log(updateString);
          sendRemoveRemoteDirectoryCommand(pathname, callback);
        } else {
          // check for the 'purging_check.txt' file to determine if we're ok to delete this folder
          let foundPurgingCheckFile = false;
          for (let folderListIndex = 0;
            folderListIndex < dayFolderList.length;
            folderListIndex += 1) {
            if ((dayFolderList[folderListIndex].type === '-')
                && (dayFolderList[folderListIndex].name === 'purging_check.txt')) {
              foundPurgingCheckFile = true;
              folderListIndex = dayFolderList.length; // short-circuit the loop
            }
          }
          if (!foundPurgingCheckFile) {
            updateString = `---------- no purging_check.txt file found in folder: ${serverUrl}: ${pathname}`;
            updateAllVariablesWithCombinedResult(updateString);
            // console.log(updateString);
            if (!deleteFailedList.includes(pathname)) {
              deleteFailedList.push(pathname);
            }
            callback(null); // move on to the next folder
            return;
          }

          sftpClient.get(`${pathname}/purging_check.txt`).then((data) => {
            // eslint-disable-next-line max-len
            // console.log(`>>> purging_check.txt transferred into memory.  Buffer size = ${data.length}`);
            const checkString = data.toString();
            // console.log(`>>>>>>>>>>> contents: ${checkString}`);

            if (checkString !== 'OK') {
              updateString = `not allowed to purge folder: ${serverUrl}: ${pathname} : ${checkString}`;
              updateAllVariablesWithCombinedResult(updateString);
              // console.log(updateString);
              if (!deleteFailedList.includes(pathname)) {
                deleteFailedList.push(pathname);
              }
              callback(null); // move on to the next folder
            } else {
              sendRemoveRemoteDirectoryCommand(pathname, callback);
            }
          }).catch((err) => {
            if (err) {
              log.error(`sftpClient.get catch err = ${err}`);
            }
            callback(err);
          });
        }
      });
    } else {
      // console.log('---- skipping folder: ' + serverUrl + ': ' + pathname);
      callback(null);
    }
  }

  // //-----------------------------------------------------------------------------
  // //-----------------------------------------------------------------------------
  // //-----------------------------------------------------------------------------
  //
  // function checkDirectoriesForMonthDate(pathname, yearInt, callback) {
  //
  //   let updateString = '----- checking folder: ' + serverUrl + ': ' + pathname;
  //   // updateAllVariablesWithCombinedResult(updateString);
  //   console.log(updateString);
  //
  //   directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);
  //
  //   sftpClient.list(pathname).then((monthDateList) => {
  //     if (directoryReadTimeoutTimer) {
  //       clearTimeout(directoryReadTimeoutTimer);
  //       directoryReadTimeoutTimer = null;
  //     } else {
  //       callback(new Error('timeout on MonthDate directory read'));
  //       return;
  //     }
  //
  //     let monthDateArray = [];
  //     let monthDateIndex = 0;
  //     for (monthDateIndex = 0; monthDateIndex < monthDateList.length; monthDateIndex += 1) {
  //       if (monthDateList[monthDateIndex].type === 'd') {
  //         let folderName = monthDateList[monthDateIndex].name;
  //         if (!isNaN(folderName)) {
  //           monthDateArray.push(folderName);
  //         }
  //       }
  //     }
  //     monthDateArray.sort();
  //
  //     monthDateIndex = 0;
  //     let purgeYear = purgeFileDate.getFullYear();
  //     let purgeMonth = purgeFileDate.getMonth() + 1;
  //     let purgeDate = purgeFileDate.getDate();
  //     let doneFlag = false;
  //
  //     async.whilst(
  //       function () {
  //         return (!doneFlag) && (monthDateIndex < monthDateArray.length);
  //       },
  //       function (callback2) {
  //         let monthInt = parseInt(monthDateArray[monthDateIndex].substring(0,2));
  //         let dateInt = parseInt(monthDateArray[monthDateIndex].substring(2,4));
  //         let newPathname = pathname + monthDateArray[monthDateIndex] +'/';
  //         monthDateIndex += 1;
  //         if ((yearInt < purgeYear) || (monthInt < purgeMonth)) {
  //           // since we're on a month earlier than our purge date,
  //           // the entire monthDate folder can be deleted
  //           removeRemoteDirectory(newPathname, callback2);
  //         } else if (monthInt === purgeMonth) {
  //           // month matches, so we MIGHT need to delete some monthday folders
  //           if (dateInt <= purgeDate) {
  //             // since we're on a date on or before our purge date,
  //             // the entire monthDate folder can be deleted
  //             removeRemoteDirectory(newPathname, callback2);
  //           } else {
  //             doneFlag = true;
  //             callback2(null);
  //           }
  //         } else {
  //           doneFlag = true;
  //           callback2(null);
  //         }
  //       },
  //       function (err, n) {
  //         if (err) {
  //           callback (err);
  //         } else {
  //           // updateString = '----- done with folder: ' + serverUrl + ': ' + pathname;
  //           // updateAllVariablesWithCombinedResult(updateString);
  //           // console.log(updateString);
  //
  //           callback(null);
  //         }
  //       }
  //     );
  //   }).catch((err) => {
  //     console.log('--- sftpClient.list err = ' + err);
  //     callback(err);
  //   });
  // }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function checkMonthFolderForDate(pathname, yearInt, monthInt, callback) {
    // let updateString = `----- checking folder: ${serverUrl}: ${pathname}`;
    // updateAllVariablesWithCombinedResult(updateString);
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
        callback(new Error('timeout on Month directory read'));
        return;
      }

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

      dateIndex = 0;
      const purgeYear = purgeFileDate.getFullYear();
      const purgeMonth = purgeFileDate.getMonth() + 1;
      const purgeDate = purgeFileDate.getDate();
      let doneFlag = false;

      async.whilst(
        () => (!doneFlag) && (dateIndex < dateArray.length),
        (callback2) => {
          const dateInt = parseInt(dateArray[dateIndex], 10);
          const newPathname = `${pathname + dateArray[dateIndex]}/`;
          dateIndex += 1;
          if ((yearInt < purgeYear) || (monthInt < purgeMonth)) {
            // since we're on a month earlier than our purge date,
            // the entire monthDate folder can be deleted
            removeRemoteDirectory(newPathname, callback2);
          } else if (monthInt === purgeMonth) {
            // month matches, so we MIGHT need to delete some monthday folders
            if (dateInt <= purgeDate) {
              // since we're on a date on or before our purge date,
              // the entire monthDate folder can be deleted
              removeRemoteDirectory(newPathname, callback2);
            } else {
              doneFlag = true;
              callback2(null);
            }
          } else {
            doneFlag = true;
            callback2(null);
          }
        },
        (err) => {
          if (err) {
            callback(err);
          } else {
            // updateString = `----- done with folder: ${serverUrl}: ${pathname}`;
            // updateAllVariablesWithCombinedResult(updateString);
            // console.log(updateString);

            callback(null);
          }
        },
      );
    }).catch((err) => {
      if (err) {
        log.error(`sftpClient.list: catch err = ${err}`);
      }
      callback(err);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function processMonthFolders(monthArray, pathname, yearInt, callback) {
    let monthIndex = 0;
    const purgeYear = purgeFileDate.getFullYear();
    const purgeMonth = purgeFileDate.getMonth() + 1;
    let doneFlag = false;

    // console.log('---------------------processMonthFolders');
    // console.log('---------------------monthArray.length = ' + monthArray.length);
    async.whilst(
      () => (!doneFlag) && (monthIndex < monthArray.length),
      (callback2) => {
        const monthInt = parseInt(monthArray[monthIndex], 10);
        const newPathname = `${pathname + monthArray[monthIndex]}/`;
        monthIndex += 1;
        // console.log('---------------------yearInt = ' + yearInt);
        // console.log('---------------------purgeYear = ' + purgeYear);
        // console.log('---------------------monthInt = ' + monthInt);
        // console.log('---------------------purgeMonth = ' + purgeMonth);
        if ((yearInt < purgeYear) || (monthInt < purgeMonth)) {
          // since we're on a month earlier than our purge date,
          // the entire monthDate folder can be deleted
          removeRemoteDirectory(newPathname, callback2);
        } else if (monthInt === purgeMonth) {
          // month matches, so we MIGHT need to delete some day folders
          checkMonthFolderForDate(newPathname, yearInt, monthInt, callback2);
        } else {
          doneFlag = true;
          callback2(null);
        }
      },
      (err) => {
        if (err) {
          callback(err);
        } else {
          // updateString = `----- done with folder: ${serverUrl}: ${pathname}`;
          // updateAllVariablesWithCombinedResult(updateString);
          // console.log(updateString);

          callback(null);
        }
      },
    );
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function processMonthDateFolders(monthDateArray, pathname, yearInt, callback) {
    let monthDateIndex = 0;
    const purgeYear = purgeFileDate.getFullYear();
    const purgeMonth = purgeFileDate.getMonth() + 1;
    const purgeDate = purgeFileDate.getDate();
    let doneFlag = false;

    async.whilst(
      () => (!doneFlag) && (monthDateIndex < monthDateArray.length),
      (callback2) => {
        const monthInt = parseInt(monthDateArray[monthDateIndex].substring(0, 2), 10);
        const dateInt = parseInt(monthDateArray[monthDateIndex].substring(2, 4), 10);
        const newPathname = `${pathname + monthDateArray[monthDateIndex]}/`;
        monthDateIndex += 1;
        if ((yearInt < purgeYear) || (monthInt < purgeMonth)) {
          // since we're on a month earlier than our purge date,
          // the entire monthDate folder can be deleted
          removeRemoteDirectory(newPathname, callback2);
        } else if (monthInt === purgeMonth) {
          // month matches, so we MIGHT need to delete some monthday folders
          if (dateInt <= purgeDate) {
            // since we're on a date on or before our purge date,
            // the entire monthDate folder can be deleted
            removeRemoteDirectory(newPathname, callback2);
          } else {
            doneFlag = true;
            callback2(null);
          }
        } else {
          doneFlag = true;
          callback2(null);
        }
      },
      (err) => {
        if (err) {
          callback(err);
        } else {
          // updateString = '----- done with folder: ' + serverUrl + ': ' + pathname;
          // updateAllVariablesWithCombinedResult(updateString);
          // console.log(updateString);

          callback(null);
        }
      },
    );
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function checkYearFolderForMonthOrMonthDate(pathname, yearInt, callback) {
    // const updateString = `----- checking folder: ${serverUrl}: ${pathname}`;
    // updateAllVariablesWithCombinedResult(updateString);
    // console.log(updateString);

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    sftpClient.list(pathname).then((yearFolderList) => {
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on Year folder directory read'));
        return;
      }

      const yearFolderSubfolderArray = [];

      let yearFolderListIndex = 0;
      for (yearFolderListIndex = 0;
        yearFolderListIndex < yearFolderList.length;
        yearFolderListIndex += 1) {
        if (yearFolderList[yearFolderListIndex].type === 'd') {
          const folderName = yearFolderList[yearFolderListIndex].name;
          // eslint-disable-next-line no-restricted-globals
          if (!isNaN(folderName)) {
            yearFolderSubfolderArray.push(folderName);
          }
        }
      }
      yearFolderSubfolderArray.sort();

      if (yearFolderSubfolderArray.length > 0) {
        if (yearFolderSubfolderArray[0].length === 4) {
          // folder structure is:
          // root/
          //      year/
          //           month-date/
          // ex.  root/
          //           2021/
          //           2022/
          //                0829/
          //                0830/
          //                0831/
          //                0901/
          //                0902/
          //                0903/
          //                0904/
          //                0905/
          // console.log('<<<<<<<<<<<<<<<<< processMonthDateFolders >>>>>>>>>>>>>>>>>>>>');
          processMonthDateFolders(yearFolderSubfolderArray, pathname, yearInt, callback);
        } else if (yearFolderSubfolderArray[0].length === 2) {
          // folder structure is:
          // root/
          //      year/
          //           month/
          //                 date/
          // ex.  root/
          //           2021/
          //           2022/
          //                08/
          //                   29/
          //                   30/
          //                   31/
          //                09/
          //                   01/
          //                   02/
          //                   03/
          //                   04/
          //                   05/
          // console.log('<<<<<<<<<<<<<<<<< processMonthFolders >>>>>>>>>>>>>>>>>>>>');
          processMonthFolders(yearFolderSubfolderArray, pathname, yearInt, callback);
        }
      }
    }).catch((err) => {
      if (err) {
        log.error(`sftpClient.list: catch err = ${err}`);
      }
      callback(err);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function checkDirectoriesForYear(pathname, callback) {
    // let updateString = `----- checking folder: ${serverUrl}: ${pathname}`;
    // updateAllVariablesWithCombinedResult(updateString);
    // console.log(updateString);

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    sftpClient.list(pathname).then((yearList) => {
      if (directoryReadTimeoutTimer) {
        clearTimeout(directoryReadTimeoutTimer);
        directoryReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout on Year directory read'));
        return;
      }

      const yearArray = [];
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

      yearIndex = 0;
      const purgeYear = purgeFileDate.getFullYear();
      let doneFlag = false;

      async.whilst(
        () => (!doneFlag) && (yearIndex < yearArray.length),
        (callback2) => {
          const yearInt = parseInt(yearArray[yearIndex], 10);
          const newPathname = `${pathname + yearArray[yearIndex]}/`;
          yearIndex += 1;
          // if (yearInt < purgeYear) {
          //   // since we're on a year earlier than our purge date,
          //   // the entire year folder can be deleted
          //   removeRemoteDirectory(newPathname, callback2);
          // } else if (yearInt === purgeYear) {
          if (yearInt <= purgeYear) {
            // year matches, so we MIGHT need to delete some monthday folders
            checkYearFolderForMonthOrMonthDate(newPathname, yearInt, callback2);
          } else {
            doneFlag = true;
            callback2(null);
          }
        },
        (err) => {
          if (err) {
            callback(err);
          } else {
            // updateString = `----- done with folder: ${serverUrl}: ${pathname}`;
            // updateAllVariablesWithCombinedResult(updateString);
            // console.log(updateString);

            callback(null);
          }
        },
      );
    }).catch((err) => {
      if (err) {
        log.error(`sftpClient.list catch err = ${err}`);
      }
      callback(err);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function checkTimerFunc() {
    if (readingFile) {
      //      console.log('----still working on previous file operation: ' + serverUrl);
      return;
    }


    readingFile = true;
    folderPurgedFlag = false;

    //    console.log('!!!! timer: checkTimerFunc: ' + serverUrl);
    startMilliseconds = Date.now();

    purgeFileDate = new Date(startMilliseconds - cleanupAgeLimitMs);
    if (lastPurgeFileDay !== purgeFileDate.getDate()) {
      lastPurgeFileDay = purgeFileDate.getDate();
      // clear out the delete-failed-list, forcing a recheck of all previously
      // failed folders each new day.
      deleteFailedList = [];
    }

    checkDirectoriesForYear(serverFolder, (err) => {
      if (err) {
        log.error(`checkDirectoriesForYear: err = ${err}`);
      }
      endMilliseconds = Date.now();
      if (folderPurgedFlag) {
        const updateString = `--- TOTAL elapsed milliseconds = ${endMilliseconds - startMilliseconds}: ${serverUrl}`;
        updateAllVariablesWithCombinedResult(updateString);
        // console.log(updateString);
      }
      readingFile = false;
    });
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
    cleanupAgeLimitMs = (that.machine.settings.model.cleanupAgeLimit + 1) * 1000 * 60 * 60 * 24;
    checkFrequencyMs = that.machine.settings.model.checkFrequency * 1000;

    serverUrl = that.machine.settings.model.sftpUrl;
    serverPort = that.machine.settings.model.sftpPort;
    serverFolder = that.machine.settings.model.sftpFolder;
    log.info('--------------- creating sftp client');
    sftpClient = new Client();
    log.info('--------------- sftp client created');

    // clear the list of skipped folders
    deleteFailedList = [];

    readingFile = false;

    const connectOptions = {
      host: serverUrl,
      port: serverPort,
      username,
      password,
    };
    // console.log(`--- connectOptions = ${JSON.stringify(connectOptions)}`);

    sftpClient.connect(connectOptions).then(() => {
      log.info('sftpClient connected');
      sftpClientConnectedFlag = true;

      setImmediate(checkTimerFunc); // initial check to start immediately.
      // schedule subsequent reads
      checkTimer = setInterval(checkTimerFunc, checkFrequencyMs);
    }).catch((err) => {
      log.error(`sftpClient.connect: cstch err = ${err}`);
    });

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

    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }

    if (sftpClientConnectedFlag) {
      // shut down our sftp client
      log.info('--- sftpClient.end()');
      sftpClient.end();
      sftpClientConnectedFlag = false;
    }

    if (ssh2Connection !== null) {
      ssh2Connection.end();
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
  hpl: hplSftpFileCleanup,
  defaults,
  schema,
};
