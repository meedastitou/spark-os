# spark-hpl-euromap63
A Hardware Protocol Layer (HPL) for reading CSV files

## Configuration
### Variables
This module relies on being passed the contents of the configuration file of the CSV machine utilizing this module for it to determine which variables to read.

An example CSV variable declaration looks like this:

```javascript
{
    "name": "Counter",
    "description": "Machine Cycle Counter",
    "format": "int16",
    "rowPosition": "First after Header",
    "columnPosition": "Match Name",
    "matchName": "screwSpeed",
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field          | Description
-------------- | ------------------------------------------------------------------------------------------------
name           | A short text string to reference the variable by.
description    | A longer description of the variable.
format         | The format of the data, this will generally determine the data length read. i.e. Byte is 8 bits.
rowPosition    | The row from which to read the value: 'First', 'Last', 'First after Header', or 'Specific Row'
specificRow    | If rowPosition is 'Specific Row', the number of the row from which to read the value
columnPosition | The column from which to read the value: 'Match Name' or 'Specific Column'
matchName      | If columnPosition is 'Match Name', the name of the column in the header from which to read the value
specificColumn | If columnPosition is 'Specific Column', the number of the column from which to read the value

### Settings
The CSV module requires an ethernet connection between Spark and the slave device.

The config options include the WebDAV URL where the CSV file resides, the CSV filename, the CSV read time, and the separator used to parse lines in the CSV file

### Example
