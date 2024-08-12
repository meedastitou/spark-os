const _ = require('lodash');
let fs = require('fs');
const defaults = require('./defaults.json');
const schema = require('./schema.json');

//------------------------------------------------------------------------------

// constructor
const hplScanner = function hplScanner(log, machine, model, conf, db, alert) {
  // Private variables
  const that = this;

  const EVENT_TYPES = {
    EV_SYN: 0x00,
    EV_KEY: 0x01, // [joystick] JS_EVENT_BUTTON
    EV_REL: 0x02, // [joystick] JS_EVENT_AXIS
    EV_ABS: 0x03,
    EV_MSC: 0x04,
    EV_SW: 0x05,
    EV_LED: 0x11,
    EV_SND: 0x12,
    EV_REP: 0x14,
    EV_FF: 0x15,
    EV_PWR: 0x16,
    EV_FF_STATUS: 0x17,
    EV_MAX: 0x1f,
    EV_INIT: 0x80, // [joystick] JS_EVENT_INIT
  };

  const LEFT_SHIFT_KEY_CODE = 225;
  const RIGHT_SHIFT_KEY_CODE = 229;

  const keyScanChar = [
    '', '', '', '', 'a', 'b', 'c', 'd', 'e', 'f', // 0 - 9
    'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', // 10 - 19
    'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', // 20 - 29
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', // 30 - 39
    '', '', '', '', ' ', '-', '=', '[', ']', '\\', // 40 - 49
    '', ';', '\'', '`', ',', '.', '/', '', '', '', // 50 - 59
    '', '', '', '', '', '', '', '', '', '', // 60 - 69
    '', '', '', '', '', '', '', '', '', '', // 70 - 79
    '', '', '', '', '/', '*', '-', '+', '', '1', // 80 - 89
    '2', '3', '4', '5', '6', '7', '8', '9', '0', '.', // 90 - 99
    '', '', '', '=', '', '', '', '', '', '', // 100 - 109
    '', '', '', '', '', '', '', '', '', '', // 110 - 119
    '', '', '', '', '', '', '', '', '', '', // 120 - 129
    '', '', '', '', '', '', '', '', '', '', // 130 - 139
    '', '', '', '', '', '', '', '', '', '', // 140 - 149
    '', '', '', '', '', '', '', '', '', '', // 150 - 159
    '', '', '', '', '', '', '', '', '', '', // 160 - 169
    '', '', '', '', '', '', '', '', '', '', // 170 - 179
    '', '', '', '', '', '', '', '', '', '', // 180 - 189
    '', '', '', '', '', '', '', '', '', '', // 190 - 199
    '', '', '', '', '', '', '', '', '', '', // 200 - 209
    '', '', '', '', '', '', '', '', '', '', // 210 - 219
    '', '', '', '', '', '', '', '', '', '', // 220 - 229
    '', '', '', '', '', '', '', '', '', '', // 230 - 239
    '', '', '', '', '', '', '', '', '', '', // 240 - 249
    '', '', '', '', '', '', // 250 - 255
  ];

  const shiftKeyScanChar = [
    '', '', '', '', 'A', 'B', 'C', 'D', 'E', 'F', // 0 - 9
    'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', // 10 - 19
    'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', // 20 - 29
    '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', // 30 - 39
    '', '', '', '', ' ', '_', '+', '{', '}', '|', // 40 - 49
    '', ':', '"', '~', '<', '>', '?', '', '', '', // 50 - 59
    '', '', '', '', '', '', '', '', '', '', // 60 - 69
    '', '', '', '', '', '', '', '', '', '', // 70 - 79
    '', '', '', '', '', '', '', '', '', '', // 80 - 89
    '', '', '', '', '', '', '', '', '', '', // 90 - 99
    '', '', '', '', '', '', '', '', '', '', // 100 - 109
    '', '', '', '', '', '', '', '', '', '', // 110 - 119
    '', '', '', '', '', '', '', '', '', '', // 120 - 129
    '', '', '', '', '', '', '', '', '', '', // 130 - 139
    '', '', '', '', '', '', '', '', '', '', // 140 - 149
    '', '', '', '', '', '', '', '', '', '', // 150 - 159
    '', '', '', '', '', '', '', '', '', '', // 160 - 169
    '', '', '', '', '', '', '', '', '', '', // 170 - 179
    '', '', '', '', '', '', '', '', '', '', // 180 - 189
    '', '', '', '', '', '', '', '', '', '', // 190 - 199
    '', '', '', '', '', '', '', '', '', '', // 200 - 209
    '', '', '', '', '', '', '', '', '', '', // 210 - 219
    '', '', '', '', '', '', '', '', '', '', // 220 - 229
    '', '', '', '', '', '', '', '', '', '', // 230 - 239
    '', '', '', '', '', '', '', '', '', '', // 240 - 249
    '', '', '', '', '', '', // 250 - 255
  ];

  let scannerFd = null;
  let scanString = '';
  let scanCompleteTimer = null;
  let scannerConnectTimer = null;
  let connectionErrorTimer = null;
  let duplexFlag = false;
  let shiftFlag = false;
  let reportErrorFlag = true;

  // Alert Objects
  alert.preLoad({
    'scanner-disconnect': {
      msg: `${machine.info.name}: Connection Error`,
      description: 'Failed to communicate with Scanner. Please ensure Scanner is properly connected',
    },
  });

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine, {
    settings: {
      model,
    },
  });

  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line global-require
    fs = require('./test/scanner-stream-tester');
    this.tester = fs;
  }

  function updateConnectionStatus(connected) {
    conf.set(`machines:${machine.info.name}:settings:model:connectionStatus`, connected, () => {});
  }

  updateConnectionStatus(false);

  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  function updateDatabase(variable, value) {
    that.dataCb(that.machine, variable, value, (err, res) => {
      if (err) {
        log.error(err);
      }
      if (res) log.debug(res);
    });
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function scanComplete() {
    const variableArray = that.machine.variables;

    // go through each variable for this machine and update with the received sca1nString.
    for (let i = 0; i < variableArray.length; i += 1) {
      updateDatabase(variableArray[i], scanString);
    }

    // clear everything for the next received scan.
    scanString = '';
    duplexFlag = false;
    shiftFlag = false;
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function parseScannerBuffer(buf) {
    if (buf.length >= 24) {
      // unsigned long time structure.
      return {
        tssec: buf.readUInt32LE(0),
        tsusec: buf.readUInt32LE(8),
        type: buf.readUInt16LE(16),
        code: buf.readUInt16LE(18),
        value: buf.readInt32LE(20),
      };
    }
    if (buf.length >= 16) {
      // https://www.kernel.org/doc/Documentation/input/input.txt
      // is inconsistent with linux/input.h
      // 'value' is a signed 32 bit int in input.h.
      // code is truth, and this also makes more sense for negative
      // axis movement
      // struct input_event {
      //   struct timeval time;
      //   __u16 type;
      //   __u16 code;
      //   __s32 value;
      // };
      return {
        tssec: buf.readUInt32LE(0),
        tsusec: buf.readUInt32LE(4),
        type: buf.readUInt16LE(8),
        code: buf.readUInt16LE(10),
        value: buf.readInt32LE(12),
      };
    } if (buf.length === 8) {
      // https://www.kernel.org/doc/Documentation/input/joystick-api.txt
      // struct js_event {
      //  __u32 time;  /* event timestamp in milliseconds */
      //  __s16 value; /* value */
      //  __u8 type;   /* event type */
      //  __u8 number; /* axis/button number */
      // };
      return {
        time: buf.readUInt32LE(0),
        value: buf.readInt16LE(4),
        type: buf.readUInt8(6),
        number: buf.readUInt8(7),
      };
    } if (buf.length === 3) {
      // mice mouse
      return {
        t: buf.readInt8(0),
        x: buf.readInt8(1),
        y: buf.readInt8(2),
      };
    }

    return {};
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function handleScannerEvent(ev) {
    if (ev.type === EVENT_TYPES.EV_MSC) {
      // eslint-disable-next-line no-bitwise
      const keyValue = ev.value & 0xff;
      let keyChar;

      // if we've received a shift key prior to this, use the shiftKeyScanChar map.
      if (shiftFlag) {
        keyChar = shiftKeyScanChar[keyValue];
      } else {
        keyChar = keyScanChar[keyValue];
      }
      // check if we've got a character
      if (keyChar !== '') {
        if (duplexFlag === false) {
          scanString += keyChar;
          // set the duplexFlag so that we ignore the next key.  It appears that
          // every key is reported twice.  Perhaps once for press and once for release?
          // Regardless, we need to throw away every other key report.
          duplexFlag = true;
        } else {
          duplexFlag = false;
        }
      } else if ((keyValue === LEFT_SHIFT_KEY_CODE) || (keyValue === RIGHT_SHIFT_KEY_CODE)) {
        shiftFlag = !shiftFlag;
      } else {
        log.debug('Received unknown scan code.  keyValue: ', keyValue);
      }

      // start (or reset) the timer to trigger the end of scan processing.
      if (scanCompleteTimer) {
        clearTimeout(scanCompleteTimer);
      }
      scanCompleteTimer = setTimeout(scanComplete, 50);
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function processScannerData(buf) {
    let ev;
    let part;

    //  Sometimes (modern Linux), multiple key events will be in the triggered at once for the
    //  same timestamp. The first 4 bytes will be repeated for every event, so we use that
    //  knowledge to actually split it. We assume event structures of 3 bytes, 8 bytes,
    //  16 bytes or 24 bytes.

    if (buf.length > 8) {
      const t = buf.readUInt32LE(0);
      let i; let n; let
        lastPos = 0;
      for (i = 8, n = buf.length; i < n; i += 8) {
        if (buf.readUInt32LE(i) === t) {
          part = buf.slice(lastPos, i);
          ev = parseScannerBuffer(part);
          if (ev) {
            handleScannerEvent(ev);
          }
          lastPos = i;
        }
      }
      part = buf.slice(lastPos, i);
      ev = parseScannerBuffer(part);
      if (ev) {
        handleScannerEvent(ev);
      }
    } else {
      ev = parseScannerBuffer(buf);
      if (ev) {
        handleScannerEvent(ev);
      }
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function connectionErrorTimeout() {
    // it's been long enough since we tried to connect.  since we didn't get
    // an error, reset our reporting flag, so if the scanner is
    // disconnected, we will report again.
    reportErrorFlag = true;

    // set the connection status to true since we are connected
    updateConnectionStatus(true);

    // Clear the raised alert for disconnection
    alert.clear('scanner-disconnect');
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function processScannerError() {
    if (reportErrorFlag) {
      // log.error('Error from Scanner stream: ', err);
      alert.raise({ key: 'scanner-disconnect' });
      reportErrorFlag = false; // only report once for each disconnect.
    }
    if (connectionErrorTimer) {
      clearTimeout(connectionErrorTimer); // if we had a timer running, cancel it
    }
    // eslint-disable-next-line no-use-before-define
    closeScannerReadStream();
    // eslint-disable-next-line no-use-before-define
    scannerConnectTimer = setTimeout(connectToScanner, 30000); // retry in 30 seconds.
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function closeScannerReadStream() {
    updateConnectionStatus(false);

    if (scannerFd) {
      scannerFd.removeListener('data', processScannerData);
      scannerFd.removeListener('error', processScannerError);
      scannerFd.close();
      scannerFd = null;
    }
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function connectToScanner() {
    connectionErrorTimer = setTimeout(connectionErrorTimeout, 5000);
    scannerFd = fs.createReadStream(that.machine.settings.model.device, { flags: 'r', encoding: null });
    scannerFd.on('data', processScannerData);
    scannerFd.on('error', processScannerError);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  function open(callback) {
    if (scannerFd === null) {
      setImmediate(connectToScanner);
    }

    // trigger callback on succesful connection
    callback(null);
  }

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  this.start = function start(dataCb, configUpdateCb, done) {
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

      // reset the variables for processing the received scancodes.
      scanString = '';
      duplexFlag = false;
      shiftFlag = false;

      log.info(`Started: ${that.machine.info.name}`);
      return done(null);
    });

    return undefined;
  };

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  this.stop = function stop(done) {
    updateConnectionStatus(false);

    if (!that.machine) {
      return done('machine undefined');
    }

    if (scanCompleteTimer) {
      clearTimeout(scanCompleteTimer); // if we had a timer running, cancel it
      scanCompleteTimer = null;
    }
    if (scannerConnectTimer) {
      clearTimeout(scannerConnectTimer); // if we had a timer running, cancel it
      scannerConnectTimer = null;
    }
    if (connectionErrorTimer) {
      clearTimeout(connectionErrorTimer); // if we had a timer running, cancel it
      connectionErrorTimer = null;
    }

    // clear the alert raised
    alert.clearAll((err) => {
      if (err) {
        log.error(err);
      }

      closeScannerReadStream();
      log.info(`Stopped: ${that.machine.info.name}`);

      return done(null);
    });

    return undefined;
  };

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------

  this.restart = function restart(done) {
    log.debug(`Restarting: ${that.machine.info.name}`);
    that.stop((err) => {
      if (err) {
        return done(err);
      }
      return that.start(that.dataCb, that.configUpdateCb, startErr => done(startErr));
    });
  };

  //------------------------------------------------------------------------------
  //------------------------------------------------------------------------------
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
  hpl: hplScanner,
  defaults,
  schema,
};
