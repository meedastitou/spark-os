# spark-hpl-soap#
A Hardware Protocol Layer (HPL) for acquiring MES data via SOAP (Simple Object Access Protocol).

## Current state
 - Initial version

## For future updates

## Configuration

### Variables
This module relies on variables specifying a request key to determine which "column" of data to read from the MES system.

An example MES variable looks like this:

```javascript
{
    "name": "Article",
    "description": "The article MES value",
    "format": "char",
    "requestKey": "ARTICLE"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the string response data into.
requestKey | The "column" in the MES "table" where the value should be read

### Settings

## Regex notes
