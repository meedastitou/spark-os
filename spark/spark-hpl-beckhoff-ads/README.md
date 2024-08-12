# spark-hpl-beckhoff-ads
A Hardware Protocol Layer (HPL) for Beckhoff ADS

## Configuration
### Variables
This module relies on being passed the contents of the configuration file of the ADS machine utilizing this module for it to determine which variables to read from.

An example ADS variable declaration looks like this:

```javascript
{
    "name": "Counter",
    "description": "Machine Cycle Counter",
    "adsAddressName": "Main.nCounter",
    "format": "int16"
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field       | Description
----------- | ------------------------------------------------------------------------------------------------
name        | A short text string to reference the variable by.
description | A longer description of the variable.
adsAddressName  | The ADS Name of variable (if addressing via Name method) e.g. Main.byByte[4].
format      | The format of the data, this will generally determine the data length read. i.e. Byte is 8 bits.
length      | Only required for strings, this determines the length of the string array required to be read.

Table giving conversion between Beckhoff ADS format and Spark HPL format

ADS format | Signed | Bits | HPL format
---------- | ------ | ---- | ----------
Byte       | No     | 8    | uint8
Bool       | No     | 8    | bool
Word       | No     | 16   | uint16
DWord      | No     | 32   | uint16
SInt       | Yes    | 8    | int8
USInt      | No     | 8    | uint8
Int        | Yes    | 16   | int16
UInt       | No     | 16   | uint16
DInt       | Yes    | 32   | int32
UDInt      | No     | 32   | uint32
Real       | Yes    | 32   | float
LReal      | Yes    | 64   | double

### Settings
The Beckhoff ADS module requires an ethernet connection between Spark and the slave device.

All variables in the config are read sequentially, in your ADS machine you should use a setting in the config file to determine the delay between each complete read cycle.

The config options include the IP address of the target slave device, the AMS address of the slave device and the AMS address chosen for the Spark.

### Example
See [spark-machine-demo-beckhoff-ads.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines/browse/beckhoff-ads/demo-beckhoff-ads-byname.json) in the [spark-machines](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines) repository for a full example.
