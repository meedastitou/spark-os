const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const async = require('async');
const _ = require('lodash');
const should = require('chai').should();
const awsKinesis = require('aws-sdk');
const kinesalite = require('kinesalite');
const thisModule = require('../index.js');
const pkg = require('../package.json');

awsKinesis.config.region = 'us-east-1';
awsKinesis.config.credentials = new awsKinesis.Credentials({
  accessKeyId: 'TEST',
  secretAccessKey: 'TEST',
});

const kinesaliteServer = kinesalite({ path: './test/mydb', createStreamMs: 0 });
const kinesis = new awsKinesis.Kinesis({ region: 'us-east-1', endpoint: 'http://localhost:4567' });

// setup bunyan logging
const log = bunyan.createLogger({
  name: pkg.name,
  level: 'debug',
  src: true,
  streams: [{
    path: './test/test.log',
  }],
});

function has(object, key) {
  return (
    object !== undefined
      && key !== undefined
      && object[key] !== undefined
  );
}

const conf = {
  protocols: {
    'spark-protocol-aws-kinesis': {
      settings: {
        model: {
          enable: true,
          accessKeyId: 'TEST',
          secretAccessKey: 'TEST',
          region: 'us east (n. virginia)',
          kinesisStreamName: 'TEST',
        },
      },
    },
  },
  machines: {
    'my-machine1': {
      info: {
        name: 'my-machine1',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
        },
      },
      variables: {
        temperature: {
          name: 'temperature',
        },
      },
    },
    'my-machine2': {
      info: {
        name: 'my-machine2',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: true,
        },
      },
      variables: {
        count: {
          name: 'count',
        },
      },
    },
    'my-machineV': {
      info: {
        name: 'my-machineV',
        hpl: 'virtual',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: true,
        },
      },
      variables: {
        pressure: {
          name: 'pressure',
          srcVariables: [{
            srcVariable: 'temperature',
            srcMachine: 'my-machine1',
          }],
        },
      },
    },
  },
};

const sparkdb = new EventEmitter();
sparkdb.db = {};
sparkdb.add = function addKeyValuePairToDb(key, value) {
  sparkdb.db[key] = value;
  sparkdb.emit('added', key);
};
sparkdb.get = function getValueFromDbByKey(key, done) {
  return done(null, sparkdb.db[key]);
};

const sparkconfig = new EventEmitter();
sparkconfig.set = function setKeyValuePairInConfig(key, value, done) {
  log.debug(key, value);
  sparkconfig.emit('set', key);
  if (done) done(null);
};
sparkconfig.get = function getValueFromConfigByPath(key, cb) {
  const path = key.split(':');
  let pathKey = key;
  let target = conf;

  let err = null;
  while (path.length > 0) {
    pathKey = path.shift();

    if (target && has(target, pathKey)) {
      target = target[pathKey];
    } else {
      err = 'undefined';
    }
  }

  const value = target;

  if (!cb) {
    return value;
  }
  return cb(err, value);
};

let listenerSet = false;
sparkconfig.listeners = function mockListeners() {
  return {
    indexOf() {
      if (listenerSet) return 1;

      listenerSet = true;
      return -1;
    },
  };
};
sparkconfig.removeListener = function mockRemoveListeners() {};

const modules = {
  'spark-logging': {
    exports: {
      getLogger(moduleName) {
        return log.child({
          thisModule: moduleName,
        });
      },
      debug() {},
      info() {},
    },
  },
  'spark-db': {
    exports: sparkdb,
  },
  'spark-alert': {
    exports: {
      getAlerter() {
        const that = this;
        that.alerts = {};

        function updateAlert(_obj) {
          const obj = _obj;
          // iterate over keys in the object
          Object.keys(obj).forEach((k) => {
            // check if the key is a function
            if (typeof obj[k] === 'function') {
              // if it is then run the function and replace
              // the key with the output
              obj[k] = obj[k](obj);
            }
          });
          return obj;
        }

        return {
          clearAll(cb) { return cb(); },
          preLoad(alerts) {
            that.alerts = alerts;
          },
          clear() {},
          raise(_alert) {
            const alert = updateAlert(_.extend({}, _alert, that.alerts[_alert.key]));
            log.error({ alert }, 'Raised alert');
          },
        };
      },
    },
  },
  'spark-config': {
    exports: sparkconfig,
  },
};

