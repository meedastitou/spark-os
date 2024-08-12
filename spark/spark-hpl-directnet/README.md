# spark-hpl-scada#
A Hardware Protocol Layer (HPL) for acquiring data from DirectLOGIC DL405 and DL205 controllers using the DirectNET protocol

## Current state
 - Initial version

## For future updates

## Configuration

### Variables
This module relies on variables specifying an octal address, whether the variable is a memory variable, and input or an output, and for inputs and outputs whether to use the most significant byte or the least significant byte.
For inputs and outputs, the address may end with an optional ".n", where a n is a digit between 0 and 7 indicating a bit position (0 being the LSB).

An example DirectNet variable looks like this:

```javascript
{
    "name": "Input Status Bit",
    "description": "An input status bit",
    "format": "boolean",
    "address": "40400.0",
    "type": "input",
    "bytePos": "LSB"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the response data into
address | The V-Memory address of the variable's values, with and optional ".n" to indicate a bit position within a byte
type | Whether the variable is a memory value, an input, or an output
bytePos | For input and outputs, where the byte in the most or least significant portion of the word is to be used

### Settings

## Regex notes
