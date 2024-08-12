const { EventEmitter } = require('events');
const os = require('os');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const async = require('async');
const usb = require('usb');
const glob = require('glob');
const ini = require('ini');
const pkg = require('./package.json');

let spark = {};
try {
  spark = JSON.parse(fs.readFileSync('/etc/spark.json', 'utf8'));
} catch (e) {
  // console.log("Failed to find /etc/spark.json, using inbuild defaults");

  spark = {
    hardwareSearchList: [{
      searchPath: '/sys/class/tty/tty{S[1-9],USB*,ACM*}',
      class: 'tty',
    }, {
      searchPath: '/sys/class/net/{eth*,en*,wlan*,wl*}',
      class: 'net',
    }, {
      searchPath: '/sys/class/input/input*',
      class: 'input',
    }],
  };
}

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};

const hardwarePollTime = 10 * 1000;
const mountPollTime = 2 * 1000;

let log;
let conf;
let hardwarePollTimer;
let mountPollTimer;

// var sparkHWDetect = {
//     name: pkg.name
// };

let currentHardware = {};
let mountedDrives = [];

const sparkHWDetect = new EventEmitter();
sparkHWDetect.name = pkg.name;
sparkHWDetect.mountDir = '/run/media/system';

// list of serial types known by the linux kernel
const serialTypes = [
  'unknown',
  '8250',
  '16450',
  '16550',
  '16550A',
  'Cirrus',
  '16650',
  '16650V2',
  '16750',
  '16950',
  '16954',
  '16654',
  '16850',
  'RSA',
  'NS16550A',
  'XSCALE',
  'RM9000',
  'OCTEON',
  'AR7',
  'U6_16550A',
];

sparkHWDetect.stop = function stop(done) {
  if (hardwarePollTimer) {
    clearInterval(hardwarePollTimer);
    hardwarePollTimer = null;
  }

  if (mountPollTimer) {
    clearInterval(mountPollTimer);
    mountPollTimer = null;
  }

  log.info('Stopped', pkg.name);
  return done(null);
};

sparkHWDetect.require = function require() {
  return ['spark-config',
    'spark-logging',
  ];
};

sparkHWDetect.getCurrentHardware = function getCurrentHardware() {
  return currentHardware;
};

function getMountedDrives() {
  const currentMountedDrives = [];
  // get all files and subdirectories in the mount directory
  try {
    const fileList = fs.readdirSync(sparkHWDetect.mountDir);
    for (let iFile = 0; iFile < fileList.length; iFile += 1) {
      const file = fileList[iFile];
      // if found a subdirectory, add it to the list, if it is not empty
      const filePath = `${sparkHWDetect.mountDir}/${file}`;
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        try {
          if (fs.readdirSync(filePath).length !== 0) {
            currentMountedDrives.push(file);
          }
        } catch (e) {
          log.error(e);
        }
      }
    }
  } catch (err) {
    log.debug(err);
  }

  return currentMountedDrives;
}

function pollForMountedDrives() {
  mountPollTimer = setInterval(() => {
    // emit event if any drives either mounted or unmounted
    const currentMountedDrives = getMountedDrives();
    const recentlyMountedDrives = [];
    const recentlyUnmountedDrives = [];
    for (let iCurr = 0; iCurr < currentMountedDrives.length; iCurr += 1) {
      if (!mountedDrives.includes(currentMountedDrives[iCurr])) {
        recentlyMountedDrives.push(currentMountedDrives[iCurr]);
      }
    }

    if (recentlyMountedDrives.length > 0) {
      sparkHWDetect.emit('mounted', recentlyMountedDrives);
    }

    for (let iOld = 0; iOld < mountedDrives.length; iOld += 1) {
      if (!currentMountedDrives.includes(mountedDrives[iOld])) {
        recentlyUnmountedDrives.push(mountedDrives[iOld]);
      }
    }

    if (recentlyUnmountedDrives.length > 0) {
      sparkHWDetect.emit('unmounted', recentlyUnmountedDrives);
    }

    mountedDrives = currentMountedDrives;
  }, mountPollTime);
}