function fetchRecordDataFromTestStream(callback) {
  // get the shard of the TEST stream
  const listShardsParams = {
    MaxResults: 1,
    StreamName: 'TEST',
  };
  kinesis.listShards(listShardsParams, (listShardsErr, listShardsData) => {
    if (listShardsErr) throw listShardsErr;

    // get the shard iterator
    const shardParams = {
      ShardId: listShardsData.Shards[0].ShardId,
      ShardIteratorType: 'TRIM_HORIZON',
      StreamName: 'TEST',
    };
    kinesis.getShardIterator(shardParams, (shardErr, shardData) => {
      if (shardErr) throw shardErr;

      // get the record from the shard iterator
      const recordParams = {
        ShardIterator: shardData.ShardIterator,
      };
      kinesis.getRecords(recordParams, (recordErr, recordData) => {
        if (recordErr) throw recordErr;

        // pass the records to the callback
        return callback(recordData);
      });
    });
  });
}

describe('Spark AWS Kinesis Producer', function describeTestHarness() {
  before((done) => {
    kinesaliteServer.listen(4567, (err) => {
      if (err) {
        return done(err);
      }

      return kinesis.listStreams({ Limit: 1 }, (err2, data) => {
        if (err2) {
          return done(err2);
        }

        if (data.StreamNames[0] !== 'TEST') {
          // if the TEST stream does not exist, create it
          const streamParams = {
            ShardCount: 1,
            StreamName: 'TEST',
          };

          return kinesis.createStream(streamParams, error => done(error));
        }

        return done(null);
      });
    });
  });

  this.timeout(2000);

  // amount of time (in ms) to wait for Kinesalite operations
  const wait = 50;

  it('require should succeed', (done) => {
    thisModule.require().should.be.instanceof(Array);
    return done();
  });

  it('should start when given valid credentials', (done) => {
    // start the producer
    thisModule.start(modules, (err, result) => {
      if (err) throw err;
      result.name.should.be.equal(pkg.name);
      return done();
    });
  });

  it('should produce new machine data to kinesis', (done) => {
    const time = new Date();

    // add new data
    const newData = {
      machine: 'my-machine1',
      variable: 'temperature',
      access: 'read',
      temperature: 1234,
      _id: 42,
      createdAt: time,
    };
    sparkdb.add('TEST', newData);

    setTimeout(() => {
      // check that 1234 was produced to kinesalite

      fetchRecordDataFromTestStream((recordData) => {
        // get the most recent record from the shard
        const dataLength = recordData.Records.length;
        const record = JSON.parse(recordData.Records[dataLength - 1].Data.toString());

        try {
          // record should be of type "record" and contain the payload 1234
          record.type.should.be.equal('record');
          record.data.attributes.temperature.value.should.be.equal(1234);
        } catch (e) {
          throw e;
        }

        return done();
      });
    }, wait);
  });

  it('should produce new machine metadata to kinesis when machine is enabled', (done) => {
    // alter machine metadata and emit the "set" event from config
    conf.machines['my-machine2'].settings.model.publishDisabled = false;
    sparkconfig.set('machines:my-machine2:settings:model:publishDisabled', false);

    setTimeout(() => {
      // check that metadata was produced to kinesalite

      fetchRecordDataFromTestStream((recordData) => {
        // get the most recent record from the shard
        const dataLength = recordData.Records.length;
        const record = JSON.parse(recordData.Records[dataLength - 1].Data.toString());

        // replicate the expected record
        const expected = {
          info: {
            name: 'my-machine2',
          },
          variables: {
            count: {
              name: 'count',
            },
          },
        };

        try {
          // record should be of type "metadata" and contain the updated metadata
          record.type.should.be.equal('metadata');
          JSON.stringify(record.data).should.be.equal(JSON.stringify(expected));
        } catch (e) {
          throw e;
        }

        return done();
      });
    }, wait);
  });

  it('should produce new virtual machine metadata to kinesis when machine is enabled', (done) => {
    // alter machine metadata and emit the "set" event from config
    conf.machines['my-machineV'].settings.model.publishDisabled = false;
    sparkconfig.set('machines:my-machineV:settings:model:publishDisabled', false);

    setTimeout(() => {
      // check that metadata was produced to kinesalite

      fetchRecordDataFromTestStream((recordData) => {
        // get the most recent record from the shard
        const dataLength = recordData.Records.length;
        const record = JSON.parse(recordData.Records[dataLength - 1].Data.toString());

        // replicate the expected record
        const expected = {
          info: {
            name: 'my-machineV',
            hpl: 'virtual',
          },
          variables: {
            pressure: {
              name: 'pressure',
              srcVariables: [{
                srcVariable: 'temperature',
                srcMachine: 'my-machine1',
              }],
              referencedMachineInfo: {
                name: 'my-machine1',
              },
              referencedMachineConfig: {
                enable: true,
                publishDisabled: false,
              },
              referencedVariable: {
                name: 'temperature',
              },
            },
          },
        };

        try {
          // record should be of type "metadata" and contain the updated metadata
          record.type.should.be.equal('metadata');
          JSON.stringify(record.data).should.be.equal(JSON.stringify(expected));
        } catch (e) {
          throw e;
        }

        return done();
      });
    }, wait);
  });

  it('should produce new machine metadata to kinesis when variables are changed', (done) => {
    // alter machine metadata and emit the "set" event from config
    conf.machines['my-machine2'].variables.humidity = { name: 'humidity' };
    sparkconfig.set('machines:my-machine2:variables', null);

    setTimeout(() => {
      // check that metadata was produced to kinesalite

      fetchRecordDataFromTestStream((recordData) => {
        // get the most recent record from the shard
        const dataLength = recordData.Records.length;
        const record = JSON.parse(recordData.Records[dataLength - 1].Data.toString());

        // replicate the expected record
        const expected = {
          info: {
            name: 'my-machine2',
          },
          variables: {
            count: {
              name: 'count',
            },
            humidity: {
              name: 'humidity',
            },
          },
        };

        try {
          // record should be of type "metadata" and contain the updated metadata
          record.type.should.be.equal('metadata');
          JSON.stringify(record.data).should.be.equal(JSON.stringify(expected));
        } catch (e) {
          throw e;
        }

        return done();
      });
    }, wait);
  });

  it('should produce new virtual machine metadata to kinesis when variables are changed', (done) => {
    // alter machine metadata and emit the "set" event from config
    conf.machines['my-machineV'].variables.count = {
      name: 'count',
      srcVariables: [{
        srcVariable: 'count',
        srcMachine: 'my-machine2',
      }],
    };
    sparkconfig.set('machines:my-machineV:variables', null);

    setTimeout(() => {
      // check that metadata was produced to kinesalite

      fetchRecordDataFromTestStream((recordData) => {
        // get the most recent record from the shard
        const dataLength = recordData.Records.length;
        const record = JSON.parse(recordData.Records[dataLength - 1].Data.toString());

        // replicate the expected record
        const expected = {
          info: {
            name: 'my-machineV',
            hpl: 'virtual',
          },
          variables: {
            pressure: {
              name: 'pressure',
              srcVariables: [{
                srcVariable: 'temperature',
                srcMachine: 'my-machine1',
              }],
              referencedMachineInfo: {
                name: 'my-machine1',
              },
              referencedMachineConfig: {
                enable: true,
                publishDisabled: false,
              },
              referencedVariable: {
                name: 'temperature',
              },
            },
            count: {
              name: 'count',
              srcVariables: [{
                srcVariable: 'count',
                srcMachine: 'my-machine2',
              }],
              referencedMachineInfo: {
                name: 'my-machine2',
              },
              referencedMachineConfig: {
                enable: true,
                publishDisabled: false,
              },
              referencedVariable: {
                name: 'count',
              },
            },
          },
        };

        try {
          // record should be of type "metadata" and contain the updated metadata
          record.type.should.be.equal('metadata');
          JSON.stringify(record.data).should.be.equal(JSON.stringify(expected));
        } catch (e) {
          throw e;
        }

        return done();
      });
    }, wait);
  });

  it('should only produce complete records', (done) => {
    const time = new Date();

    // add new count data
    const countData = {
      machine: 'my-machine2',
      variable: 'count',
      access: 'read',
      count: 1234,
      _id: 43,
      createdAt: time,
    };
    sparkdb.add('TEST', countData);

    // add new humidity data
    const humidityData = {
      machine: 'my-machine2',
      variable: 'humidity',
      access: 'read',
      humidity: 5678,
      _id: 43,
      createdAt: time,
    };
    sparkdb.add('TEST', humidityData);

    setTimeout(() => {
      // check that ONLY the complete record was produced to kinesalite

      fetchRecordDataFromTestStream((recordData) => {
        // get the most recent record from the shard
        const dataLength = recordData.Records.length;
        const record = JSON.parse(recordData.Records[dataLength - 1].Data.toString());
        const prevRecord = JSON.parse(recordData.Records[dataLength - 2].Data.toString());

        try {
          // record should be of type "record" and contain the payload 5678
          record.type.should.be.equal('record');
          record.data.attributes.count.value.should.be.equal(1234);
          record.data.attributes.humidity.value.should.be.equal(5678);

          // the previous record should be metadata from previous test
          prevRecord.type.should.be.equal('metadata');
        } catch (e) {
          throw e;
        }

        return done();
      });
    }, wait);
  });

  it('should not send an incomplete record when it is interrupted by a different record', (done) => {
    const time = new Date();

    // alter metadata to form a buffer record between this test and the previous one
    conf.machines['my-machine1'].variables.partsMade = { name: 'partsMade' };
    sparkconfig.set('machines:my-machine1:variables', null);

    // add record 1 part 1/2
    const record1Part1 = {
      machine: 'my-machine2',
      variable: 'count',
      access: 'read',
      count: 1234,
      _id: 43,
      createdAt: time,
    };
    sparkdb.add('TEST', record1Part1);

    // add record 2 part 1/2
    const record2Part1 = {
      machine: 'my-machineV',
      variable: 'pressure',
      access: 'read',
      pressure: 8765,
      _id: 43,
      createdAt: time,
    };
    sparkdb.add('TEST', record2Part1);

    // add record 2 part 2/2
    const record2Part2 = {
      machine: 'my-machineV',
      variable: 'count',
      access: 'read',
      count: 4321,
      _id: 43,
      createdAt: time,
    };
    sparkdb.add('TEST', record2Part2);

    // add record 1 part 2/2
    const record1Part2 = {
      machine: 'my-machine2',
      variable: 'humidity',
      access: 'read',
      humidity: 5678,
      _id: 43,
      createdAt: time,
    };
    sparkdb.add('TEST', record1Part2);

    setTimeout(() => {
      // check that ONLY record 2 was produced to kinesalite

      fetchRecordDataFromTestStream((recordData) => {
        // get the most recent record from the shard
        const dataLength = recordData.Records.length;
        const record = JSON.parse(recordData.Records[dataLength - 1].Data.toString());
        const prevRecord = JSON.parse(recordData.Records[dataLength - 2].Data.toString());

        try {
          // record should be of type "record" and contain the payload 5678
          record.type.should.be.equal('record');
          record.data.attributes.pressure.value.should.be.equal(8765);
          record.data.attributes.count.value.should.be.equal(4321);

          // the previous record should be metadata from the buffer record
          prevRecord.type.should.be.equal('metadata');
        } catch (e) {
          throw e;
        }

        return done();
      });
    }, wait);
  });

  it('should not send records for a machine with publishing disabled', (done) => {
    const time = new Date();

    async.series([
      function produceMetadataRecord(cb) {
        // alter machine metadata to create a metadata record
        conf.machines['my-machine2'].variables = { count: { name: 'count' } };
        sparkconfig.set('machines:my-machine2:variables', { count: { name: 'count' } });
        cb(null);
      },
      function disablePublishing(cb) {
        // disable the machine's publishing
        conf.machines['my-machine2'].settings.model.publishDisabled = true;
        sparkconfig.set('machines:my-machine2:settings:model:publishDisabled', true);
        cb(null);
      },
      function attemptToProduceDataRecord(cb) {
        // add new data for machine 2
        const countData = {
          machine: 'my-machine2',
          variable: 'count',
          access: 'read',
          count: 1234,
          _id: 43,
          createdAt: time,
        };
        sparkdb.add('TEST', countData);

        cb(null);
      }],
    (err) => {
      if (err) throw err;

      // ensure that the most recent record is the metadata from the start of the test
      fetchRecordDataFromTestStream((recordData) => {
        // get the most recent record from the shard
        const dataLength = recordData.Records.length;
        const record = JSON.parse(recordData.Records[dataLength - 1].Data.toString());

        try {
          // record should be of type "metadata"
          record.type.should.be.equal('metadata');
        } catch (e) {
          throw e;
        }

        return done();
      });
    });
  });

  it('should stop without issue', (done) => {
    // stop the producer
    thisModule.stop((err) => {
      if (err) throw err;
      return done();
    });
  });

  it('should not start if disabled at initialization', (done) => {
    const time = new Date();

    // disable the producer in the config
    conf.protocols['spark-protocol-aws-kinesis'].settings.model.enable = false;

    // start the producer
    thisModule.start(modules, (err) => {
      if (err) throw err;
    });

    // ensure that the producer does not send any new records
    let lastRecord;

    async.series([
      function fetchTheLastRecord(cb) {
        // get the most recent record

        fetchRecordDataFromTestStream((recordData) => {
          // get the most recent record from the shard
          const dataLength = recordData.Records.length;
          lastRecord = JSON.parse(recordData.Records[dataLength - 1].Data.toString());
        });
        return cb(null);
      },
      function attemptToProduceDataRecord(cb) {
        // add new data
        const newData = {
          machine: 'my-machine1',
          variable: 'temperature',
          access: 'read',
          temperature: 1234,
          _id: 42,
          createdAt: time,
        };
        sparkdb.add('TEST', newData);

        cb(null);
      },
      function fetchTheMostRecentRecord(cb) {
        // ensure that the most recent record has not changed

        fetchRecordDataFromTestStream((recordData) => {
          // get the most recent record from the shard
          const dataLength = recordData.Records.length;
          const record = JSON.parse(recordData.Records[dataLength - 1].Data.toString());

          return cb(null, record);
        });
      }],
    (err, result) => {
      const expectedRecord = JSON.stringify(lastRecord);
      const actualRecord = JSON.stringify(result[2]);

      actualRecord.should.be.equal(expectedRecord);

      done();
    });
  });

  it('should not start if region is undefined', (done) => {
    // pass undefined region
    conf.protocols['spark-protocol-aws-kinesis'].settings.model = {
      enable: true,
      accessKeyId: 'TEST',
      secretAccessKey: 'TEST',
      region: '',
      kinesisStreamName: 'TEST',
    };

    // expect starting the producer to fail
    thisModule.start(modules, (err, result) => {
      should.equal(result, undefined);
      return done();
    });
  });

  it('should not start if region is not a valid AWS region', (done) => {
    // pass undefined region
    conf.protocols['spark-protocol-aws-kinesis'].settings.model = {
      enable: true,
      accessKeyId: 'TEST',
      secretAccessKey: 'TEST',
      region: 'bad-region',
      kinesisStreamName: 'TEST',
    };

    // expect starting the producer to fail
    thisModule.start(modules, (err, result) => {
      should.equal(result, undefined);
      return done();
    });
  });

  it('should stop if disabled after starting', (done) => {
    // enable the producer in the config
    conf.protocols['spark-protocol-aws-kinesis'].settings.model = {
      enable: true,
      accessKeyId: 'TEST',
      secretAccessKey: 'TEST',
      region: 'us east (n. virginia)',
      kinesisStreamName: 'TEST',
    };

    // start the producer
    thisModule.start(modules, (err) => {
      if (err) throw err;
    });

    setTimeout(() => {
      // disable the producer in the config and emit that changes have been made
      conf.protocols['spark-protocol-aws-kinesis'].settings.model.enable = false;
      sparkconfig.set('protocols:spark-protocol-aws-kinesis:settings:model:enable', false);

      // ensure that the producer does not send any new records
      let lastRecord;
      const time = new Date();

      async.series([
        function fetchTheLastRecord(cb) {
          // get the most recent record

          fetchRecordDataFromTestStream((recordData) => {
            // get the most recent record from the shard
            const dataLength = recordData.Records.length;
            lastRecord = JSON.parse(recordData.Records[dataLength - 1].Data.toString());
          });
          return cb(null);
        },
        function attemptToProduceDataRecord(cb) {
          // add new data
          const newData = {
            machine: 'my-machine1',
            variable: 'temperature',
            access: 'read',
            temperature: 1234,
            _id: 42,
            createdAt: time,
          };
          sparkdb.add('TEST', newData);

          cb(null);
        },
        function fetchTheMostRecentRecord(cb) {
          // ensure that the most recent record has not changed

          fetchRecordDataFromTestStream((recordData) => {
            // get the most recent record from the shard
            const dataLength = recordData.Records.length;
            const record = JSON.parse(recordData.Records[dataLength - 1].Data.toString());

            return cb(null, record);
          });
        }],
      (err, result) => {
        const expectedRecord = JSON.stringify(lastRecord);
        const actualRecord = JSON.stringify(result[2]);

        actualRecord.should.be.equal(expectedRecord);

        done();
      });
    }, wait);
  });
});
