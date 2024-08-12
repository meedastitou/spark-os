## Spark Protocol Data Logger

### About

When enabled this module will attempt to write data from enabled machines to file.
A new file is used for each enabled machine, with the filename taking the form:

`machineName-unixTimestamp.log` e.g. `spark-machine-wasabi-1506504938393.log`

Files are place in the path specified by the `File Path` option in the settings. An alert will be raised if the path is not valid.

A new file will be created each time the Data Logger is re-enabled, otherwise new data will just be appended to the existing file.

The data is written to file in the format:

`variableName;timeStamp;value`

e.g. semilcolon seperated. A simple example would be:

`pressure;2017-09-27T09:20:55.588Z;0.156`

A more complex example for a Wasabi array variable  would be:

`ana-in-ch-3-inj-speed;2017-09-27T09:20:55.588Z;0.079268293,0.079268293,0.091463415,0.207317073,0.097560976,0.085365854.........`

Whilst running, the data logger monitors the amount of free space in the designated path. If this starts running low (only 20% free) it will alert to say that space is getting low.

If free space drops to only 10%, the data logger will alert and close the files to stop any further writing.

### Use with a USB drive
To log to a USB drive you will need to mount the drive by hand on the command line first. It must be mounted using the spark-protocol user and group e.g.

```
sudo mount /dev/sdb1 /media/usbdrive -o uid=spark-protocol -o gid=spark-protocol
```

You will need to select the appropriate 'dev' device for the actual usb drive, this can be found by using 'journalctl -f' command to monitor for hardware changes when plugging the USB device in. Also the directory /media/usbdrive needs to exist prior to the attempt to mount.

`/media/usbdrive` will then be the `File Path` to use in the Data Logger settings.

### Authors

[Dominic White](mailto:dominic.whitek@te.com)