function parseUsbDeviceUevent(ueventPath, done) {
  fs.readFile(`${ueventPath}/uevent`, 'utf8', (err, _uevent) => {
    let uevent = _uevent;
    if ((err) || (!uevent)) {
      return done(err);
    }

    uevent = ini.parse(uevent);

    // check the uevent has the values we need
    if (!_.hasIn(uevent, 'DEVTYPE')
    || !_.hasIn(uevent, 'BUSNUM')
    || !_.hasIn(uevent, 'DEVNUM')) {
      return done(null);
    }

    if (uevent.DEVTYPE !== 'usb_device') {
      // ignore, this is not a usb device
      return done(null);
    }

    const usbDevs = usb.getDeviceList();

    // find this device in the list of usb devices
    const index = _.findIndex(usbDevs, {
      busNumber: parseInt(uevent.BUSNUM, 10),
      deviceAddress: parseInt(uevent.DEVNUM, 10),
    });

    if (index === -1) {
      // failed to find the usb device
      return done(null);
    }

    const device = {
      usbBusNumber: usbDevs[index].busNumber,
      usbDeviceAddress: usbDevs[index].deviceAddress,
      usbPortNumber: _.get(usbDevs[index], 'portNumbers', []).join('.'),
      usbIdVendor: usbDevs[index].deviceDescriptor.idVendor,
      usbIdProduct: usbDevs[index].deviceDescriptor.idProduct,
    };

    return done(null, device);
  });
}

function findUsbDeviceUevent(devPath, done) {
  let prefix;
  let searchPrefixIndex = 0;
  const searchPrefix = [
    '/device/..',
    '/device/../..',
    '/../..',
  ];

  async.doWhilst(
    (cb) => {
      // try each prefix until we find a usb device
      prefix = searchPrefix[searchPrefixIndex += 1];
      parseUsbDeviceUevent(devPath + prefix, (err, device) => cb(null, device));
    },
    device => ((searchPrefixIndex < searchPrefix.length) && (_.isEmpty(device))),
    (err, device) => done(null, prefix, device),
  );
}

function findTtyDevices(usbDevs, searchPath, done) {
  glob(searchPath, (errGlob, files) => {
    if ((errGlob) || !(files) || (files.length === 0)) {
      return done(null);
    }

    return async.map(files, (devPath, cbMap) => {
      const device = {
        path: devPath,
        device: `/dev/${path.basename(devPath)}`,
        class: 'tty',
      };

      // ignore some devices
      if ((device.device === '/dev/console')
           || (device.device === '/dev/ptmx')
           || (device.device === '/dev/tty')
           || (device.device === '/dev/ttyprintk')) {
        return cbMap(null);
      }

      return async.waterfall([
        (cbWater) => {
          // the the serial type
          fs.readFile(`${devPath}/type`, 'utf8', (err, _ttyType) => {
            let ttyType = _ttyType;
            if (err) {
              if (err.code === 'ENOENT') {
                // if the files does not exists that is ok
                return cbWater(null);
              }
              return cbWater(err);
            }

            ttyType = parseInt(ttyType, 10);
            if ((ttyType <= 0) || (ttyType >= serialTypes.length)) {
              log.debug(`unknown tty type ${ttyType}`);
              return cbWater(new Error(`unknown tty type ${ttyType}`));
            }
            device.serialType = serialTypes[ttyType];

            return cbWater(null);
          });
        },
      ], (errWaterfall) => {
        if (errWaterfall) {
          return cbMap(null);
        }

        return findUsbDeviceUevent(devPath, (errFindUsb, prefix, usbDevice) => {
          if ((errFindUsb) || (!usbDevice)) {
            return cbMap(null, device);
          }

          _.merge(device, usbDevice);

          return async.waterfall([
            (cbWater) => {
              fs.readFile(`${devPath + prefix}/manufacturer`, 'utf8', (err, manufacturer) => {
                if ((!err) && (manufacturer)) {
                  _.set(device, 'manufacturer', manufacturer.trim());
                }
                return cbWater(null);
              });
            },
            (cbWater) => {
              fs.readFile(`${devPath + prefix}/product`, 'utf8', (err, product) => {
                if ((!err) && (product)) {
                  _.set(device, 'product', product.trim());
                }
                return cbWater(null);
              });
            },
          ], () => cbMap(null, device));
        });
      });
    }, (err, _devices) => {
      // remove empty values
      const devices = _devices.filter(n => ((n !== undefined) && (n !== null)));
      return done(null, devices);
    });
  });
}

