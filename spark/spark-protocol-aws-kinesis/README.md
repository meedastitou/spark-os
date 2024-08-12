## Spark Protocol AWS Kinesis

### About

When enabled, this module will attempt to produce data to an AWS Kinesis stream.

The module must be configured with the Access Key ID, Secret Access Key, and region of an AWS user, as well as the name of the Kinesis stream to produce Spark data to. Note that the stream must be created in the specified region, and the user must have 'PutRecord' permission on the specified stream.

### Connection

The module uses the Kinesis class in the AWS SDK to produce records to the stream. When Spark data is produced to the stream, the partition key of the record is derived from the Spark host name and the name of the machine that generated the data. This means that all records from a given Spark and a given machine will be sent to the same shard.

Records that are not successfully sent to the stream are discarded. This means that exceeding the provisioned throughput of the stream will lead to lost data.

### Format of produced records

Each record produced by the module contains data encoded in a JSON string with the following form:
```
{
    "type": <type of record>,
    "host": <hostname of the Spark Machine>,
    "data": <data payload>
}
```

The module produces three types of records:

- Connection Test records (type: "connection_test") are produced when the module is initializing as a way to test the connection with the specified Kinesis stream. They do not contain any useful data.

- Metadata records (type: "metadata") are produced when the status of a machine changes. They contain metadata about a machine and its variables.

- Record records (type: "record") are produced whenever a machine publishes variable data. They contain the name of the machine that produced the record, the time the record was created, and information about the machine's variables, including their values. Each Record record has the form:

```
{
    "type": <type of record>,
    "host": <hostname of the Spark Machine>,
    "data": {
        "machine": <machine name>,
        "time": <timestamp of data>,
        "attributes": {
            <variable name>: {
                "name": <variable name>,
                "description": <variable description>,
                "format": <Spark datatype of variable>
                "value": <variable value>
            },
            ...
        }
    }
}
```

If the data is from a virtual machine that Spark is monitoring, then additional metadata is produced for each variable, including information about the source machines and variables from which the virtual variable is derived.

### Processing records using an AWS Lambda function

One way to create a consumer to process the data in the Kinesis stream is to use an AWS Lambda function. An example consumer function can be found at:

```
spark-protocol-aws-kinesis/consumer
```

This consumer function collects the data and metadata that Spark produces and stores them in DynamoDB.

To use the consumer function with AWS Lambda, create a new function in Lambda under the same account that Spark is configured to produce data to. Also create two DynamoDB tables to receive the data and metadata from Spark. Make sure that the Lambda function's execution role has "putItem" and "updateItem" permissions on the tables.

By default, the tables you create must be named "SparkData" and "SparkMetadata." If you want your tables to have different names, you must change the "dataTableName" and "metadataTableName" constants in the code (index.js) to match your table names. 

To prepare the consumer function to execute in Lambda, navigate to the consumer folder and run ```yarn install```, then compress the files into a .zip file. For Linux machines, there is a script included to do this automatically; simply run ```yarn zip```.

Once the files are compressed in a .zip archive, upload the .zip to the Lambda function. Then add a Kinesis trigger to the function, configuring it to consume data from the same Kinesis stream that Spark is producing to.

 If everything has been set up correctly, the data and metadata that Spark sends to Kinesis should now be stored in the corresponding DynamoDB tables.

### Testing

The protocol's test harness uses [Kinesalite](https://github.com/mhart/kinesalite) to test the protocol on a mocked local Kinesis service. In order for the tests to run properly, Node.js Server-side JavaScript must be allowed through the firewall. To do this on Windows 10, go to:

```
Control Panel > Windows Firewall > Advanced Settings > Inbound Rules
```

Then double-click on "Node.js: Server-side JavaScript," select "Allow the connection," and click "OK."


### Authors

[Sam Pawlikowski](mailto:sam.pawlikowski@te.com)
