# spark-machine-dataq

A Spark Machine designed to interface with the DataQ DI-149 data acquisition device, connected via a virtual serial port.

Eight channels of analog inputs are configurable.
Four channels of digital inputs are configurable.

Variable names can be customized via the machines settings page.

The capturing sampling rate is configurable between 1 and 20 Hz

Some of the digital inputs can be set to special modes
- DI0 can be used to reset the counter (when DI3 is being used as a counter).
- DI2 can be used as a rate detecting input, additionaly configuring the likely maximum Hz expected.
- DI3 can be set to a counter mode, and can be reset by DI0 or by stopping the machine.

### Future work

We could implement some converters to process the analog inputs into units by post processing the data. Currently analog inputs will output between -2048 and 2047 for -10 to +10v.
