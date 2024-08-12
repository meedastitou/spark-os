# spark-hpl-arburg


A Hardware Protocol Layer (HPL) for the Arburg Machines using the Selogica Interace v2 and v3.

Operates in Serial mode.

## Configuration

### Variables
This module relies on being passed the contents of the configuration file of the Arburg machine utilizing this module for it to determine which variables to read
from.

Variables are classed based on which status block they are located in. There is also a byteOffset field to give the exact location of the variable within that block.

An example Arburg variable looks like this:

```javascript
{
  "name": "machineNumber",
  "description": "Machine Number",
  "format": "uint32",
  "blockLocation": "Basic Status",
  "byteOffset": 0
}
```
If the variable is a string then the format should be set to char and a length field added:

```javascript
{
  "name": "program1",
  "description": "Program 1",
  "format": "char",
  "length": 15,
  "blockLocation": "Basic Status",
  "byteOffset": 10
}
```


The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by.
description | A longer description of the variable.
format | The Spark HPL data type used to help extract the data correctly.
blockLocation | Which block of the status response the variable resides in.
byteOffset | The byte offset from the base of the selected block.

The following table describes the possible block locations in the request key

Location  | Description
--------- | -----------
Basic Status | Block containing basic status information. Always present in the status response.
Process Data 1st Cylinder | Block containing the process data for the 1st active cyclinder. Optional
Process Data 2nd Cylinder | Block containing the process data for the 2nd active cyclinder. Optional
Automation Components | Block containing the process data for the automation components. Optional
Alarm String | Block containg an alarm message in string format. Optional

### Settings

Data can be requested from the Arburg machine at a rate specified by the 'requestFrequency' property.

See the [yokogawa-demo-v2.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines/browse/arburg/arburg-test.json) in the [spark-machines](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines) repository for a full example.
