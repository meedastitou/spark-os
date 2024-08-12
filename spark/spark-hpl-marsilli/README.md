# spark-hpl-marsilli#
A Hardware Protocol Layer (HPL) for acquiring data from Marsilli machines

## Current state
 - Initial version

## For future updates

## Configuration

### Variables
This module relies on variables of the following four types:
 - Raw Data: a byte offset into the data sent by the Marsilli machine must be provided
 - Alarm Code: a unit number of the alarm code desired must be provided

An example raw data variable looks like this:

```javascript
{
    "name": "spindle",
    "description": "Spindle used for part on carrier",
    "format": "uint8",
    "byteOffset": 29
}
```
If the raw data variable is a string, then the format should be set to char and a length field added:

```javascript
{
    "name": "part-number",
    "description": "Part number",
    "format": "char",
    "length": 11,
    "byteOffset": 10
}
```
An example of an alarm code variable looks like this:

```javascript
{
    "name": "unit-1-alarm-code",
    "description": "Unit 1 Alarm Code",
    "unitNumber": 1
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the response data into
byteOffset | For raw data variables, the byte offset at which the data for the variable begins
unitNumber | For alarm code variables, the unit number (1-15) if the desired alarm code

### Settings

## Regex notes
