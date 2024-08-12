# node-s7-serial

This module implements the PPI and MPI protocols over a serial interface.

PPI is used on Siemens S7-200 and MPI on Siemens S7-300 and s7-400

## Features
Supports Bit, Word, and Double Word access of most memory areas available on these PLC's.

Memory accesses can be formated as either signed, unsigned, floating point or boolean.

__NOTE__ that currently a maximum of 20 variables can be added (by repeatedly calling addItems). After this additional variables will be rejected. This limit is set due to the fact that the protocols can only handle a maximum of 20 requests in a single exchange. A small amount of further work could be easily done to manage multiple exhanges when the 20 request limit is reached.

## Memory Areas S7-200

Area Code | Description
----------|-------------
I | Process-image Input Register
Q | Process-image Output Register
M | Bit Memory Area
V | Variable Memory Area
C | Counter Memory Area
T | Timer Memory Area
AI | Analog Inputs
AQ | Analog Outputs

## Memory Areas S7-300

Area Code | Description
----------|-------------
I | Process-image Input Register
Q | Process-image Output Register
M | Bit Memory Area
DB | Data Block Memory Area
DI | Instance Data Blocks (NOT TESTED)
L | Local Data (NOT TESTED)
C | Counter Memory Area
T | Timer Memory Area


## Example Memory Addresses
Most of the memory areas of the S7-200 and S7-300 are formed of a one or two character memory area code, followed by a length code. For most access types the length code is missing if the access is intended to be of the 'bit' type. A decimal address follows, and then (if it is a bit access) a 'dot' and then a bit address (0-7).

Address | Description
--------|------------
Q10.1 | Read bit 1 of byte 10 in the Q memory area
IB20 | Read a byte at address 20 of the I memory area
MW25 | Read a 16 bit word at address 25 of the M memory area
QD40 | Read a 32 bit double word at address 40 of the Q memory area

## DB and DI  Memory Addresses on the S7-300

The DB and DI areas are slightly different in that they also have an additional bank address associated with them. Also they use an 'X' as the length code for a bit, rather than no length code.

Address | Description
--------|------------
DB100.DBX10.1 | Read bit 1 of byte 10 in the 100th block of the DB memory area
DB50.DBW30 | Read a 16 bit word at address 50 of the 50tj block of teh DB memory area

__NOTE:__  The addressing string descibed here differs from the one utilized in the nodes7 module used when in ethernet mode. That interface is descibed here https://github.com/plcpeople/nodeS7

## Usage

The API has been kept as close a possible to the existing node-s7 module, as both are expected to be called from the spark-hpl-siemens-s7. Here is an example to configure for the PPI protocol.

```javascript
var nodeS7Serial = require('node-s7-serial');


var protocolMode = 'PPI';
var device = '/dev/ttyUSB0';
var baudRate = '9600';
var parity = 'EVEN';
var mpiMode = null;
var mpiSpeed = null;

client = new nodeS7Serial.constructor(protocolMode, device, baudRate, parity, mpiMode, mpiSpeed);

// start a new connection
client.initiateConnection(function(err){

    if (err) {
        log.error(err);
        return;
    }

    // add a read item to list to read a bit from bit 2 of address 10 in the 'M' Memory Area and treat repsonse as a boolean
    client.addItems("M10.2", nodeS7Serial.constants.FORMAT_BOOL);

    // add a read item to list to read a word at address 4 in the 'AI' Memory Area and treat repsonse as a signed number
    client.addItems("AIW4", nodeS7Serial.constants.FORMAT_SIGNED);

    // now read all items in the added list
    client.readAllItems(function(err, resultObject) {

        if (err) {
            log.error(err);
            return;
        }

        // get the results from the returned result object using the variables address as the key
        console.log(resultObject["M10.2"]);
        console.log(resultObject["AIW4"]);

        // close the connection once done
        client.dropConnection(function(){
            console.log("Connection Dropped");
        });
    }
});


```
