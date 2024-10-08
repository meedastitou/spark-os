# spark-hpl-kellerbus
A Hardware Protocol Layer (HPL) for kellerbus

## Configuration
### Variables
This module relies on being passed the contents of the configuration file of the kellerbus machine utilizing this module for it to determine which variables to read from.

An example modbus variable looks like this:

```javascript
{
    "name": "TXT1_5",
    "description": "A String of length 5",
    "type": "hr",
    "address": "9000",
    "format": "char",
    "length": 5
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field       | Description
----------- | ------------------------------------------------------------------------------------------------
name        | A short text string to reference the variable by
description | A longer description of the variable
type        | The type of data being accessed, discrete input, coil, input register, or holding register
address     | The modbus hex address of the variable. This is a 4 digit hex string.
format      | The format of the data, this will generally determine the data length read. i.e. Byte is 8 bits.
length      | Only required for strings, this determines the length of the string array required to be read

Table giving conversion between kellerbus format and Spark HPL format

Modbus format | HPL format
------------- | ----------
Bit           | bool
Int           | int16
Hex           | uint16
Float         | float
Int2          | int32
String        | string

### Settings
The kellerbus module can be configured for serial connection between Spark and the slave device.

All variables in the config are read sequentially, in your kellerbus machine you should use a setting in the config file to determine the delay between each complete read cycle.

### Optimization
Sort your variables in the config file in an ordered way and spark-hpl-kellerbus will attempt to create the smallest number of transactions from the given variables. This will reduce the overheads and latency of a machine utilizing the kellerbus interface. By 'ordered' it is meant that grouping variables of the same type together and with sequentially ascending addresses.

### Example
See [spark-machine-demo-modbus.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines/browse/modbus/spark-machine-demo-modbus.json) in the [spark-machines](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines) repository for a full example.
