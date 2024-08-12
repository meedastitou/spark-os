const { EventEmitter } = require('events');
const moment = require('moment');
const _ = require('lodash');
const IoRedis = require('ioredis');
const Ajv = require('ajv');
const pkg = require('./package.json');

let redis;
let redisSub;

const ajv = Ajv({
  allErrors: true,
});
const validateData = ajv.compile({
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: [
    'machine',
  ],
  properties: {
    machine: {
      description: 'Machine this data originates from',
      type: 'string',
      minLength: 1,
    },
    access: {
      type: 'string',
      enum: [
        'read',
        'write',
        'persist',
      ],
      default: 'read',
    },
  },
});

const info = {
  name: pkg.name,
  fullname: pkg.fullname,
  version: pkg.version,
  description: pkg.description,
};

let log;
let conf;
let started = false;
let timer = null;

const sparkdb = new EventEmitter();

sparkdb.expireTimeSec = 60 * 1; /* 1 minutes */

function removeKeyFromLists(machine, key, done) {
  // remove the key from our lists
  redis.keys(`machine:${machine}:lists:*`, (err, lists) => {
    const pipelineCmd = _.map(lists, n => ['zrem', n, key]);

    redis
      .pipeline(pipelineCmd)
      .exec((e, result) => {
        if (e) {
          return done(e);
        }
        return done(null, result);
      });
  });
}

function expireLists(machine, done) {
  const max = moment().subtract(sparkdb.expireTimeSec, 'seconds').format('x');

  // find the lists for this machine
  redis.keys(`machine:${machine}:lists:*`, (err, lists) => {
    // create a pipeline command to remove all keys older
    // that the expire time from the lists
    const pipelineCmd = _.map(lists, n => ['zremrangebyscore', n, '-inf', max]);

    redis
      .pipeline(pipelineCmd)
      .exec((e, keys) => {
        if (e) {
          return done(e);
        }
        return done(null, keys);
      });
  });
}

function jsonParse(json, done) {
  let obj;
  let err = null;

  try {
    obj = JSON.parse(json);
  } catch (e) {
    err = e;
    obj = null;
    log.error('Failed parsing json', err);
  }

  if (_.isFunction(done)) {
    return done(err, obj);
  }
  return obj;
}

sparkdb.start = function start(modules, done) {
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
      log.error({
        err,
      });
    }
  });

  // subscribe to key expire notifications
  redisSub.psubscribe('__keyspace@0__:machine:*', (err, count) => {
    log.debug({ err, count }, 'Subscribed to __keyspace@0__:machine:*');
  });

  redisSub.on('pmessage', (pattern, channel, operation) => {
    // log.debug({ pattern, channel, operation });

    // channel is in the form '__keyspace@0__:machine:machineName:[read|write]:xxxx
    const keySplit = channel.split(':');

    // remove __keyspace@0__ from the begining
    keySplit.shift();

    const key = keySplit.join(':');

    switch (operation) {
      case 'expired':
      {
        if (keySplit[2] === 'write') {
          sparkdb.emit('write-expired', key);
        } else {
          sparkdb.emit('expired', key);
        }

        break;
      }

      case 'set':
      {
        if (keySplit[2] === 'write') {
          sparkdb.emit('write-added', key);
        } else {
          sparkdb.emit('added', key);
        }

        break;
      }
      default:
        // do nothing
        break;
    }
  });

  log.info('Started', pkg.name);
  started = true;
  return done(null, info);
};

sparkdb.stop = function stop(done) {
  if (!started) {
    return done(new Error('not started'));
  }

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  // unsubscribe to notifications
  return redisSub.punsubscribe('__keyspace@0__:machine:*')
    .then((count) => {
      log.debug({ count }, 'Unsubscribed to __keyspace@0__:machine:*');
    })
    .catch(err => log.error(err))
    .finally(() => {
      log.info('Stopped', pkg.name);
      redisSub = null;
      started = false;
      return done();
    });
};

sparkdb.require = function require() {
  return [
    'spark-config',
    'spark-logging',
  ];
};

