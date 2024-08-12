/* jshint esversion: 6 */
const { EventEmitter } = require('events');
const _ = require('lodash');

const SESSION_RSP_FILE = 'SESS0000.RSP';
const REPORT_DAT_FILE = 'REPORT0000.DAT';
const ALARM_DAT_FILE = 'GETALARMS0000.DAT';
const SET_VARIABLE_FILE = 'SETVARIABLE0000.JOB';

let variables;

const directoryContents = [
  {
    type: 'file',
    basename: SESSION_RSP_FILE,
    filename: `/${SESSION_RSP_FILE}`,
  },
  {
    type: 'file',
    basename: REPORT_DAT_FILE,
    filename: `/${REPORT_DAT_FILE}`,
  },
  {
    type: 'file',
    basename: ALARM_DAT_FILE,
    filename: `/${ALARM_DAT_FILE}`,
  },
];

const ALARM_DATA_TEXT = '1,20171110,17:16:56,147797,1,6169,"Alarm Test 1"\r\n'
+ '2,20171110,17:15:56,147796,1,7956,"Alarm Test 2"\r\n'
+ '\r\n';

const dataWrittenEmitter = new EventEmitter();

function getReportText() {
  let reportLine1 = ''; let
    reportLine2 = '';
  variables.forEach((variable) => {
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
    this.getDirectoryContents = function getDirectoryContents() {
      return new Promise(((resolve) => {
        resolve(directoryContents);
      }));
    };
    this.getFileContents = function getFileContents(fileName) {
      const basename = fileName.replace('/', '');
      if (basename === REPORT_DAT_FILE) {
        return new Promise(((resolve) => {
          resolve(getReportText());
        }));
      }
      if (basename === ALARM_DAT_FILE) {
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

WebDAVTestClient.prototype.setVariables = function setVariables(machineVariables) {
  variables = machineVariables;
};

WebDAVTestClient.prototype.dataWritten = function dataWritten() {
  return dataWrittenEmitter;
};

module.exports = WebDAVTestClient;
