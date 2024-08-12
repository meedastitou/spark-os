# spark-hpl-virtual

A Hardware Protocol Layer (HPL) for virtual Machines. This module is used to create new 'virtual' variables from any other machines source variables.

### Configuration
This module relies on being passed the contents of the configuration file of the virtual machine utilizing this module for it to determine which variables to create from which source variables.

Each virtual variables in the virtual machine can be tailored to:

- rename a source variable
- check an array of source variables and only produce a value when one of them changes from a known good state (successValue)

### Variables

An example virtual variable for looks like this:

```javascript
{
    "name": "error",
    "description": "Error",
    "format": "uint16",
    "srcVariables": [{
        "srcMachine": "spark-machine-dummy",
        "srcVariable": "error",
        "successValue": "success, from spark-machine-dummy"
    }, {
        "srcMachine": "spark-machine-dummy2",
        "srcVariable": "error",
        "successValue": "success, from spark-machine-dummy2"
    }]
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field       | Description
----------- | ------------------------------------------------------------------------------------------------
name        | A short text string to reference the variable by
description | A longer description of the variable
format      | The format of the data, one of bool, int16, uint16, float, int32, char.
srcVariables | Array of one or more sources (machine + variable). Also requires a 'successValue' to indicate the value to ignore (the non-error state value)

--------------------------------------------------------------------------------------------------------------
SPARK-1621:  Added TWO variable-types:
'Variable Update Alert':  New logic works as follows:
- Add a new Virtual operation to our spark-hpl-virtual protocol: Variable Update Alert
-	This operation would have a source variable(s) that would be monitored for a change.  When a change is seen, the variable for this operation would
  be set to true.  After a specified period of time, it would be set to false.
-	In addition to this source variable, we would add the following fields for the operation:
  -	Variable Update Alert Timeout: The length of time (in seconds) to hold the Alert Variable as true (after seeing its Source Variable change) until reverting to false.


'SQL-reference':  New logic works as follows:
-	Add a new Virtual operation to our spark-hpl-virtual protocol: SQL-reference
-	This operation would have a source variable that would feed data into the virtual machine – in this particular case, this data would come from a barcode reader.
-	In addition to this source variable, we would add the following fields for the operation:
  -	SQL Server Name: The name (or IP address) of the server to connect to.
  -	SQL Port: The port number of the SQL database to connect to.
  -	SQL Database Name: The name of the SQL database.
  -	SQL Table Name: The name of the SQL database table.
  -	SQL Username: The username to access the SQL database.
  -	SQL Password: The password to access the SQL database.
  -	SQL Column Name: The name of the column to use for querying against the data received from the Source Variable
-	The operation would be that when data is received for the Source Variable, we would establish a connection to the SQL database and query against the Column Name for the data we received.  Such as:
  -	SELECT * FROM SQL-Table-Name WHERE SQL Column Name LIKE Source-variable-data
-	If we find the string, the virtual machine variable will be set to TRUE.  Otherwise, FALSE.
--------------------------------------------------------------------------------------------------------------
