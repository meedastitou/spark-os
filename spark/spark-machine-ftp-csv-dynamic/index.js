/*jshint esversion: 6 */
var path = require('path');
var EventEmitter = require("events").EventEmitter;
var config = require(path.join(__dirname, 'config.json'));
var pkg = require(path.join(__dirname, 'package.json'));
var async = require('async');
var _ = require('lodash');
let ftp = require('ftp');

const { Readable } = require('stream');

// Private variables
let ftpClient = null;
let readTimer = null;
let username = '';
let password = '';
let readFrequencyMs = 5000;
let lastFileTimestamp = 0;
let lastBatchStartTime = 0;
let readingFile = false;
let parsingFile = false;
let separator = '';
let timestampFieldIndex1 = 0; // assume first field is the timestamp
let timestampFieldIndex2 = -1;  // use -1 to indicate that there is NO second timestamp field
var lastFileReadTimestamp = 0;
const maxNumberOfFilesToReport = 10;
const maxNumberOfRowsToReport = 500;
let checkAllFilesFlag = false;
let continueProcessingCurrentFileFlag = false;
let continueProcessingFilename = '';
let continueProcessingFileTimestamp = 0;

let totalSize = 0;
let fileContentsString = '';

var firstStart = true;
var alert = null;

var info = {
    name: pkg.name,
    fullname: pkg.fullname,
    version: pkg.version,
    description: pkg.description
};
config.info = info;

var deliverEntireResultVariable = {
    "name": "CombinedResult",
    "description": "CombinedResult",
    "format": "char",
    "array": true
};

function dbAddResult(err, res) {
    if (err) {
        alert.raise({ key: 'db-add-error', errorMsg: err.message });
    } else {
        alert.clear('db-add-error');
    }
    if (res) log.debug(res);
}

function updateConnectionStatus(connected) {
  conf.set('machines:' + pkg.name + ':settings:model:connectionStatus', connected, () => {});
}

var ftpCsvDynamic = new EventEmitter();

function onSetListener(key) {
    // check if anything in the model changes
    var re = new RegExp('machines:' + pkg.name + ':settings:model:(?!connectionStatus)');
    if (re.test(key)) {
        conf.get('machines:' + pkg.name + ':settings:model', function(err, model) {
            log.debug('machines:' + pkg.name + ':settings:model', model);

            if (!_.isEqual(model, config.settings.model)) {
                // if any of the setting have changed
                log.debug('machines:' + pkg.name + ':settings:model changed from', config.settings.model, 'to', model);

                // update our local copy
                config.settings.model = model;

                // request a restart
                ftpCsvDynamic.emit('restartRequest', info.name);
            }
        });
    }
}



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

