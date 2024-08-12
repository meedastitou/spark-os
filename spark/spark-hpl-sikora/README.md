# spark-hpl-sikora

A Hardware Protocol Layer (HPL) for the Sikora measurement and control device.

Operates in Serial mode only.

## Current state

## Configuration

### Variables
This module relies on being passed the contents of the configuration file of the Sikora machine utilizing this module for it to determine which variables to read
from.

An example sikora variable looks like this:

```javascript
{
    "name": "Monitor1",
    "description": "Capacitance (Cold)",
    "format": "int16",
    "charOffset": 6,
    "charLength": 5
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the string response data into.
charOffset | The number of characters offset from the start of the payload where this variable's data is located.
charLength | The number of characters that make up this variable's data.


### Settings

Data can be requested from the Sikora machine at a rate specified by the 'requestFrequency' property.
