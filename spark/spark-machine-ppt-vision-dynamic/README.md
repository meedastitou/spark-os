# spark-machine-ppt-vision-dynamic#
A Spark Machine designed to adapt to dynamically changing variable data from a PPT Datalogic vision system.

The module is designed to interface as a net server, with a PPT Datalogic connecting to it as a client.

The output from the PPT Datalogic machine must be a string with comma separated data of the format.

```
"var1Name,var1Data,var2Name,var2Data,var3Name,var3Data,var4Name,var4Data,...."
```

for example:

```
"Date, 04-14-2016, Time, 10:36:37 am, Deformed part,1, Insulation u width,0.1449, Wire u width,0.0947, Top lance ht.,0.0230, Bottom lance ht.,0.0259, Nose width,0.0368, Result,Pass, Count,669979"
```

If the data passed to this module is not in this form then the module will not work as intended and will likely sit in a constant restart loop.

The module attempts to guess the most appropriate format (data type) for each variable found e.g. float, char or int. It will also change the variable's name so that it meets with the Spark naming convention. e.g. no special characters or spaces. So for example _Top lance ht._ would become _TopLanceHt_

A few cycles worth of data will be lost each time there is an adaption, this is because the module has to restart and the PPT Datalogic net client needs to reconnect to the module. The restart is required to allow output protocols to pick up the change to this machine and let them reload in the updated variable list for it.

## Configuration

### Settings

The only settings for this module are related to enabling/disabling the machine and setting the port number for the net server.

## Testing
In the 'test' sub-directory of the spark-hpl-net directory there is a reference client that can be used to test this module. There is also a reference input data file in spark-machines/net/test/ which has a dynamic payload.

To run this, change to the _spark-hpl-net/test_ directory and use the following line. Where _148.174.7.169_ is the ip address of the Spark, _10000_ is its configured port and _2000_ is the publish rate in milliseconds.

```
node ./testPublishClient.js 148.174.7.169 10000 ../../spark-machines/net/test/ppt_dynamic_test_data.json 2000

```
