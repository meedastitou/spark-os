/*jshint esversion: 6 */
var path = require('path');
var EventEmitter = require("events").EventEmitter;
var config = require(path.join(__dirname, 'config.json'));
var pkg = require(path.join(__dirname, 'package.json'));
var async = require('async');
var _ = require('lodash');
let webdav = require('webdav');

// Private variables
let webdavClient = null;
let readTimer = null;
let username = '';
let password = '';
let readFrequencyMs = 5000;
let lastFileRead = '';
let lastRowRead = 0;
let running = false;
let readingFile = false;

var firstStart = true;
var alert = null;

var demoIndex = -1; // set to 0 to initiate the demo sequence.  note that this is hardcoded to
                    // the specific files in the directory at the time of the demo.

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

function updateConnectionStatus(connected) {
  conf.set('machines:' + pkg.name + ':settings:model:connectionStatus', connected, () => {});
}

var webdavTxtDynamic = new EventEmitter();

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
                webdavTxtDynamic.emit('restartRequest', info.name);
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

function parseTxtFile(text, callback) {

  // get the individual rows of the txt file
  const lines = text.split(/\r+\n?/);

  let startingRow;
  let endingRow;

  if (demoIndex === 0) {
    // for demo, first read, use the next to last file, and we will get 1 element 16 back from the end
    startingRow = lines.length - 1 - (16 * 2);
    endingRow = startingRow + 2;
    lastRowRead = endingRow;
    demoIndex = 1;
  } else if (demoIndex === 1) {
    // for demo, second read, use the next to last file, and we will get 10 elements, starting 15 back from the end (leaving 5 for the next
    startingRow = lines.length - 1 - (15 * 2);
    endingRow = startingRow + 10;
    lastRowRead = endingRow;
    demoIndex = 2;
  } else if (demoIndex === 2) {
    // for demo, third read, part 1, just use the latest file.  this should cause a read of the last 5 elements from the previous file,
    // then the entirety of the latest.  Since the latest is still pretty long, we will artificially limit this to the first 5 elements.
    startingRow = lastRowRead;
    endingRow = lines.length - 1;
    lastRowRead = endingRow;
    demoIndex = 3;
  } else if (demoIndex === 3) {
    // for demo, third read, part 2, just use the latest file.  this should cause a read of the last 5 elements from the previous file,
    // then the entirety of the latest.  Since the latest is still pretty long, we will artificially limit this to the first 5 elements.
    startingRow = 0;
    endingRow = 10;
    lastRowRead = endingRow;
    demoIndex = 4;
  } else if (demoIndex === 4) {
    // for demo, forth read, continue with the latest file, but we will set the starting point 7 back from the end and only return 4 element
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

//  console.log('startingRow = ' + startingRow + '      endingRow = ' + endingRow + '       lastRowRead = ' + lastRowRead);

  var combinedResultArray = [];
  for (let iLines = startingRow; iLines < endingRow; iLines += 2) {
    // combine two lines into a single
    let completeRow = lines[iLines] + ' ' + lines[iLines + 1];
    // fix any spaces before or after the =
    completeRow = completeRow.replace(/\s*=\s*/g, '=');
    // strip out the timestamp
    let lastequalsindex = completeRow.lastIndexOf('=');
    let timestampIndex = completeRow.indexOf(' ', lastequalsindex);
    let timestampValue = completeRow.substring(timestampIndex + 1);
    completeRow = completeRow.substring(0, timestampIndex);
//    console.log('lines[' + iLines + ', ' + (iLines + 1) + '] = ' + completeRow);
//    console.log('Timestamp = ' + timestampValue);
    const variableElements = completeRow.split(' ');
//    console.log('variableElements = ' + variableElements);
    let data = {};
    for (let iFields = 0; iFields < variableElements.length; iFields += 1) {
      let fields = variableElements[iFields].split('=');
      data[fields[0]] = fields[1];
    }

    let UTCOffset = _.get(config.settings.model, 'utcOffset', 0);
    const originalUTCTimestamp = Date.parse(timestampValue);

    const adjustedUTCTimestamp = originalUTCTimestamp + (UTCOffset * 60 * 60 * 1000);

    const adjustedDate = new Date(adjustedUTCTimestamp);

    timestampValue = adjustedDate.toISOString();

    data.timestamp = timestampValue;
    combinedResultArray.push(data);
  }

  if (combinedResultArray.length) {

      var combinedResultsData = {
          machine: config.info.name,
          variable: "CombinedResult",
          CombinedResult: combinedResultArray
      };

      db.add(combinedResultsData, function(err, res) {
          if (err) {
              alert.raise({ key: 'db-add-error', errorMsg: err.message });
          } else {
              alert.clear('db-add-error');
          }
          if (res) log.debug(res);
          callback(null);
        });
  } else {
    callback(null);
  }

}

function readFile(filename, callback) {
  // if new file and reading all, always start at the first row
  if (filename !== lastFileRead) lastRowRead = 0;

//  console.log('----------------reading file: ' + filename);

  webdavClient
    .getFileContents(`/${filename}`, { format: 'text' })
    .then((text) => {
//console.log('----------------start text');
//console.log(text);
//console.log('----------------end text');
      parseTxtFile(text, function() {
        updateConnectionStatus(true);
        alert.clear('file-not-found-error');
        callback();
      });
    })
    .catch((err) => {
//      console.log('err = ' + err);
      updateConnectionStatus(false);
      alert.raise({ key: 'file-not-found-error', filename });
      callback();
    });
}

function readTimerFunc() {
  // prevent interrupting long read with another read
  if (readingFile) return;
  readingFile = true;

  let filename = null;
  const baseFilename = _.get(config.settings.model, 'baseFilename', '');
  let newestDate = new Date(0);
  const matchingFiles = [];

  webdavClient
    .getDirectoryContents('/')
    .then((contents) => {
      alert.clear('directory-read-error');
      // search the directory for all files with this base name and find the newest
      async.forEach(contents, (item, cbSearch) => {
        if ((item.type === 'file') && (item.basename.startsWith(baseFilename))) {
          const fileDate = new Date(item.lastmod);
          let blacklistRegexString = '';
          if (_.get(config.settings.model, 'useBlacklistRegex', false)) {
            blacklistRegexString = _.get(config.settings.model, 'blacklistRegex', '');
          }
          if (blacklistRegexString === '') {
            // no regex, allowed to analyze this file
            matchingFiles.push(item.basename);
            if (fileDate > newestDate) {
              newestDate = fileDate;
              filename = item.basename;
            }
          } else {
            var blacklistRegex = new RegExp(blacklistRegexString);
            if (!blacklistRegex.test(item.basename)) {
              matchingFiles.push(item.basename);
              if (fileDate > newestDate) {
                newestDate = fileDate;
                filename = item.basename;
              }
            } else {
              console.log('----blacklist match: ' + item.basename + ', file ignored');
            }
          }
        }
        cbSearch();
      },
      () => {
        if (filename !== null) {
          if (demoIndex === 0) {
            // for demo, first read, use the next to last file, and we will get 1 element 16 back from the end
            filename = '21876532021012716.txt';
          } else if (demoIndex === 1) {
            // for demo, second read, use the next to last file, and we will get 10 elements, starting 15 back from the end (leaving 5 for the next read)
            filename = '21876532021012716.txt';
          } else if ((demoIndex === 2) || (demoIndex === 3)) {
            // for demo, third read, part 1 and 2, just use the latest file.  this should cause a read of the last 5 elements from the previous file,
            // then the entirety of the latest.  Since the latest is still pretty long, we will artificially limit this to the first 5 elements.
          } else if (demoIndex === 4) {
            // for demo, forth read, continue with the latest file, but we will set the starting point 7 back from the end and only return 4 elements.
            // this will leave 3 more elements for the next read, then future reads will work as normal.
          }
//          console.log('----------------latest file: ' + filename);
          if (lastFileRead !== '') {
            if (filename !== lastFileRead) {
              // first, finish processing the previous file.
              readFile(lastFileRead, () => {
                // then, process the new file, from the beginning
                lastRowRead = 0;
                readFile(filename, () => {
                  lastFileRead = filename;
                  alert.clear('base-filename-not-found-error');
                  readingFile = false;
                });
              });
            } else {
              // process any new data in the file
              readFile(filename, () => {
                alert.clear('base-filename-not-found-error');
                readingFile = false;
              });
            }
          } else {
            // first time reading the files
            readFile(filename, () => {
              lastFileRead = filename;
              alert.clear('base-filename-not-found-error');
              readingFile = false;
            });
          }
        } else {
          // raise an alert for base filename not found
          alert.raise({ key: 'base-filename-not-found-error', baseFilename });
          readingFile = false;
        }
      });
    })
    .catch(() => {
      if (running) {
        alert.raise({ key: 'directory-read-error' });
      }
      readingFile = false;
    });
}

function open(callback) {
  ({ username } = config.settings.model);
  ({ password } = config.settings.model);
  readFrequencyMs = config.settings.model.readFrequency * 1000;
  lastFileRead = '';
  lastRowRead = 0;

  let serverUrl = config.settings.model.webdavUrl;
  if (!serverUrl.startsWith('http')) serverUrl = `http://${serverUrl}`;

  webdavClient = webdav(serverUrl, username, password);

  readTimer = setInterval(readTimerFunc, readFrequencyMs);

  running = true;
  readingFile = false;

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

webdavTxtDynamic.start = function(modules, done) {

    log = modules['spark-logging'].exports.getLogger(pkg.name);
    db = modules['spark-db'].exports;
    conf = modules['spark-config'].exports;
    alert = modules['spark-alert'].exports.getAlerter(pkg.name);

    // preload alert messages that have known keys
    alert.preLoad({
      'file-not-found-error': {
        msg: 'webDAV Dynamic: File Not Found',
        description: x => `The file ${x.filename} could not be found on the WebDAV server`,
      },
      'directory-read-error': {
        msg: 'webDAV Dynamic: Directory Read Error',
        description: 'The specified directory could not be read on the WebDAV server',
      },
      'base-filename-not-found-error': {
        msg: 'webDAV Dynamic::File With Base Filename Not Found',
        description: x => `No file with the base filename ${x.baseFilename} could be found on the WebDAV server`,
      },
      'db-add-error': {
        msg: 'webDAV Dynamic: Error Writing to Database',
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

        if ((config.variables.length !== 1) || (!_.isEqual(config.variables[0], deliverEntireResultVariable))) {
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

webdavTxtDynamic.stop = function(done) {

  updateConnectionStatus(false);
  running = false;
  readingFile = false;
  if (readTimer) {
    clearInterval(readTimer);
    readTimer = null;
  }

  clearAlertsAndStop(done);
};

webdavTxtDynamic.require = function() {
    return ['spark-logging',
        'spark-db',
        'spark-alert',
        'spark-config'
    ];
};

module.exports = webdavTxtDynamic;