function parseFile(filename, fileTimestamp) {

  if (parsingFile) {
    return;
  }
  parsingFile = true;

  const lines = fileContentsString.split(/\r+\n?/);
  console.log('----number of lines = ' + lines.length);

  let latestTimestamp = 0;
  let latestTimestampLineIndex = 0;
  let latestTimestampRowFields;

  let newRows = [];
  if (lastBatchStartTime === 0) {
    // first read - just find the latest entry
    for (let index = 1; index < lines.length; index += 1) {
      const fields = lines[index].replace(/\0/g, '').split(separator);
      let timestamp = 0;
      if ((timestampFieldIndex1 < fields.length) && (timestampFieldIndex2 < fields.length)) {
        if (timestampFieldIndex2 >= 0) {
          timestamp = Date.parse(fields[timestampFieldIndex1] + ' ' + fields[timestampFieldIndex2]);
        } else {
          timestamp = Date.parse(fields[timestampFieldIndex1]);
        }
      }
      if (timestamp > latestTimestamp) {
        latestTimestampRowFields = fields;
        latestTimestamp = timestamp;
        latestTimestampLineIndex = index;
      }
    }
    if (latestTimestampRowFields) {
      newRows.push(latestTimestampRowFields);
    }
  } else {
    let firstRow = 0;
    if (_.get(config.settings.model, 'useHeaderRowForKeywords', true)) {
      firstRow = 1;
    }
    for (let index = firstRow; index < lines.length; index += 1) {
      const fields = lines[index].replace(/\0/g, '').split(separator);
      let timestamp = 0;
      if ((timestampFieldIndex1 < fields.length) && (timestampFieldIndex2 < fields.length)) {
        if (timestampFieldIndex2 >= 0) {
          timestamp = Date.parse(fields[timestampFieldIndex1] + ' ' + fields[timestampFieldIndex2]);
        } else {
          timestamp = Date.parse(fields[timestampFieldIndex1]);
        }
      }
      if (timestamp > lastBatchStartTime) {
        newRows.push(fields);
      }
      if (timestamp > latestTimestamp) {
        latestTimestampRowFields = fields;
        latestTimestamp = timestamp;
        latestTimestampLineIndex = index;
      }
    }
  }

  if (newRows.length > 0) {
    console.log('>>>>>>>> newRows.length = ' + newRows.length);
    // first, sort the fields that we've tagged as newer than our last read
    if ((timestampFieldIndex1 < newRows[0].length) && (timestampFieldIndex2 < newRows[0].length)) {
      if (timestampFieldIndex2 >= 0) {

        //    console.log('>>>> PRESORT');
        //    for (var i = 0; i < newRows.length; i += 1) {
        //      console.log('>>> newRow[' + i + '] = ' + JSON.stringify(newRows[i]));
        //    }
        newRows.sort(function(a, b) {
          return ((Date.parse(a[timestampFieldIndex1]+' '+a[timestampFieldIndex2]) >
                   Date.parse(b[timestampFieldIndex1]+' '+b[timestampFieldIndex2])) ? -1 :
                      ((Date.parse(a[timestampFieldIndex1]+' '+a[timestampFieldIndex2]) ==
                        Date.parse(b[timestampFieldIndex1]+' '+b[timestampFieldIndex2])) ? 0 : 1));
        });
        //    console.log('>>>> POSTSORT');
        //    for (var i = 0; i < newRows.length; i += 1) {
        //      console.log('>>> newRow[' + i + '] = ' + JSON.stringify(newRows[i]));
        //    }

        // newRows should now hold the newest row data in array element 0.
        lastBatchStartTime = Date.parse(newRows[0][timestampFieldIndex1] + ' ' + newRows[0][timestampFieldIndex2]);

      } else {

        //    console.log('>>>> PRESORT');
        //    for (var i = 0; i < newRows.length; i += 1) {
        //      console.log('>>> newRow[' + i + '] = ' + JSON.stringify(newRows[i]));
        //    }
        newRows.sort(function(a, b) {
          return ((Date.parse(a[timestampFieldIndex1]) > Date.parse(b[timestampFieldIndex1])) ? -1 :
                    ((Date.parse(a[timestampFieldIndex1]) == Date.parse(b[timestampFieldIndex1])) ? 0 : 1));
        });
        //    console.log('>>>> POSTSORT');
        //    for (var i = 0; i < newRows.length; i += 1) {
        //      console.log('>>> newRow[' + i + '] = ' + JSON.stringify(newRows[i]));
        //    }

        // newRows should now hold the newest row data in array element 0.
        lastBatchStartTime = Date.parse(newRows[0][timestampFieldIndex1]);

      }
    }

    console.log('>>>>> latest BatchStartTime timestamp line = ' + (latestTimestampLineIndex + 1));
    console.log('>>>>> line #' + (latestTimestampLineIndex + 1) + ': ' + lines[latestTimestampLineIndex]);

    let keywords = [];
    if (_.get(config.settings.model, 'useHeaderRowForKeywords', true)) {
      // get the keyowrds from the header row
      keywords = lines[0].replace(/\0/g, '').split(separator);
    } else {
      // get the keyowrds from the config entry
      keywords = _.get(config.settings.model, 'keywordList', '').split(',');
    }

    //console.log('----keywords = ' + keywords);
    //console.log('------keywords.length = ' + keywords.length);
    if (keywords.length === 0) {
      parsingFile = false;
      return;
    }

    // we will work backwards through the newRows data, so as to deliver oldest data first
    var rowIndex = newRows.length - 1;  // assume maximum number of rows to report
//    var rowIndex = maxNumberOfRowsToReport - 1;  // assume maximum number of rows to report
//    if (rowIndex >= newRows.length) {
//      rowIndex = newRows.length - 1; // but limit ourselves to the actual number that we have
//    }
    var reportCount = 0;
    while ((rowIndex >= 0) && (reportCount < maxNumberOfRowsToReport)) {
      var combinedResultArray = [];
      var data = {};

      const rowData = newRows[rowIndex];
      for (var colNumber = 0; colNumber < keywords.length; colNumber += 1) {
        //console.log('----data[' + keywords[colNumber] + '] = ' + rowData[colNumber]);
        if ((colNumber < rowData.length) && (keywords[colNumber].length > 0)) {
          // skip any date/time field that we used for sorting - that will be added as a new,
          // defined timestamp field.
          if ((colNumber !== timestampFieldIndex1) && (colNumber !== timestampFieldIndex2)) {
            data[keywords[colNumber]] = rowData[colNumber];
          }
        }
      }

      // add the timestamp field to each object
      var rowTimestampValue;
      if (timestampFieldIndex2 >= 0) {
        rowTimestampValue = Date.parse(rowData[timestampFieldIndex1] + ' ' + rowData[timestampFieldIndex2]);
      } else {
        rowTimestampValue = Date.parse(rowData[timestampFieldIndex1]);
      }

      // add in any UTC offset
      let UTCOffset = _.get(config.settings.model, 'utcOffset', 0);
      const adjustedUTCTimestamp = rowTimestampValue + (UTCOffset * 60 * 60 * 1000);

      const adjustedTimestamp = new Date(adjustedUTCTimestamp);

      rowTimestampValue = adjustedTimestamp.toISOString();
      data.timestamp = rowTimestampValue;

      // optionally add in the filename
      if (_.get(config.settings.model, 'includeFilenameInCombinedData', false)) {
        // only add the filename field if we don't already have one
        if (!_.has(data, "filename")) {
          data.filename = filename;
        }
      }

      combinedResultArray.push(data);

      reportCount = reportCount + 1;
      console.log('----Report #' + reportCount + ': CombinedResult = ' + JSON.stringify(combinedResultArray));

      if (combinedResultArray.length) {
        console.log('---------------updating database');
        var combinedResultsData = {
          machine: config.info.name,
          variable: "CombinedResult",
          CombinedResult: combinedResultArray
        };

        db.add(combinedResultsData, dbAddResult);
      }
      rowIndex -= 1;
    }
    if (rowIndex >= 0) {
      // still more to process in this file - set a flag so we resume here
      continueProcessingCurrentFileFlag = true;
      continueProcessingFilename = filename;
      continueProcessingFileTimestamp = fileTimestamp;
      if ((timestampFieldIndex1 < newRows[rowIndex + 1].length) && (timestampFieldIndex2 < newRows[rowIndex + 1].length)) {
        if (timestampFieldIndex2 >= 0) {
          lastBatchStartTime = Date.parse(newRows[rowIndex + 1][timestampFieldIndex1] + ' ' + newRows[rowIndex + 1][timestampFieldIndex2]);
        } else {
          lastBatchStartTime = Date.parse(newRows[rowIndex + 1][timestampFieldIndex1]);
        }
      }
    } else {
      continueProcessingCurrentFileFlag = false;
    }
  } else {
    console.log('No entries found with a later timestamp');
  }
  parsingFile = false;
}

