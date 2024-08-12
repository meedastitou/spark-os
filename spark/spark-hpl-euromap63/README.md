# spark-hpl-euromap63
A Hardware Protocol Layer (HPL) for Euromap63

## Configuration
### Variables
This module relies on being passed the contents of the configuration file of the Euromap63 machine utilizing this module for it to determine which variables to read.

An example Euromap63 variable declaration looks like this:

```javascript
{
    "name": "Counter",
    "description": "Machine Cycle Counter",
    "format": "int16",
    "reportName": "COUNT"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field       | Description
----------- | ------------------------------------------------------------------------------------------------
name        | A short text string to reference the variable by.
description | A longer description of the variable.
reportName  | The field name to use for matching the requested variable in the response file.
format      | The format of the data, this will generally determine the data length read. i.e. Byte is 8 bits.

### Settings
The Euromap63 module requires an ethernet connection between Spark and the slave device.

The config options include the port number to use for listening for the incoming ftp request.

### Example
