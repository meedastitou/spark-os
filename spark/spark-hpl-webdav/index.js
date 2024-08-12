/* jshint esversion: 6 */
const _ = require('lodash');
let webdav = require('webdav');
const async = require('async');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

//-------------------------------------------------------------------------
//-------------------------------------------------------------------------
//-------------------------------------------------------------------------

// constructor
const hplWebDAV = function hplWebDAV(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'file-not-found-error': {
      msg: `${machine.info.name}: File Not Found`,
      description: x => `The file ${x.filename} could not be found on the WebDAV server`,
    },
    'directory-read-error': {
      msg: `${machine.info.name}: Directory Read Error`,
      description: 'The specified directory could not be read on the WebDAV server',
    },
    'base-filename-not-found-error': {
      msg: `${machine.info.name}: File With Base Filename Not Found`,
      description: x => `No file with the base filename ${x.baseFilename} could be found on the WebDAV server`,
    },
    'database-error': {
      msg: `${machine.info.name}: Error Writing to Database`,
      description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
    },
    'datetime-error': {
      msg: 'webDAV Dynamic: Error with date/time field',
      description: 'The specified field in the file could not be converted to a proper date/time value',
    },
  });

  // if running test harness, get webdav test client
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line global-require
    webdav = require('./test/webdav-test-client');
  }

  // Private variables
  const that = this;
  let webdavClient = null;
  let readTimer = null;
  let username = '';
  let password = '';
  let readFrequencyMs = 5000;
  let lastFileRead = '';
  let lastRowRead = 0;
  let running = false;

  let lastFileReadTimestamp = 0;
  let lastFileReadName = '';
  let latestRowTimestamp = 0;
  let latestTimestampRowIndex = 0;
  const maxNumberOfFilesToReport = 1;
  const maxNumberOfRowsToReport = 2500;
  let timestampFieldIndex1 = 0; // assume first field is the timestamp
  let timestampFieldIndex2 = -1; // use -1 to indicate that there is NO second timestamp field
  let checkAllFilesFlag = false;
  let combinedResultArray = [];

  let fileContentsString = '';
  let continueProcessingCurrentFileFlag = false;
  let continueProcessingFilename = '';
  let continueProcessingFileTimestamp = 0;

  // FORCE EARLY TIMESTAMP FOR TESTING
  // let firstReadFlag = true;  // used for testing
  // let firstProcessFlag = true;  // used for testing
  // // END FORCE EARLY TIMESTAMP FOR TESTING

  let latestLargeFileTimestampRowFields = [];
  let latestLargeFileTimestamp = 0;
  let latestLargeFileRowTimestamp = 0;
  let largeFileRowIndex = 0;

  let totalFilesize = 0;
  let keywords = [];
  let newRows = [];
  let processingRowIndex;

  let machineName = '';

  let startMilliseconds;
  let endMilliseconds;

  let readFileStream = null;

  let shuttingDownFlag = false;
  let demoIndex = 0;

  const MINIMUM_FILE_SIZE = 10; // files in the directory musyt be this large to be considered

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine, {
    settings: {
      model,
    },
  });

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

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

  function convertType(format, resultAsString) {
    if (resultAsString !== null) {
      let result;
      let isNumber;

      switch (format) {
        case 'char':
        {
          // remove any leading and trailing quotes
          result = resultAsString;
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

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function variableAlert(variableName) {
    alert.raise({
      key: `var-read-error-${variableName}`,
      msg: `${machine.info.name}: Error Reading Variable`,
      description: `Error in reading ${variableName}. Please check the variable definition.`,
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function parseCSVFileOriginal(text) {
    // get the individual row and colum elements
    const lines = text.split(/\r?\n/);
    const rows = [];
    for (let iLine = 0; iLine < lines.length; iLine += 1) {
      const line = lines[iLine].trim();
      if (line.length !== 0) {
        const columns = lines[iLine].split(that.machine.settings.model.separator);
        for (let iCol = 0; iCol < columns.length; iCol += 1) {
          // remove any leading or trailing quotes
          columns[iCol] = columns[iCol].trim().replace(/^"(.*)"$/, '$1');
        }
        rows.push(columns);
      }
    }
    // extract the variable values
    that.machine.variables.forEach((variable) => {
      let iFirstRow = -1;
      let iLastRow = -1;
      switch (variable.rowPosition) {
        case 'First':
          iFirstRow = 0;
          iLastRow = 0;
          break;
        case 'First after Header':
          iFirstRow = 1;
          iLastRow = 1;
          break;
        case 'Specific Row':
          iFirstRow = _.get(variable, 'specificRow', 0) - 1;
          iLastRow = iFirstRow;
          break;
        case 'All New Rows at End':
          iFirstRow = lastRowRead;
          iLastRow = rows.length - 1;
          break;
        default: // last row
          iFirstRow = rows.length - 1;
          iLastRow = iFirstRow;
      }
      if ((iFirstRow >= 0) && (iFirstRow < rows.length)) {
        let iCol = -1;
        if (variable.columnPosition === 'Specific Column') {
          iCol = _.get(variable, 'specificColumn', 0) - 1;
        } else { // match column header
          iCol = rows[0].indexOf(_.get(variable, 'matchName', ''));
        }
        let variableError = false;
        for (let iRow = iFirstRow; iRow <= iLastRow; iRow += 1) {
          if ((iCol >= 0) && (iCol < rows[iRow].length)) {
            const value = convertType(variable.format, rows[iRow][iCol]);
            if (value !== null) {
              updateDatabase(variable, value);
            } else {
              variableError = true;
            }
          } else {
            variableError = true;
          }
        }
        if (variableError) {
          variableAlert(variable.name);
        } else {
          alert.clear(`var-read-error-${variable.name}`);
        }
      } else {
        variableAlert(variable.name);
      }
    });

    // save the last row read, in case reading all new rows at end of file
    lastRowRead = rows.length;
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readFileOriginal(filename, callback) {
    // if new file and reading all, always start at the first row
    if (filename !== lastFileRead) lastRowRead = 0;

    webdavClient
      .getFileContents(`/${filename}`, { format: 'text' })
      .then((text) => {
        parseCSVFileOriginal(text);
        lastFileRead = filename;
        updateConnectionStatus(true);
        alert.clear('file-not-found-error');
        callback();
      })
      .catch(() => {
        // raise an alert for file not found only if no deleting files after read
        if (!_.get(that.machine.settings.model, 'deleteFileAfterRead', false) && running) {
          updateConnectionStatus(false);
          alert.raise({ key: 'file-not-found-error', filename });
        }
        callback();
      });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readTimerFunc() {
    readTimer = null;
    if (_.get(that.machine.settings.model, 'mode', 'Original') === 'Original') {
      // eslint-disable-next-line no-use-before-define
      processReadTimerModeOriginal();
    } else if (_.get(that.machine.settings.model, 'mode', 'Original').startsWith('CSV')) {
      // eslint-disable-next-line no-use-before-define
      processReadTimerModeCSVCombinedResult();
    } else {
      // eslint-disable-next-line no-use-before-define
      processReadTimerModeTXTCombinedResult();
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function processReadTimerModeOriginal() {
    if (_.get(that.machine.settings.model, 'useBaseFilename', false)) {
      let filename = null;
      const baseFilename = _.get(that.machine.settings.model, 'baseFilename', '');
      const newestDate = new Date(0);
      const matchingFiles = [];

      webdavClient
        .getDirectoryContents('/')
        .then((contents) => {
          alert.clear('directory-read-error');
          // search the directory for all files with this base name and find the newest
          async.forEach(contents, (item, cbSearch) => {
            if ((item.type === 'file')
                && (item.size >= MINIMUM_FILE_SIZE)
                && (item.basename.startsWith(baseFilename))) {
              let blacklistRegexString = '';
              if (_.get(that.machine.settings.model, 'useBlacklistRegex', false)) {
                blacklistRegexString = _.get(that.machine.settings.model, 'blacklistRegex', '');
              }
              let fileMatch = true;
              if (blacklistRegexString !== '') {
                const blacklistRegex = new RegExp(blacklistRegexString);
                if (blacklistRegex.test(item.basename)) {
                  log.info(`----blacklist match: ${item.basename}, file ignored`);
                  fileMatch = false;
                }
              }
              if (fileMatch === true) {
                matchingFiles.push(item.basename);
                const fileDate = new Date(item.lastmod);
                if (fileDate > newestDate) {
                  filename = item.basename;
                }
              }
            }
            cbSearch();
          },
          () => {
            if (filename !== null) {
              readFileOriginal(filename, () => {
                alert.clear('base-filename-not-found-error');
                // if required, delete all matching files after reading newest
                if (_.get(that.machine.settings.model, 'deleteFileAfterRead', false)) {
                  async.forEach(matchingFiles, (matchingFile, cbDelete) => {
                    webdavClient.deleteFile(`/${matchingFile}`)
                      .then(() => {
                        // if successfully delete file read, clear last file read (starting over)
                        if (matchingFile === filename) lastFileRead = '';
                        cbDelete();
                      })
                      .catch(() => {
                        cbDelete();
                      });
                  },
                  () => {
                    // set up for the next read
                    readTimer = (readTimerFunc, readFrequencyMs);
                  });
                } else {
                  // set up for the next read
                  readTimer = (readTimerFunc, readFrequencyMs);
                }
              });
            } else {
              if (!_.get(that.machine.settings.model, 'deleteFileAfterRead', false)) {
                // raise an alert for base filename not found only if no deleting files after read
                alert.raise({ key: 'base-filename-not-found-error', baseFilename });
              }
              // set up for the next read
              readTimer = setTimeout(readTimerFunc, readFrequencyMs);
            }
          });
        })
        .catch((err) => {
          log.info(`----- ${machineName}: getDirectoryContents err = ${err}`);
          if (running) {
            alert.raise({ key: 'directory-read-error' });
          }
          // set up for the next read
          readTimer = setTimeout(readTimerFunc, readFrequencyMs);
        });
    } else {
      const { filename } = that.machine.settings.model;
      readFileOriginal(filename, () => {
        // if required, delete the file after reading it
        if (_.get(that.machine.settings.model, 'deleteFileAfterRead', false)) {
          webdavClient.deleteFile(`/${filename}`)
            .then(() => {
              // if successfully delete file read, clear last file read since starting over
              lastFileRead = '';
              // set up for the next read
              readTimer = setTimeout(readTimerFunc, readFrequencyMs);
            })
            .catch(() => {
              // set up for the next read
              readTimer = setTimeout(readTimerFunc, readFrequencyMs);
            });
        } else {
          // set up for the next read
          readTimer = setTimeout(readTimerFunc, readFrequencyMs);
        }
      });
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function updateAllVariablesWithCombinedResult() {
    // extract the variable values
    that.machine.variables.forEach((variable) => {
      updateDatabase(variable, combinedResultArray);
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function parseCSVFileCombinedResultsVersion1(readFilename, fileTimestamp) {
    // get the individual rows of the csv file
    const lines = fileContentsString.split(/\r+\n?/);
    // log.info('------ ' + machineName + ': lines = ' + JSON.stringify(lines));

    keywords = lines[4].split(that.machine.settings.model.separator);
    // log.info('----- ' + machinename + ': keywords.length = ' + keywords.length);
    // log.info('----- ' + machineName + ': keywords = ' + keywords);

    const keywordStringFilter = _.get(that.machine.settings.model, 'keywordStringFilter', '');
    const keywordStringReplacement = _.get(that.machine.settings.model, 'keywordStringReplacement', '');

    if (keywordStringFilter !== '') {
      if (keywords.length) {
        for (let keywordIndex = 0; keywordIndex < keywords.length; keywordIndex += 1) {
          keywords[keywordIndex] = keywords[keywordIndex].replace(keywordStringFilter,
            keywordStringReplacement);
        }
      }
    }

    combinedResultArray = [];
    for (let rowNumber = 5; rowNumber < lines.length; rowNumber += 1) {
      const rowData = lines[rowNumber].split(that.machine.settings.model.separator);
      // log.info('----- ' + machineName + ': reading row: ' + rowNumber);
      // log.info('----- ' + machineName + ': >>>' + lines[rowNumber] + '<<<');
      // for (var index = 0; index < rowData.length; index += 1) {
      // log.info('----- ' + machineName + ': rowData[' + index + '] = ' + rowData[index]);
      // }
      // log.info('----- ' + machineName + ': ' + rowData);
      // log.info('----- ' + machineName + ': rowData.length = ' + rowData.length);
      if (rowData.length === keywords.length) {
        const data = {};
        for (let colNumber = 0; colNumber < keywords.length; colNumber += 1) {
          // log.info('----- ' + machineName + ': data[' + keywords[colNumber] + '] = ' +
          //          rowData[colNumber]);
          data[keywords[colNumber]] = rowData[colNumber];
        }
        // add the filename field to each object, if requested
        if (_.get(that.machine.settings.model, 'includeFilenameInCombinedData', false)) {
          // only add the filename field if we don't already have one
          if (!_.has(data, 'filename')) {
            data.filename = readFilename;
          }
        }
        // add the timestamp field to each object
        data.timestamp = fileTimestamp;
        combinedResultArray.push(data);
      } else {
        // log.info('----- ' + machineName + ': field count does not match: keywords.length = ' +
        //          keywords.length + ', rowData.length = ' + rowData.length);
      }
    }

    // log.info('----- ' + machineName + ': CombinedResult = ' +
    //          JSON.stringify(combinedResultArray));

    if (combinedResultArray.length) {
      log.info(`----- ${machineName}: updating database, fileTimestamp = ${fileTimestamp}`);
      // var combinedResultsData = {
      //   machine: config.info.name,
      //   variable: "CombinedResult",
      //   CombinedResult: combinedResultArray
      // };

      log.info(`-----${machineName}: combinedResultArray = ${JSON.stringify(combinedResultArray)}`);

      updateAllVariablesWithCombinedResult();
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function reportCombinedResultsVersion2RowData(readFilename, fileTimestamp) {
    let reportCount = 0;
    const replaceComma = _.get(that.machine.settings.model, 'replaceCommaWithDecimalInNumericalValues', false);

    combinedResultArray = [];
    while ((processingRowIndex >= 0) && (reportCount < maxNumberOfRowsToReport)) {
      const data = {};

      const rowData = newRows[processingRowIndex];
      for (let colNumber = 0; colNumber < keywords.length; colNumber += 1) {
        // log.info('----- ' + machineName + ': data[' + keywords[colNumber] + '] = ' +
        //          rowData[colNumber]);
        if ((colNumber < rowData.fields.length) && (keywords[colNumber].length > 0)) {
          let value = rowData.fields[colNumber];
          if (replaceComma) {
            // eslint-disable-next-line no-restricted-globals
            if (isNaN(value)) {
              // value is not a number, let's see if replacing the comma turns it into one
              const newValue = value.replace(/,+/g, '.');
              // eslint-disable-next-line no-restricted-globals
              if (!isNaN(newValue)) {
                // replacing the commas resulted in a number, so use that.
                value = newValue;
              }
            }
          }
          data[keywords[colNumber]] = value;
          // // skip any date/time field that we used for sorting - that will be added as a new,
          // // defined timestamp field.
          // if ((colNumber !== timestampFieldIndex1) && (colNumber !== timestampFieldIndex2)) {
          //   data[keywords[colNumber]] = rowData.fields[colNumber];
          // }
        }
      }
      // add the filename field to each object, if requested
      if (_.get(that.machine.settings.model, 'includeFilenameInCombinedData', false)) {
        // only add the filename field if we don't already have one
        if (!_.has(data, 'filename')) {
          data.filename = readFilename;
        }
      }

      // add the timestamp field to each object
      let entryTimestampValue = rowData.timestamp;
      // var rowTimestampValue;
      // if (timestampFieldIndex2 >= 0) {
      //   rowTimestampValue = Date.parse(rowData[timestampFieldIndex1] + ' ' +
      //                                  rowData[timestampFieldIndex2]);
      // } else {
      //   rowTimestampValue = Date.parse(rowData[timestampFieldIndex1]);
      // }

      // add in any UTC offset
      const UTCOffset = _.get(that.machine.settings.model, 'utcOffset', 0);
      const adjustedUTCTimestamp = entryTimestampValue + (UTCOffset * 60 * 60 * 1000);

      const adjustedTimestamp = new Date(adjustedUTCTimestamp);

      entryTimestampValue = adjustedTimestamp.toISOString();

      // add the timestamp field to the data.  If one currently exists,
      // add a '-' to the beginning of the key string until it doesn't match a field
      let timestampKeyString = 'timestamp';
      while (_.has(data, timestampKeyString)) {
        timestampKeyString = `-${timestampKeyString}`;
      }
      data[timestampKeyString] = entryTimestampValue;

      combinedResultArray.push(data);

      reportCount += 1;
      // log.info('----- ' + machineName+ ': Report #' + reportCount +
      //          ': CombinedResult = ' + JSON.stringify(combinedResultArray));

      latestRowTimestamp = newRows[processingRowIndex].timestamp;
      latestLargeFileRowTimestamp = newRows[processingRowIndex].timestamp;
      latestTimestampRowIndex = newRows[processingRowIndex].fileRowIndex;
      processingRowIndex -= 1;
    }

    if (combinedResultArray.length) {
      if (combinedResultArray.length === 1) {
        log.info(`----- ${machineName}: updating database, reporting ${combinedResultArray.length} row of data`);
      } else {
        log.info(`----- ${machineName}: updating database, reporting ${combinedResultArray.length} rows of data`);
      }

      // var combinedResultsData = {
      //   machine: config.info.name,
      //   variable: "CombinedResult",
      //   CombinedResult: combinedResultArray
      // };

      updateAllVariablesWithCombinedResult();
    }

    // FORCE EARLY TIMESTAMP FOR TESTING
    // if (firstProcessFlag) {
    //   firstProcessFlag = false;
    //   // back up 15 seconds for testing multiple rows processed on next cycle.
    //   latestRowTimestamp -= 15 * 1000;
    // }
    // FORCE EARLY TIMESTAMP FOR TESTING

    if (processingRowIndex >= 0) {
      // still more to process in this file - set a flag so we resume here
      continueProcessingCurrentFileFlag = true;
      continueProcessingFilename = readFilename;
      continueProcessingFileTimestamp = fileTimestamp;
    } else {
      continueProcessingCurrentFileFlag = false;
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function parseCSVFileCombinedResultsVersion2(readFilename, fileTimestamp) {
    // get the individual rows of the csv file
    const lines = fileContentsString.split(/\r+\n?/);
    // log.info('----- ' + machineName + ': lines = ' + JSON.stringify(lines));

    let latestTimestamp = 0;
    let latestTimestampRowFields;

    if (readFilename !== lastFileReadName) {
      latestTimestampRowIndex = 0;
    }

    const fileTimestampYear = fileTimestamp.getFullYear();
    const fileTimestampMonth = fileTimestamp.getMonth();
    const fileTimestampDate = fileTimestamp.getDate();

    // first, get the keywords
    keywords = [];
    if (_.get(that.machine.settings.model, 'useHeaderRowForKeywords', false)) {
      if (_.get(that.machine.settings.model, 'useTabsForDelimiters', false)) {
        keywords = lines[0].replace(/\0/g, '').split('\t');
      } else {
        keywords = lines[0].replace(/\0/g, '').split(that.machine.settings.model.separator);
      }
    } else {
      keywords = _.get(that.machine.settings.model, 'keywordList', '').split(that.machine.settings.model.separator);
    }
    // log.info('----- ' + machineName + ': keywords = ' + keywords);
    // log.info('----- ' + machineName + ': keywords.length = ' + keywords.length);
    if (keywords.length === 0) {
      // log.info('----- ' + machineName + ': No keywords.');
      endMilliseconds = Date.now();
      log.info(`----- ${machineName}: done parsing file: ${readFilename}.  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
      return;
    }

    const keywordStringFilter = _.get(that.machine.settings.model, 'keywordStringFilter', '');
    const keywordStringReplacement = _.get(that.machine.settings.model, 'keywordStringReplacement', '');

    if (keywordStringFilter !== '') {
      if (keywords.length) {
        for (let keywordIndex = 0; keywordIndex < keywords.length; keywordIndex += 1) {
          keywords[keywordIndex] = keywords[keywordIndex].replace(keywordStringFilter,
            keywordStringReplacement);
        }
      }
    }

    let minimumNumberOfFields = 2; // one for datetime, one for data
    if (timestampFieldIndex2 >= 0) {
      minimumNumberOfFields = 3; // plus one for date, time in seperate fields
    }

    if (_.get(that.machine.settings.model, 'requireDataForAllKeyFields', false)) {
      minimumNumberOfFields = keywords.length;
    }

    newRows = [];
    let fields = [];
    let timestampConversionError = false;
    if (latestRowTimestamp === 0) {
      // first read - just find the latest entry
      let startIndex = 0;
      if (_.get(that.machine.settings.model, 'useHeaderRowForKeywords', false)) {
        startIndex = 1;
      }
      for (let index = startIndex; index < lines.length; index += 1) {
        if (_.get(that.machine.settings.model, 'useTabsForDelimiters', false)) {
          fields = lines[index].replace(/\0/g, '').split('\t');
        } else {
          fields = lines[index].replace(/\0/g, '').split(that.machine.settings.model.separator);
        }
        if (fields.length >= minimumNumberOfFields) {
          let timestamp = 0;
          if (_.get(that.machine.settings.model, 'useFiledateForTimestampDate', false)) {
            if (timestampFieldIndex1 < fields.length) {
              const timeFields = fields[timestampFieldIndex1].split(':');
              if (timeFields.length === 3) {
                const timestampString = new Date(fileTimestampYear,
                  fileTimestampMonth,
                  fileTimestampDate,
                  timeFields[0],
                  timeFields[1],
                  timeFields[2]);
                timestamp = Date.parse(timestampString);
              }
            }
          } else if (timestampFieldIndex2 >= 0) {
            timestamp = Date.parse(`${fields[timestampFieldIndex1]} ${fields[timestampFieldIndex2]}`);
          } else {
            timestamp = Date.parse(fields[timestampFieldIndex1]);
          }
          // eslint-disable-next-line no-restricted-globals
          if ((isNaN(timestamp)) || (timestamp === 0)) {
            timestampConversionError = true;
          } else if (timestamp >= latestTimestamp) {
            latestTimestampRowFields = fields;
            latestTimestamp = timestamp;
            latestTimestampRowIndex = index;
            latestRowTimestamp = timestamp;
          }
        }
      }
      if (latestTimestamp !== 0) {
        const rowObject = {
          fields: latestTimestampRowFields,
          timestamp: latestTimestamp,
          fileRowIndex: latestTimestampRowIndex,
        };
        newRows.push(rowObject);
      }
    } else {
      let startIndex = 0;
      if (_.get(that.machine.settings.model, 'useHeaderRowForKeywords', false)) {
        startIndex = 1;
      }
      for (let index = startIndex; index < lines.length; index += 1) {
        if (_.get(that.machine.settings.model, 'useTabsForDelimiters', false)) {
          fields = lines[index].replace(/\0/g, '').split('\t');
        } else {
          fields = lines[index].replace(/\0/g, '').split(that.machine.settings.model.separator);
        }
        if (fields.length >= minimumNumberOfFields) {
          let timestamp = 0;
          if (_.get(that.machine.settings.model, 'useFiledateForTimestampDate', false)) {
            if (timestampFieldIndex1 < fields.length) {
              const timeFields = fields[timestampFieldIndex1].split(':');
              if (timeFields.length === 3) {
                const timestampString = new Date(fileTimestampYear,
                  fileTimestampMonth,
                  fileTimestampDate,
                  timeFields[0],
                  timeFields[1],
                  timeFields[2]);
                timestamp = Date.parse(timestampString);
              }
            }
          } else if ((timestampFieldIndex1 < fields.length)
                     && (timestampFieldIndex2 < fields.length)) {
            if (timestampFieldIndex2 >= 0) {
              timestamp = Date.parse(`${fields[timestampFieldIndex1]} ${fields[timestampFieldIndex2]}`);
            } else {
              timestamp = Date.parse(fields[timestampFieldIndex1]);
            }
          }
          // eslint-disable-next-line no-restricted-globals
          if ((isNaN(timestamp)) || (timestamp === 0)) {
            timestampConversionError = true;
          } else if ((timestamp > latestRowTimestamp)
                || ((timestamp === latestRowTimestamp) && (index > latestTimestampRowIndex))) {
            const rowObject = {
              fields,
              timestamp,
              fileRowIndex: index,
            };
            newRows.push(rowObject);
          }
        }
      }
    }

    if (timestampConversionError) {
      alert.raise({ key: 'datetime-error' });
    } else {
      alert.clear('datetime-error');
    }

    let rowsToProcess = 0;
    if (newRows.length > 0) {
      // log.info('----- ' + machineName + ': newRows.length = ' + newRows.length);
      // eslint-disable-next-line no-nested-ternary
      newRows.sort((a, b) => ((a.timestamp > b.timestamp) ? -1
        : ((a.timestamp === b.timestamp) ? 0 : 1)));

      // we will work backwards through the newRows data, so as to deliver oldest data first
      rowsToProcess = newRows.length;
      processingRowIndex = newRows.length - 1; // assume maximum number of rows to report
      reportCombinedResultsVersion2RowData(readFilename, fileTimestamp);
    } else {
      log.info(`----- ${machineName}: No entries found with a later row timestamp`);
    }

    endMilliseconds = Date.now();
    if (processingRowIndex >= 0) {
      // eslint-disable-next-line max-len
      log.info(`----- ${machineName}: done parsing file for this cycle: ${readFilename}.  ${maxNumberOfRowsToReport} rows processed.  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
    } else if (rowsToProcess === 1) {
      // eslint-disable-next-line max-len
      log.info(`----- ${machineName}: done parsing file: ${readFilename}.  1 row processed.  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
    } else {
      // eslint-disable-next-line max-len
      log.info(`----- ${machineName}: done parsing file: ${readFilename}.  ${rowsToProcess} rows processed.  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function isNumeric(str) {
    let localStr;
    if ((str.startsWith('+')) && (str.length > 1)) {
      localStr = str.substring(1);
    } else if ((str.startsWith('-')) && (str.length > 1)) {
      localStr = str.substring(1);
    }

    // use type coercion to parse the _entirety_ of the string
    // (`parseFloat` alone does not do this)...

    // eslint-disable-next-line no-restricted-globals
    if (isNaN(localStr)) {
      return false;
    }
    // ...and ensure strings of whitespace fail
    // eslint-disable-next-line no-restricted-globals
    if (isNaN(parseFloat(localStr))) {
      return false;
    }
    return true;
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function trimLeadingZeros(valueString) {
    let localValueString = valueString.trim();
    let leadingPlusFlag = false;
    let leadingMinusFlag = false;
    if (isNumeric(valueString)) {
      // to use the regex to trim the leading zeros, we need to temoorarily strip out the '+' or '-'
      if (localValueString.startsWith('+')) {
        leadingPlusFlag = true;
        localValueString = localValueString.substring(1);
      } else if (localValueString.startsWith('-')) {
        leadingMinusFlag = true;
        localValueString = localValueString.substring(1);
      }
      localValueString = localValueString.replace(/^0+(?=\d)/, '');
      if (leadingPlusFlag) {
        localValueString = `+${localValueString}`;
      } else if (leadingMinusFlag) {
        localValueString = `-${localValueString}`;
      }
    }

    return localValueString;
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function parseCSVFileCombinedResultsCN612DND(readFilename, fileTimestamp) {
    // get the individual rows of the csv file
    const lines = fileContentsString.split(/\r+\n?/);
    // log.info('------ lines = ' + JSON.stringify(lines));

    let latestTimestamp = 0;
    let latestTimestampRowFields;

    latestTimestampRowIndex = 0;

    newRows = [];
    let fields = [];
    let timestampConversionError = true;
    if (latestRowTimestamp === 0) {
      // first read - just find the latest entry
      for (let index = 0; index < lines.length; index += 1) {
        if (_.get(that.machine.settings.model, 'useTabsForDelimiters', false)) {
          fields = lines[index].replace(/\0/g, '').split('\t');
        } else {
          fields = lines[index].replace(/\0/g, '').split(that.machine.settings.model.separator);
        }
        let timestamp = 0;
        if ((timestampFieldIndex1 < fields.length) && (timestampFieldIndex2 < fields.length)) {
          if (timestampFieldIndex2 >= 0) {
            timestamp = Date.parse(`${fields[timestampFieldIndex1]} ${fields[timestampFieldIndex2]}`);
          } else {
            timestamp = Date.parse(fields[timestampFieldIndex1]);
          }
        }
        // eslint-disable-next-line no-restricted-globals
        if ((!isNaN(timestamp)) && (timestamp !== 0)) {
          timestampConversionError = false;

          if (timestamp > latestTimestamp) {
            latestTimestampRowFields = fields;
            latestTimestamp = timestamp;
            latestTimestampRowIndex = index;
          }
        }
      }
      if (latestTimestamp !== 0) {
        newRows.push(latestTimestampRowFields);
      }
    } else {
      for (let index = 0; index < lines.length; index += 1) {
        if (_.get(that.machine.settings.model, 'useTabsForDelimiters', false)) {
          fields = lines[index].replace(/\0/g, '').split('\t');
        } else {
          fields = lines[index].replace(/\0/g, '').split(that.machine.settings.model.separator);
        }
        let timestamp = 0;
        if ((timestampFieldIndex1 < fields.length) && (timestampFieldIndex2 < fields.length)) {
          if (timestampFieldIndex2 >= 0) {
            timestamp = Date.parse(`${fields[timestampFieldIndex1]} ${fields[timestampFieldIndex2]}`);
          } else {
            timestamp = Date.parse(fields[timestampFieldIndex1]);
          }
        }
        // eslint-disable-next-line no-restricted-globals
        if ((!isNaN(timestamp)) && (timestamp !== 0)) {
          timestampConversionError = false;

          if (timestamp > latestRowTimestamp) {
            newRows.push(fields);
          }
          if (timestamp > latestTimestamp) {
            latestTimestampRowFields = fields;
            latestTimestamp = timestamp;
            latestTimestampRowIndex = index;
          }
        }
      }
    }

    if (timestampConversionError) {
      alert.raise({ key: 'datetime-error' });
    } else {
      alert.clear('datetime-error');
    }

    if (newRows.length > 0) {
      // log.info('----- ' + machineName + ': newRows.length = ' + newRows.length);
      if (newRows.length > 1) {
        if ((timestampFieldIndex1 < newRows[0].length)
            && (timestampFieldIndex2 < newRows[0].length)) {
          if (timestampFieldIndex2 >= 0) {
            // log.info('>>>> ' + machineName + ': PRESORT');
            // for (var i = 0; i < newRows.length; i += 1) {
            //   log.info('>>>  ' + machineName + ': newRow[' + i + '] = ' +
            //            JSON.stringify(newRows[i]));
            // }
            // first, sort the fields that we've tagged as newer than our last read
            // eslint-disable-next-line no-nested-ternary
            newRows.sort((a, b) => ((Date.parse(`${a[timestampFieldIndex1]} ${a[timestampFieldIndex2]}`)
                       > Date.parse(`${b[timestampFieldIndex1]} ${b[timestampFieldIndex2]}`)) ? -1
              : ((Date.parse(`${a[timestampFieldIndex1]} ${a[timestampFieldIndex2]}`)
                            === Date.parse(`${b[timestampFieldIndex1]} ${b[timestampFieldIndex2]}`)) ? 0 : 1)));
            // log.info('>>>> ' + machineName + ': POSTSORT');
            // for (var i = 0; i < newRows.length; i += 1) {
            //   log.info('>>> ' + machineName + ': newRow[' + i + '] = ' +
            //            JSON.stringify(newRows[i]));
            // }
            latestRowTimestamp = Date.parse(`${newRows[0][timestampFieldIndex1]} ${newRows[0][timestampFieldIndex2]}`);
          } else {
            // log.info('>>>> ' + machineName + ': PRESORT');
            // for (var i = 0; i < newRows.length; i += 1) {
            //   log.info('>>> ' + machineName + ': newRow[' + i + '] = ' +
            //            JSON.stringify(newRows[i]));
            // }
            // first, sort the fields that we've tagged as newer than our last read
            // eslint-disable-next-line no-nested-ternary
            newRows.sort((a, b) => ((Date.parse(a[timestampFieldIndex1])
                                     > Date.parse(b[timestampFieldIndex1])) ? -1
              : ((Date.parse(a[timestampFieldIndex1])
                  === Date.parse(b[timestampFieldIndex1])) ? 0 : 1)));
            // log.info('>>>> ' + machineName + ': POSTSORT');
            // for (var i = 0; i < newRows.length; i += 1) {
            //   log.info('>>> ' + machineName + ': newRow[' + i + '] = ' +
            //            JSON.stringify(newRows[i]));
            // }
            latestRowTimestamp = Date.parse(newRows[0][timestampFieldIndex1]);
          }
        }
      }

      // log.info('>>>>> ' + machineName + ': latest BatchStartTime timestamp line = ' +
      //          (latestTimestampRowIndex + 1));
      // log.info('>>>>> ' + machineName + ': line #' + (latestTimestampRowIndex + 1) +
      //          ': ' + lines[latestTimestampRowIndex]);

      const keywordStringFilter = _.get(that.machine.settings.model, 'keywordStringFilter', '');
      const keywordStringReplacement = _.get(that.machine.settings.model, 'keywordStringReplacement', '');

      // we will work backwards through the newRows data, so as to deliver oldest data first
      let rowIndex = newRows.length - 1; // assume maximum number of rows to report
      // var rowIndex = maxNumberOfRowsToReport - 1;  // assume maximum number of rows to report
      // if (rowIndex >= newRows.length) {
      //   rowIndex = newRows.length - 1; // but limit ourselves to the actual number that we have
      // }
      let reportCount = 0;

      while ((rowIndex >= 0) && (reportCount < maxNumberOfRowsToReport)) {
        combinedResultArray = [];
        const data = {};

        const rowData = newRows[rowIndex];
        let colNumber = _.get(that.machine.settings.model, 'startFieldForKeyValuePairs', 2) - 1;
        while (colNumber < (rowData.length - 1)) {
          // skip any date/time field that we used for sorting - that will be added as a new,
          // defined timestamp field.
          if ((colNumber !== timestampFieldIndex1) && (colNumber !== timestampFieldIndex2)) {
            let keyString = rowData[colNumber];
            if (_.get(that.machine.settings.model, 'valuesAsArrays', false)) {
              // key, value-0, value-1, value-2, ..., value-n
              const bracketStringIndex = keyString.indexOf('[]');
              const arraySize = _.get(that.machine.settings.model, 'valuesArraySize', 1);
              for (let arrayIndex = 0;
                ((arrayIndex < arraySize)
                     && ((colNumber + arrayIndex + 1) < rowData.length));
                arrayIndex += 1) {
                let valueString = rowData[colNumber + arrayIndex + 1];
                if (_.get(that.machine.settings.model, 'trimNumericDataLeadingZeros', false)) {
                  valueString = trimLeadingZeros(valueString);
                }
                let arrayKeyString = keyString;
                if (bracketStringIndex === -1) {
                  // no brackets in the key string, simply append -arrayIndex to the key
                  arrayKeyString = `${keyString}-${arrayIndex}`;
                } else {
                  // we found brackets in the key string, replay [] with [arrayIndex]
                  arrayKeyString = keyString.slice(0, (bracketStringIndex + 1)) + arrayIndex
                                                      + keyString.slice(bracketStringIndex + 1);
                }
                if (keywordStringFilter !== '') {
                  arrayKeyString = arrayKeyString.replace(keywordStringFilter,
                    keywordStringReplacement);
                }
                data[arrayKeyString] = valueString;
              }
              colNumber += (arraySize + 1);
            } else {
              // normal key,value pair
              let valueString = rowData[colNumber + 1];
              if (_.get(that.machine.settings.model, 'trimNumericDataLeadingZeros', false)) {
                valueString = trimLeadingZeros(valueString);
              }
              if (keywordStringFilter !== '') {
                keyString = keyString.replace(keywordStringFilter, keywordStringReplacement);
              }
              data[keyString] = valueString;
              colNumber += 2;
            }
          } else {
            colNumber += 1;
          }
        }
        // add the filename field to each object, if requested
        if (_.get(that.machine.settings.model, 'includeFilenameInCombinedData', false)) {
          // only add the filename field if we don't already have one
          if (!_.has(data, 'filename')) {
            data.filename = readFilename;
          }
        }

        // add the timestamp field to each object
        let rowTimestampValue;
        if (timestampFieldIndex2 >= 0) {
          rowTimestampValue = Date.parse(`${rowData[timestampFieldIndex1]} ${rowData[timestampFieldIndex2]}`);
        } else {
          rowTimestampValue = Date.parse(rowData[timestampFieldIndex1]);
        }

        // add in any UTC offset
        const UTCOffset = _.get(that.machine.settings.model, 'utcOffset', 0);
        const adjustedUTCTimestamp = rowTimestampValue + (UTCOffset * 60 * 60 * 1000);

        const adjustedTimestamp = new Date(adjustedUTCTimestamp);

        rowTimestampValue = adjustedTimestamp.toISOString();
        data.timestamp = rowTimestampValue;

        combinedResultArray.push(data);

        reportCount += 1;
        // eslint-disable-next-line max-len
        // log.info('----- ' + machineName + ': Report #' + reportCount + ': CombinedResult = ' + JSON.stringify(combinedResultArray));

        if (combinedResultArray.length) {
          // log.info('----- ' + machineName + ': updating database');
          // var combinedResultsData = {
          //   machine: config.info.name,
          //   variable: "CombinedResult",
          //   CombinedResult: combinedResultArray
          // };

          updateAllVariablesWithCombinedResult();
        }
        rowIndex -= 1;
      }
      if (rowIndex >= 0) {
        // still more to process in this file - set a flag so we resume here
        continueProcessingCurrentFileFlag = true;
        continueProcessingFilename = readFilename;
        continueProcessingFileTimestamp = fileTimestamp;
        if ((timestampFieldIndex1 < newRows[rowIndex + 1].length)
            && (timestampFieldIndex2 < newRows[rowIndex + 1].length)) {
          if (timestampFieldIndex2 >= 0) {
            latestRowTimestamp = Date.parse(`${newRows[rowIndex + 1][timestampFieldIndex1]} ${newRows[rowIndex + 1][timestampFieldIndex2]}`);
          } else {
            latestRowTimestamp = Date.parse(newRows[rowIndex + 1][timestampFieldIndex1]);
          }
        }
      } else {
        continueProcessingCurrentFileFlag = false;
      }
    } else {
      log.info(`----- ${machineName}: No entries found with a later row timestamp`);
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function parseCSVFileCombinedResults(readFilename, fileTimestamp) {
    log.info(`----- ${machineName}: parsing file: ${readFilename},  timestamp = ${fileTimestamp}`);
    const parseMode = _.get(that.machine.settings.model, 'mode', 'CSV: Combined result-version 1');
    if (parseMode === 'CSV: Combined result-version 1') {
      parseCSVFileCombinedResultsVersion1(readFilename, fileTimestamp);
    } else if (parseMode === 'CSV: Combined result-CN612-DND') {
      parseCSVFileCombinedResultsCN612DND(readFilename, fileTimestamp);
    } else {
      parseCSVFileCombinedResultsVersion2(readFilename, fileTimestamp);
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  //    debug function for dumping the contents of a a buffer in easy-to-read format, 16 bytes/line
  // function dumpBuffer(buffer) {
  //   let str = '';
  //   for (let i = 0; i < buffer.length; i += 1) {
  //     if (buffer[i] < 16) {
  //       str += `0${buffer[i].toString(16)} `;
  //     } else {
  //       str += `${buffer[i].toString(16)} `;
  //     }
  //     if ((((i + 1) % 16) === 0) || ((i + 1) === buffer.length)) {
  //       log.info(str);
  //       str = '';
  //     }
  //   }
  // }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function parseLargeFileChunkForLatestRow(readFilename, bufferToProcess, fileTimestamp) {
    fileContentsString = bufferToProcess.toString();
    // eslint-disable-next-line max-len
    // log.info('----- ' + machineName + ': parseCSVFileCombinedResultsVersion2LargeFileChunk: fileContentsString.length = ' + fileContentsString.length);

    // get the individual rows of the csv file
    const lines = fileContentsString.split(/\r+\n?/);
    // eslint-disable-next-line max-len
    // log.info('----- ' + machineName + ': parseCSVFileCombinedResultsVersion2LargeFileChunk: lines.length = ' + lines.length);
    // log.info('----- ' + machineName + ': lines = ' + JSON.stringify(lines));

    const fileTimestampYear = fileTimestamp.getFullYear();
    const fileTimestampMonth = fileTimestamp.getMonth();
    const fileTimestampDate = fileTimestamp.getDate();

    let startIndex = 0;
    // eslint-disable-next-line max-len
    // log.info('----- ' + machineName + ': parseCSVFileCombinedResultsVersion2LargeFileChunk: totalFilesize = ' + totalFilesize);
    if (totalFilesize === 0) {
      // first, get the keywords
      newRows = [];
      keywords = [];
      if (_.get(that.machine.settings.model, 'useHeaderRowForKeywords', false)) {
        startIndex = 1;
        largeFileRowIndex = 1;
        if (_.get(that.machine.settings.model, 'useTabsForDelimiters', false)) {
          keywords = lines[0].replace(/\0/g, '').split('\t');
        } else {
          keywords = lines[0].replace(/\0/g, '').split(that.machine.settings.model.separator);
          log.info(`----- ${machineName}: parseCSVFileCombinedResultsVersion2LargeFileChunk: keywords.length = ${keywords.length}`);
        }
      } else {
        keywords = _.get(that.machine.settings.model, 'keywordList', '').split(that.machine.settings.model.separator);
      }
      // log.info('----- ' + machineName + ': keywords = ' + keywords);
      // log.info('----- ' + machineName + ': keywords.length = ' + keywords.length);
      if (keywords.length === 0) {
        // log.info('----- ' + machineName + ': No keywords.');
        endMilliseconds = Date.now();
        log.info(`----- ${machineName}: done parsing file: ${readFilename}.  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
        return;
      }

      const keywordStringFilter = _.get(that.machine.settings.model, 'keywordStringFilter', '');
      const keywordStringReplacement = _.get(that.machine.settings.model, 'keywordStringReplacement', '');

      if (keywordStringFilter !== '') {
        if (keywords.length) {
          for (let keywordIndex = 0; keywordIndex < keywords.length; keywordIndex += 1) {
            keywords[keywordIndex] = keywords[keywordIndex].replace(keywordStringFilter,
              keywordStringReplacement);
          }
        }
      }
    }

    let minimumNumberOfFields = 2; // one for datetime, one for data
    if (timestampFieldIndex2 >= 0) {
      minimumNumberOfFields = 3; // plus one for date, time in seperate fields
    }

    if (_.get(that.machine.settings.model, 'requireDataForAllKeyFields', false)) {
      minimumNumberOfFields = keywords.length;
    }

    let fields = [];
    let timestampConversionError = false;

    for (let index = startIndex; index < lines.length; index += 1) {
      largeFileRowIndex += 1;
      if (_.get(that.machine.settings.model, 'useTabsForDelimiters', false)) {
        fields = lines[index].replace(/\0/g, '').split('\t');
      } else {
        fields = lines[index].replace(/\0/g, '').split(that.machine.settings.model.separator);
      }
      // if ((index === 0) || (index === (lines.length - 1))) {
      // eslint-disable-next-line max-len
      //   log.info('----- ' + machineName + ': parseCSVFileCombinedResultsVersion2LargeFileChunk: row #' + largeFileRowIndex + ' fields = ' + JSON.stringify(fields));
      // }
      // if (index < 10) {
      // eslint-disable-next-line max-len
      //   log.info('----- ' + machineName + ': parseCSVFileCombinedResultsVersion2LargeFileChunk: fields.length for index=' + index + ': ' + fields.length);
      // }
      // if (index > (lines.length - 10)) {
      // eslint-disable-next-line max-len
      //   log.info('----- ' + machineName + ': parseCSVFileCombinedResultsVersion2LargeFileChunk: fields.length for index=' + index + ': ' + fields.length);
      // }
      if (fields.length >= minimumNumberOfFields) {
        let timestamp = 0;
        if (_.get(that.machine.settings.model, 'useFiledateForTimestampDate', false)) {
          if (timestampFieldIndex1 < fields.length) {
            const timeFields = fields[timestampFieldIndex1].split(':');
            if (timeFields.length === 3) {
              const timestampString = new Date(fileTimestampYear,
                fileTimestampMonth,
                fileTimestampDate,
                timeFields[0],
                timeFields[1],
                timeFields[2]);
              timestamp = Date.parse(timestampString);
            }
          }
        } else if (timestampFieldIndex2 >= 0) {
          timestamp = Date.parse(`${fields[timestampFieldIndex1]} ${fields[timestampFieldIndex2]}`);
        } else {
          timestamp = Date.parse(fields[timestampFieldIndex1]);
        }
        // eslint-disable-next-line no-restricted-globals
        if ((isNaN(timestamp)) || (timestamp === 0)) {
          timestampConversionError = true;
        } else if (timestamp >= latestLargeFileRowTimestamp) {
          latestLargeFileTimestampRowFields = fields;
          latestLargeFileTimestamp = timestamp;
          latestTimestampRowIndex = largeFileRowIndex;
          latestLargeFileRowTimestamp = timestamp;
        }
      }
    }

    if (timestampConversionError) {
      alert.raise({ key: 'datetime-error' });
    } else {
      alert.clear('datetime-error');
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function parseLargeFileChunkForNewRows(readFilename, bufferToProcess, fileTimestamp) {
    fileContentsString = bufferToProcess.toString();
    // eslint-disable-next-line max-len
    // log.info('----- ' + machineName + ': parseCSVFileCombinedResultsVersion2LargeFileChunk: fileContentsString.length = ' + fileContentsString.length);

    // get the individual rows of the csv file
    const lines = fileContentsString.split(/\r+\n?/);
    // eslint-disable-next-line max-len
    // log.info('----- ' + machineName + ': parseCSVFileCombinedResultsVersion2LargeFileChunk: lines.length = ' + lines.length);
    // log.info('----- ' + machineName + ': lines = ' + JSON.stringify(lines));

    const fileTimestampYear = fileTimestamp.getFullYear();
    const fileTimestampMonth = fileTimestamp.getMonth();
    const fileTimestampDate = fileTimestamp.getDate();

    let startIndex = 0;
    // eslint-disable-next-line max-len
    // log.info('----- ' + machineName + ': parseCSVFileCombinedResultsVersion2LargeFileChunk: totalFilesize = ' + totalFilesize);
    if (totalFilesize === 0) {
      // first, get the keywords
      newRows = [];
      keywords = [];
      if (_.get(that.machine.settings.model, 'useHeaderRowForKeywords', false)) {
        startIndex = 1;
        largeFileRowIndex = 1;
        if (_.get(that.machine.settings.model, 'useTabsForDelimiters', false)) {
          keywords = lines[0].replace(/\0/g, '').split('\t');
        } else {
          keywords = lines[0].replace(/\0/g, '').split(that.machine.settings.model.separator);
          log.info(`----- ${machineName}: parseCSVFileCombinedResultsVersion2LargeFileChunk: keywords.length = ${keywords.length}`);
        }
      } else {
        keywords = _.get(that.machine.settings.model, 'keywordList', '').split(that.machine.settings.model.separator);
      }
      // log.info('----- ' + machineName + ': keywords = ' + keywords);
      // log.info('----- ' + machineName + ': keywords.length = ' + keywords.length);
      if (keywords.length === 0) {
        // log.info('----- ' + machineName + ': No keywords.');
        endMilliseconds = Date.now();
        log.info(`----- ${machineName}: done parsing file: ${readFilename}.  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);
        return;
      }

      const keywordStringFilter = _.get(that.machine.settings.model, 'keywordStringFilter', '');
      const keywordStringReplacement = _.get(that.machine.settings.model, 'keywordStringReplacement', '');

      if (keywordStringFilter !== '') {
        if (keywords.length) {
          for (let keywordIndex = 0; keywordIndex < keywords.length; keywordIndex += 1) {
            keywords[keywordIndex] = keywords[keywordIndex].replace(keywordStringFilter,
              keywordStringReplacement);
          }
        }
      }
    }

    let minimumNumberOfFields = 2; // one for datetime, one for data
    if (timestampFieldIndex2 >= 0) {
      minimumNumberOfFields = 3; // plus one for date, time in seperate fields
    }

    if (_.get(that.machine.settings.model, 'requireDataForAllKeyFields', false)) {
      minimumNumberOfFields = keywords.length;
    }

    let fields = [];
    let timestampConversionError = false;

    for (let index = startIndex; index < lines.length; index += 1) {
      largeFileRowIndex += 1;
      if (_.get(that.machine.settings.model, 'useTabsForDelimiters', false)) {
        fields = lines[index].replace(/\0/g, '').split('\t');
      } else {
        fields = lines[index].replace(/\0/g, '').split(that.machine.settings.model.separator);
      }
      // if ((index === 0) || (index === (lines.length - 1))) {
      // eslint-disable-next-line max-len
      //   log.info('----- ' + machineName + ': parseCSVFileCombinedResultsVersion2LargeFileChunk: row #' + largeFileRowIndex + ' fields = ' + JSON.stringify(fields));
      // }
      // if (index < 10) {
      // eslint-disable-next-line max-len
      //   log.info('----- ' + machineName + ': parseCSVFileCombinedResultsVersion2LargeFileChunk: fields.length for index=' + index + ': ' + fields.length);
      // }
      // if (index > (lines.length - 10)) {
      // eslint-disable-next-line max-len
      //   log.info('----- ' + machineName + ': parseCSVFileCombinedResultsVersion2LargeFileChunk: fields.length for index=' + index + ': ' + fields.length);
      // }
      if (fields.length >= minimumNumberOfFields) {
        let timestamp = 0;
        if (_.get(that.machine.settings.model, 'useFiledateForTimestampDate', false)) {
          if (timestampFieldIndex1 < fields.length) {
            const timeFields = fields[timestampFieldIndex1].split(':');
            if (timeFields.length === 3) {
              const timestampString = new Date(fileTimestampYear,
                fileTimestampMonth,
                fileTimestampDate,
                timeFields[0],
                timeFields[1],
                timeFields[2]);
              timestamp = Date.parse(timestampString);
            }
          }
        } else if (timestampFieldIndex2 >= 0) {
          timestamp = Date.parse(`${fields[timestampFieldIndex1]} ${fields[timestampFieldIndex2]}`);
        } else {
          timestamp = Date.parse(fields[timestampFieldIndex1]);
        }
        // eslint-disable-next-line no-restricted-globals
        if ((isNaN(timestamp)) || (timestamp === 0)) {
          timestampConversionError = true;
        } else if ((timestamp > latestLargeFileRowTimestamp)
              || ((timestamp === latestLargeFileRowTimestamp)
                  && (largeFileRowIndex > latestTimestampRowIndex))) {
          const rowObject = {
            fields,
            timestamp,
            fileRowIndex: largeFileRowIndex,
          };
          newRows.push(rowObject);
        }
      }
    }

    if (timestampConversionError) {
      alert.raise({ key: 'datetime-error' });
    } else {
      alert.clear('datetime-error');
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readLargeFileCombinedResults(readFilename, fileTimestamp, callback) {
    log.info(`----- ${machineName}: reading file: ${readFilename},  timestamp = ${fileTimestamp}`);

    if (readFilename !== lastFileReadName) {
      latestTimestampRowIndex = 0;
    }

    totalFilesize = 0;
    // let chunkIndex = 0;
    let bufferToProcess = Buffer.from([]);
    newRows = [];
    largeFileRowIndex = 0;
    const crlfBuf = Buffer.from([0x0d, 0x0a]);

    shuttingDownFlag = false;
    readFileStream = webdavClient.createReadStream(`/${readFilename}`);

    let findLatestDataRowFlag = false;
    if (latestLargeFileTimestamp === 0) {
      findLatestDataRowFlag = true;
      latestLargeFileRowTimestamp = 0;
    }

    readFileStream.on('data', (chunk) => {
      if (shuttingDownFlag) {
        readFileStream.removeAllListeners();
        readFileStream = null;
      }

      // if (totalBytes === 0) {
      //   log.info('----- ' + machineName + ': first chunk:');
      //   dumpBuffer(chunk);
      // }

      const lastCRLFIndex = chunk.lastIndexOf(crlfBuf);
      if (findLatestDataRowFlag) {
        parseLargeFileChunkForLatestRow(readFilename, Buffer.concat([bufferToProcess,
          chunk.subarray(0, lastCRLFIndex)]),
        fileTimestamp);
      } else {
        parseLargeFileChunkForNewRows(readFilename, Buffer.concat([bufferToProcess,
          chunk.subarray(0, lastCRLFIndex)]),
        fileTimestamp);
      }
      bufferToProcess = chunk.subarray(lastCRLFIndex + 2);

      // if (lastCRLFIndex === (chunk.length - 2)) {
      //   log.info('----- ' + machineName + ': CHUNK #: ' + chunkIndex +
      //            ' ended with a carriage return');
      // }
      // chunkIndex += 1;

      totalFilesize += chunk.length;

      // log.info('chunk.length = ' + chunk.length + '    totalBytes = ' + totalBytes);
    });

    readFileStream.on('end', () => {
      log.info(`----- ${machineName}: finished reading file: ${readFilename} size = ${totalFilesize}`);

      if (findLatestDataRowFlag) {
        if (latestLargeFileTimestamp !== 0) {
          const rowObject = {
            fields: latestLargeFileTimestampRowFields,
            timestamp: latestLargeFileTimestamp,
            fileRowIndex: latestTimestampRowIndex,
          };
          newRows.push(rowObject);
          processingRowIndex = newRows.length - 1; // assume maximum number of rows to report
          reportCombinedResultsVersion2RowData(readFilename, fileTimestamp);
        }
      } else if (newRows.length > 0) {
        // log.info('----- ' + machineName + ': newRows.length = ' + newRows.length);
        // eslint-disable-next-line no-nested-ternary
        newRows.sort((a, b) => ((a.timestamp > b.timestamp) ? -1
          : ((a.timestamp === b.timestamp) ? 0 : 1)));

        // log.info('----- ' + machineName + ': latest BatchStartTime timestamp line = ' +
        //          (latestTimestampRowIndex + 1));
        // log.info('----- ' + machineName + ': line #' + (latestTimestampRowIndex + 1) +
        //          ': ' + lines[latestTimestampRowIndex]);

        // we will work backwards through the newRows data, so as to deliver oldest data first
        processingRowIndex = newRows.length - 1; // assume maximum number of rows to report
        reportCombinedResultsVersion2RowData(readFilename, fileTimestamp);
      } else {
        log.info(`----- ${machineName}: No entries found with a later row timestamp`);
      }

      lastFileReadName = readFilename;
      updateConnectionStatus(true);
      alert.clear('file-not-found-error');

      readFileStream.removeAllListeners();
      readFileStream = null;

      if (callback) {
        callback();
      }
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readFileCombinedResults(readFilename, fileTimestamp, callback) {
    startMilliseconds = Date.now();

    log.info(`----- ${machineName}: reading file: ${readFilename},  timestamp = ${fileTimestamp}`);

    webdavClient
      .getFileContents(`/${readFilename}`, { format: 'text' })
      .then((text) => {
        // log.info('----- ' + machineName + ': start text');
        // log.info(text);
        // log.info('----- ' + machineName + ': end text');

        endMilliseconds = Date.now();
        log.info(`----- ${machineName}: done reading file: ${readFilename}.  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);

        fileContentsString = text;
        // let fileLength = fileContentsString.length;
        // log.info('!!!!!! ' + machineName + ': fileContentsString.length = ' + fileLength);
        // log.info('!!!!!! ' + machineName + ': fileContentsString.substr(0, 100) = ' +
        //          fileContentsString.substr(0, 100));
        // log.info('!!!!!! ' + machineName +
        //           ': fileContentsString.substr(fileLength - 100) = ' +
        //           fileContentsString.substr(fileLength - 100));
        parseCSVFileCombinedResults(readFilename, fileTimestamp);
        fileContentsString = '';
        lastFileReadName = readFilename;
        updateConnectionStatus(true);
        alert.clear('file-not-found-error');
        if (callback) {
          callback();
        }
      })
      .catch((err) => {
        // raise an alert for file not found only if not deleting files after read
        log.info(`----- ${machineName}: getFileContents err = ${err}`);
        updateConnectionStatus(false);
        alert.raise({ key: 'file-not-found-error', filename: readFilename });
        if (callback) {
          callback();
        }
      });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function processReadTimerModeCSVCombinedResult() {
    startMilliseconds = Date.now();

    // prevent interrupting long read with another read
    if (continueProcessingCurrentFileFlag) {
      log.info(`----- ${machineName}: continue processing file: ${continueProcessingFilename}`);
      reportCombinedResultsVersion2RowData(continueProcessingFilename,
        continueProcessingFileTimestamp);
      readTimer = setTimeout(readTimerFunc, readFrequencyMs);
      return;
    }

    let numberOfFilesToReport = maxNumberOfFilesToReport;
    let fileIndex = 0;
    let currentFileIndex;
    const matchingFiles = [];
    if ((_.get(that.machine.settings.model, 'useBaseFilename', false))
        || (checkAllFilesFlag)) {
      // use base filename
      const baseFilename = _.get(that.machine.settings.model, 'baseFilename', '');

      // for our first report, ONLY deliver the latest file's data
      if (lastFileReadTimestamp === 0) {
        numberOfFilesToReport = 1;
      }

      log.info(`----- ${machineName}: reading directory`);

      webdavClient
        .getDirectoryContents('/')
        .then((contents) => {
          endMilliseconds = Date.now();
          log.info(`----- ${machineName}: done reading directory.  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);

          alert.clear('directory-read-error');
          // search the directory for all files with this base name and find the newest
          async.forEach(contents, (item, cbSearch) => {
            if ((item.type === 'file')
                && (item.size >= MINIMUM_FILE_SIZE)
                && ((checkAllFilesFlag)
                 || (item.basename.startsWith(baseFilename)))) {
              let blacklistRegexString = '';
              if (_.get(that.machine.settings.model, 'useBlacklistRegex', false)) {
                blacklistRegexString = _.get(that.machine.settings.model, 'blacklistRegex', '');
              }
              let fileMatch = true;
              if (blacklistRegexString !== '') {
                const blacklistRegex = new RegExp(blacklistRegexString);
                if (blacklistRegex.test(item.basename)) {
                  log.info(`----blacklist match: ${item.basename}, file ignored`);
                  fileMatch = false;
                }
              }
              if (fileMatch === true) {
                const fileDate = new Date(item.lastmod);
                matchingFiles.push({ name: item.basename, timestamp: fileDate });
              }
            }
            cbSearch();
          },
          () => {
            // check if we found ANY matching filenames
            if (matchingFiles.length > 0) {
              // first, sort the matching files
              // eslint-disable-next-line no-nested-ternary
              matchingFiles.sort((a, b) => ((a.timestamp > b.timestamp) ? -1
                : ((a.timestamp === b.timestamp) ? 0 : 1)));
              // matchingFiles should now hold the newest file info in array element 0.

              // log.info('----- ' + machineName + ': matchingFiles.length: ' +
              //          matchingFiles.length);
              // log.info('----- ' + machineName + ': matchingFiles:' +
              //          JSON.stringify(matchingFiles));
              // log.info('----- ' + machineName + ': lastFileReadTimestamp = ' +
              //          lastFileReadTimestamp);

              // we will work backwards through the matchingFiles,
              // so as to deliver oldest data first
              fileIndex = numberOfFilesToReport - 1; // assume maximum number of files to report
              if (fileIndex >= matchingFiles.length) {
                // but limit ourselves to the actual number that we have
                fileIndex = matchingFiles.length - 1;
              }
              async.whilst(
                () => fileIndex >= 0,
                (callback) => {
                  currentFileIndex = fileIndex;
                  fileIndex -= 1;
                  //  log.info('----- ' + machineName + ': checking: ' +
                  //     JSON.stringify(matchingFiles[currentFileIndex]));
                  //  log.info('----- ' + machineName + ': lastFileReadTimestamp: ' +
                  //     lastFileReadTimestamp);

                  if (matchingFiles[currentFileIndex].timestamp > lastFileReadTimestamp) {
                    // only read the file if it's newer than our last report
                    const parseMode = _.get(that.machine.settings.model, 'mode', 'CSV: Combined result-version 1');
                    if (parseMode === 'CSV: Combined result-version 2-large file') {
                      readLargeFileCombinedResults(matchingFiles[currentFileIndex].name,
                        matchingFiles[currentFileIndex].timestamp,
                        callback);
                    } else {
                      readFileCombinedResults(matchingFiles[currentFileIndex].name,
                        matchingFiles[currentFileIndex].timestamp, callback);
                    }
                    lastFileReadTimestamp = matchingFiles[currentFileIndex].timestamp;

                    // FORCE EARLY TIMESTAMP FOR TESTING
                    // if (firstReadFlag) {
                    //   firstReadFlag = false;
                    //   lastFileReadTimestamp -= 1;
                    //   log.info('----- ' + machineName +
                    //            ': adjusted for testing: lastFileReadTimestamp = ' +
                    //            lastFileReadTimestamp);
                    // }
                    // END FORCE EARLY TIMESTAMP FOR TESTING

                    if (continueProcessingCurrentFileFlag) {
                      // force the loop to end, since we are going to continue with
                      // this file next interval
                      fileIndex = -1;
                    }
                  } else {
                    callback(null);
                  }
                },
                (err) => {
                  // done processing all available files

                  endMilliseconds = Date.now();
                  log.info(`----- ${machineName}: done reading files.  err = ${JSON.stringify(err)}      Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);

                  // set up for the next read
                  readTimer = setTimeout(readTimerFunc, readFrequencyMs);
                },
              );
            } else {
              alert.raise({ key: 'base-filename-not-found-error', filename: baseFilename });

              // set up for the next read
              readTimer = setTimeout(readTimerFunc, readFrequencyMs);
            }
          });
        })
        .catch(() => {
          if (running) {
            alert.raise({ key: 'directory-read-error' });
          }
          // set up for the next read
          readTimer = setTimeout(readTimerFunc, readFrequencyMs);
        });
    } else {
      // use specific filename
      const filename = _.get(that.machine.settings.model, 'filename', '');
      webdavClient
        .stat(filename)
        .then((itemStats) => {
          alert.clear('file-not-found-error');
          const fileDate = new Date(itemStats.lastmod);
          if (fileDate > lastFileReadTimestamp) {
            readFileCombinedResults(filename, fileDate, () => {
              if (continueProcessingCurrentFileFlag) {
                lastFileReadTimestamp = matchingFiles[currentFileIndex].timestamp;
                // force the loop to end, since we are going to continue with this'
                // file next interval
                fileIndex = -1;
              } else {
                lastFileReadTimestamp = fileDate;
                // set up for the next read

                endMilliseconds = Date.now();
                log.info(`----- ${machineName}: done reading file.  Total elapsed milliseconds = ${endMilliseconds - startMilliseconds}`);

                readTimer = setTimeout(readTimerFunc, readFrequencyMs);
              }
            });
          } else {
            log.info(`----- ${machineName}: file ${filename} not changed.  lastmod: ${itemStats.lastmod}`);
            // set up for the next read
            readTimer = setTimeout(readTimerFunc, readFrequencyMs);
          }
        })
        .catch(() => {
          if (running) {
            alert.raise({ key: 'file-not-found-error' });
          }
          // set up for the next read
          readTimer = setTimeout(readTimerFunc, readFrequencyMs);
        });
    }
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function parseTxtFile(text, callback) {
    // get the individual rows of the txt file
    const lines = text.split(/\r+\n?/);

    let startingRow;
    let endingRow;

    if (demoIndex === 0) {
      // for demo, first read, use the next to last file, and we will get 1 element 16 back
      // from the end
      startingRow = lines.length - 1 - (16 * 2);
      endingRow = startingRow + 2;
      lastRowRead = endingRow;
      demoIndex = 1;
    } else if (demoIndex === 1) {
      // for demo, second read, use the next to last file, and we will get 10 elements, starting
      // 15 back from the end (leaving 5 for the next
      startingRow = lines.length - 1 - (15 * 2);
      endingRow = startingRow + 10;
      lastRowRead = endingRow;
      demoIndex = 2;
    } else if (demoIndex === 2) {
      // for demo, third read, part 1, just use the latest file.  this should cause a read of the
      // last 5 elements from the previous file/.
      // then the entirety of the latest.  Since the latest is still pretty long, we will
      // artificially limit this to the first 5 elements.
      startingRow = lastRowRead;
      endingRow = lines.length - 1;
      lastRowRead = endingRow;
      demoIndex = 3;
    } else if (demoIndex === 3) {
      // for demo, third read, part 2, just use the latest file.  this should cause a read of the
      //  last 5 elements from the previous file.
      // then the entirety of the latest.  Since the latest is still pretty long, we will
      // artificially limit this to the first 5 elements.
      startingRow = 0;
      endingRow = 10;
      lastRowRead = endingRow;
      demoIndex = 4;
    } else if (demoIndex === 4) {
      // for demo, forth read, continue with the latest file, but we will set the starting point
      // 7 back from the end and only return 4 element.
      // this will leave 3 more elements for the next read, then future reads will work as normal.
      startingRow = lines.length - 1 - (7 * 2);
      endingRow = startingRow + (4 * 2);
      lastRowRead = endingRow;
      demoIndex = 5;
    } else {
      if (lastFileRead === '') {
        // if this is our first read, simple report the last data element in the file
        startingRow = lines.length - 1 - 2;
      } else {
        startingRow = lastRowRead;
      }
      endingRow = lines.length - 1;
      lastRowRead = endingRow;
    }

    // log.info('----- ' + machineName + ': startingRow = ' + startingRow +
    //             '      endingRow = ' + endingRow + '       lastRowRead = ' + lastRowRead);

    combinedResultArray = [];
    for (let iLines = startingRow; iLines < endingRow; iLines += 2) {
      // combine two lines into a single
      let completeRow = `${lines[iLines]} ${lines[iLines + 1]}`;
      // fix any spaces before or after the =
      completeRow = completeRow.replace(/\s*=\s*/g, '=');
      // strip out the timestamp
      const lastequalsindex = completeRow.lastIndexOf('=');
      const timestampIndex = completeRow.indexOf(' ', lastequalsindex);
      let timestampValue = completeRow.substring(timestampIndex + 1);
      completeRow = completeRow.substring(0, timestampIndex);
      //  log.info('----- ' + machineName + ': lines[' + iLines +
      //              ', ' + (iLines + 1) + '] = ' + completeRow);
      //  log.info('----- ' + machineName + ': Timestamp = ' + timestampValue);
      const variableElements = completeRow.split(' ');
      //  log.info('----- ' + machineName + ': variableElements = ' + variableElements);
      const data = {};
      for (let iFields = 0; iFields < variableElements.length; iFields += 1) {
        const fields = variableElements[iFields].split('=');
        // eslint-disable-next-line prefer-destructuring
        data[fields[0]] = fields[1];
      }

      const UTCOffset = _.get(that.machine.settings.model, 'utcOffset', 0);
      const originalUTCTimestamp = Date.parse(timestampValue);

      const adjustedUTCTimestamp = originalUTCTimestamp + (UTCOffset * 60 * 60 * 1000);

      const adjustedDate = new Date(adjustedUTCTimestamp);

      timestampValue = adjustedDate.toISOString();

      data.timestamp = timestampValue;
      combinedResultArray.push(data);
    }

    if (combinedResultArray.length) {
      updateAllVariablesWithCombinedResult();
    }
    callback(null);
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readTXTFile(filename, callback) {
    // if new file and reading all, always start at the first row
    if (filename !== lastFileRead) lastRowRead = 0;

    // log.info('----- ' + machineName + ': reading file: ' + filename);

    webdavClient
      .getFileContents(`/${filename}`, { format: 'text' })
      .then((text) => {
        // log.info('----- ' + machineName + ': start text');
        // log.info(text);
        // log.info('----- ' + machineName + ': end text');
        parseTxtFile(text, () => {
          updateConnectionStatus(true);
          alert.clear('file-not-found-error');
          callback();
        });
      })
      .catch((err) => {
        log.info(`----- ${machineName}: getFileContents err = ${err}`);
        updateConnectionStatus(false);
        alert.raise({ key: 'file-not-found-error', filename });
        callback();
      });
  }

  function processReadTimerModeTXTCombinedResult() {
    let filename = null;
    const baseFilename = _.get(that.machine.settings.model, 'baseFilename', '');
    let newestDate = new Date(0);
    const matchingFiles = [];

    webdavClient
      .getDirectoryContents('/')
      .then((contents) => {
        alert.clear('directory-read-error');
        // search the directory for all files with this base name and find the newest
        async.forEach(contents, (item, cbSearch) => {
          if ((item.type === 'file')
              && (item.size >= MINIMUM_FILE_SIZE)
              && (item.basename.startsWith(baseFilename))) {
            let blacklistRegexString = '';
            if (_.get(that.machine.settings.model, 'useBlacklistRegex', false)) {
              blacklistRegexString = _.get(that.machine.settings.model, 'blacklistRegex', '');
            }
            let fileMatch = true;
            if (blacklistRegexString !== '') {
              const blacklistRegex = new RegExp(blacklistRegexString);
              if (blacklistRegex.test(item.basename)) {
                log.info(`----blacklist match: ${item.basename}, file ignored`);
                fileMatch = false;
              }
            }
            if (fileMatch === true) {
              matchingFiles.push(item.basename);
              const fileDate = new Date(item.lastmod);
              if (fileDate > newestDate) {
                newestDate = fileDate;
                filename = item.basename;
              }
            }
          }
          cbSearch();
        },
        () => {
          if (filename !== null) {
            // log.info('----- ' + machineName + ': latest file: ' + filename);
            if (lastFileRead !== '') {
              if (filename !== lastFileRead) {
                // first, finish processing the previous file.
                readTXTFile(lastFileRead, () => {
                  // then, process the new file, from the beginning
                  lastRowRead = 0;
                  readTXTFile(filename, () => {
                    lastFileRead = filename;
                    alert.clear('base-filename-not-found-error');
                    // set up for the next read
                    readTimer = setTimeout(readTimerFunc, readFrequencyMs);
                  });
                });
              } else {
                // process any new data in the file
                readTXTFile(filename, () => {
                  alert.clear('base-filename-not-found-error');
                  // set up for the next read
                  readTimer = setTimeout(readTimerFunc, readFrequencyMs);
                });
              }
            } else {
              // first time reading the files
              readTXTFile(filename, () => {
                lastFileRead = filename;
                alert.clear('base-filename-not-found-error');
                // set up for the next read
                readTimer = setTimeout(readTimerFunc, readFrequencyMs);
              });
            }
          } else {
            // raise an alert for base filename not found
            alert.raise({ key: 'base-filename-not-found-error', baseFilename });
            // set up for the next read
            readTimer = setTimeout(readTimerFunc, readFrequencyMs);
          }
        });
      })
      .catch(() => {
        if (running) {
          alert.raise({ key: 'directory-read-error' });
        }
        // set up for the next read
        readTimer = setTimeout(readTimerFunc, readFrequencyMs);
      });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function open(callback) {
    ({ username } = that.machine.settings.model);
    ({ password } = that.machine.settings.model);
    readFrequencyMs = that.machine.settings.model.readFrequency * 1000;
    lastFileRead = '';
    lastRowRead = 0;
    latestRowTimestamp = 0;
    lastFileReadTimestamp = 0;

    latestLargeFileTimestamp = 0;

    // FORCE EARLY TIMESTAMP FOR TESTING
    // firstReadFlag = true;  // used for testing
    // firstProcessFlag = true;  // used for testing
    // END FORCE EARLY TIMESTAMP FOR TESTING

    checkAllFilesFlag = _.get(that.machine.settings.model, 'checkAllFiles', false);

    const timestampIndexFields = _.get(that.machine.settings.model, 'timestampFields', '1').split(that.machine.settings.model.separator);
    timestampFieldIndex1 = timestampIndexFields[0] - 1;
    if (timestampFieldIndex1 < 0) {
      timestampFieldIndex1 = 0;
    }
    if (timestampIndexFields.length > 1) {
      timestampFieldIndex2 = timestampIndexFields[1] - 1;
    } else {
      timestampFieldIndex2 = -1;
    }

    let serverUrl = that.machine.settings.model.webdavUrl;
    if (!serverUrl.startsWith('http')) serverUrl = `http://${serverUrl}`;

    webdavClient = webdav(serverUrl, username, password);

    readTimer = setTimeout(readTimerFunc, readFrequencyMs);

    running = true;

    // if deleting file after read, set the connection status true  until HPL stopped
    if (_.get(that.machine.settings.model, 'deleteFileAfterRead', false)) {
      updateConnectionStatus(true);
    }

    callback(null);
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
    running = false;
    continueProcessingCurrentFileFlag = false;

    shuttingDownFlag = true;

    if (readTimer) {
      clearTimeout(readTimer);
      readTimer = null;
    }

    clearAlertsAndStop(done);
  };

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop((err) => {
      if (err) return done(err);
      that.start(that.dataCb, that.configUpdateCb, startErr => done(startErr));
      return undefined;
    });
  };

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  this.updateModel = function updateModel(newModel, done) {
    log.debug('Updating');
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

module.exports = {
  hpl: hplWebDAV,
  defaults,
  schema,
};
