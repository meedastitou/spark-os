/* spark-config can't use spark-logging because spark-logging requires spark-config */
/* so allow console errors and warning only.  No other module should do this */
/* eslint no-console: ["error", { allow: ["warn", "error"] }] */

const { EventEmitter } = require('events');
const { URL } = require('url');
const IoRedis = require('ioredis');
const _ = require('lodash');

const nconf = require('nconf');
const pkg = require('./package.json');
// Require `nconf-redis` to extend `nconf`
require('nconf-redis');

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};

const sparkConfig = new EventEmitter();

const DEFAULT_REDIS_URL = process.env.DEFAULT_REDIS_URL || 'redis://localhost:6379/0';

sparkConfig.defaultConf = null;
sparkConfig.namespace = 'nconf';

function getRedisUrl() {
  let redisUrl;
  try {
    redisUrl = new URL(nconf.get('REDIS_URL'));
    if (redisUrl.protocol !== 'redis:') {
      throw new Error('wrong protocol');
    }
    [, redisUrl.db] = redisUrl.pathname.split('/');
  } catch (e) {
    redisUrl = new URL(DEFAULT_REDIS_URL);
    redisUrl.db = 0;
  }
  return redisUrl;
}

sparkConfig.start = function start(modules, done) {
  // read environment vaiables
  nconf.env();

  const redisUrl = getRedisUrl();
  // console.log(redisUrl.toString());

  // setup the redis config store
  nconf.use('redis', {
    namespace: sparkConfig.namespace,
    host: redisUrl.hostname,
    port: redisUrl.port,
    db: redisUrl.db,
  });

  // setup default values
  if (sparkConfig.defaultConf) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const defaultConf = require(sparkConfig.defaultConf);
      nconf.defaults(defaultConf.config());
    } catch (e) {
      // console.error(`Failed reading ${sparkConfig.defaultConf}`, e);
    }
  }

  sparkConfig.redis = new IoRedis(redisUrl.toString());
  const redisSub = new IoRedis(redisUrl.toString());

  // enable notifications, redis disables this by default
  redisSub.config('SET', 'notify-keyspace-events', 'KEA', (/* err */) => {
    // console.log({ err }, 'SET', 'notify-keyspace-events', 'KEA');
  });

  // subscribe to notifications for the nconf namespace
  redisSub.psubscribe(`__keyspace@0__:${sparkConfig.namespace}:*`, (/* err, count */) => {
    // console.log({ err, count }, `Subscribed to __keyspace@0__:${sparkConfig.namespace}:*`);
  });

  redisSub.on('pmessage', (pattern, channel, operation) => {
    // console.log(pattern, channel, operation);

    if (operation !== 'set') {
      return;
    }

    const keySplit = channel.split(':');

    // remove the namespace from the start of the key
    keySplit.shift();
    keySplit.shift();
    const key = keySplit.join(':');

    // emit that a key has been set, but only for 'model' settings changes ..
    const reSettings = new RegExp(':settings:model:*');
    // or variable changes
    const reVariables = new RegExp(':variables$');
    // or hardware scanner changes
    const reHwscan = new RegExp('^hardware:[0-9]:');

    if ((reSettings.test(key)) || reVariables.test(key) || (reHwscan.test(key))) {
      sparkConfig.emit('set', key);
    }
  });

  // console.log("Started", pkg.name);
  return done(null, info);
};

sparkConfig.stop = function stop(done) {
  return done(null);
};

sparkConfig.require = function require() {
  return [];
};

sparkConfig.set = function set(key, value, done) {
  nconf.set(key, value, err => done(err));
};

sparkConfig.get = function get(key, done) {
  if (done) {
    return nconf.get(key, (err, value) => done(err, value));
  }
  return nconf.get(key);
};

// allow omitKeys to be optional
sparkConfig.getFiltered = function getFiltered(param1, param2, param3) {
  const base = param1;
  let omitKeys = param2;
  let done = param3;

  if (typeof param2 === 'function') {
    omitKeys = null;
    done = param2;
  }

  // get all the keys
  sparkConfig.redis.keys(`${sparkConfig.namespace}:${base}*`, (keysErr, keys) => {
    if (keysErr || _.isEmpty(keys)) {
      return done(keysErr, {});
    }

    // filter out any keys we are not interested in
    let omitKeysProcessed = [];
    if (_.isArray(omitKeys)) {
      omitKeysProcessed = omitKeys.map(x => x.replace('.', ':'));
    }
    omitKeysProcessed.push('keys');
    const keysfiltered = keys.filter(k => !omitKeysProcessed.some(o => k.includes(o)));

    if (_.isEmpty(keysfiltered)) {
      return done(null, {});
    }

    // get all the data from all these keys
    return sparkConfig.redis.mget(keysfiltered, (mgetErr, result) => {
      if (mgetErr || _.isEmpty(result)) {
        // it's hard to trigger this.  Would require between the time we got
        // the keys and did mget that the keys were removed
        return done(mgetErr, {});
      }

      // convert the results array into an object
      const out = {};
      result.forEach((r, i) => {
        const key = keysfiltered[i];
        const p = key.split(':');
        let target = out;
        while (p.length > 1) {
          const k = p.shift();
          if (!_.has(target, k)) {
            target[k] = {};
          }
          target = target[k];
        }
        const k = p.shift();
        target[k] = JSON.parse(r);
      });

      return done(null, _.get(out[sparkConfig.namespace], base.replace(':', '.')));
    });
  });
};

sparkConfig.clear = function clear(key, done) {
  nconf.clear(key, err => done(err));
};

module.exports = sparkConfig;
