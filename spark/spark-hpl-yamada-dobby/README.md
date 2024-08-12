# spark-hpl-yamada-dobby#
A Hardware Protocol Layer (HPL) for Yamada Dobby V-Link protocol over serial.

This is a request/response protocol.

## Current state
 - In req/res mode we expect each request to be a single variable, and to get a guaranteed response for each request.

## For future updates
- Support extra types e.g. DateTime, Boolean, possibly arrays?
- Re-connection support

## Configuration

### Variables
This module relies on being passed the contents of the configuration file of the Yamada Dobby machine utilizing this module for it to determine which variables to read
from.

An example 16 bit variable looks like this:

```javascript
{
    "name": "DSPM",
    "description": "DISPLAY SPM",
    "requestKey": "010208360000000000",
    "format": "uint16"
}
```

Another example to access the single highest bit of a 16bit word as a boolean will look like this:

```javascript
{
    "name": "OnStatus",
    "description": "On Status",
    "requestKey": "010208360000000000",
    "format": "bool"
    "bitRead": 15
}
```

You can access the processed 'Alarm' information via a variable with the _alarmVariable_ property set to _true_:

```javascript
{
    "name": "alarm",
    "description": "Alarm",
    "format": "int16"
    "alarmVariable": true
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the string response data into.
requestKey | The string key to send over serial to get this variable as a response.
bitRead | When requiring a bool format, which bit of the 16 bit word to use.
alarmVariable | When set to true, the processed alarm data is retrieved from a set address region. The requestKey property is ignored for this type of variable. The format should be set to 'int16'.

### Settings

All variables in the config are read sequentially, in your machine you should use a setting in the config file to determine the delay between each complete read cycle.

Please see the spark-machine-yamada-dobby-2.json for a full example.
See [spark-machine-yamada-dobby-2.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines/browse/yamada-dobby/spark-machine-yamada-dobby-2.json) in the [spark-machines](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines) repository for a full example.

