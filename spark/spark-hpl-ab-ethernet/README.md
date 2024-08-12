# spark-hpl-ab-ethernet
A Hardware Protocol Layer (HPL) for the Allen Bradley Ethernet Protocol

### Configuration
This module relies on being passed the contents of the configuration file of the Allen Bradley Ethernet machine utilizing this module for it to determine which variables to read from.

This HPL relies on the [nodes7](https://www.npmjs.com/package/nodepccc) whose description declares a number of caveats:

Currently the hpl API does not support routing parameters, so will not work with PLC that require these e.g. ControlLogix

### Variables

An example Allen Bradley Ethernet variable looks like this:

```javascript
{
    "name": "temp",
    "description": "Temperature",
    "address": "F8:1",
    "format": "float"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field       | Description
----------- | ------------------------------------------------------------------------------------------------
name        | A short text string to reference the variable by
description | A longer description of the variable
address     | The s7 address of the variable in the form ` <type specifier><file number - I assumed 1, O assumed 0, S assumed 2>:<element>[</bit> or </DN, /EN, /TT> or <.ACC, .PRE>],array length`
format      | The format of the data, one of bool, int16, uint16, float, int32, char.

Note data can be arrays, you must set the optional array property of the variable for this to be handled correctly.
