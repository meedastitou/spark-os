# spark-hpl-mitsubishi-fx

A Hardware Protocol Layer (HPL) for the MitsubishiFx Computer Link protocol.

Operates in Serial or Ethernet mode.

## Current state
- All data from MitsubishiFx is strings representing decimal integers. If 32 bit data is requested it may need to word swapped.

## Configuration

### Variables
This module relies on being passed the contents of the configuration file of the MitsubishiFx machine utilizing this module for it to determine which variables to read
from.

An example Mitsubishi variable looks like this:

```javascript
{
  "name": "d110",
  "description": "D110",
  "format": "uint16",
  "memoryArea": "D"
  "address": "110"
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
address | Contains the address to read data from within the selected memory area


The following table describes the possible memory locations in the request key

Location  | Type | Description
--------- | ---- | -----------
X | Bit | Inputs
Y | Bit | Outputs
M | Bit | Auxiliary relays
S | Bit | States
TS | Bit | Timer contacts
CS | Bit | Counter contacts
D | Word16 | Data, File or Ram registers
TN | Word16 | Timer current value
CN | Word16* | Counter current value

* Part of the CN address range returns 32 bit data (C200 to C255)

Supported Spark format types are _bool_, _int16_, _uint16_, _int32_, _uint32_

The following are unsupported _float_, _double_ and _char_


### Settings

Data can be requested from the MitsubishiFx machine at a rate specified by the 'requestFrequency' property.
