# spark-hpl-ethernetip#
A Hardware Protocol Layer (HPL) for acquiring data using the Ethernet/IP

## Current state
 - Initial version

## For future updates

## Configuration

### Variables
This module relies on variables specifying whether a PLC variable or attribute is to be read.

An example Ethernet/IP variable looks like this:

```javascript
{
    "name": "Counter",
    "description": "A counter variable",
    "format": "uint16",
    "requestType": "variable",
    "controllerVariable": "COUNT"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the string response data into.
requestType | Contains the string enum representing whether to request a variable or a specified attribute
controllerVariable | Contains the name of the PLC variable, if requestType is "variable"

### Settings

## Regex notes
