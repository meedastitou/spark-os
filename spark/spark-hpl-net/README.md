# spark-hpl-net#
A Hardware Protocol Layer (HPL) for Net to simplfy the creating of any TCP / UDP interfaced machines.

Both request/response and publish/subscribe methodologies are handled.
In pub/sub mode Spark can act as a client or server, in either case data is assumed to be published to Spark from the physical machine.

## Current state
 - Currently only TCP (not UDP) is supported.
 - Subscribes are assumed not necessary when in pub/sub mode.
 - In pub/sub mode we expect a list of ALL data variables back for each publish if no terminator string is specified. If one is specified we concatenate the received data until we receive the expected terminator string (assumes terminator string will be seen on a packet boundary).
 - In pub/sub variables can be extracted from the published data either by a regex or csv style (with customizable separator)
 - In req/res mode we expect each request to be a single variable, and to get a guaranteed response for each request.
 - Arrays are supported using the 'array' flag on a per variable basis

## For future updates
- Add udp support.
- Support extra types e.g. DateTime?
- Support for the subscription side of pub/sub.
- Re-connection support when in client mode

## Configuration

### Variables
This module relies on being passed the contents of the configuration file of the net machine utilizing this module for it to determine which variables to read
from.

An example net variable using pub/sub looks like this:

```javascript
{
    "name": "Count",
    "description": "The parts made counter",
    "regex": "count= ([^,]+)",
    "format": "Int",
```
An example net variable using req/res looks like this:

```javascript
{
    "name": "Count",
    "description": "The parts made counter",
    "requestKey": "getCount"
    "format": "Int",
```

The variables must match the JSON scheme defined in [defaults.json](./defaults.json) and [hpl.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machine-hpl/browse/schemas/hpl.json)

The following table describes the fields of each variable

Field  | Description
-----  | -----------
name | A short text string to reference the variable by
description | A longer description of the variable
regex | In pub/sub mode, the regular expression to be used to extract this variable from the publish data. Require either this field or csvPos field.
csvPos | In pub/sub mode, the position in the published data for comma separated results (or separated with a custom separator). Require either this field or regex field.
Array | In pub/sub mode, if more than one result is expected per publish, enable this option to store each in an array.
requestKey | In req/res mode, the string key to send to the server to get this variable as a response.
format | The Spark HPL data type to convert the string response data into.

### Settings

The Net module can be configured for either pub/sub or req/res methodologies. In pub/sub it can act as either a client or a server.

In req/res mode all variables in the config are read sequentially, in your machine you should use a setting in the config file to determine the delay between each complete read cycle.

Please see the config.json file of the spark-machine-ppt-datalogic for a full example.
See [spark-machine-ppt-datalogic.json](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines/browse/net/spark-machine-ppt-datalogic.json) in the [spark-machines](https://makemake.tycoelectronics.com/stash/projects/IOTLABS/repos/spark-machines) repository for a full example.

## Testing
In the 'test' sub-directory there are two reference servers and a reference client that can be used to test either a pub/sub type machine (as client or server) or a req/res type.

For example to test a 'publish' type machine acting as a server of name spark-machine-ppt-datalogic you can use the test json file of sample data and the testPublishServer.js.
If the machine is configured for port 10000 and you want to publish every 2 seconds then use the following line from within the test directory:

```
node testPublishServer.js 10000 ../../spark-machines/net/test/ppt-datalogic-publish-data.json 5
```

To test new machines you will need to create a sample data file for the server to use. See the specifc client or server code for details on the required format.


## Regex notes
Due to the regex having to be contained in a json formatted file, you will need to use a '\' escape sequence if you use '\' in your regular expression.
e.g.
```
"regex": "\, (.*?)\,",
```
needs to be changed to
```
"regex": "\\, (.*?)\\,",
```
