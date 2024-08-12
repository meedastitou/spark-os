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
let running = false;
let lastRowTimestamp = 0;
let readingFile = false;
let parsingFile = false;

var firstStart = true;
var alert = null;

var lastFileReadTimestamp = 0;
const maxNumberOfFilesToReport = 10;
const maxNumberOfRowsToReport = 500;
let timestampFieldIndex1 = 0; // assume first field is the timestamp
let timestampFieldIndex2 = -1;  // use -1 to indicate that there is NO second timestamp field
let checkAllFilesFlag = false;

let fileContentsString = '';
let continueProcessingCurrentFileFlag = false;
let continueProcessingFilename = '';
let continueProcessingFileTimestamp = 0;

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

var webdavCsvDynamic = new EventEmitter();

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

function dbAddResult(err, res) {
    if (err) {
        alert.raise({ key: 'db-add-error', errorMsg: err.message });
    } else {
        alert.clear('db-add-error');
    }
    if (res) log.debug(res);
}

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

function updateConnectionStatus(connected) {
  conf.set('machines:' + pkg.name + ':settings:model:connectionStatus', connected, () => {});
}

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

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
                webdavCsvDynamic.emit('restartRequest', info.name);
            }
        });
    }
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

function parseCSVFileOriginal(readFilename, fileTimestamp) {
  // get the individual rows of the csv file
  const lines = fileContentsString.split(/\r+\n?/);
//  console.log('------ lines = ' + JSON.stringify(lines));

  const keywords = lines[4].split(',');
  //console.log('----keywords = ' + keywords);
  //console.log('------keywords.length = ' + keywords.length);

  var combinedResultArray = [];
  for (var rowNumber = 5; rowNumber < lines.length; rowNumber += 1) {
      var rowData = lines[rowNumber].split(',');
      //console.log('-----reading row: ' + rowNumber);
      //console.log('>>>' + lines[rowNumber] + '<<<');
      //for (var index = 0; index < rowData.length; index += 1) {
      //console.log('rowData[' + index + '] = ' + rowData[index]);
      //}
      //console.log(rowData);
      //console.log('------rowData.length = ' + rowData.length);
      if (rowData.length === keywords.length) {
        var data = {};
        for (var colNumber = 0; colNumber < keywords.length; colNumber += 1) {
          //console.log('----data[' + keywords[colNumber] + '] = ' + rowData[colNumber]);
          data[keywords[colNumber]] = rowData[colNumber];
        }
        // add the filename field to each object, if requested
        if (_.get(config.settings.model, 'includeFilenameInCombinedData', false)) {
          // only add the filename field if we don't already have one
          if (!_.has(data, "filename")) {
            data.filename = readFilename;
          }
        }
        // add the timestamp field to each object
        data.timestamp = fileTimestamp;
        combinedResultArray.push(data);
      } else {
//        console.log('---------------field count does not match: keywords.length = ' + keywords.length + ', rowData.length = ' + rowData.length);
      }
  }

  //console.log('----CombinedResult = ' + JSON.stringify(combinedResultArray));

  if (combinedResultArray.length) {
    console.log('---------------updating database, fileTimestamp = ' + fileTimestamp);
    var combinedResultsData = {
      machine: config.info.name,
      variable: "CombinedResult",
      CombinedResult: combinedResultArray
    };

    db.add(combinedResultsData, dbAddResult);
  }

}

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

function isNumeric(str) {
  // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
  if (isNaN(str)) {
    return false;
  }
  // ...and ensure strings of whitespace fail
  if (isNaN(parseFloat(str))) {
    return false;
  }
  return true;
}

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

