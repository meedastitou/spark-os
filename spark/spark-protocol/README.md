## Spark Protocol Layer

Spark Protocol Layer written for [Node.js](https://nodejs.org).  This application connects to a backed redis database and pushishes the data over various protocols.

## Start

### Setup

The application requires Node.js.  It is recommended to install Node.js using [NVM](https://github.com/creationix/nvm).  NVM allows management of installed Node.js versions.  It will install Node.js into the `.nvm` directory under your home directory meaning root permissions are not needed.  Install NVM and the latest v0.10.x version of Node.js by running these commands:

```
sudo apt-get install build-essential
curl https://raw.githubusercontent.com/creationix/nvm/v0.25.2/install.sh | bash
nvm install 0.10
nvm alias default 0.10
```

Next, to build and run the code some Node.js modules should be installed globally.

```
yarn global add grunt-cli bunyan
```

Finally, install all the Node.js modules needed by the Spark Protocol Layer as follows

```
cd /path/to/spark-protocol
yarn install
```

### Configuration

The file `defaultConf.js` contains the application configuration.  The configuration is set using the following environment variable

| **Environment Variable** | **Meaning** |
|:-------------------------|:------------|
| NODE_ENV                 | The current node environment to run.  Possible options are development, production and testing |
| LOG_LEVEL                | Logging detail to produce. Possible options are trace, debug, info, warn, error, fatal (see [bunyan log levels](https://github.com/trentm/node-bunyan#levels)) |
| LOG_FILE                 | File to write logging to.  If not set write to stdout |
| SPARK_CONFIG             | Path to the spark config file.  Defaults to /etc/spark/spark.json |
| REDIS_URL                | url for the redis database to use, defaults to redis://localhost:6379/0 |


If NODE_ENV is not set the application default to **development** mode.  Consult `defaultConf.js` to see the default values each mode.

## Development

To develop run the command:

```
grunt dev
```

This will build the application, start it running in Node.js and watch for any changes.  If any files are changed then the code is rebuild and Node.js restarted.

## Authors

[Martin Bark](mailto:martin.bark@te.com)
