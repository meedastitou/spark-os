# spark-hpl-mlan#
A Hardware Protocol Layer (HPL) for acquiring data from controllers using the MLAN protocol

## Current state
 - Initial version

## For future updates

## Configuration

### Variables
This module relies on variables that define the command code, byte offset, and format of the desired data.

An example variable looks like this:

```javascript
{
    "name": "temperature",
    "description": "Temperature in 0.1 degrees C",
    "format": "uint16",
    "commandCode": 74,
    "byteOffset": 2
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type of the desired value, which also specifies the number of bytes for non-string data
commandCode | The command code to send to retrieve the desired data
byteOffset | The byte offset in the response at which the data for the variable begins

### Settings

## Regex notes
