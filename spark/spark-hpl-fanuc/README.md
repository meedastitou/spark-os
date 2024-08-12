# spark-hpl-fanuc

A Hardware Protocol Layer (HPL) for the Fanuc Injection Molding Press.

Operates in either Ethernet or Serial mode.

In Ethernet mode, Spark acts as a server, with a physical Fanuc device connecting to it as a client.

All data from Fanuc is character based. All numbers sent are integers, and may require post processing into floating point numbers. This is achieved with the 'meastype' variable property.

## Current state
- In Ethernet mode we assume all data is contained within each single ethernet packet. e.g. no concatenating done, and assuming start of each packet is the start of each data payload.
- This could be improved to check for payload delimiters (starts with STX (0x02) and ends with an ETX (0x03) a 1 byte CRC and then \r\n) and append data packets when necessary or reject data when it does not conform.

## Configuration

### Variables
This module relies on being passed the contents of the configuration file of the fanuc machine utilizing this module for it to determine which variables to read
from.

An example fanuc variable looks like this:

```javascript
{
    "name": "Monitor1",
    "description": "Monitor 1 Pressure",
    "format": "float",
    "measType": "Pressure",
    "charOffset": 198,
    "charLength": 6
}
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the string response data into.
measType | The variables measurment type which determines how the raw data is processed e.g. multiplied by 0.01. The list of available measurment types is given in the table below.
charOffset | The number of characters offset from the start of the payload where this variable's data is located.
charLength | The number of characters that make up this variable's data.

The following table describes the possible options for the measType property

Type  | Description
----- | -----------
None (N/A) | Used for counts etc
Time (0.01s) | Time in units of 0.01s. Data will be divided by 100
Precision Time (0.001s) | Time in units of 0.001s. Data will be divided by 1000
Length/Distance | Distance in mm or inches depending on the units set.
Temperature | Temperature in Celcius or Fahrenheit depending on the units set.
Percentage (0.1%) | Percentage in units of 0.1%. Data will be divided by 10
Percentage (0.01%) | Percentage in units of 0.01%. Data will be divided by 100
Pressure | Pressure in units denoted by the units property
Power (0.1kw) | Power in 0.1kw. Data will be divided by 10
Precision Power (0.01kw) | Power in 0.01kw. Data will be divided by 100
Consumption (0.1w) | Power in 0.1w. Data will be divided by 10
Flow | Flow in in 0.01. Data will be divided by 100
Force | Force in units denoted by the units property
Volume | Volume in units denoted by the units property

### Settings

The Fanuc hpl can be configured for imperial or metric using the 'units' property, this should be set correctly otherwise the post processing done on the raw data may be incorrect.

Data can be requested from the Fanuc machine at a rate specified by the 'requestFrequency' property.

Please see the config.json file of the spark-machine-ppt-datalogic for a full example.
See [spark-machine-ppt-datalogic.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines/browse/fanuc/fanuc_roboshot.json) in the [spark-machines](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines) repository for a full example.
