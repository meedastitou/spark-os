const path = require('path');
const pkg = require(path.join(__dirname, 'package.json'));
const EventEmitter = require("events").EventEmitter;

let devices = {}; // Object to store list of found devices.
const removalTime = 30 * 1000; // time a device stays in the list before needing to be
// rediscovered in milliseconds.

let resourceCounter = 0;
var noble = require('noble');
var nodeBle = new EventEmitter();
let scanningStarted = false;

/* Internal functions, only called within the module. */

/* Add any found devices to the array of devices. Automatically updates the
   device details if they change, ensuring the most recent information is
   published. */
function publishList(peripheral) {
    /* Temporary variable to store the information of the current detected
       device before adding it to the list of devices. */
    let currentDevice = {
        id: peripheral.id,
        address: peripheral.address,
        connectable: peripheral.connectable,
        rssi: peripheral.rssi,
        localName: peripheral.advertisement.localName,
        advertisement: peripheral.advertisement,
        timeDiscovered: Date.now()
    };

    devices[currentDevice.id] = currentDevice;

    removeOldDevices(devices);

    nodeBle.emit('newList', devices);
}

/* Function to remove inactive devices. */
function removeOldDevices(devices) {
    /* Iterates through all registered devices and check the time elapsed
       since they last broadcast any information. If it's longer than the
       time set in the 'removalTime' variable, it removes them from the
       list. */
    for (var id in devices) {
        let timeDiff = (Date.now() - devices[id].timeDiscovered);

        if (timeDiff >= removalTime) {
            delete devices[id];
        }
    }
}

/* Callback function used to add a stateChange listener, and also as a reference
   to remove the listener when the stop function is called. Starts noble
   scanning and published the list for any calling module(s) to receive. */
function startScan(state)
{
  if (state === 'poweredOn') {
      noble.startScanning([], true);
      scanningStarted = true;
      noble.on('discover', publishList);
  } else {
      noble.stopScanning();
  }
}

/* External functions -exported by the module and called by any modules
                    implementing this one. */
nodeBle.start = function() {
    if (resourceCounter === 0) {
      resourceCounter++;
          /* Initial Scan */

          // if already powered on
          if (noble.state === 'poweredOn') {
              // it is safe to start scanning
              noble.startScanning([], true);
              scanningStarted = true;
              noble.on('discover', publishList);
          }

          // register for state changes
          noble.on('stateChange', startScan);
          }
      else
      {
        resourceCounter++;

        /* Subsequent scans */
        if (noble.state == 'poweredOn' && (!scanningStarted)) {
            noble.startScanning([], true);

            noble.on('discover', publishList);
        }
      }
};

nodeBle.stop = function() {

    resourceCounter--;

    if (resourceCounter === 0) {
      /* Additional protection to stop stopScanning being called multiple times. */
      if(scanningStarted)
      {
          noble.stopScanning();
          noble.removeListener('stateChange', publishList);
          noble.removeListener('discover', publishList);
          scanningStarted = false;
      }
    }
};

module.exports = nodeBle;
