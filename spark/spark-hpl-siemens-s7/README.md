# spark-hpl-siemens-s7
A Hardware Protocol Layer (HPL) for the Siemens S7 Protocol.

This module supports S7 Ethernet mode and also the PPI and MPI protocols in Serial mode.

### Configuration
This module relies on being passed the contents of the configuration file of the Siemens S7 machine utilizing this module for it to determine which variables to read from.

In Ethernet mode this HPL relies on the [nodes7](https://www.npmjs.com/package/nodes7) module which has the following caveats:

_S7-1200 and S7-1500 CPU access requires access using "Slot 1" and you must disable optimized block access (in TIA portal) for the blocks you are using. In addition, you must "Enable GET/PUT Access" in the 1500 controller in TIA Portal. Doing so opens up the controller for other access by other applications as well, so be aware of the security implications of doing this._

_This has been tested only on direct connection to newer PROFINET CPUs and Helmholz NetLINK PRO COMPACT units. It SHOULD work with any CP that supports TCP as well, but S7-200/400/1200 haven't been tested. Very old CPUs have not been tested. S7 routing is not supported._

The serial mode is decribed in more detail [here](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/node-s7-serial/browse/README.md)

### Variables

An example Siemens S7 ethernet variable looks like this:

```javascript
{
    "name": "temp",
    "description": "Temperature",
    "address": "MW30",
    "format": "float"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field       | Description
----------- | ------------------------------------------------------------------------------------------------
name        | A short text string to reference the variable by
description | A longer description of the variable
address     | The s7 ethernet address of the variable in the form `<data block number.><memory area><data type><byte offset><.array length/bit length>` OR
address     | The s7 serial address of the variable in the form `<data block number.><memory area><byte offset><.bit address>`
format      | The format of the data, one of bool, int16, uint16, float, int32, char.

Note data can be arrays, you must set the optional array property of the variable for this to be handled correctly.
