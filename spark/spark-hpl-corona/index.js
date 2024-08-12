const net = require('net');
const url = require('url');
const _ = require('lodash');
const defaults = require('./defaults.json');
const schema = require('./schema.json');

// constructor
const hplCorona = function hplCorona(log, machine, model, conf, db, alert) {
  // preload alert messages that have known keys
  alert.preLoad({
    'db-add-error': {
      msg: 'Database Add Error',
      description: x => `Error adding to the database. Error: ${x.errorMsg}`,
    },
  });

  // Private variables
  const that = this;
  const RETRY_TIMEOUT = 2000;
  let client;
  let coronaUrl;

  // size of a format in bytes
  const formatToNumBytes = {
    int8: {
      bytesPerSample: 1,
      read: 'readInt8',
    },
    int16: {
      bytesPerSample: 2,
      read: 'readInt16LE',
    },
    int32: {
      bytesPerSample: 4,
      read: 'readInt32LE',
    },
    uint8: {
      bytesPerSample: 1,
      read: 'readUInt8',
    },
    uint16: {
      bytesPerSample: 2,
      read: 'readUInt16LE',
    },
    uint32: {
      bytesPerSample: 4,
      read: 'readUInt32LE',
    },
    float: {
      bytesPerSample: 4,
      read: 'readFloatLE',
    },
    double: {
      bytesPerSample: 8,
      read: 'readDoubleLE',
    },
  };

  // public variables
  that.dataCb = null;
  that.configUpdateCb = null;
  that.machine = _.merge({}, defaults, machine, {
    settings: {
      model,
    },
  });

  // Private methods
  function onError(err) {
    log.error(err);
  }

  function onData(data) {
    const numChannels = that.machine.variables.length;

    that.machine.variables.forEach((variable) => {
      // convert the data to a typed array
      const { bytesPerSample, read } = _.get(formatToNumBytes, variable.format);

      // demux the data for the required channel
      const demuxData = [];
      const start = variable.channelNum * bytesPerSample;
      const increment = numChannels * bytesPerSample;
      for (let i = start; i < data.length; i += increment) {
        demuxData.push(data[read](i, bytesPerSample));
      }

      // write the variable data to the database
      that.dataCb(that.machine, variable, demuxData, (err) => {
        if (err) {
          alert.raise({ key: 'db-add-error', errorMsg: err.message });
        } else {
          alert.clear('db-add-error');
        }
      });
    });
  }

  function onDisconnect() {
    log.debug('Disconnected');
    if (client) {
      client.removeListener('data', onData);
      client.removeListener('error', onError);
      client.removeListener('close', onDisconnect);
      client.removeListener('end', onDisconnect);
      setTimeout(that.clientReconnect, RETRY_TIMEOUT);
    }
  }

  function clientConnect() {
    client = net.createConnection({
      host: coronaUrl.hostname,
      port: coronaUrl.port,
    });
    client.on('error', onError);
    client.on('close', onDisconnect);
    client.on('end', onDisconnect);
    client.on('data', onData);
  }

  this.clientReconnect = function clientReconnect() {
    log.debug('Reconnecting');
    clientConnect();
  };

  // Privileged methods
  this.start = function start(dataCb, configUpdateCb, done) {
    if (typeof dataCb !== 'function') {
      return done('dataCb not a function');
    }
    that.dataCb = dataCb;

    if (typeof configUpdateCb !== 'function') {
      return done('configUpdateCb not a function');
    }
    that.configUpdateCb = configUpdateCb;

    // check if the machine is enabled
    if (!that.machine.settings.model.enable) {
      log.debug(`${machine.info.name} Disabled`);
      return done(null);
    }

    // Private variables
    coronaUrl = url.parse(that.machine.settings.model.url);

    clientConnect();

    log.debug('Started');
    return done(null);
  };

  this.stop = function stop(done) {
    if (client) {
      client.end();
      client = null;
    }

    // clear existing alerts
    alert.clearAll(() => {
      log.debug('Stopped');
      return done(null);
    });
  };

  this.restart = function restart(done) {
    log.debug('Restarting');
    that.stop(() => {
      that.start(that.dataCb, that.configUpdateCb, err => done(err));
    });
  };

  this.updateModel = function updateModel(newModel, done) {
    log.debug('Updating');
    that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
    that.restart(err => done(err));
  };

  return true;
};

module.exports = {
  hpl: hplCorona,
  defaults,
  schema,
};
