## Spark Protocol AWS IoT Advanced

### About

This module operates in the same manner as spark-protocol-aws-iot, only adds additional metrics and configures topics namespaces
to more closely match the Sprakplug standard.

From spark-protocol-aws-iot:
when enabled this module will attempt to publish data to AWS's IoT Platform. Connection status is written back to the config as the boolean connectedToDb.

The relevant certificates and keys must be specified in the configuration, and can be set either via paths to files, or by pasting their contents into the configuration. All certificates and keys must be in PEM format.

### Notes on setting up the 'Thing' in the AWS IoT cloud
- The 'Thing' name you create must match the hostname of the Spark you aer creating it for.
- When you generate the certificates for the 'Thing' they must be enabled also, as they start out disabled by default.
- The certificates can either be placed on the Spark's filesystem and refered to by path, or pasted in as text (in the Spark Protocol's AWS IoT settings page).
- A policy must be attached to the 'Things' certifcate to allow it to connect and publish. Use the following as a template to create one, then 'Attach Policy' to your certificate.

```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "iot:*",
      "Resource": "*"
    }
  ]
}
```

- The AWS IoT 'Settings' infomation page contains an 'endpoint' string. This must be pasted into the 'Host Endpoint' setting in Spark's AWS IoT Client Settings.




### Connection

We are using the 'aws-iot-device-sdk-js' node.js module which supports connection types of 'mqtts' and 'Websockets TLS', but currently we have only implemented 'mqtts'.

### Publised Data Format

Data is published for each variable of each enabled machine. They are published using a topic created using the following methodology

```
machines-physical-hostname/spark-machine-name/spark-variable-name
```

The payload of the publish is the variable's current value and its database timestamp as an ISO string. Note that integers and floats are sent as numbers, and string values as strings. They are converted based on the format/outputFormat specified by the variable.

The following is an example payload for a topic from 'spark-000baba3a63f/spark-machine-dummy/pressure'

```
{
    value: 0.12,
    timestamp: "2016-09-01T14:52:10.671Z"
}
```

In addtion to these publishes, each time a Spark Machine is enabled, a topic of  'machines-physical-hostname/spark-machine-name' will be published detailing the list of variables the Spark Machine has, and all of those variables properties.

The following is an example payload for a topic from 'spark-000baba3a63f/spark-machine-dummy'

```
{
  "variables": {
    "temperature": {
      "name": "temperature",
      "description": "Temperature",
      "format": "float",
      "type": "random"
    },
    "pressure": {
      "name": "pressure",
      "description": "Pressure",
      "format": "float",
      "type": "sine"
    },
    "humidity": {
      "name": "humidity",
      "description": "Humidity",
      "format": "float",
      "type": "cosine"
    }
  }
}
```

### Authors

[Dominic White](mailto:dominic.whitek@te.com)
