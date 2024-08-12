# spark-machine-ftp-csv-dynamic#
A Spark Machine designed to adapt to dynamically changing variable data from a ftp-csv file.

The module is designed to interface as a ftp client.


The module attempts to guess the most appropriate format (data type) for each variable found e.g. float, char or int. It will also change the variable's name so that it meets with the Spark naming convention. e.g. no special characters or spaces. So for example _Top lance ht._ would become _TopLanceHt_

A few cycles worth of data will be lost each time there is an adaption, this is because the module has to restart and the PPT Datalogic net client needs to reconnect to the module. The restart is required to allow output protocols to pick up the change to this machine and let them reload in the updated variable list for it.

## Configuration

### Settings

The only settings for this module are related to enabling/disabling the machine and the settings for the ftp server.

## Testing
