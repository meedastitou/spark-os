/* jshint esversion: 6 */
require('chai').should();
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const ftpClient = require('ftp');
const pkg = require('../package.json');
const SparkHplEuromap63 = require('../index.js');

const FTP_PORT = 8080;

const SESSION_REQ_FILE = '/SESS0000.REQ';
const SESSION_RSP_FILE = '/SESS0000.RSP';
const INVALID_REQ_FILE = '/INVALID.REQ';

const ALARM_DATA_TEXT_1 = '1,20171110,17:16:56,147797,1,6169,"Alarm Test 1"\r\n'
+ '2,20171110,17:15:56,147796,1,7956,"Alarm Test 2"\r\n'
+ '\r\n';

const ALARM_DATA_TEXT_2 = '2,20171110,17:16:56,147796,1,7956,"Alarm Test 2"\r\n'
+ '\r\n';

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const testMachine = {
  info: {
    name: 'test-machine',
    fullname: 'Test machine',
    version: '1.0.0',
    description: 'Test Machine',
    hpl: 'euromap63',
  },
  settings: {
    model: {
      enable: true,
      connectionMode: 'FTP server',
      ftpIp: '127.0.0.1',
      ftpPort: FTP_PORT,
      webdavUrl: '',
      ftpUsername: 'anonymous',
      ftpPassword: 'anonymous@',
      sessionNumber: 0,
      cyclicType: 'time',
      cyclicTime: 15,
      cyclicShotCount: 1,
    },
  },
  variables: [
    {
      name: 'Date',
      description: 'Date',
      format: 'char',
      reportName: 'DATE',
      value: '20170920',
    },
    {
      name: 'Time',
      description: 'Time',
      format: 'char',
      reportName: 'TIME',
      value: '18:49:17',
    },
    {
      name: 'Count',
      description: 'Count',
      format: 'uint32',
      reportName: 'COUNT',
      value: 18402,
    },
    {
      name: 'act-tim-cyc-first',
      description: 'act-tim-cyc-first',
      format: 'float',
      reportName: 'ActTimCyc',
      value: 29.0,
    },
    {
      name: 'act-vol-csh',
      description: 'act-vol-csh',
      format: 'int8',
      reportName: 'ActVolCsh[1,1]',
      value: 10,
    },
    {
      name: 'act-tim-fill',
      description: 'act-tim-fill',
      format: 'uint8',
      reportName: 'ActTimFill[1]',
      value: 1,
    },
    {
      name: 'act-tim-plst',
      description: 'act-tim-plst',
      format: 'int16',
      reportName: 'ActTimPlst[1]',
      value: 13,
    },
    {
      name: 'act-prs-mach-spec-max',
      description: 'act-prs-mach-spec-max',
      format: 'uint16',
      reportName: 'ActPrsMachSpecMax',
      value: 1195,
    },
    {
      name: 'act-prs-xfr-spec',
      description: 'act-prs-xfr-spec',
      format: 'uint32',
      reportName: 'ActPrsXfrSpec[1]',
      value: 1194,
    },
    {
      name: 'act-vol-xfr',
      description: 'act-vol-xfr',
      format: 'bool',
      reportName: 'ActVolXfr[1]',
      value: true,
    },
    {
      name: 'act-tim-cyc-second',
      description: 'act-tim-cyc-second',
      format: 'double',
      reportName: 'ActTimCyc',
      value: 29.0,
    },
    {
      name: 'alarmCode',
      description: 'Alarm Code',
      format: 'uint16',
      alarmCode: true,
      value: 7956,
    },
    {
      name: 'alarmCodeArray',
      description: 'Alarm Code Array',
      format: 'uint16',
      alarmCode: true,
      array: true,
      value: [6169, 7956],
    },
    {
      name: 'alarmCodeActivated',
      description: 'Alarm Code Activated',
      format: 'uint16',
      alarmCodeChanged: 'Activated',
      value: 7956,
    },
    {
      name: 'alarmCodeDeactivated',
      description: 'Alarm Code Deactivated',
      format: 'uint16',
      alarmCodeChanged: 'Deactivated',
      value: 6169,
    },
    {
      name: 'write-char',
      description: 'Write Char',
      format: 'char',
      reportName: 'WriteChar',
      access: 'write',
      value: 'ABCD',
    },
    {
      name: 'write-number',
      description: 'Write Number',
      format: 'int16',
      reportName: 'WriteNumber',
      access: 'write',
      value: 12345,
    },
    {
      name: 'write-bool',
      description: 'Write Bool',
      format: 'bool',
      reportName: 'WriteBool',
      access: 'write',
      value: true,
    },
  ],
};

