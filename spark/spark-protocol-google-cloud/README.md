## Spark Protocol Google Cloud Client

### About

When enabled this module will attempt to publish data to either a Google Cloud Datastore instance, a Google Cloud Bigtable instance or to Google Pub/Sub using the _keyfile_ and _projectId_ configured on the Spark. Connection status is written back to the config as the boolean connectedToDb.

### Setting up Google Cloud Datastore and Bigtable instance

* You will need to create a Google account if you do not have one (or do not want to use your _home_ account).
* Then create a Google Cloud Storage Account https://cloud.google.com/products/ and click the _Try it Free_ option, logging in with your google account details.
* Go to the console (https://console.cloud.google.com/home/dashboard)
* A test project is created for you, you can rename this to _Spark Test Project_ or similar, but make a note of the _projectId_. This id needs to be added to the Spark settings page for Google Cloud Client.
* Select API->Credentials and create a _Service account key_ for the relevant service e.g.  _Cloud DataStore_ or _PubSub Editor_.
* Save the key file and rename it to _keyfile.json_ and either SCP the key into the Spark data directory or place it in the root of the SD-Card.
* The path will need to be set in the Spark settings page for Google Cloud Client (/boot if using the root of the SD-Card or /data if you used SCP to copy it into the data directory).

Additionally for Bigtable

* Enable API for Cloud Bigtable Table Admin
* Create a Bigtable instance with a suitable name. This is required to be entered in Spark's settings for the Google CLoud Client.
* A cluster Id with a suitable name. This is required to be entered in Spark's settings for the Google Cloud Client.
* And choose an appopriate geographical zone for the data to be stored in.
* Set a table name in the Spark Settings. This is the table that will be (created if necessary and) written to.

### Key and Data format for Datastore

When enabled in Spark and configured for Datastore, the Google Cloud Client protocol will send data from the Spark Machines with the namespace set to _Spark_ and the key based on _host name_ _machine name_, _variable name_ and the unique _database_id_ assigned to each database entry. For example:

```
hostname: 'spark-000baba819fb', machine: 'spark-machine-dummy', variable: 'humidity', id: 1234
```

The payload of each data object is the current value of the variable along with its ISO timestamp string.

```
value: 40.5, timestamp: 2016-07-11T15:29:22.329Z
```

### Key and Data format for Bigtable

When enabled in Spark and configured for Bigtable, the Google Cloud Client protocol will write data from the Spark Machines into the configured table, using a key based on _host name_ _machine name_, _variable name_ and _unix_timestamp_ . For example:

```
spark-000baba819fb#spark-machine-dummy#humidity#1466017315951
spark-000baba819fb#spark-machine-dummy#humidity#1469544459924
```

The payload of each data object is the current value of the variable along with its unix timestamp (contained in a mandatory column family).

```
cf1{humidity: {value: 0.9602936856769431, timestamp: 1469544459924 } }
```
Note for Bigtable all values are sent as strings, as Cloud Bigtable treats all data as raw byte strings.

### Topic and Data format for Pub/Sub

The topic is formed from the Spark's unique hostname combined with the name of the machine being published e.g.

```
spark-000baba819fb.spark-machine-dummy
```

If mulitple machines are enabled on the Spark you will then have multiple topics being published.


The payload of each data object is the name of the variable, the current value of the variable, along with its ISO timestamp string.

```
{ name: 'temperature', value: 27.99240784925745, timestamp: 2017-03-03T15:42:42.755Z }
```


For all implmementations, the data is batched up to reduce the overhead of network messaging. The number of data items per message sent is set by the config parameter _packetQueueSize_

### Authors

[Dominic White](mailto:dominic.whitek@te.com)
