# spark-hpl-omron-fins

A Hardware Protocol Layer (HPL) for the various Omron Fins PLCs.

Operates in Serial or Ethernet mode. In addition the serial mode has two versions 'Hostlink (C-mode)' and 'FINS (CV-mode)'.

## Configuration

### Variables
This module relies on being passed the contents of the configuration file of the Omron machine utilizing this module for it to determine which variables to read
from.

An example Omron variable looks like this:

```javascript
{
  "name": "d110",
  "description": "D110",
  "format": "uint16",
  "address": "D110"
}
```

An example Omron bit read variable (bit reads happen when an address containing a dot is included) looks like this:

```javascript
{
  "name": "w110-bit-1",
  "description": "W110 Bit 1",
  "format": "bool",
  "address": "W110.1"
}
```


The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
format | The Spark HPL data type to convert the string response data into.
address | Contains the address to read data from including the memory area and optional dot number if doing a bit read


### Formats supported

#### Normal Reads
In non bit read mode, variables can be parsed out as:

 _bool_, _char_, _int8_, _uint8_, _int16_, _uint16_, _int32_, _uint32_, _float_ and _double_.

Notes:
 * For _bool_, _int8_ and _uint8_ types the data will be converted from a 16 bit word size recieved from the machine.
 * For char, you will be expected to add a 'length' property to the variable and set its length to create a string response from multiple chars.

#### Bit Reads
In bit read mode, variables can be parsed out as:

_bool_, _int8_, _uint8_, _int16_, _uint16_

Notes:
 * The value will always just be a one or zero whatever the format size, excpect for the _bool_ format, in which case it is coerced into a true or false value.
 * In Serial mode the 'ascii' data can be decimal encoded from the machine. If this is the case and the data currently looks wrong, the 'Decimal Encoded Data' parameter can be added to the variable in question and set to enable.


### Unsupported Formats

The following are unsupported:

_int64_, _uint64_


### Array Support
Arrays are supported for all but _char_ variable types. You will need to add the 'array' property to the variable and set it to 'true' and also add the 'length' property and set the length to the required length of the array.


### Address areas supported

The address areas that are currently supported vary depending on the interface

#### Ethernet mode

Location  | Type | Description
--------- | ---- | -----------
EM | Bit or Word16 | Extended Memories
CIO | Bit or Word16 | CIO
WR | Bit or Word16 | Work Area
HR | Bit or Word16 | Holding Registers
AR | Bit or Word16 | Auxiliary Registers
DM | Bit or Word16 | Data Memories
C  | Bit or Word16 | Counters
T  | Bit or Word16 | Timers
DR | Bit or Word16 | Data Registers
IR | DWord32       | Index Registers
TK | Bit           | Task Flags
TS | Bit           | Timer Status

#### Serial Hostlink (C-mode)

Location  | Type
--------- | ----
IR | Word16
SR | Word16
LR | Word16
PV | Word16
TC | Word8
DM |  Word16
D  | Word16
AR | Word16
CIO | Word16
HR | Word16

Notes
 - In this mode of operation bit mode is achieved by masking and shifting the word or byte repsonse back from the machine.
 - Only DM and IR memory areas have been tested.

#### Serial FINS (CV-mode)

Location  | Type | Description
--------- | ---- | -----------
DM | Bit or Word16 | Data Memories
IR | Bit or Word16 | Register Memories

#### Serial FINS (CV-Extended)
Location  | Type | Description
--------- | ---- | -----------
A  | Bit or Word16 | Auxiliary Memory
C  | Bit or Word16 | Counter Area
CIO| Bit or Word16 | I/O Area
D  | Bit or Word16 | Data Memory
DM | Bit or Word16 | Data Memory (synonym for D)
DR | Bit or Word16 | Data Registers
E  | Bit or Word16 | Extended Memory
H  | Bit or Word16 | Holding Area
IR | Bit or DWord32| Register Memory
T  | Bit or Word16 | Timer Area
TK | Bit           | Task Flag Area
TS | Bit           | Timer Status Area
W  | Bit or Word16 | Working Area


### Settings

Data can be requested from the Omron machine at a rate specified by the 'requestFrequency' property.
