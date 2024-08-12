# spark-hpl-srtp#
A Hardware Protocol Layer (HPL) for acquiring data from a machine employing the SRTP Protocol

## Current state
 - Initial version

## For future updates

## Configuration

### Variables
This module relies on variables specifying a memory area and address to determine which item of data to read.

An example SRTP variable looks like this:

```javascript
{
    "name": "Register 110",
    "description": "The 110 Register",
    "format": "uint16",
    "memoryArea": "%R",
    "address": "110"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the string response data into.
memoryArea | Contains the string enum representing the memory area to read from
address | Contains the address to read data from within the selected memory area

### Settings

## Regex notes
