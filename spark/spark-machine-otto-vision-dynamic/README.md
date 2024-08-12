# spark-machine-otto-vision-dynamic#
A Spark Machine designed to adapt to dynamically changing variable data from a Otto vision system.

The module is designed to interface as a net server, with a Otto vision system connecting to it as a client.

The output from the Otto vision machine must be XML with an OrderHeader section containing the variable names and a OrderData section containing the variable values.  The OrderHeader section must contain
a Merkmal Bezeichnung for each variable.  Also, the data must end with <!--END-->

for example:

<?xml version="1.0" encoding="windows-1252"?><KernelData> ... =""/><OrderHeader OrderName="1924275-1" ... <Merkmal Bezeichnung="Insulation Barrel out 1" ... </OrderHeader>
<OrderData>
<R N="Insulation Barrel out 1" R="2.8971" ...
</OrderData>
:
:
<!--END-->

If the data passed to this module is not in this form then the module will not work as intended and will likely sit in a constant restart loop.

The module attempts to guess the most appropriate format (data type) for each variable found e.g. float, char or int. It will also change the variable's name so that it meets with the Spark naming convention. e.g. no special characters or spaces. So for example _Top lance ht._ would become _TopLanceHt_

A few cycles worth of data will be lost each time there is an adaption, this is because the module has to restart and the Otto vision net client needs to reconnect to the module. The restart is required to allow output protocols to pick up the change to this machine and let them reload in the updated variable list for it.

## Configuration

### Settings

The only settings for this module are related to enabling/disabling the machine and setting the port number for the net server.

## Testing
In the 'test' sub-directory of the spark-hpl-net directory there is a reference client that can be used to test this module. There is also a reference input data file in spark-machines/net/test/ which has a dynamic payload.

To run this, change to the _spark-hpl-net/test_ directory and use the following line. Where _148.174.7.169_ is the ip address of the Spark, _10000_ is its configured port and _2000_ is the publish rate in milliseconds.

```
node ./testPublishClient.js 148.174.7.169 10000 ../../spark-machines/net/test/otto_dynamic_test_data.json 2000

```
