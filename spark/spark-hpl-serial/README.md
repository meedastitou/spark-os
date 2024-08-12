# spark-hpl-serial#
A Hardware Protocol Layer (HPL) for serial to simplfy the creating of any serial interfaced machines.

Both request/response and publish/subscribe methodologies are handled.

## Current state
 - Subscribes are assumed not necessary when in pub/sub mode.
 - In pub/sub mode we expect a list of ALL data variables back for each publish in a single line terminated by a carriage return.
 - In pub/sub variables can be extracted from the published data either by a regex or csv style (with customizable separator)
 - In req/res mode we expect each request to be a single variable, and to get a guaranteed response for each request.

## For future updates
- Support extra types e.g. DateTime, Boolean, possibly arrays?
- Support for the subscription side of pub/sub.
- Re-connection support

## Configuration

### Variables
This module relies on being passed the contents of the configuration file of the serial machine utilizing this module for it to determine which variables to read
from.

An example serial variable using pub/sub and a regex to parse the response looks like this:

```javascript
{
    "name": "Count",
    "description": "The parts made counter",
    "regex": "count= ([^,]+)",
    "format": "int16"
}
```

An example serial variable using req/res for a SE-DUZ protocol looks like this:

```javascript
{
    "name": "Clamping_Force_Abnormal",
    "description": "Clamping Force Abnormal",
    "requestKey": "A408"
    "format": "double"
}
```

An example serial variable using req/res for a V-LINK protocol looks like this:

```javascript
{
    "name": "DSPM",
    "description": "DISPLAY SPM",
    "requestKey": "010208360000000000",
    "format": "uint16"
}
```

Another example serial variable using req/res for a V-LINK protocol to access the single highest bit of a 16bit word as a boolean will look like this:

```javascript
{
    "name": "OnStatus",
    "description": "On Status",
    "requestKey": "010208360000000000",
    "format": "bool"
    "bitRead": 15
}
```

An example serial variable using req/res for a Yokogawa protocol looks like this:

```javascript
{
  "name": "good-products",
  "description": "Good product count from Yokogawa PLC - Address D7006 in hex is 01B5E",
  "format": "uint32",
  "requestKey": "WRDD01B5E,02"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
regex | In pub/sub mode, the regular expression to be used to extract this variable from the published data. Require either this field or csvPos field.
csvPos | In pub/sub mode, the position in the published data for comma separated results (or separated with a custom separator). Require either this field or regex field.
requestKey | In req/res mode, the string key to send over serial to get this variable as a response must be formated as unicode as shown above.
format | The Spark HPL data type to convert the string response data into.
bitRead | In V-Link protocol when requiring a bool format, which bit of the 16 bit word to use.

### Settings

The Serial module can be configured for either pub/sub or req/res methodologies.

In req/res mode all variables in the config are read sequentially, in your machine you should use a setting in the config file to determine the delay between each complete read cycle.

Current protocols supported in the req/res mode are SE-DUZ, V-LINK and Yokogawa, more can be added by adding extra parsing code to create the specific request message, and decode the specific response message of each new protocol.

Please see the config.json file of the spark-machine-sumitomo-seduz for a full example.
See [spark-machine-sumitomo-seduz.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines/browse/serial/spark-machine-sumitomo-seduz.json) in the [spark-machines](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines) repository for a full example.

## Regex notes
Due to the regex having to be contained in a json formatted file, you will need to use a '\' escape sequence if you use '\' in your regular expression.
e.g.
```
"regex": "\, (.*?)\,",
```
needs to be changed to
```
"regex": "\\, (.*?)\\,",
```
