const { EventEmitter } = require('events');
const _ = require('lodash');
const IoRedis = require('ioredis');
const pkg = require('./package.json');

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};

let redis;
let redisSub;
let log;
let conf;
let started = false;
const sparkAlert = new EventEmitter();

const Alerter = function Alerter(module) {
  // Private variables
  const that = this;

  // public variables
  that.alerts = {};

  // Private methods
  function getAlertKey(key) {
    return ['alerts', module, key].join(':');
  }

  function updateAlert(obj) {
    // iterate over keys in the object
    Object.keys(obj).forEach((k) => {
      // check if the key is a function
      if (_.isFunction(obj[k])) {
        // if it is then run the function and replace
        // the key with the output
        _.set(obj, k, obj[k](obj));
      }
    });
  }

  this.preLoad = function preLoad(alerts) {
    that.alerts = alerts;
  };

  // Privileged methods
  this.raise = function raise(alert) {
    if (!(_.has(alert, 'key'))) {
      log.error('alert.key missing');
      return new Error('alert.key missing');
    }

    if (_.has(that.alerts, alert.key)) {
      _.extend(alert, that.alerts[alert.key]);
    } else {
      if (!(_.has(alert, 'msg'))) {
        log.error('alert.msg missing');
        return new Error('alert.msg missing');
      }

      if (!(_.has(alert, 'description'))) {
        log.error('alert.description missing');
        return new Error('alert.description missing');
      }
    }

    updateAlert(alert);

    if (!(_.has(alert, 'level'))) {
      _.set(alert, 'level', 'error');
    }

    log.error({ alert }, 'Raised alert');
    return redis.set(getAlertKey(alert.key), JSON.stringify(alert));
  };

  this.clear = function clear(key) {
    if ((!key) || (typeof key !== 'string') || (key.length === 0)) {
      log.error('invalid key');
      return new Error('invalid key');
    }

    log.debug({ key }, 'Cleared alert');
    return redis.del(getAlertKey(key));
  };

  this.clearAll = function clearAll(done) {
    sparkAlert.clearAlerts(module, done);
  };
  return true;
};

sparkAlert.start = function start(modules, done) {
  if (started) {
    return done(new Error('already started'));
  }

  log = modules['spark-logging'].exports.getLogger(pkg.name);
  conf = modules['spark-config'].exports;
  const REDIS_URL = conf.get('REDIS_URL') || 'redis://localhost:6379/0';

  log.info('Connecting to db', REDIS_URL);

  redis = new IoRedis(REDIS_URL);
  redisSub = new IoRedis(REDIS_URL);

  // enable notifications, redis disables this by default
  redisSub.config('SET', 'notify-keyspace-events', 'KEA', (err) => {
    if (err) {
      log.error({ err });
    }
  });

  // subscribe to key the alerts keyspace
  redisSub.psubscribe('__keyspace@0__:alerts:*', (err, count) => {
    log.debug({ err, count }, 'Subscribed to __keyspace@0__:alerts:*');
  });

  redisSub.on('pmessage', (pattern, channel, operation) => {
    // log.debug({ pattern, channel, operation });

    // channel is in the form '__keyspace@0__:alerts:machine:alertkey
    const keySplit = channel.split(':');

    // ignore invalid messages
    if ((keySplit.length !== 4) || (keySplit[1] !== 'alerts')) {
      return;
    }

    // get the machine
    const machine = keySplit[2];

    if (operation === 'set') {
      // remove __keyspace@0__ from the begining
      keySplit.shift();
      const key = keySplit.join(':');

      let alertObj;
      redis.get(key, (err, value) => {
        try {
          alertObj = JSON.parse(value);
        } catch (e) {
          alertObj = null;
        }

        if (!alertObj) {
          // ignore empty alerts
          return;
        }

        // emit raised event with machine and alert
        sparkAlert.emit('raised', machine, alertObj);
      });
    } else if (operation === 'del') {
      const alertKey = keySplit[3];

      // emit cleared event with machine and alert key field
      sparkAlert.emit('cleared', machine, alertKey);
    }
  });

  log.info('Started', pkg.name);
  started = true;
  return done(null, info);
};

sparkAlert.stop = function stop(done) {
  if (!started) {
    return done(new Error('not started'));
  }

  log.info('Stopped', pkg.name);
  started = false;
  return done();
};

sparkAlert.require = function require() {
  return [
    'spark-config',
    'spark-logging',
  ];
};

sparkAlert.getAlerter = function getAlerter(module) {
  if ((!module) || (typeof module !== 'string') || (module.length === 0)) {
    return new Error('invalid module');
  }
  return new Alerter(module);
};

sparkAlert.getAlerts = function getAlerts(param1, param2) {
  const module = param1;
  let done = param2;
  let search;

  if ((typeof module === 'string' || module instanceof String)) {
    search = `alerts:${module}:*`;
  } else {
    done = module;
    search = 'alerts:*';
  }

  redis.keys(search, (err, keys) => {
    if (err) {
      return done(err);
    }

    if (_.isEmpty(keys)) {
      return done(null, []);
    }

    return redis.mget(keys, (e, result) => {
      if (e) {
        return done(e);
      }

      // json parse the results and filter out any nulls (not sure why there are nulls)
      const resultParsed = result.map(r => JSON.parse(r));
      const resultFiltered = resultParsed.filter(r => !_.isNil(r));

      // sort by key
      resultFiltered.sort((a, b) => ((a.key > b.key) ? 1 : -1));

      return done(null, resultFiltered);
    });
  });
};

sparkAlert.getAlertsCount = function getAlertsCount(param1, param2) {
  const module = param1;
  let done = param2;
  let search;

  if ((typeof module === 'string' || module instanceof String)) {
    search = `alerts:${module}:*`;
  } else {
    done = module;
    search = 'alerts:*';
  }

  redis.keys(search, (err, keys) => {
    if (err) {
      return done(err);
    }

    return done(null, keys.length || 0);
  });
};

sparkAlert.clearAlerts = function clearAlerts(param1, param2) {
  const module = param1;
  let done = param2;
  let search;

  if ((typeof module === 'string' || module instanceof String)) {
    search = `alerts:${module}:*`;
  } else {
    done = module;
    search = 'alerts:*';
  }

  // find the alert keys
  redis.keys(search, (err, keys) => {
    if (err) {
      return done(err);
    }

    if (!keys) {
      return done(null);
    }

    // create a pipeline command to remove all keys older
    // that the expire time from the lists
    const pipelineCmd = _.map(keys, n => ['del', n]);

    return redis
      .pipeline(pipelineCmd)
      .exec((e) => {
        if (e) {
          return done(e);
        }
        return done(null);
      });
  });
};

module.exports = sparkAlert;