function parseCSVFileVersion2(readFilename, fileTimestamp) {
  if (parsingFile) {
//    console.log('------already parsing file');
    return;
  }
  parsingFile = true;

  // get the individual rows of the csv file
  const lines = fileContentsString.split(/\r+\n?/);
  //console.log('------ lines = ' + JSON.stringify(lines));

  let latestTimestamp = 0;
  let latestTimestampRowIndex = 0;
  let latestTimestampRowFields;

  // first, get the keywords
  let keywords = [];
  if (_.get(config.settings.model, 'useHeaderRowForKeywords', false)) {
    if (_.get(config.settings.model, 'useTabsForDelimiters', false)) {
      keywords = lines[0].replace(/\0/g, '').split('\t');
    } else {
      keywords = lines[0].replace(/\0/g, '').split(',');
    }
  } else {
    keywords = _.get(config.settings.model, 'keywordList', '').split(',');
  }
  //console.log('----keywords = ' + keywords);
  //console.log('------keywords.length = ' + keywords.length);
  if (keywords.length === 0) {
//    console.log('-----No keywords.');
    parsingFile = false;
    return;
  }

  let minimumNumberOfFields = 2;  // one for datetime, one for data
  if (timestampFieldIndex2 >= 0) {
    minimumBumberOfFields = 3;  // plus one for date, time in seperate fields
  }

  let newRows = [];
  let fields = [];
  let timestampConversionError = true;
  if (lastRowTimestamp === 0) {
//    console.log('------first read - return single data point');
    // first read - just find the latest entry
    let startIndex = 0;
    if (_.get(config.settings.model, 'useHeaderRowForKeywords', false)) {
      startIndex = 1;
    }
    for (let index = startIndex; index < lines.length; index += 1) {
      if (_.get(config.settings.model, 'useTabsForDelimiters', false)) {
        fields = lines[index].replace(/\0/g, '').split('\t');
      } else {
        fields = lines[index].replace(/\0/g, '').split(',');
      }
      if (fields.length >= minimumNumberOfFields) {
        let timestamp = 0;
        if ((timestampFieldIndex1 < fields.length) && (timestampFieldIndex2 < fields.length)) {
          if (timestampFieldIndex2 >= 0) {
            timestamp = Date.parse(fields[timestampFieldIndex1] + ' ' + fields[timestampFieldIndex2]);
          } else {
            timestamp = Date.parse(fields[timestampFieldIndex1]);
          }
        }
        if ((isNaN(timestamp)) || (timestamp === 0)) {
          continue;
        } else {
          timestampConversionError = false;
        }

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
//    console.log('------latestTimestampRowIndex = ' + latestTimestampRowIndex);
//    console.log('------latestTimestampRowFields = ' + JSON.stringify(latestTimestampRowFields));
  } else {

//    console.log('------NOT first read - return all new data points');
//    const lastRowTimestampValue = new Date(lastRowTimestamp);
//    console.log('------lastRowTimestampValue = ' + lastRowTimestampValue.toISOString());

    let startIndex = 0;
    if (_.get(config.settings.model, 'useHeaderRowForKeywords', false)) {
      startIndex = 1;
    }
    for (let index = startIndex; index < lines.length; index += 1) {
      if (_.get(config.settings.model, 'useTabsForDelimiters', false)) {
        fields = lines[index].replace(/\0/g, '').split('\t');
      } else {
        fields = lines[index].replace(/\0/g, '').split(',');
      }
      if (fields.length >= minimumNumberOfFields) {
        let timestamp = 0;
        if ((timestampFieldIndex1 < fields.length) && (timestampFieldIndex2 < fields.length)) {
          if (timestampFieldIndex2 >= 0) {
            timestamp = Date.parse(fields[timestampFieldIndex1] + ' ' + fields[timestampFieldIndex2]);
          } else {
            timestamp = Date.parse(fields[timestampFieldIndex1]);
          }
        }
        if ((isNaN(timestamp)) || (timestamp === 0)) {
          continue;
        } else {
          timestampConversionError = false;
        }

        if (timestamp > lastRowTimestamp) {
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
    console.log('>>>>>>>> newRows.length = ' + newRows.length);
    if ((timestampFieldIndex1 < newRows[0].length) && (timestampFieldIndex2 < newRows[0].length)) {
      if (timestampFieldIndex2 >= 0) {
//    console.log('>>>> PRESORT');
//    for (var i = 0; i < newRows.length; i += 1) {
//      console.log('>>> newRow[' + i + '] = ' + JSON.stringify(newRows[i]));
//    }
    // first, sort the fields that we've tagged as newer than our last read
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
        lastRowTimestamp = Date.parse(newRows[0][timestampFieldIndex1] + ' ' + newRows[0][timestampFieldIndex2]);

      } else {
        //    console.log('>>>> PRESORT');
        //    for (var i = 0; i < newRows.length; i += 1) {
        //      console.log('>>> newRow[' + i + '] = ' + JSON.stringify(newRows[i]));
        //    }
            // first, sort the fields that we've tagged as newer than our last read
        newRows.sort(function(a, b) {
          return ((Date.parse(a[timestampFieldIndex1]) > Date.parse(b[timestampFieldIndex1])) ? -1 :
                    ((Date.parse(a[timestampFieldIndex1]) == Date.parse(b[timestampFieldIndex1])) ? 0 : 1));
        });
        //    console.log('>>>> POSTSORT');
        //    for (var i = 0; i < newRows.length; i += 1) {
        //      console.log('>>> newRow[' + i + '] = ' + JSON.stringify(newRows[i]));
        //    }
        lastRowTimestamp = Date.parse(newRows[0][timestampFieldIndex1]);
      }
    }

//    console.log('>>>>> latest BatchStartTime timestamp line = ' + (latestTimestampRowIndex + 1));
//    console.log('>>>>> line #' + (latestTimestampRowIndex + 1) + ': ' + lines[latestTimestampRowIndex]);

    // we will work backwards through the newRows data, so as to deliver oldest data first
    var rowIndex = newRows.length - 1;  // assume maximum number of rows to report
    // var rowIndex = maxNumberOfRowsToReport - 1;  // assume maximum number of rows to report
    // if (rowIndex >= newRows.length) {
    //   rowIndex = newRows.length - 1; // but limit ourselves to the actual number that we have
    // }
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
            let reportString = rowData[colNumber];
            if (_.get(config.settings.model, 'trimNumericDataLeadingZeros', false)) {
              reportString = reportString.trim();
              if (isNumeric(reportString)) {
                reportString = reportString.replace(/^0+(?=\d)/, '');
              }
            }
            data[keywords[colNumber]] = reportString;
          }
        }
      }
      // add the filename field to each object, if requested
      if (_.get(config.settings.model, 'includeFilenameInCombinedData', false)) {
        // only add the filename field if we don't already have one
        if (!_.has(data, "filename")) {
          data.filename = readFilename;
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

      combinedResultArray.push(data);

      reportCount = reportCount + 1;
//      console.log('----Report #' + reportCount + ': CombinedResult = ' + JSON.stringify(combinedResultArray));

      if (combinedResultArray.length) {
//        console.log('---------------updating database');
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
      continueProcessingFilename = readFilename;
      continueProcessingFileTimestamp = fileTimestamp;
      if ((timestampFieldIndex1 < newRows[rowIndex + 1].length) && (timestampFieldIndex2 < newRows[rowIndex + 1].length)) {
        if (timestampFieldIndex2 >= 0) {
          lastRowTimestamp = Date.parse(newRows[rowIndex + 1][timestampFieldIndex1] + ' ' + newRows[rowIndex + 1][timestampFieldIndex2]);
        } else {
          lastRowTimestamp = Date.parse(newRows[rowIndex + 1][timestampFieldIndex1]);
        }
      }
    } else {
      continueProcessingCurrentFileFlag = false;
    }
  } else {
    console.log('No entries found with a later row timestamp');
  }
  parsingFile = false;
}

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

function parseCSVFileCN612DND(readFilename, fileTimestamp) {
  if (parsingFile) {
//    console.log('------already parsing file');
    return;
  }
  parsingFile = true;

  // get the individual rows of the csv file
  const lines = fileContentsString.split(/\r+\n?/);
  //console.log('------ lines = ' + JSON.stringify(lines));

  let latestTimestamp = 0;
  let latestTimestampRowIndex = 0;
  let latestTimestampRowFields;

  let newRows = [];
  let fields = [];
  let timestampConversionError = true;
  if (lastRowTimestamp === 0) {
//    console.log('------first read - return single data point');
    // first read - just find the latest entry
    for (let index = 0; index < lines.length; index += 1) {
      if (_.get(config.settings.model, 'useTabsForDelimiters', false)) {
        fields = lines[index].replace(/\0/g, '').split('\t');
      } else {
        fields = lines[index].replace(/\0/g, '').split(',');
      }
      let timestamp = 0;
      if ((timestampFieldIndex1 < fields.length) && (timestampFieldIndex2 < fields.length)) {
        if (timestampFieldIndex2 >= 0) {
          timestamp = Date.parse(fields[timestampFieldIndex1] + ' ' + fields[timestampFieldIndex2]);
        } else {
          timestamp = Date.parse(fields[timestampFieldIndex1]);
        }
      }
      if ((isNaN(timestamp)) || (timestamp === 0)) {
        continue;
      } else {
        timestampConversionError = false;
      }

      if (timestamp > latestTimestamp) {
        latestTimestampRowFields = fields;
        latestTimestamp = timestamp;
        latestTimestampRowIndex = index;
      }
    }
    newRows.push(latestTimestampRowFields);
//    console.log('------latestTimestampRowIndex = ' + latestTimestampRowIndex);
//    console.log('------latestTimestampRowFields = ' + JSON.stringify(latestTimestampRowFields));
  } else {

//    console.log('------NOT first read - return all new data points');
//    const lastRowTimestampValue = new Date(lastRowTimestamp);
//    console.log('------lastRowTimestampValue = ' + lastRowTimestampValue.toISOString());

    for (let index = 0; index < lines.length; index += 1) {
      if (_.get(config.settings.model, 'useTabsForDelimiters', false)) {
        fields = lines[index].replace(/\0/g, '').split('\t');
      } else {
        fields = lines[index].replace(/\0/g, '').split(',');
      }
      let timestamp = 0;
      if ((timestampFieldIndex1 < fields.length) && (timestampFieldIndex2 < fields.length)) {
        if (timestampFieldIndex2 >= 0) {
          timestamp = Date.parse(fields[timestampFieldIndex1] + ' ' + fields[timestampFieldIndex2]);
        } else {
          timestamp = Date.parse(fields[timestampFieldIndex1]);
        }
      }
      if ((isNaN(timestamp)) || (timestamp === 0)) {
        continue;
      } else {
        timestampConversionError = false;
      }

      if (timestamp > lastRowTimestamp) {
        newRows.push(fields);
      }
      if (timestamp > latestTimestamp) {
        latestTimestampRowFields = fields;
        latestTimestamp = timestamp;
        latestTimestampRowIndex = index;
      }
    }
  }

  if (timestampConversionError) {
    alert.raise({ key: 'datetime-error' });
  } else {
    alert.clear('datetime-error');
  }

  if (newRows.length > 0) {
    console.log('>>>>>>>> newRows.length = ' + newRows.length);
    if ((timestampFieldIndex1 < newRows[0].length) && (timestampFieldIndex2 < newRows[0].length)) {
      if (timestampFieldIndex2 >= 0) {
//    console.log('>>>> PRESORT');
//    for (var i = 0; i < newRows.length; i += 1) {
//      console.log('>>> newRow[' + i + '] = ' + JSON.stringify(newRows[i]));
//    }
    // first, sort the fields that we've tagged as newer than our last read
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
        lastRowTimestamp = Date.parse(newRows[0][timestampFieldIndex1] + ' ' + newRows[0][timestampFieldIndex2]);

      } else {
        //    console.log('>>>> PRESORT');
        //    for (var i = 0; i < newRows.length; i += 1) {
        //      console.log('>>> newRow[' + i + '] = ' + JSON.stringify(newRows[i]));
        //    }
            // first, sort the fields that we've tagged as newer than our last read
        newRows.sort(function(a, b) {
          return ((Date.parse(a[timestampFieldIndex1]) > Date.parse(b[timestampFieldIndex1])) ? -1 :
                    ((Date.parse(a[timestampFieldIndex1]) == Date.parse(b[timestampFieldIndex1])) ? 0 : 1));
        });
        //    console.log('>>>> POSTSORT');
        //    for (var i = 0; i < newRows.length; i += 1) {
        //      console.log('>>> newRow[' + i + '] = ' + JSON.stringify(newRows[i]));
        //    }
        lastRowTimestamp = Date.parse(newRows[0][timestampFieldIndex1]);
      }
    }

//    console.log('>>>>> latest BatchStartTime timestamp line = ' + (latestTimestampRowIndex + 1));
//    console.log('>>>>> line #' + (latestTimestampRowIndex + 1) + ': ' + lines[latestTimestampRowIndex]);

    // we will work backwards through the newRows data, so as to deliver oldest data first
    var rowIndex = newRows.length - 1;  // assume maximum number of rows to report
    // var rowIndex = maxNumberOfRowsToReport - 1;  // assume maximum number of rows to report
    // if (rowIndex >= newRows.length) {
    //   rowIndex = newRows.length - 1; // but limit ourselves to the actual number that we have
    // }
    var reportCount = 0;

    while ((rowIndex >= 0) && (reportCount < maxNumberOfRowsToReport)) {
      var combinedResultArray = [];
      var data = {};

      const rowData = newRows[rowIndex];
      let startIndex = _.get(config.settings.model, 'startFieldForKeyValuePairs', 2) - 1;
      for (var colNumber = startIndex; colNumber < (rowData.length - 1); colNumber += 2) {
        // skip any date/time field that we used for sorting - that will be added as a new,
        // defined timestamp field.
        if ((colNumber !== timestampFieldIndex1) && (colNumber !== timestampFieldIndex2)) {
          let keyString = rowData[colNumber];
          let valueString = rowData[colNumber + 1];
          if (_.get(config.settings.model, 'trimNumericDataLeadingZeros', false)) {
            valueString = valueString.trim();
            if (isNumeric(valueString)) {
              valueString = valueString.replace(/^0+(?=\d)/, '');
            }
          }
          data[keyString] = valueString;
        }
      }
      // add the filename field to each object, if requested
      if (_.get(config.settings.model, 'includeFilenameInCombinedData', false)) {
        // only add the filename field if we don't already have one
        if (!_.has(data, "filename")) {
          data.filename = readFilename;
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

      combinedResultArray.push(data);

      reportCount = reportCount + 1;
//      console.log('----Report #' + reportCount + ': CombinedResult = ' + JSON.stringify(combinedResultArray));

      if (combinedResultArray.length) {
//        console.log('---------------updating database');
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
      continueProcessingFilename = readFilename;
      continueProcessingFileTimestamp = fileTimestamp;
      if ((timestampFieldIndex1 < newRows[rowIndex + 1].length) && (timestampFieldIndex2 < newRows[rowIndex + 1].length)) {
        if (timestampFieldIndex2 >= 0) {
          lastRowTimestamp = Date.parse(newRows[rowIndex + 1][timestampFieldIndex1] + ' ' + newRows[rowIndex + 1][timestampFieldIndex2]);
        } else {
          lastRowTimestamp = Date.parse(newRows[rowIndex + 1][timestampFieldIndex1]);
        }
      }
    } else {
      continueProcessingCurrentFileFlag = false;
    }
  } else {
    console.log('No entries found with a later row timestamp');
  }
  parsingFile = false;
}

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

function parseCSVFile(readFilename, fileTimestamp) {

  let parseMode = _.get(config.settings.model, 'mode', 'original');
  if (parseMode === 'version2') {
    parseCSVFileVersion2(readFilename, fileTimestamp);
  } else if (parseMode === 'CN612-DND') {
    parseCSVFileCN612DND(readFilename, fileTimestamp);
  } else {
    parseCSVFileOriginal(readFilename, fileTimestamp);
  }
}

//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------

function readFile(readFilename, fileTimestamp, callback) {

  console.log('----------------reading file: ' + readFilename + ',  timestamp = ' + fileTimestamp);

  webdavClient
    .getFileContents(`/${readFilename}`, { format: 'text' })
    .then((text) => {
//console.log('----------------start text');
//console.log(text);
//console.log('----------------end text');
      fileContentsString = text;
      parseCSVFile(readFilename, fileTimestamp);
      updateConnectionStatus(true);
      alert.clear('file-not-found-error');
      if (callback) {
        callback();
      }
    })
    .catch((err) => {
      // raise an alert for file not found only if not deleting files after read
      console.log('err = ' + err);
      updateConnectionStatus(false);
      alert.raise({ key: 'file-not-found-error', filename: readFilename });
      if (callback) {
        callback();
      }
    });
}

function readTimerFunc() {
  // prevent interrupting long read with another read
  if (readingFile) {
//    console.log('-------- already reading file!');
    if (continueProcessingCurrentFileFlag) {
//      console.log('-------- continue parsing current file!');
      parseCSVFile(continueProcessingFilename, continueProcessingFileTimestamp);
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

    webdavClient
      .getDirectoryContents('/')
      .then((contents) => {
        alert.clear('directory-read-error');
        // search the directory for all files with this base name and find the newest
        async.forEach(contents, (item, cbSearch) => {
          if ((item.type === 'file') &&
              ((checkAllFilesFlag) ||
               (item.basename.startsWith(baseFilename)))) {
            const fileDate = new Date(item.lastmod);
            let blacklistRegexString = '';
            if (_.get(config.settings.model, 'useBlacklistRegex', false)) {
              blacklistRegexString = _.get(config.settings.model, 'blacklistRegex', '');
            }
            if (blacklistRegexString === '') {
              // no regex, allowed to analyze this file
              matchingFiles.push({'name': item.basename, 'timestamp': fileDate});
            } else {
              var blacklistRegex = new RegExp(blacklistRegexString);
              if (!blacklistRegex.test(item.basename)) {
                matchingFiles.push({'name': item.basename, 'timestamp': fileDate});
              } else {
                console.log('----blacklist match: ' + item.basename + ', file ignored');
              }
            }
          }
          cbSearch();
        },
        () => {
          // check if we found ANY matching filenames
          if (matchingFiles.length > 0) {
            // first, sort the matching files
            matchingFiles.sort(function(a, b) {
              return ((a.timestamp > b.timestamp) ? -1 : ((a.timestamp == b.timestamp) ? 0 : 1));
            });
            // matchingFiles should now hold the newest file info in array element 0.

//console.log('matchingFiles:' + JSON.stringify(matchingFiles));

            // we will work backwards through the matchingFiles, so as to deliver oldest data first
            var fileIndex = numberOfFilesToReport - 1;  // assume maximum number of files to report
//console.log('------------------------- matchingFiles.length: ' + matchingFiles.length);
            if (fileIndex >= matchingFiles.length) {
              fileIndex = matchingFiles.length - 1; // but limit ourselves to the actual number that we have
            }
            async.whilst(
              function () {
                return fileIndex >= 0;
              },
              function (callback) {
                var currentFileIndex = fileIndex;
                fileIndex--;
//console.log('------------------------- checking: ' + JSON.stringify(matchingFiles[currentFileIndex]));
//console.log('------------------------- lastFileReadTimestamp: ' + lastFileReadTimestamp);

                if (matchingFiles[currentFileIndex].timestamp > lastFileReadTimestamp) {
                  // only read the file if it's newer than our last report
                  readFile(matchingFiles[currentFileIndex].name, matchingFiles[currentFileIndex].timestamp, callback);
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
        });
      })
      .catch(() => {
        if (running) {
          alert.raise({ key: 'directory-read-error' });
        }
        readingFile = false;
      });
    } else {
      // use specific filename
      const filename = _.get(config.settings.model, 'filename', '');
      webdavClient
        .stat(filename)
        .then((itemStats) => {
          alert.clear('file-not-found-error');
          const fileDate = new Date(itemStats.lastmod);
          if (fileDate > lastFileReadTimestamp) {
            readFile(filename, fileDate, function () {
              if (continueProcessingCurrentFileFlag) {
                lastFileReadTimestamp = matchingFiles[currentFileIndex].timestamp;
                fileIndex = -1; //force the loop to end, since we are going to continue with this file next interval
              } else {
                lastFileReadTimestamp = fileDate;
                readingFile = false;
              }
            });
          } else {
            console.log('file ' + filename + ' not changed.  lastmod: ' + itemStats.lastmod);
            readingFile = false;
          }
        })
        .catch(() => {
          if (running) {
            alert.raise({ key: 'file-not-found-error' });
          }
          readingFile = false;
        });
    }
}

function open(callback) {
  ({ username } = config.settings.model);
  ({ password } = config.settings.model);
  readFrequencyMs = config.settings.model.readFrequency * 1000;

  checkAllFilesFlag = _.get(config.settings.model, 'checkAllFiles', false);

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

  let serverUrl = config.settings.model.webdavUrl;
  if (!serverUrl.startsWith('http')) serverUrl = `http://${serverUrl}`;

  webdavClient = webdav(serverUrl, username, password);

  lastFileReadTimestamp = 0;
  lastRowTimestamp = 0;

  // schedule subsequent reads
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

webdavCsvDynamic.start = function(modules, done) {

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
        msg: 'webDAV Dynamic: File With Base Filename Not Found',
        description: x => `No file with the base filename ${x.filename} could be found on the WebDAV server`,
      },
      'db-add-error': {
        msg: 'webDAV Dynamic: Error Writing to Database',
        description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`,
      },
      'datetime-error': {
        msg: 'webDAV Dynamic: Error with date/time field',
        description: 'The specified field in the file could not be converted to a proper date/time value',
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

webdavCsvDynamic.stop = function(done) {

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

webdavCsvDynamic.require = function() {
    return ['spark-logging',
        'spark-db',
        'spark-alert',
        'spark-config'
    ];
};

module.exports = webdavCsvDynamic;