function readAndParseFile(readFilename, fileTimestamp, callback) {

  console.log('------reading file: ' + readFilename);

  totalSize = 0;
  fileContentsString = '';

  ftpClient.get(readFilename, function(err, rs) {
     if (err) {
       console.log('ftp file read err: ' + err);
       callback();
     } else {
       rs.setEncoding('utf8');
       rs.on('data', (chunk) => {
         totalSize += chunk.length;
         fileContentsString = fileContentsString + chunk;
//             console.log(`Received ${chunk.length} bytes of data.`);
       });
       rs.on('end', () => {
         console.log('There will be no more data.');
         console.log('------------totalSize = ' + totalSize);

         parseFile(readFilename, fileTimestamp);
         updateConnectionStatus(true);
         alert.clear('file-not-found-error');
         if (callback) {
           callback();
         }
       });
     }
  });

}

function readTimerFunc() {
  // prevent interrupting long read with another read
  if (readingFile) {
    if (continueProcessingCurrentFileFlag) {
      parseFile(continueProcessingFilename, continueProcessingFileTimestamp);
      if (!continueProcessingCurrentFileFlag) {
        readingFile = false;  // we've finished parsing, so go back to reading next cycle
      }
    }
    return;
  }
  readingFile = true;

  var numberOfFilesToReport = maxNumberOfFilesToReport;
  if ((_.get(config.settings.model, 'useBaseFilename', false)) ||
      (checkAllFilesFlag)) {
    // use base filename - or check all files
    let filename = null;
    const baseFilename = _.get(config.settings.model, 'baseFilename', '');
    const matchingFiles = [];

    // for our first report, ONLY deliver the latest file's data
    if (lastFileReadTimestamp === 0) {
      numberOfFilesToReport = 1;
    }

    ftpClient.list(function(err, list) {
      if (err) {
        console.log('ftp directory list error: ' + err);
      } else {
        console.log('-----------------filelist = ' + JSON.stringify(list));
        for (let index = 0; index < list.length; index += 1) {
          const fileTypeExtension = _.get(config.settings.model, 'fileType', '');
          if (list[index].type === '-') {
            if (checkAllFilesFlag) {
              if ((fileTypeExtension === '') ||
                  ((fileTypeExtension !== '') && (list[index].name.endsWith(fileTypeExtension)))) {
                const fileDate = new Date(list[index].date);
                matchingFiles.push({'name': list[index].name, 'timestamp': fileDate});
              }
            } else if (_.get(config.settings.model, 'useBaseFilename', false)) {
              if (list[index].name.startsWith(baseFilename)) {
                if ((fileTypeExtension === '') ||
                    ((fileTypeExtension !== '') && (list[index].name.endsWith(fileTypeExtension)))) {
                  const fileDate = new Date(list[index].date);
                  matchingFiles.push({'name': list[index].name, 'timestamp': fileDate});
                }
              }
            } else {
              if (list[index].name === _.get(config.settings.model, 'filename', '')) {
                const fileDate = new Date(list[index].date);
                matchingFiles.push({'name': list[index].name, 'timestamp': fileDate});
              }
            }
          }
        }

        // check if we found ANY matching filenames
        if (matchingFiles.length > 0) {
          // since we found a matching file, we can clear our alert
          alert.clear('base-filename-not-found-error');
          // first, sort the matching files
          matchingFiles.sort(function(a, b) {
            return ((a.timestamp > b.timestamp) ? -1 : ((a.timestamp == b.timestamp) ? 0 : 1));
          });
          // matchingFiles should now hold the newest file info in array element 0.

console.log('matchingFiles:' + JSON.stringify(matchingFiles));

          // we will work backwards through the matchingFiles, so as to deliver oldest data first
          var fileIndex = numberOfFilesToReport - 1;  // assume maximum number of files to report
console.log('------------------------- matchingFiles.length: ' + matchingFiles.length);
          if (fileIndex >= matchingFiles.length) {
            fileIndex = matchingFiles.length - 1; // but limit ourselves to the actual number that we have
          }
          async.whilst(
            function () {
              return fileIndex >= 0;
            },
            function (callback) {
              var currentFileIndex = fileIndex;
              fileIndex = fileIndex - 1;
console.log('------------------------- checking: ' + JSON.stringify(matchingFiles[currentFileIndex]));
console.log('------------------------- lastFileReadTimestamp: ' + lastFileReadTimestamp);

              if (matchingFiles[currentFileIndex].timestamp > lastFileReadTimestamp) {
                // only read the file if it's newer than our last report
                readAndParseFile(matchingFiles[currentFileIndex].name, matchingFiles[currentFileIndex].timestamp, callback);
                if (continueProcessingCurrentFileFlag) {
                  lastFileReadTimestamp = matchingFiles[currentFileIndex].timestamp;
                  fileIndex = -1; //force the loop to end, since we are going to continue with this file next interval
                }
              } else {
                callback(null);
              }
            },
            function (err) {
              // done processing all available files
              if (!continueProcessingCurrentFileFlag) {
                readingFile = false;
                // set out new timestamp threshold
                if (lastFileReadTimestamp < matchingFiles[0].timestamp) {
                  lastFileReadTimestamp = matchingFiles[0].timestamp;
                }
              }
            });

        } else {
          alert.raise({ key: 'base-filename-not-found-error', filename: baseFilename });
          readingFile = false;
        }

      }
    });
  } else {
    // use specific filename
    const filename = _.get(config.settings.model, 'filename', '');

    ftpClient.lastMod(filename, function(err, fileTimestamp) {
      if (err) {
        console.log('ftp file lastMod err: ' + err);
        readingFile = false;
        return;
      } else {

        console.log('date = ' + fileTimestamp);
        const convertedTimestamp = Date.parse(fileTimestamp);
        if (convertedTimestamp > lastFileTimestamp) {
          lastFileTimestamp = convertedTimestamp; // subtract 1 to ensure we read again (for testing)
          readAndParseFile(filename, convertedTimestamp, function () {
            lastFileReadTimestamp = convertedTimestamp;
            if (!continueProcessingCurrentFileFlag) {
              readingFile = false;
            }
          });
        } else {
          console.log('file ' + filename + ' not changed.  lastmod: ' + fileTimestamp);
          readingFile = false;
        }

      }
    });
  }
}