function findNetDevices(usbDevs, searchPath, done) {
  glob(searchPath, (errGlob, files) => {
    if ((errGlob) || !(files) || (files.length === 0)) {
      return done(null);
    }

    return async.map(files, (devPath, cbMap) => {
      const device = {
        path: devPath,
        device: path.basename(devPath),
        class: 'net',
      };

      // ignore the loopback device
      if (device.device === 'lo') {
        return cbMap(null);
      }

      return async.waterfall([
        (cbWater) => {
          fs.readFile(`${devPath}/address`, 'utf8', (err, macAddress) => {
            if ((!err) && (macAddress)) {
              device.macAddress = macAddress.trim();
            }
            return cbWater(null);
          });
        },
        (cbWater) => {
          const netInterface = os.networkInterfaces()[device.device];
          if (!netInterface) {
            return cbWater(null);
          }

          netInterface.forEach((address) => {
            if (address.family === 'IPv4' && !address.internal) {
              _.set(device, 'ipv4Address', address.address);
              _.set(device, 'ipv4Netmask', address.netmask);
            }
          });

          return cbWater(null);
        },
      ], (errWaterfall) => {
        if (errWaterfall) {
          return cbMap(null);
        }

        return findUsbDeviceUevent(devPath, (errFindUsb, prefix, usbDevice) => {
          if ((errFindUsb) || (!usbDevice)) {
            return cbMap(null, device);
          }

          _.merge(device, usbDevice);

          return async.waterfall([
            (cbWater) => {
              fs.readFile(`${devPath + prefix}/manufacturer`, 'utf8', (err, manufacturer) => {
                if ((!err) && (manufacturer)) {
                  _.set(device, 'manufacturer', manufacturer.trim());
                }
                return cbWater(null);
              });
            },
            (cbWater) => {
              fs.readFile(`${devPath + prefix}/product`, 'utf8', (err, product) => {
                if ((!err) && (product)) {
                  _.set(device, 'product', product.trim());
                }
                return cbWater(null);
              });
            },
          ], () => cbMap(null, device));
        });
      });
    }, (err, _devices) => {
      // remove empty values
      const devices = _devices.filter(n => ((n !== undefined) && (n !== null)));
      return done(null, devices);
    });
  });
}

