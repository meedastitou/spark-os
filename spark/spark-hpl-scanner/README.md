# spark-machine-scanner#
A Spark Machine designed to read data from a scanner and report the received string as a defined variable scan-string.

The module is designed to interface to a scanner connecting as a hid device (/dev/input/event0).

## Configuration

### Settings

An Enable setting for enabling/disabling the machine
A scanPath setting for defining the appropriate device to open for listening
A publishDisabled setting to prevent the received scan data from being sent out.
