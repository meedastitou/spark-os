/* jshint esversion: 6 */
const { EventEmitter } = require('events');
const _ = require('lodash');

const SESSION_RSP_FILE = 'SESS0000.RSP';
const REPORT_DAT_FILE = 'REPORT0000.DAT';
const ALARM_DAT_FILE = 'GETALARMS0000.DAT';
const SET_VARIABLE_FILE = 'SETVARIABLE0000.JOB';
const variables = {};

const directoryContents = [
  {
    type: 'file',
    basename: SESSION_RSP_FILE,
    filename: `/${SESSION_RSP_FILE}`,
    lastmod: 0,
  },
  {
    type: 'file',
    basename: REPORT_DAT_FILE,
    filename: `/${REPORT_DAT_FILE}`,
    lastmod: 0,
  },
  {
    type: 'file',
    basename: ALARM_DAT_FILE,
    filename: `/${ALARM_DAT_FILE}`,
    lastmod: 0,
  },
];

const ALARM_DATA_TEXT = '1,20171110,17:16:56,147797,1,6169,"Alarm Test 1"\r\n'
+ '2,20171110,17:15:56,147796,1,7956,"Alarm Test 2"\r\n'
+ '\r\n';

const dataWrittenEmitter = new EventEmitter();

function getReportText(machineIndex) {
  let reportLine1 = ''; let
    reportLine2 = '';
  variables[machineIndex].forEach((variable) => {
    if ((_.get(variable, 'access', 'read') === 'read')
      && !_.get(variable, 'alarmCode', false)
      && (_.get(variable, 'alarmCodeChanged', 'None') === 'None')) {
      if (reportLine1.length !== 0) {
        reportLine1 = `${reportLine1},`;
        reportLine2 = `${reportLine2},`;
      }
      reportLine1 = `${reportLine1}${variable.reportName}`;
      reportLine2 = `${reportLine2}${variable.value}`;
    }
  });
  return `${reportLine1}\r\n${reportLine2}\r\n`;
}

const WebDAVTestClient = function WebDAVTestClient() {
  const Client = function Client() {
    this.deleteFile = function deleteFile() {
      return new Promise(((resolve) => {
        resolve();
      }));
    };
    this.putFileContents = function putFileContents(fileName, content) {
      const basename = fileName.replace('/', '');
      if (basename === SET_VARIABLE_FILE) {
        dataWrittenEmitter.emit('data', content);
      }
      return new Promise(((resolve) => {
        resolve();
      }));
    };
    this.getDirectoryContents = function getDirectoryContents(folderName) {
      return new Promise(((resolve) => {
        const updatedDirectoryContents = directoryContents.map((item) => {
          if (folderName) {
            // Create a new object with the updated 'filename' property
            return {
              ...item,
              filename: `/${folderName}${item.basename}`,
            };
          }
          return item; // No modification needed
        });
        resolve(updatedDirectoryContents);
      }));
    };
    this.getFileContents = function getFileContents(fileName) {
      let getFolderName = fileName.split('/')[0];
      getFolderName = getFolderName.replace('/', '');
      const basename = fileName.replace('/', '');
      if (basename.endsWith(REPORT_DAT_FILE)) {
        return new Promise(((resolve) => {
          resolve(getReportText(getFolderName));
        }));
      }
      if (basename.endsWith(ALARM_DAT_FILE)) {
        return new Promise(((resolve) => {
          resolve(ALARM_DATA_TEXT);
        }));
      }

      return new Promise(((resolve, reject) => {
        reject(Error('Unhandled file contents'));
      }));
    };
  };
  return new Client();
};

WebDAVTestClient.prototype.setVariables = function setVariables(machineIndex, machineVariables) {
  variables[machineIndex] = machineVariables;
};

WebDAVTestClient.prototype.dataWritten = function dataWritten() {
  return dataWrittenEmitter;
};

module.exports = WebDAVTestClient;
