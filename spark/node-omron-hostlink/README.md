# node-omron-hostlink

This is a an implementation of the Omron FINS command protocol running over serial using Host Link.

Host Link refers to the addition of Host Link Headers and Footers to the FINS command and the fact that the whole payload is ascii encoded.
It is designed to be sent over a serial interace, which is how it is used here.

There is also an additional serial mode, where the FINS command is replace by the simpler Host Link command. The mode to use for serial is set by the finsMode flag. If set to 'false' it will use 'Hostlink (C-mode)' if 'true' then it iwll use'FINS (CV-mode)'.

## Features

Not all memory area reads have been tested. In FINS mode only DM and IR memory areas are supported currently. In Hostlink mode, more memory areas are allowed, but only DM and IR have been tested.

## Usage

The API has been kept as close a possible to the existing node-omron-fins module, as both are expected to be called from the spark-hpl-omron-fins.

```javascript
var hostlink = require('node-omron-hostlink');

var serialOptions = {};
serialOptions.baudRate = 9600;
serialOptions.dataBits = 7;
serialOptions.stopBits = 2;
serialOptions.parity = 'even';
serialOptions.timeout = 500;

// create a client (opening the specified serial port, with specified options) and chosing the Hostlink (C-mode)
var client = new hostlink('/dev/ttyUSB0', false, serialOptions);

// subscribe to events from module
client.on('error', clientErrorHandler);
client.on('reply', clientReplyHandler);
client.on('timeout', clientTimeoutHandler);

// send a request to read a single 16 bit word from address 0100 from the DM memory area
client.read('DM0100', 1, function(err) {
    if (err) {
        log.error(err);
    }
});

// send a request to read a single bit (bit 02) from address 010 from the IR memory area
client.read('IR010.02', 1, function(err) {
    if (err) {
        log.error(err);
    }
});

// unsubscribe to events from module
client.removeListener('error', clientErrorHandler);
client.removeListener('reply', clientReplyHandler);
client.removeListener('timeout', clientTimeoutHandler);

// close client
client.close();

function clientReplyHandler(msg) {
    // should return an array of 1 or more 16 bit values (or single bit values if the memory is address via bit addressing e.g. 'IR010.02').
    if(msg) {
        // print each array value returned
        msg.values.forEach(function(value) {
            console.log(value);
        });
    }
}

function clientErrorHandler(err) {
    // log any errors we get
    log.error(err);
}

function clientTimeoutHandler() {
    // log any timeouts we get
    log.error("Timeout for read request");
}
```
