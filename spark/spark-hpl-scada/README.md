# spark-hpl-scada#
A Hardware Protocol Layer (HPL) for acquiring data from a SCADA machine (Simple Object Access Protocol).

## Current state
 - Initial version

## For future updates

## Configuration

### Variables
This module relies on variables specifying a request key to determine which item of data to read from a record of SCADA data.

An example ABS Colil variable looks like this:

```javascript
{
    "name": "State",
    "description": "The SCADA state",
    "format": "char",
    "requestKey": "State"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the string response data into.
requestKey | The name of the data item to retrieve in the select record of the SCADA data

### Settings

## Regex notes
