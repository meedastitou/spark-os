# spark-hpl-mlan#
A Hardware Protocol Layer (HPL) for acquiring data from Dri-Air ADC controlled dryers.

## Current state
 - Initial version

## For future updates

## Configuration

### Variables
This module relies on variable of 3 types: general commands, temperature requests, and periodic temperature values.  General commands require a command name and can read and write values, temperature requests require a temperature descriptor and are read-only, and periodic temperature values require the index of the desired temperature in the periodic temperature report and are read-only.

An example general command variable looks like this:

```javascript
{
    "name": "dew-point",
    "description": "Dew Point",
    "format": "float",
    "commandName": 'DEW',
    "access": 'read'
}
```

An example temperature request variable looks like this:

```javascript
{
    "name": "pr1-temp",
    "description": "Process Temperature Hopper 1",
    "format": "float",
    "temperatureDescriptor": 'PR1'
}
```
An example periodic temperature value variable looks like this:

```javascript
{
    "name": "internal-temp-1",
    "description": "Internal Temperature 1",
    "format": "float",
    "temperatureIndex": 0
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type of the desired value
commandName | The name of the command used to read or write values for general command variables
temperatureDescriptor | The descriptor of the temperature value to be read for temperature request variables
temperatureIndex | The index of the temperature to be read for periodic temperature value variables

### Settings

## Regex notes
