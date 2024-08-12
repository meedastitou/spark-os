# spark-hpl-yokogawa

A Hardware Protocol Layer (HPL) for the Yokogawa Machine.

Operates in either Ethernet or Serial mode.

In Ethernet mode, a physical Yokogawa device acts as a server, with Spark connecting to it as a client. This HPL only supports the 'ascii' version of the ethernet interface, and not the 'raw' mode. Either 'Port A' or 'Port B' can be used, whichever port is chosen that port will need be set to 'ascii' mode on the Yokogawa machine.

## Current state
- All data from Yokogawa is hex encoded integers (or bit based booleans encoded as '0' or '1'). Word ordering is slightly unsual, 32 bit integers need to be word swapped. There is currently no support for correctly word swapping 64bit integers.

- currently the checksum (in serial mode) is not checked on responses from the Yokogawa Machine.

- Currently only WRD and BRD commands have been tested

## Configuration

### Variables
This module relies on being passed the contents of the configuration file of the Yokogawa machine utilizing this module for it to determine which variables to read
from.

An example Yokogawa variable looks like this:

```javascript
{
  "name": "good-products",
  "description": "Good product count",
  "format": "uint32",
  "requestKey": "WRDD7006,02"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the string response data into.
requestKey | Contains the variables 3 character command type e.g WRD, its address e.g. D7006, and then the number of them to get (seperated with a comma).

The following table describes the possible commands in the request key

Command  | Description
----- | -----------
BRD | Read Bit(s) command
WRD | Read Word(s) command

The comma seperated length field in the request key should be set to correspond to the number of 16 bit words required for the variable. e.g. for a variable with a format of uint32, the length should be set to 2.

### Settings

Data can be requested from the Yokogawa machine at a rate specified by the 'requestFrequency' property.

See the [yokogawa-demo-v2.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines/browse/yokogawa/yokogawa-demo-v2.json) in the [spark-machines](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines) repository for a full example.