function findInputDevices(usbDevs, searchPath, done) {
  glob(searchPath, (errGlob, files) => {
    if ((errGlob) || !(files) || (files.length === 0)) {
      return done(null);
    }

    return async.map(files, (devPath, cbMap) => {
      const device = {
        path: devPath,
        class: 'input',
      };

      async.waterfall([
        (cbWater) => {
          // the input device will use an event device to deliver events (keycodes).
          // read the folder items to determine which eventx hadler to publish.
          fs.readdir(devPath, (err, items) => {
            if (err) {
              return cbWater(err);
            }
            const eventString = items.find(element => (element.startsWith('event')));

            if (eventString) {
              device.device = `/dev/input/${eventString}`;
            }
            return cbWater(null);
          });
        },
      ], (errWaterfall) => {
        if (errWaterfall) {
          return cbMap(null);
        }

        return findUsbDeviceUevent(devPath, (errFindUsb, prefix, usbDevice) => {
          if ((errFindUsb) || (!usbDevice)) {
            return cbMap(null, device);
          }

          _.merge(device, usbDevice);

          return async.waterfall([
            (cbWater) => {
              fs.readFile(`${devPath + prefix}/manufacturer`, 'utf8', (err, manufacturer) => {
                if ((!err) && (manufacturer)) {
                  _.set(device, 'manufacturer', manufacturer.trim());
                }
                return cbWater(null);
              });
            },
            (cbWater) => {
              fs.readFile(`${devPath + prefix}/product`, 'utf8', (err, product) => {
                if ((!err) && (product)) {
                  _.set(device, 'product', product.trim());
                }
                return cbWater(null);
              });
            },
          ], () => cbMap(null, device));
        });
      });
    }, (err, _devices) => {
      // remove empty values
      const devices = _devices.filter(n => ((n !== undefined) && (n !== null)));
      return done(null, devices);
    });
  });
}

function findOnBoardDevices(done) {
  if (!_.hasIn(spark, 'hardwareSearchList')) {
    return done(null, []);
  }

  const usbDevs = usb.getDeviceList();

  return async.map(spark.hardwareSearchList, (item, cb) => {
    switch (item.class) {
      case 'tty': {
        return findTtyDevices(usbDevs, item.searchPath, (err, devices) => cb(err, devices));
      }
      case 'net': {
        return findNetDevices(usbDevs, item.searchPath, (err, devices) => cb(err, devices));
      }
      case 'input': {
        return findInputDevices(usbDevs, item.searchPath, (err, devices) => cb(err, devices));
      }
      default: {
        return cb(`Unsupported class ${item.class}`);
      }
    }
  },
  (err, _devices) => {
    if (err) {
      return done(err);
    }

    // remove empty values
    const devices = _devices.filter(n => ((n !== undefined) && (n !== null)));
    return done(err, _.flatten(devices));
  });
}

function updateHardware(done) {
  async.waterfall([
    (cb) => {
      findOnBoardDevices((err, devices) => {
        if (err) {
          log.debug(err);
        }

        return cb(null, devices);
      });
    },
    (hardware, cb) => {
      // check if anything changed from last time
      if (_.isEqual(currentHardware, hardware)) {
        // no changes
        return cb(null, null);
      }

      log.debug(hardware, 'Found spark hardware');

      // the list of modules changed so update the list
      currentHardware = _.cloneDeep(hardware);

      return cb(null, hardware);
    },
  ],
  (err, hardware) => {
    if (err) {
      // ignore errors and continue
      log.warn(err);
      return done(null);
    }

    if (!hardware) {
      return done(null, info);
    }

    // clear any existing hardware configuration
    return conf.clear('hardware', (errClear) => {
      if (errClear) {
        return done(errClear);
      }

      // save the details of the spark hardware we found
      return conf.set('hardware', hardware, (errSet) => {
        if (errSet) {
          return done(errSet);
        }

        return done(null, info);
      });
    });
  });
}

function pollForUpdates() {
  hardwarePollTimer = setInterval(() => {
    updateHardware((err) => {
      if (err) {
        log.error(err);
      }
    });
  }, hardwarePollTime);
}

sparkHWDetect.start = function start(modules, done) {
  log = modules['spark-logging'].exports.getLogger(pkg.name);
  conf = modules['spark-config'].exports;

  updateHardware((err, res) => {
    pollForUpdates();

    if (err) {
      return done(err);
    }
    log.info('Started', pkg.name);
    return done(null, res);
  });

  // initialize the list of currently mounted drives
  mountedDrives = getMountedDrives();

  // begin polling to detected mounted or unmounted drives
  pollForMountedDrives();
};

module.exports = sparkHWDetect;
