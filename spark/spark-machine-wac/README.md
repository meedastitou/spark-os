# spark-machine-wac #

This is a spark machine designed to get data from Wireless Applicator Counters (WACs).

It listens for a list of bluetooth low energy devices output by the node-ble module and
filters out any devices that aren't WACs. The user is able to select a number of WACs
to get data for in the web admin by entering the MAC addresses of each.

The module parses the data contained in the advertisement of each WAC (e.g. number of
counts, signal strength, serial number, battery level etc.) and writes this to the
spark database.
