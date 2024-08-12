# spark-hpl-opcua
A Hardware Protocol Layer (HPL) for reading variables from an OPC-UA servers

### Configuration
This module relies on being passed the contents of the configuration file of the OPC-UA machine utilizing this module for it to determine which variables to read from.

This OPC-UA client can be run in two different modes, set by the 'scheme' setting
- req/res The client requests variable data periodically based on a 'request frequency'
- pub/sub The client subscribes to all variables and receives notification when they change

### Unsupported Features

Currently this module relies on knowing the node id's of each variable of interest on the OPC-UA server. It does not discover nodes by browsing. There is a seperate stand-alone Node.js app that can be run to discover all the variables on a server. See here https://makemake.tycoelectronics.com/stash/users/te192184/repos/opcua-browser/browse

Currently the OPC-UA client doesn't support the addition of using certificates and security.

### Variables

An example OPC-UA variable looks like this:

```javascript
{
    "name": "temp",
    "description": "Temperature",
    "format": "float",
    "nodeId": "ns=3;s=MainsVoltageLow.Quality",
    "array": "false"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field                 | Description
--------------------- | ------------------------------------------------------------------------------------------------
name                  | A short text string to reference the variable by
description           | A longer description of the variable
nodeId                | The OPC-UA node id of the variable, discovered by browsing the OPC-UA server
format                | The format of the data, one of bool, int16, uint16, float, int32, char.
array                 | Data can be arrays, you must set the  array property of the variable for this to be handled correctly.
destination variables | An optional list of variables to be created with the values at specified indexes of the array, if the parent variable is an array