const db = new EventEmitter();

function dataCb(machine, variable, value, done) {
  const data = {
    machine: machine.info.name,
    variable: variable.name,
  };
  data[variable.name] = value;
  log.debug({ data });
  db.emit('data', data);
  done(null);
}

function configUpdateCb(machine, done) {
  log.debug({ machine });
  return done(null);
}

let alerts = {};
const sparkAlert = new EventEmitter();
sparkAlert.getAlerter = function getAlerter() {
  return {
    clearAll(done) {
      return done(null);
    },
    preLoad: function preLoad(preloadAlerts) {
      alerts = preloadAlerts;
    },
    raise: function raise(_alert) {
      const alert = _alert;
      if (_.has(alerts, alert.key)) _.extend(alert, alerts[alert.key]);
      Object.keys(alert).forEach((k) => {
        // check if the key is a function
        if (typeof alert[k] === 'function') {
          // if it is then run the function and replace
          // the key with the output
          alert[k] = alert[k](alert);
        }
      });
      sparkAlert.emit('raise', alert);
    },
    clear(key) {
      log.debug({ key }, 'Cleared alert');
    },
  };
};

const sparkConfig = new EventEmitter();
sparkConfig.set = function set(key, value, done) {
  if (done) return done(null);
  return undefined;
};


let client;
function createFTPClient(callback) {
  client = new ftpClient();
  client.on('ready', () => callback(null));
  client.connect({ port: FTP_PORT });
}

function streamToString(stream, cb) {
  const chunks = [];
  stream.on('data', (chunk) => {
    chunks.push(chunk.toString());
  });
  stream.on('end', () => {
    cb(chunks.join(''));
  });
}