function open(callback) {
  ({ username } = config.settings.model);
  ({ password } = config.settings.model);
  readFrequencyMs = config.settings.model.readFrequency * 1000;

  checkAllFilesFlag = _.get(config.settings.model, 'checkAllFiles', false);

  separator = _.get(config.settings.model, 'separator', ',');
  if (separator.length === 0) {
    serperator = ',';
  }
  const timestampIndexFields = _.get(config.settings.model, 'timestampFields', '1').split(',');
  timestampFieldIndex1 = timestampIndexFields[0] - 1;
  if (timestampFieldIndex1 < 0) {
    timestampFieldIndex1 = 0;
  }
  if (timestampIndexFields.length > 1) {
    timestampFieldIndex2 = timestampIndexFields[1] - 1;
  } else {
    timestampFieldIndex2 = -1;
  }
  let serverUrl = config.settings.model.ftpUrl;

  ftpClient = new ftp();
  ftpClient.on('ready', function() {
    ftpClient.list(function(err, list) {
      if (err) {
        console.log('ftp directory list error: ' + err);
      } else {
        console.dir(list);

        readingFile = false;
        lastFileTimestamp = 0;
        lastBatchStartTime = 0;

        console.log('=----starting read timer');

        // schedule subsequent reads
        readTimer = setInterval(readTimerFunc, readFrequencyMs);
      }
    });
  });

  ftpClient.on('end', function() {
    console.log('----received end');
  });

  ftpClient.on('error', function(err) {
    console.log('----received error: ' + err);
  });

  let ftpConfig = {host: serverUrl};
  if ((username) && (username.length > 0)) {
    ftpConfig.user = username;
  }
  if ((password) && (password.length > 0)) {
    ftpConfig.password = password;
  }
  // connect to localhost:21 as anonymous
  ftpClient.connect(ftpConfig);

  callback(null);
}

