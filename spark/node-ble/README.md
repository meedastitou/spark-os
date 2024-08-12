# node-ble #

The node-ble module acts as a wrapper for the noble bluetooth low energy (BLE) node.js module, allowing for multiple devices to be detected, and for multiple modules to access the adverts of available BLE devices.

It outputs an object containing the currently available BLE devices as an event which can be read by any modules which require this one.

## Using the module: ##

To use the node-ble module, require it as with any other node module.

To get a list of devices from the module, you register a listener for a 'newList' event as so:

```
let nodeBle = require('node-ble');
let deviceList = {};


//Example callback function
function callback(list)
{
  deviceList = list;
}

//Start the module
nodeBle.start();

//Register a listener
nodeBle.on('newList', callback);
```

To close down the module:

```
// Unsubscribe from the newList events
nodeBle.removeListener('newList', callback);


nodeBle.stop();
```

This module makes use of a resource counter, as a number of different module may call it, and so the module won't properly shut down (i.e. stop noble from scanning) until the last module calling this one has told it to shut down.