sparkdb.add = function add(inData, done) {
  if (!started) {
    return done(new Error('not started'));
  }

  // copy the input data object because
  // we will modify this and return it
  const data = _.clone(inData, true);

  // verify data is valid
  if (!validateData(inData)) {
    return done(new Error(ajv.errorsText(validateData.errors)));
  }

  const access = inData.access || 'read';

  // on the first write, schedule a repeating task that expires old keys from our lists
  if (timer === null) {
    timer = setInterval(() => {
      expireLists('*', (err) => {
        if (err) {
          log.error({
            err,
          });
        }
      });
    }, (sparkdb.expireTimeSec * 1000) / 2);
  }

  // create a new id for this data object
  return redis
    .pipeline()
    .incr(`machine:${inData.machine}:${access}:data_id`)
    .expire(`machine:${inData.machine}:${access}:data_id`, module.exports.expireTimeSec)
    .exec((err, result1) => {
      if (err) {
        return done(err);
      }

      const dataId = result1[0][1];

      const key = `machine:${inData.machine}:${access}:data:${dataId}`;

      const now = moment();
      const createdAt = now.format('x');

      // create a set of pipeline commands to update the lists
      const pipelineCmd = [];

      Object.keys(inData).forEach((attr) => {
        // there is no need to create a list of the access type
        if (attr === 'access') {
          return;
        }
        pipelineCmd.push(['zadd', `machine:${inData.machine}:${access}:lists:${attr}`, createdAt, key]);
        pipelineCmd.push(['expire', `machine:${inData.machine}:${access}:lists:${attr}`, module.exports.expireTimeSec]);
      });

      // save the dataId in the data object
      /* eslint no-underscore-dangle: 0 */
      data._id = dataId;

      // add a createdAt timestamp
      data.createdAt = now.toISOString();

      // store the access type
      data.access = access;

      // save the data object using the machine and data id as a key
      return redis
        .pipeline(pipelineCmd)
        .set(key, JSON.stringify(data))
        .expire(key, module.exports.expireTimeSec)
        .exec((e) => {
          if (e) {
            return done(e);
          }

          // log.debug({ data }, 'Added data');
          return done(null, data);
        });
    });
};

sparkdb.set = function set(inData, done) {
  if (!started) {
    return done(new Error('not started'));
  }

  // verify that this is persisent data
  if (!_.has(inData, 'access') || (inData.access !== 'persist')) {
    return done(new Error('only persisent data may be set'));
  }
  // verify data is valid
  if (!validateData(inData)) {
    return done(new Error(ajv.errorsText(validateData.errors)));
  }

  // copy the input data object because
  // we will modify this and return it
  const data = _.clone(inData, true);

  const key = `machine:${inData.machine}:persist:${inData.variable}`;

  // add a createdAt timestamp
  data.createdAt = moment().toISOString();

  // store the access type
  data.access = 'persist';

  return redis.set(key, JSON.stringify(data), (e) => {
    if (e) {
      return done(e);
    }

    return done(null, data);
  });
};

sparkdb.get = function get(key, done) {
  if (!started) {
    return done(new Error('not started'));
  }

  return redis.get(key, (err, result) => {
    if (err) {
      return done(err);
    }

    return jsonParse(result, done);
  });
};

sparkdb.getLatest = function getLatest(machine, field, done) {
  if (!started) {
    return done(new Error('not started'));
  }

  // get the current dataId
  return redis.zrevrange(`machine:${machine}:read:lists:${field}`, 0, 0, (err, keys) => {
    if (err) {
      return done(err);
    }

    if (keys.length === 0) {
      return done(null, {});
    }

    return redis.get(keys[0], (e, result) => {
      if (e) {
        return done(e);
      }

      return jsonParse(result, done);
    });
  });
};

sparkdb.getAll = function getAll(machine, done) {
  if (!started) {
    return done(new Error('not started'));
  }

  return redis.zrevrange(`machine:${machine}:read:lists:machine`, 0, -1, (err, keys) => {
    if (err) {
      return done(err);
    }

    if (keys.length === 0) {
      return done(null, []);
    }

    // create a pipeline command to query for all the keys
    const pipelineCmd = _.map(keys, n => ['get', n]);

    return redis
      .pipeline(pipelineCmd)
      .exec((e, result) => {
        if (e) {
          return done(e);
        }

        // flatten the results and remove any empty data
        let res = _.flatten(result).filter(n => !_.isEmpty(n));

        // json parse the results
        res = res.map(n => jsonParse(n));

        return done(null, res);
      });
  });
};

sparkdb.getMachines = function getMachines(done) {
  if (!started) {
    return done(new Error('not started'));
  }

  return redis.keys('machine:*:data_id', (err, result) => {
    if (err) {
      return done(err);
    }

    const res = [];
    result.forEach((i) => {
      res.push(i.split(':')[1]);
    });

    return done(null, _.uniq(res));
  });
};

sparkdb.delete = function del(key, done) {
  if (!started) {
    return done(new Error('not started'));
  }

  const machine = key.split(':')[1];

  // delete the key
  return redis.del(key, (err) => {
    if (err) {
      return done(err);
    }

    // remove the key from our lists
    return removeKeyFromLists(machine, key, (e) => {
      if (e) {
        return done(e);
      }
      return done(null);
    });
  });
};

sparkdb.deleteAll = function deleteAll(machine, done) {
  if (!started) {
    return done(new Error('not started'));
  }
  // find the keys for this machine
  return redis.keys(`machine:${machine}:*`, (err, keys) => {
    // create a pipeline command to remove all keys for this machine
    const pipeline = redis.pipeline();
    keys.forEach((key) => {
      pipeline.del(key);
    });

    pipeline.exec((e) => {
      if (e) {
        return done(e);
      }
      return done(null);
    });
  });
};

module.exports = sparkdb;