function getReportText() {
  let reportLine1 = ''; let
    reportLine2 = '';
  testMachine.variables.forEach((variable) => {
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

describe('Spark HPL Euromap63', () => {
  let sparkHplEuromap63;

  it('successfully create a new Modbus HPL', (done) => {
    /* eslint new-cap: ['error', { 'newIsCap': false }] */
    sparkHplEuromap63 = new SparkHplEuromap63.hpl(log.child({
      machine: testMachine.info.name,
    }), testMachine, testMachine.settings.model, sparkConfig, null,
    sparkAlert.getAlerter());
    sparkHplEuromap63.tester.prototype.setVariables(testMachine.variables);
    return done();
  });

  it('start should error when dataCb is not a function', (done) => {
    sparkHplEuromap63.start(5, configUpdateCb, (err) => {
      if (!err) done('err not set');
      err.should.equal('dataCb not a function');
      return done();
    });
  });

  it('start should error when configUpdateCb is not a function', (done) => {
    sparkHplEuromap63.start(dataCb, 5, (err) => {
      if (!err) done('err not set');
      err.should.equal('configUpdateCb not a function');
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkHplEuromap63.start(dataCb, configUpdateCb, (err) => {
      if (err) return done(err);
      createFTPClient(done);
      return undefined;
    });
  });

  it('ftp get of connect request file should succeed', (done) => {
    client.get(SESSION_REQ_FILE, (err, stream) => {
      if (err) return done(err);
      streamToString(stream, (string) => {
        string.should.equal('00000000 CONNECT;\r\n');
        client.delete(SESSION_REQ_FILE, (delErr) => {
          if (delErr) return done(delErr);
          client.put('00000000 PROCESSED;\r\n', SESSION_RSP_FILE, (putErr) => {
            if (putErr) return done(putErr);
            setTimeout(() => {
              done();
            }, 700);
            return undefined;
          });
          return undefined;
        });
      });
      return undefined;
    });
  });

  it('ftp get of abort report request file should succeed', (done) => {
    client.get(SESSION_REQ_FILE, (err, stream) => {
      if (err) return done(err);
      streamToString(stream, (string) => {
        string.should.equal('00000001 EXECUTE "ABORTREPORT0000.JOB";\r\n');
        client.delete(SESSION_REQ_FILE, (delErr) => {
          if (delErr) return done(delErr);
          client.put('00000001 PROCESSED;\r\n', SESSION_RSP_FILE, (putEerr) => {
            if (putEerr) return done(putEerr);
            setTimeout(() => {
              done();
            }, 700);
            return undefined;
          });
          return undefined;
        });
      });
      return undefined;
    });
  });

  it('ftp get of abort alarms should succeed', (done) => {
    client.get(SESSION_REQ_FILE, (err, stream) => {
      if (err) return done(err);
      streamToString(stream, (string) => {
        string.should.equal('00000002 EXECUTE "ABORTALARMS0000.JOB";\r\n');
        client.delete(SESSION_REQ_FILE, (delErr) => {
          if (delErr) return done(delErr);
          client.put('00000002 PROCESSED;\r\n', SESSION_RSP_FILE, (putErr) => {
            if (putErr) return done(putErr);
            setTimeout(() => {
              done();
            }, 700);
            return undefined;
          });
          return undefined;
        });
      });
      return undefined;
    });
  });

  it('ftp get of report initialization should succeed', (done) => {
    client.get(SESSION_REQ_FILE, (err, stream) => {
      if (err) return done(err);
      streamToString(stream, (string) => {
        string.should.equal('00000003 EXECUTE "REPORT0000.JOB";\r\n');
        client.delete(SESSION_REQ_FILE, (delErr) => {
          if (delErr) return done(delErr);
          client.put('00000003 PROCESSED;\r\n', SESSION_RSP_FILE, (putErr) => {
            if (putErr) return done(putErr);
            setTimeout(() => {
              done();
            }, 700);
            return undefined;
          });
          return undefined;
        });
      });
      return undefined;
    });
  });

  it('ftp get of alarm initialization should succeed', (done) => {
    client.get(SESSION_REQ_FILE, (err, stream) => {
      if (err) return done(err);
      streamToString(stream, (string) => {
        string.should.equal('00000004 EXECUTE "GETALARMS0000.JOB";\r\n');
        client.delete(SESSION_REQ_FILE, (delErr) => {
          if (delErr) return done(delErr);
          client.put('00000004 PROCESSED;\r\n', SESSION_RSP_FILE, (putErr) => {
            if (putErr) return done(putErr);
            setTimeout(() => {
              done();
            }, 700);
            return undefined;
          });
          return undefined;
        });
      });
      return undefined;
    });
  });

  it('ftp get of an invalid filename should raise an alert', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('invalid-filename');
      alert.msg.should.equal('Euromap 63: Invalid File Name');
      alert.description.should.equal('An invalid file name was provided by the client.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });
    client.get(INVALID_REQ_FILE, () => {
    });
  });

  it('ftp mode should produced valid report data', (done) => {
    client.put(getReportText(), '/REPORT0000.DAT', (err) => {
      if (err) return done(err);
      const readVariables = [];
      const gotDataForVar = [];
      testMachine.variables.forEach((variable) => {
        if ((_.get(variable, 'access', 'read') === 'read')
        && !_.get(variable, 'alarmCode', false)
        && (_.get(variable, 'alarmCodeChanged', 'None') === 'None')) {
          readVariables.push(variable);
        }
      });
      db.on('data', (data) => {
        readVariables.forEach((variable) => {
          if (_.get(variable, 'access', 'read') === 'read') {
            if (variable.name === data.variable) {
              if (gotDataForVar.indexOf(data.variable) === -1) {
                data[variable.name].should.eql(variable.value);
                gotDataForVar.push(data.variable);
                if (gotDataForVar.length === readVariables.length) {
                  db.removeAllListeners('data');
                  return done();
                }
              }
            }
          }
          return undefined;
        });
      });
      return undefined;
    });
  });

  it('ftp mode should produced valid alarm code data', (done) => {
    client.append(ALARM_DATA_TEXT_1, '/GETALARMS0000.DAT', (err) => {
      if (err) return done(err);
      const readVariables = [];
      const gotDataForVar = [];
      testMachine.variables.forEach((variable) => {
        if ((_.get(variable, 'access', 'read') === 'read')
        && (_.get(variable, 'alarmCode', false)
        || (_.get(variable, 'alarmCodeChanged', 'None') === 'Activated'))) {
          readVariables.push(variable);
        }
      });
      db.on('data', (data) => {
        readVariables.forEach((variable) => {
          if (_.get(variable, 'access', 'read') === 'read') {
            if (variable.name === data.variable) {
              if (gotDataForVar.indexOf(data.variable) === -1) {
                data[variable.name].should.eql(variable.value);
                gotDataForVar.push(data.variable);
                if (gotDataForVar.length === readVariables.length) {
                  db.removeAllListeners('data');
                  return done();
                }
              }
            }
          }
          return undefined;
        });
      });
      return undefined;
    });
  });

  it('ftp mode should produced valid alarm code data', (done) => {
    client.put(ALARM_DATA_TEXT_2, '/GETALARMS0000.DAT', (err) => {
      if (err) return done(err);
      const readVariables = [];
      const gotDataForVar = [];
      testMachine.variables.forEach((variable) => {
        if ((_.get(variable, 'access', 'read') === 'read')
        && !_.get(variable, 'array', false)
        && (_.get(variable, 'alarmCode', false)
        || (_.get(variable, 'alarmCodeChanged', 'None') === 'Deactivated'))) {
          readVariables.push(variable);
        }
      });
      db.on('data', (data) => {
        readVariables.forEach((variable) => {
          if (_.get(variable, 'access', 'read') === 'read') {
            if (variable.name === data.variable) {
              if (gotDataForVar.indexOf(data.variable) === -1) {
                data[variable.name].should.eql(variable.value);
                gotDataForVar.push(data.variable);
                if (gotDataForVar.length === readVariables.length) {
                  db.removeAllListeners('data');
                  return done();
                }
              }
            }
          }
          return undefined;
        });
      });
      return undefined;
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`in ftp mode writing variable with format ${variable.format} should succeed`, (done) => {
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplEuromap63.writeData(value, (err) => {
          if (err) return done(err);
          client.get('/SETVARIABLE0000.JOB', (getErr, stream) => {
            if (getErr) return done(getErr);
            streamToString(stream, (string) => {
              const lines = string.split('\r\n');
              const tokens = lines[1].split(' ');
              let writeValue;
              switch (variable.format) {
                case 'char':
                  writeValue = tokens[2].substr(1, tokens[2].length - 3);
                  break;
                case 'bool':
                  writeValue = parseInt(tokens[2], 10) === 1;
                  break;
                default:
                  writeValue = parseInt(tokens[2], 10);
              }
              writeValue.should.equal(variable.value);
              return done();
            });
            return undefined;
          });
          return undefined;
        });
      });
    }
  });

  it('ftp get directory listing should succeed', (done) => {
    client.list((err, list) => {
      for (let iList = 0; iList < list.length; iList += 1) {
        if (list[iList].name === SESSION_REQ_FILE.substr(1)) {
          done();
        }
      }
    });
  });

  it('stop should succeed', (done) => {
    sparkHplEuromap63.stop((err) => {
      if (err) return done(err);
      return done();
    });

    // process report and alarm aborts so that stop completes
    setTimeout(() => {
      client.get(SESSION_REQ_FILE, (err, abortReportStream) => {
        if (err) return done(err);
        streamToString(abortReportStream, (abortReportString) => {
          abortReportString.should.equal('00000001 EXECUTE "ABORTREPORT0000.JOB";\r\n');
          client.delete(SESSION_REQ_FILE, (delErr) => {
            if (delErr) return done(delErr);
            client.put('00000001 PROCESSED;\r\n', SESSION_RSP_FILE, (putErr) => {
              if (putErr) return done(putErr);
              setTimeout(() => {
                client.get(SESSION_REQ_FILE, (getErr, abortAlarmsStream) => {
                  if (getErr) return done(getErr);
                  streamToString(abortAlarmsStream, (string) => {
                    string.should.equal('00000002 EXECUTE "ABORTALARMS0000.JOB";\r\n');
                    client.delete(SESSION_REQ_FILE, (del2Err) => {
                      if (del2Err) return done(del2Err);
                      client.put('00000002 PROCESSED;\r\n', SESSION_RSP_FILE, (put2Err) => {
                        if (put2Err) done(put2Err);
                      });
                      return undefined;
                    });
                  });
                  return undefined;
                });
              }, 700);
              return undefined;
            });
            return undefined;
          });
        });
        return undefined;
      });
    }, 700);
  }).timeout(8000);

  it('update model should succeed when passed valid inputs', (done) => {
    sparkHplEuromap63.updateModel({
      enable: true,
      connectionMode: 'WebDAV client',
      ftpIp: '127.0.0.1',
      ftpPort: FTP_PORT,
      webdavUrl: 'localhost',
      ftpUsername: 'anonymous',
      ftpPassword: 'anonymous@',
      sessionNumber: 0,
      cyclicType: 'time',
      cyclicTime: 15,
      cyclicShotCount: 1,
    }, (err) => {
      if (err) return done(err);
      return done();
    });
  });

  it('webdav mode should produced valid report data', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if ((_.get(variable, 'access', 'read') === 'read')
      && !_.get(variable, 'alarmCode', false)
      && (_.get(variable, 'alarmCodeChanged', 'None') === 'None')) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (_.get(variable, 'access', 'read') === 'read') {
          if (variable.name === data.variable) {
            if (gotDataForVar.indexOf(data.variable) === -1) {
              data[variable.name].should.eql(variable.value);
              gotDataForVar.push(data.variable);
              if (gotDataForVar.length === readVariables.length) {
                db.removeAllListeners('data');
                return done();
              }
            }
          }
        }
        return undefined;
      });
    });
  }).timeout(25000);

  it('webdav mode should produced valid alarm code data', (done) => {
    const readVariables = [];
    const gotDataForVar = [];
    testMachine.variables.forEach((variable) => {
      if ((_.get(variable, 'access', 'read') === 'read')
      && (_.get(variable, 'alarmCode', false))) {
        readVariables.push(variable);
      }
    });
    db.on('data', (data) => {
      readVariables.forEach((variable) => {
        if (_.get(variable, 'access', 'read') === 'read') {
          if (variable.name === data.variable) {
            if (gotDataForVar.indexOf(data.variable) === -1) {
              data[variable.name].should.eql(variable.value);
              gotDataForVar.push(data.variable);
              if (gotDataForVar.length === readVariables.length) {
                db.removeAllListeners('data');
                return done();
              }
            }
          }
        }
        return undefined;
      });
    });
  });

  testMachine.variables.forEach((variable) => {
    if ((_.get(variable, 'access') === 'write') && (variable.format !== undefined)) {
      it(`in webdave mode writing variable with format ${variable.format} should succeed`, (done) => {
        const dataWritten = sparkHplEuromap63.tester.prototype.dataWritten();
        dataWritten.on('data', (string) => {
          const lines = string.split('\r\n');
          const tokens = lines[1].split(' ');
          let value;
          switch (variable.format) {
            case 'char':
              value = tokens[2].substr(1, tokens[2].length - 3);
              break;
            case 'bool':
              value = parseInt(tokens[2], 10) === 1;
              break;
            default:
              value = parseInt(tokens[2], 10);
          }
          value.should.equal(variable.value);
          dataWritten.removeAllListeners('data');
          return done();
        });
        const value = { variable: variable.name };
        value[variable.name] = variable.value;
        sparkHplEuromap63.writeData(value, (err) => {
          if (err) done(err);
        });
      });
    }
  });

  it('stop should succeed', (done) => {
    sparkHplEuromap63.stop((err) => {
      if (err) return done(err);
      return done();
    });
  }).timeout(8000);
});
