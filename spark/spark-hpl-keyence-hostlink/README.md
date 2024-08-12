# spark-hpl-keyence-hostlink

A Hardware Protocol Layer (HPL) for the Keyence Machine using Host Link protocol.

Operates in either Ethernet or Serial mode.

TODO Re-write below for Keyence

In Ethernet mode, a physical Keyence device acts as a server, with Spark connecting to it as a client.

## Current state
- All data from Keyence is strings representing decimal integers. If 32 bit data is requested it may need to word swapped.
- Only the RD command is supported, which allows read only access to the memory areas of the machine
- Parity is assumed to be 'even' in serial mode

## Configuration

### Variables
This module relies on being passed the contents of the configuration file of the Keyence machine utilizing this module for it to determine which variables to read
from.

An example Keyence variable looks like this:

```javascript
{
  "name": "good-products",
  "description": "Good product count",
  "format": "uint16",
  "memoryArea": "DM"
  "address": "100"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the string response data into.
memoryArea | Contains the string enum representing the memory area to read from
address | Contains the  address to read data from within the selected memory area


### Settings

Data can be requested from the Keyence machine at a rate specified by the 'requestFrequency' property.
