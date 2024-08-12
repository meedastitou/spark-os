# spark-hpl-ble
A Hardware Protocol Layer (HPL) for Bluetooth Low Energy

## Configuration
### Variables
This module relies on being passed the contents of the configuration file of the ADS machine utilizing this module for it to determine which variables to read from.

An example ADS variable declaration looks like this:

```javascript
{
    "name": "battery_level",
    "description": "Battery Level",
    "addrOffset": "15",
    "format": "uint8"
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field       | Description
----------- | ------------------------------------------------------------------------------------------------
name        | A short text string to reference the variable by.
description | A longer description of the variable.
indexOffset | The offset of the variable in the buffer
format      | The format of the data, this will generally determine the data length read. i.e. Byte is 8 bits.
length      | Only required for strings, this determines the length of the string array required to be read.

### Settings
The Bluetooth Low Energy module requires a bluetooth connection between Spark and the slave device.
The target device (WAC machine) should be identified by its id (address of 10 numbers (0000000000)) and its localName (for example : "TE Applicator Count")

### Limitations
It is not possible with this implementation to watch different WAC on the same time.
For now the supported machines are WAC prototype, industrial WAC and TEchCon badge.
The code of index.js is generic and can be improved: For now, it supports the machines defined above and any machine whose variables are coded in Little Endian, on 1, 2 or 4 bytes.

