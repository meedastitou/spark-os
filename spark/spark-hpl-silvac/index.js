/*jshint esversion: 6 */
var async = require('async');
var _ = require('lodash');
let Client = require('ssh2-sftp-client');
var fs = require('fs');
var xl = require('excel4node');

const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplSilvac = function hplSilvac(log, machine, model, conf, db, alert) {

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
  let running = false;

  let directoryReadTimeoutTimer = null;
  const directoryReadTimeoutMs = 300000;   // wait 5 minute for directory list response
  let fileReadTimeoutTimer = null;
  const fileReadTimeoutMs = 300000;   // wait 2 minutes for directory list response
  let fileWriteTimeoutTimer = null;
  const fileWriteTimeoutMs = 300000;   // wait 2 minutes for directory list response
  let reconnectTimer = null;
  const SFTP_RECONNECT_TIME_MS = 60000;   // wait 1 minutes for reconnect attempt

  let yearArray = [];
  let silvacFolderString = '';

  let serverUrl = '';
  let serverPort = 0;
  let serverInboundFolder = '';
  let serverOutboundFolder = '';
  let serverDuplicateOutboundFolder = '';

  // var lastFileReadTimestamp = 0;
  var latestSilvacFolder = '';
  var latestSilvacFilename = '';
  var newSilvacFilenames = [];

  let folderList = [];
  let filesToBeProcessedList = [];
  let machineName = '';

  const MAX_NUMBER_OF_FILES_TO_PROCESS_PER_READ_CYCLE = 10;

  // Alert Object
  alert.preLoad({
    'connection-error': {
      msg: `${machine.info.name}: Connection Error`,
      description: 'Not able to open connection. Please verify the configuration',
    },
    'directory-read-error': {
      msg: `${machine.info.name}: Directory Read Error`,
      description: 'Error reading the input directory',
    },
    'read-error': {
      msg: `${machine.info.name}: File Read Error`,
      description: 'Error reading the input file',
    },
    'write-error': {
      msg: `${machine.info.name}: File Write Error`,
      description: 'Error writing the output file',
    },
  });

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  //    debug function for dumping the contents of a a buffer in easy-to-read format, 16 bytes/line
  function dumpBuffer(buffer) {
    let str = '';
    for (let i = 0; i < buffer.length; i += 1) {
      if (buffer[i] < 16) {
        str += `0${buffer[i].toString(16)} `;
      } else {
        str += `${buffer[i].toString(16)} `;
      }
      if ((((i + 1) % 16) === 0) || ((i + 1) === buffer.length)) {
        console.log(str);
        str = '';
      }
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

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

  function sftpConnectTimeout() {
    // if this timer triggers, we have experienced a connect error and waited for the
    // reconnect time.  So close the sftp socket and re-open.

    console.log('!!!!! ' + machineName + ': reconnect time expired - attempting reconnect');

    reconnectTimer = null;

    sftpClient.end();
    sftpClientConnectedFlag = false;

    open((err) => {
      if (err) {
        log.info('error in restarting connections after connect error and reconnect timeout.  err = ' + err);
      } else {
        log.info('Restarted connections after connect error and reconnect timeout');
        console.log('!!!!! ' + machineName + '!!!!!!!! reconnect successful after connect error and reconnect timeout !!!!!!!');
      }
    });

  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function directoryReadTimeout() {
    // if this timer triggers, we have not received a response for our sftp.list
    // directory read.  So close the sftp socket and re-open.

    console.log('!!!!! ' + machineName + ': directoryReadTimeout');

    alert.raise({ key: 'directory-read-error' });
    directoryReadTimeoutTimer = null;

    sftpClient.end();
    sftpClientConnectedFlag = false;

    open((err) => {
      if (err) {
        log.info('!!!!! ' + machineName + ': error in restarting connections after directory list timeout.  err = ' + err);
      } else {
        log.info('!!!!! ' + machineName + ': Restarted connections after directory list timeout');
        console.log('!!!!! ' + machineName + '!!!!!!!! detected and fixed directory read timeout !!!!!!!');
      }
    });

  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function fileReadTimeout() {
    // if this timer triggers, we have not received a response for our sftp.get
    // file read.  So close the sftp socket and re-open.

    console.log('!!!!! ' + machineName + ': fileReadTimeout');

    alert.raise({ key: 'file-read-error' });
    fileReadTimeoutTimer = null;

    sftpClient.end();
    sftpClientConnectedFlag = false;

    open((err) => {
      if (err) {
        log.info('error in restarting connections after file read timeout.  err = ' + err);
      } else {
        log.info('Restarted connections after file read timeout');
        console.log('!!!!! ' + machineName + '!!!!!!!! detected and fixed file read timeout !!!!!!!');
      }
    });

  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function fileWriteTimeout() {
    // if this timer triggers, we have not received a response for our sftp.put
    // file write.  So close the sftp socket and re-open.

    alert.raise({ key: 'file-write-error' });
    console.log('!!!!! ' + machineName + ': fileWriteTimeout');

    fileWriteTimeoutTimer = null;

    sftpClient.end();
    sftpClientConnectedFlag = false;

    open((err) => {
      if (err) {
        log.info('error in restarting connections after file write timeout.  err = ' + err);
      } else {
        log.info('Restarted connections after file write timeout');
        console.log('!!!!! ' + machineName + '!!!!!!!! detected and fixed file write timeout !!!!!!!');
      }
    });

  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function createFilesToBeProcessedList(callback) {
    filesToBeProcessedList = [];

    for (let inboundFileIndex = 0; inboundFileIndex < folderList[0].length; inboundFileIndex += 1) {
      if (folderList[0][inboundFileIndex].type === '-') {
        if (folderList[0][inboundFileIndex].name.endsWith('.csv')) {
          let inboundFilename = folderList[0][inboundFileIndex].name;
          let outboundFilename = 'SILVAC_' + inboundFilename.replace('.csv', '.xlsx');
          let foundIt = false;
          let outboundFileIndex = 0;
          while ((!foundIt) && (outboundFileIndex < folderList[1].length)) {
            if (folderList[1][outboundFileIndex].type === '-') {
              if (folderList[1][outboundFileIndex].name === outboundFilename) {
                foundIt = true;
              }
            }
            if (!foundIt) {
              outboundFileIndex += 1;
            }
          }
          if (!foundIt) {
            filesToBeProcessedList.push(folderList[0][inboundFileIndex]);
          } else {
            // alternatively, if we DID find a match, but the inbound file is
            // newer than the outbound file, process it again
            if (folderList[0][inboundFileIndex].modifyTime >= folderList[1][outboundFileIndex].modifyTime) {
              filesToBeProcessedList.push(folderList[0][inboundFileIndex]);
            }
          }
        }
      }
    }
    // console.log('----- ' + machineName + ': filesToBeProcessedList.length: ' + filesToBeProcessedList.length);
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  const readDirectory = function(folder, index, callback) {
    console.log('----- ' + machineName + ': reading folder: ' + folder);
    sftpClient.list(folder).then((directoryList) => {
      console.log('----- ' + machineName + ': folder: ' + folder + ': directoryList.length: ' + directoryList.length);
      folderList[index] = directoryList;
      callback(null);
    }).catch((err) => {
      console.log('!!!!! ' + machineName + ': error in read of folder:' + folder + ': err = ' + err);
      callback(err);
    });
  };

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function findUnprocessedSilvacFile(callback) {

    const directoryList = [serverInboundFolder, serverOutboundFolder];

    console.log('----- ' + machineName + ': findUnprocessedSilvacFile');
    folderList = [];  // clear our list prior to reading new

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }
    directoryReadTimeoutTimer = setTimeout(directoryReadTimeout, directoryReadTimeoutMs);

    async.eachOf(directoryList, readDirectory, function(err) {
      if (err) {
        console.log('!!!!! ' + machineName + 'findUnprocessedSilvacFile err: ' +  err);
        readTimer = setTimeout(readTimerFunc, readFrequencyMs);
        alert.raise({ key: 'directory-read-error' });
        callback(err);
        return;
      } else {
        alert.clear('directory-read-error');
        // console.log('----- ' + machineName + ': All files have been read successfully');
        // console.log('----- ' + machineName + ': folderList.length = ' + folderList.length);
        // for (let folderIndex = 0; folderIndex < folderList.length; folderIndex += 1) {
        //   console.log('----- ' + machineName + ': folderList[' + folderIndex + '].length = ' + folderList[folderIndex].length);
        // }
        if (directoryReadTimeoutTimer) {
          // console.log('----- ' + machineName + ': findUnprocessedSilvacFile - clearing directoryReadTimeout-1');
          clearTimeout(directoryReadTimeoutTimer);
          directoryReadTimeoutTimer = null;
        } else {
          console.log('!!!!! ' + machineName + ': findUnprocessedSilvacFile - timeout on directory reads');
          callback(new Error('timeout on directory read'));
          return;
        }
        if (folderList.length === 2) {
          createFilesToBeProcessedList();
          callback(null);
        } else {
          readTimer = setTimeout(readTimerFunc, readFrequencyMs);
          alert.raise({ key: 'directory-read-error' });
          callback(new Error('directory-read-error'));
        }
      }
    });

  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function isNumeric(str) {
    if ((str.startsWith('+')) && (str.length > 1)) {
      str = str.substring(1);
    } else if ((str.startsWith('-')) && (str.length > 1)) {
      str = str.substring(1);
    }

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

  function readAndProcessInboundFile(filename, callback) {

    let completeInboundFilepath = serverInboundFolder + filename;
    // console.log('----- ' + machineName + ': reading file: ' + completeInboundFilepath);

    if (fileReadTimeoutTimer) {
      clearTimeout(fileReadTimeoutTimer);
      fileReadTimeoutTimer = null;
    }
    fileReadTimeoutTimer = setTimeout(fileReadTimeout, fileReadTimeoutMs);

    sftpClient.get(completeInboundFilepath).then((inputFileData) => {
      console.log('<<<<<<< ' + machineName + ': finished reading file: ' + completeInboundFilepath);
      if (fileReadTimeoutTimer) {
        alert.clear('file-read-error');
        clearTimeout(fileReadTimeoutTimer);
        fileReadTimeoutTimer = null;
      } else {
        callback(new Error('timeout reading file: ' + filename));
        console.log('!!!!! ' + machineName + ': timeout reading file: ' + filename);
        return;
      }

      var inputFileString = inputFileData.toString();
      // first, strip out any /r's
      inputFileString = inputFileString.replace(/\r/g, '');
      var inputFileRows = inputFileString.split("\n");

      // console.log('inputFileRows = ' + JSON.stringify(inputFileRows));

      var outputFileString = '';

      // Create a new instance of a Workbook class
      var wb = new xl.Workbook();

      var sheetName = filename.slice(0, 30);
      // Add Worksheets to the workbook
      var ws = wb.addWorksheet(sheetName);

      // next, take care of the first line, which is different than the rest
      var lineFields = inputFileRows[0].split(";");
      for (let fieldIndex = 0; fieldIndex < lineFields.length; fieldIndex += 1) {
        if (fieldIndex > 0) {
          outputFileString += ',';
        }
        var sanitizedString = lineFields[fieldIndex].replace(/(\d),(?=\d)/g, '$1.');
        outputFileString += sanitizedString;
        if (isNumeric(sanitizedString)) {
          ws.cell(1, (fieldIndex + 1))
             .number(Number(sanitizedString));
        } else {
          ws.cell(1, (fieldIndex + 1))
             .string(sanitizedString);
        }
      }
      outputFileString += '\n';

      // console.log('outputFileString (first line) = ' + outputFileString);

      var rowIndex;
      var colIndex;
      var maxNumberOfColumns = 0;
      for (rowIndex = 1; rowIndex < inputFileRows.length; rowIndex += 1) {
        lineFields = inputFileRows[rowIndex].split(";");
        if (lineFields.length > maxNumberOfColumns) {
          maxNumberOfColumns = lineFields.length;
        }
      }

      // console.log('maxNumberOfColumns = ' + maxNumberOfColumns);

      // next, find the row with the most number of columns
      for (colIndex = 0; colIndex < maxNumberOfColumns; colIndex += 1) {
        var newRowString = '';
        for (rowIndex = 1; rowIndex < inputFileRows.length; rowIndex += 1) {
          if (inputFileRows[rowIndex] !== '') {
            lineFields = inputFileRows[rowIndex].split(";");

            if (newRowString !== '') {
              newRowString += ',';
            }
            if ((colIndex < lineFields.length) && (lineFields[colIndex] !== '')) {
              var sanitizedString = lineFields[colIndex].replace(/(\d),(?=\d)/g, '$1.');
              newRowString += sanitizedString;

              if (isNumeric(sanitizedString)) {
                ws.cell((colIndex + 2), rowIndex)
                   .number(Number(sanitizedString));
              } else {
                ws.cell((colIndex + 2), rowIndex)
                   .string(sanitizedString);
              }
            }
          }
        }
        if (newRowString !== '') {
          outputFileString += newRowString + '\n';
        }
      }

      // console.log('outputFileString = ' + outputFileString);

      // var outputFileBuffer = Buffer.from(outputFileString, 'utf8');
      // console.log('outputFileBuffer.length: ' + outputFileBuffer.length);
      // console.log('outputFileBuffer:');
      // dumpBuffer(outputFileBuffer);

      // add SILVAC_ to the beginning of the file for our output filename, and change it's extension to .xlsx
      let outputFilename = 'SILVAC_' + filename.replace('.csv', '.xlsx');;

      let completeOutboundFilepath = serverOutboundFolder + outputFilename;

      if (fileWriteTimeoutTimer) {
        clearTimeout(fileWriteTimeoutTimer);
        fileWriteTimeoutTimer = null;
      }
      fileWriteTimeoutTimer = setTimeout(fileWriteTimeout, fileWriteTimeoutMs);

      // the following writes out the csv output, but with an .xlsx extension.  Excel will reject this as an invalid xlsx format
      // sftpClient.put(outputFileBuffer, completeOutboundFilepath);
      // instead, we will write the workbook, as a binary buffer
      wb.writeToBuffer().then(function(buffer) {
        var xlsxOutputFilename = "converted-xlsx-" + process.argv[2];
        xlsxOutputFilename = xlsxOutputFilename.replace('.csv', '.xlsx');

        console.log('>>>>>>> writing completeOutboundFilepath = ' + completeOutboundFilepath);
        sftpClient.put(buffer, completeOutboundFilepath);

        if (serverDuplicateOutboundFolder !== '') {
          let completeDuplicateOutboundFilepath = serverDuplicateOutboundFolder + outputFilename;
          console.log('>>>>>>> writing completeDuplicateOutboundFilepath = ' + completeDuplicateOutboundFilepath);
          sftpClient.put(buffer, completeDuplicateOutboundFilepath);
        }

        if (fileWriteTimeoutTimer) {
          alert.clear('file-write-error');
          clearTimeout(fileWriteTimeoutTimer);
          fileWriteTimeoutTimer = null;
        } else {
          callback(new Error('timeout writing output file'));
          console.log('!!!!! ' + machineName + ': timeout writing file');
          return;
        }

        // console.log('>>>>> ' + machineName + ': file transferred into memory.  Buffer size = ' + data.length);
        // console.log('>>>>> ' + machineName + ': first 100 bytes = ' + data.slice(0,99));

        var combinedResultArray = [];
        combinedResult = {};
        combinedResult.FileName = outputFilename;
        combinedResult.FileData = outputFileString;
        combinedResultArray.push(combinedResult);

        // console.log('--------------- ' + machineName + ': updating database');

        updateAllVariablesWithCombinedResult(combinedResultArray);
        callback(null);

      }).catch((err) => {
        console.log('!!!!! ' + machineName + ': wb.writeToBuffer err = ' + err);
        alert.raise({ key: 'file-write-error' });
        if (fileWriteTimeoutTimer) {
          clearTimeout(fileWriteTimeoutTimer);
          fileWriteTimeoutTimer = null;
        }
        readTimer = setTimeout(readTimerFunc, readFrequencyMs);
        callback(err);
        return;
      });

    }).catch((err) => {
      alert.raise({ key: 'file-read-error' });
      console.log('!!!!! ' + machineName + ': sftpClient.get err = ' + err);
      readTimer = setTimeout(readTimerFunc, readFrequencyMs);
      callback(err);
    });

  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function readTimerFunc() {


    console.log('>>> ' + machineName + ': timer: readTimerFunc');
    var startMilliseconds = Date.now();
    var endMilliseconds;


    findUnprocessedSilvacFile(function(err, returnValues) {
      if (err) {
        console.log('!!!!! ' + machineName + ': findUnprocessedSilvacFile : err = ' + err);
        // do not restart the timer.  If we receive an error do to the monitoring
        // timer expiring, we should disconnect and reconnect.
        // If we have an error that does not require a restart, the
        // findUnprocessedSilvacFile routine will start the next cycle timer.
        return;
      }

      // console.log('----- ' + machineName + ': after list');
      endMilliseconds = Date.now();
      let numberOfUnprocessedFiles = filesToBeProcessedList.length;
      console.log('----- ' + machineName + ': found <<<<< ' + numberOfUnprocessedFiles + ' >>>>> unprocessed silvac files');
      console.log('----- ' + machineName + ': elapsed milliseconds = ' + (endMilliseconds - startMilliseconds));
      if (numberOfUnprocessedFiles > 0) {
        filesToBeProcessedList.sort(function(a, b) {
          return ((a.modifyTime > b.modifyTime) ? -1 :
                    ((a.modifyTime == b.modifyTime) ? 0 : 1));
        });
        // console.log('--- ' + machineName + ': latest newSilvacFilename = ' + JSON.stringify(newSilvacFilenames[0]));
        // lastFileReadTimestamp = newSilvacFilenames[0].modifyTime;
        // console.log('--- ' + machineName + ': new lastFileReadTimestamp: ' + lastFileReadTimestamp);
        let fileIndex = numberOfUnprocessedFiles - 1; // start at the end to deliver newest last
        let processedCount = 0;
        async.whilst(
          function () {
            return ((fileIndex >= 0) && (processedCount < MAX_NUMBER_OF_FILES_TO_PROCESS_PER_READ_CYCLE));
          },
          function (callback) {
            console.log('>>>>>>> ' + machineName + ': reading file #' + (processedCount + 1) + ': ' + serverInboundFolder + filesToBeProcessedList[fileIndex].name);
            readAndProcessInboundFile(filesToBeProcessedList[fileIndex].name, function(err) {
              if (err) {
                callback(err);
              } else {
                fileIndex -= 1;
                processedCount += 1;
                endMilliseconds = Date.now();
                console.log('------- ' + machineName + ': elapsed milliseconds = ' + (endMilliseconds - startMilliseconds));
                callback(null);
              }
            });
          },
          function (err, n) {
            if (err) {
              console.log('!!!!!! ' + machineName + ': getNewSilvacFiles: readAndProcessInboundFile: err = ' + err);
            } else {
              readTimer = setTimeout(readTimerFunc, readFrequencyMs);
            }
            endMilliseconds = Date.now();
            console.log('----- ' + machineName + ': total elapsed milliseconds = ' + (endMilliseconds - startMilliseconds));
            console.log('<<< ' + machineName + ': timer function exit');
          }
        );
      } else {
        console.log('----- ' + machineName + ': no unprocessed silvac csv files found');
        endMilliseconds = Date.now();
        console.log('----- ' + machineName + ': total elapsed milliseconds = ' + (endMilliseconds - startMilliseconds));
        console.log('<<< ' + machineName + ': timer function exit');
        // console.log('--- ' + machineName + ': total elapsed milliseconds = ' + (endMilliseconds - startMilliseconds));
        readTimer = setTimeout(readTimerFunc, readFrequencyMs);
      }
    });
  }

  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------
  //-----------------------------------------------------------------------------

  function open(callback) {
    console.log('--------------- ' + machineName + ': sftp open');

    if (readTimer) {
      clearTimeout(readTimer);
      readTimer = null;
    }

    ({ username } = that.machine.settings.model);
    ({ password } = that.machine.settings.model);
    readFrequencyMs = that.machine.settings.model.readFrequency * 1000;

    serverUrl = that.machine.settings.model.sftpUrl;
    serverPort = that.machine.settings.model.sftpPort;
    serverInboundFolder = that.machine.settings.model.sftpInboundFolder;
    serverOutboundFolder = that.machine.settings.model.sftpOutboundFolder;
    serverDuplicateOutboundFolder = that.machine.settings.model.sftpDuplicateOutboundFolder;

    console.log('--------------- ' + machineName + ': creating sftp client');
    sftpClient = new Client();
    console.log('--------------- ' + machineName + ': sftp client created');

    let connectOptions = {
      host: serverUrl,
      port: serverPort,
      username: username,
      password: password
    };
    console.log('--- ' + machineName + ': connectOptions = ' + JSON.stringify(connectOptions));

    sftpClient.connect(connectOptions).then(() => {
      console.log('----- ' + machineName + ': sftpClient connected');
      // schedule subsequent reads
      alert.clear('connection-error');
      readTimer = setTimeout(readTimerFunc, 100); // schedule first read in 100 msec.
    }).catch((err) => {
      alert.raise({ key: 'connection-error' });
      console.log(err, machineName + ': sftpClient.connect: catch error');

      // try to connect again after a period of time
      reconnectTimer = SetTimeout(sftpConnectTimeout, SFTP_RECONNECT_TIME_MS);
      callback(err);
      return;
    });


    running = true;

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

  this.stop = function(done) {

    updateConnectionStatus(false);
    running = false;

    if (readTimer) {
      clearTimeout(readTimer);
      readTimer = null;
    }

    if (directoryReadTimeoutTimer) {
      clearTimeout(directoryReadTimeoutTimer);
      directoryReadTimeoutTimer = null;
    }

    if (fileReadTimeoutTimer) {
      clearTimeout(fileReadTimeoutTimer);
      fileReadTimeoutTimer = null;
    }

    if (fileWriteTimeoutTimer) {
      clearTimeout(fileWriteTimeoutTimer);
      fileWriteTimeoutTimer = null;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
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
  hpl: hplSilvac,
  defaults,
  schema,
};
