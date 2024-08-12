# spark-machine-webdav-csv-dynamic#
A Spark Machine designed to adapt to dynamically changing variable data from a webdav-hosted csv file.


The module attempts to guess the most appropriate format (data type) for each variable found e.g. float, char or int. It will also change the variable's name so that it meets with the Spark naming convention. e.g. no special characters or spaces. So for example _Top lance ht._ would become _TopLanceHt_

## Configuration

### Settings

There are several settings related to the webdav server configuration, along with options for the actual data in the csv file.
