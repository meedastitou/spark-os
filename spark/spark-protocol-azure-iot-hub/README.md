## Spark Protocol Azure Cloud Client

### About

When enabled this module will attempt to publish data to an Azure IoT Hub Device.

### Setting up Azure Cloud Iot Hub

* You will need to create an Azure account https://azure.microsoft.com/en-us/services/iot-hub/ and click the _FREE ACCOUNT_ option.
* Then create a Azure IoT Hub _New_ -> IoT Hub.  Make a note of the _IoT Hub Name_.  This name needs to be added to the Spark settings page for Azure Cloud Client
* Open this new IoT Hub and go to _Shared access policies_ -> iothubOwner.
* Make a note of the _Primary key_.  This name needs to be added to the Spark settings page for Azure Cloud Client.
* The device name will be derived from the Spark's unique hostname. This is the device that will be created (if necessary) and written to.

### Key and Data format for IoT Hub Device

When enabled in Spark, the Azure Cloud Client protocol will send data from the Spark Machines to the Iot Hub's designated device. For each data point, the following fields are set from Spark:

_deviceId_, _machine_, _variable_, _value_, _timestamp_

e.g.
```
'deviceId': 'spark-000baba819fb', 'machine': 'spark-machine-dummy', 'variable': 'humidity', 'value':  40.5, timestamp: 2016-07-11T15:29:22.329Z
```

The following fields are appended by the Azure client sendEvent method.

 _EventProcessedUtcTime_, _PartitionId_, _EventEnqueuedUtcTime_, _IoTHub_.

 Where _IoTHub_ is an object containing the following:

 _MessageId_, _CorrelationId_, _ConnectionDeviceId_, _ConnectionDeviceGenerationId_, _EnqueuedTime_, _StreamId_

and where _ConnectionDeviceId_ is the unique device name of the Spark e.g. spark-000baba819fb

### Authors

[Matt Miller](mailto:matthew.miller@te.com)
