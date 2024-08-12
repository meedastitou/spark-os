# spark-hpl-secs-gem#
A Hardware Protocol Layer (HPL) for acquiring data from machines using the SECS/GEM protocol

## Current state
 - Initial version

## For future updates

## Configuration

### Variables
This module relies on variables of the following four types:
 - Equipment Constant: a numeric equipment constant ID and format must be provided
 - Status Variable: a numeric status variable ID and format must be provided
 - Active alarm codes: this is an array variable containing all active alarm codes
 - Active alarm texts: this is an array variable containing the texts of all active alarms

An example SECS/GEM variable looks like this:

```javascript
{
    "name": "Spool Count Actual",
    "description": "The actual spool count",
    "format": "int16",
    "type": "statusVariable",
    "numericID": 8
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the response data into
type | Whether the variable is an equipment constant, status variable, active alarm codes array, or active alarm texts array
numericID | For equipment constants and status variables, the numeric ID identifying the machine value

### Settings

## Regex notes