function clearAlertsAndStop(callback) {
  alert.clearAll((err) => {
    if (err) {
      log.error(err);
    }

    log.info('Stopped');

    callback(null);
  });
}

function writeBackConfig( callback ) {

    // if process has just started up
    if (firstStart === true) {
        firstStart = false;
        // write back config in case config json file had newer data than config database
        conf.set('machines:' + pkg.name, config, callback);
    } else {
        // other
        return callback();
    }
}

ftpCsvDynamic.start = function(modules, done) {

    log = modules['spark-logging'].exports.getLogger(pkg.name);
    db = modules['spark-db'].exports;
    conf = modules['spark-config'].exports;
    alert = modules['spark-alert'].exports.getAlerter(pkg.name);

    // preload alert messages that have known keys
    alert.preLoad({
      'file-not-found-error': {
        msg: 'FTP Dynamic: File Not Found',
        description: x => `The file ${x.filename} could not be found on the FTP server`,
      },
      'directory-read-error': {
        msg: 'FTP Dynamic: Directory Read Error',
        description: 'The specified directory could not be read on the FTP server',
      },
      'base-filename-not-found-error': {
        msg: 'FTP Dynamic: File With Base Filename Not Found',
        description: x => `No file with the base filename ${x.filename} could be found on the FTP server`,
      },
      'db-add-error': {
        msg: 'FTP Dynamic: Error Writing to Database',
        description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
      },
    });

    //listen for changes to the enable key
    //but only add the listener once
    if (conf.listeners('set').indexOf(onSetListener) === -1) {
        log.debug('config.settings.model.enable', config.settings.model.enable);
        conf.on('set', onSetListener);
    }


    updateConnectionStatus(false);

    // read the current settings from the database model
    conf.get('machines:' + pkg.name + ':settings:model', function(err, model) {

        // if there is model data in the db, update to it (e.g. overwrite what was read from readonly file)
        if (model) {
            config.settings.model = model;
        }

        if (!config.variables) {
          config.variables = [deliverEntireResultVariable];
          firstStart = true;
        } else if ((config.variables.length !== 1) || (!_.isEqual(config.variables[0], deliverEntireResultVariable))) {
            // if we're not already set up with the combined-response-variable, set it up and force a database updated
            config.variables = [deliverEntireResultVariable];
            firstStart = true;
        }

        // save our config if necessary
        writeBackConfig( function(err) {
            if (err) {
                return done(err);
            }

            // check enable state before continuing
            if (!config.settings.model.enable) {
                log.info('Disabled');
                return done(null, config.info);
            } else {

              open((err) => {
                if (err) {
                  return done(err);
                }

                log.info('Started');
                return done(null);
              });
            }
        });
    });
};

ftpCsvDynamic.stop = function(done) {

  ftpClient.end();

  updateConnectionStatus(false);
  running = false;
  readingFile = false;
  parsingFile = false;
  continueProcessingCurrentFileFlag = false;

  if (readTimer) {
    clearInterval(readTimer);
    readTimer = null;
  }

  clearAlertsAndStop(done);
};

ftpCsvDynamic.require = function() {
    return ['spark-logging',
        'spark-db',
        'spark-alert',
        'spark-config'
    ];
};

module.exports = ftpCsvDynamic;
