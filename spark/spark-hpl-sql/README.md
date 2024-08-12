# spark-hpl-sql#
A Hardware Protocol Layer (HPL) for acquiring data from an SQL database.

## Current state
 - Initial version

## For future updates

## Configuration

### Variables
This module relies on variables that define an SQL select query to set the variable's value.  These variables are read-only. The variables are updated when a change in the number of rows is detected.

An example variable looks like this:

```javascript
{
    "name": "thickness",
    "description": "Thickness",
    "format": "float",
    "column": "Thickness",
    "orderBy": "Time",
    "order": "Descending",
    "where": "Thickness > 0 AND Width > 0"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name   | A short text string to reference the variable by
description | A longer description of the variable
format  | The Spark HPL data type of the desired value
column  | The name of column in the SQL table to read.
orderBy | The name of the column by which rows should be sorted.  The value from first included row is retrieved.
order   | The order (Ascending or Descending) by which the rows should be sorted. The value from first included row is retrieved.
where   | An optional conditional statement that controls which rows in the SQL table to include in the query.  If omitted, all rows are included.
array   | If this optional field is true, an array of values is returned. Otherwise the first value is returned.
length  | If array is true this optional field specifies how many values are returned.  Otherwise, all values are returned.

### Settings

## Regex notes
