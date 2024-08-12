const path = require('path');
var pkg = require('../package.json');
var module = require('../index.js');
var should = require('chai').should();
var bunyan = require('bunyan');

let database = {};

/* Mock input as would be received from the node-ble module. */
let testList = {
    "00ab00cd0012": {
        id: "00ab00cd0012",
        address: "00:AB:00:CD:00:12",
        connectable: false,
        rssi: -37,
        localName: "Not-a-WAC",
        advertisement: {
          "JUNK DATA": "BLARGH"
        },
        timeDiscovered: 189283430
      },
    "00af0bcc0016": {
        id: "00af0bcc0016",
        address: "00:AF:0B:CC:00:16",
        connectable: true,
        rssi: -48,
        localName: "TE Applicator Count",
        advertisement: {
          localName: 'TE Applicator Count',
          txPowerLevel: undefined,
          manufacturerData: Buffer.from([0xea, 0x05, 0x01, 0x3f, 0x0c, 0x17,
                                         0x00, 0x00, 0x00, 0x6d, 0x55, 0x75,
                                         0x00, 0x0c, 0x41, 0x42, 0xf5, 0x03,
                                         0x00, 0x00, 0x03]),
          serviceData: [],
          serviceUuids: [],
          solicitationServiceUuids: [],
          serviceSolicitationUuids: []
          },

        timeDiscovered: 189283490
      },
    "00ba00cd0088": {
        id: "00ba00cd0088",
        address: "00:BA:00:CD:00:88",
        connectable: true,
        rssi: -59,
        localName: "TE Applicator Count",
        advertisement: {
          localName: 'TE Applicator Count',
          txPowerLevel: undefined,
          manufacturerData: Buffer.from([0xea, 0x05, 0x01, 0x3c, 0x0c, 0x32,
                                         0x00, 0x00, 0x00, 0x6d, 0x55, 0x75,
                                         0x00, 0x0c, 0x41, 0x42, 0xf8, 0x03,
                                         0x00, 0x00, 0x03]),
          serviceData: [],
          serviceUuids: [],
          solicitationServiceUuids: [],
          serviceSolicitationUuids: []
          },
        timeDiscovered: 189283474
      }
};

/* Expected filtered list */
let filteredList = {
  "00af0bcc0016": {
      id: "00af0bcc0016",
      address: "00:AF:0B:CC:00:16",
      connectable: true,
      rssi: -48,
      localName: "TE Applicator Count",
      advertisement: {
        localName: 'TE Applicator Count',
        txPowerLevel: undefined,
        manufacturerData: Buffer.from([0xea, 0x05, 0x01, 0x3f, 0x0c, 0x17,
                                       0x00, 0x00, 0x00, 0x6d, 0x55, 0x75,
                                       0x00, 0x0c, 0x41, 0x42, 0xf5, 0x03,
                                       0x00, 0x00, 0x03]),
        serviceData: [],
        serviceUuids: [],
        solicitationServiceUuids: [],
        serviceSolicitationUuids: []
        },

      timeDiscovered: 189283490
    },
  "00ba00cd0088": {
      id: "00ba00cd0088",
      address: "00:BA:00:CD:00:88",
      connectable: true,
      rssi: -59,
      localName: "TE Applicator Count",
      advertisement: {
        localName: 'TE Applicator Count',
        txPowerLevel: undefined,
        manufacturerData: Buffer.from([0xea, 0x05, 0x01, 0x3c, 0x0c, 0x32,
                                       0x00, 0x00, 0x00, 0x6d, 0x55, 0x75,
                                       0x00, 0x0c, 0x41, 0x42, 0xf8, 0x03,
                                       0x00, 0x00, 0x03]),
        serviceData: [],
        serviceUuids: [],
        solicitationServiceUuids: [],
        serviceSolicitationUuids: []
        },
      timeDiscovered: 189283474
    }
};

/* Expected data to be parsed */
let WACInfo = {
  "00af0bcc0016": {
    "companyCode": {data: 1514, varName: "00af0bcc0016-companyCode"},
    "serialNum": {data: 1013, varName: "00af0bcc0016-serialNum"},
    "count": {data: 23, varName: "00af0bcc0016-count"},
    "notifications": {data: 0, varName: "00af0bcc0016-notifications"},
    "partNum": {data: "1-7689581-2", varName: "00af0bcc0016-partNum"},
    "dashNum": {data: 0, varName: "00af0bcc0016-dashNum"},
    "revNum": {data: "AB", varName: "00af0bcc0016-revNum"},
    "batteryLevel": {data: 97.96875, varName: "00af0bcc0016-batteryLevel"},
    "rssi": {data: -48, varName: "00af0bcc0016-rssi"}
  },

  "00ba00cd0088": {
      "companyCode": {data: 1514, varName: "00ba00cd0088-companyCode"},
      "serialNum": {data: 1016, varName: "00ba00cd0088-serialNum"},
      "count": {data: 50, varName: "00ba00cd0088-count"},
      "notifications": {data: 0, varName: "00ba00cd0088-notifications"},
      "partNum": {data: "1-7689581-2", varName: "00ba00cd0088-partNum"},
      "dashNum": {data: 0, varName: "00ba00cd0088-dashNum"},
      "revNum": {data: "AB", varName: "00ba00cd0088-revNum"},
      "batteryLevel": {data: 97.875, varName: "00ba00cd0088-batteryLevel"},
      "rssi": {data: -59, varName: "00ba00cd0088-rssi"}
    }
};

let conf = {
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
  LOG_FILE: process.env.LOG_FILE || 'test.log',
  LOG_STORE_DIR: path.join(__dirname, 'logs'),

  machines: {
    "spark-machine-wac": {
      "variables": [],
      "settings": {
          "model": {
              "enable": true,
              "deviceList": "00af0bcc0016,00ba00cd0088",
              "updateRate": 5,
              "publishDisabled": false
             // There's a bug in the code...
        }  //           ________
      }  //      _____|         \_____
    }  //      _|    /\  0 _ 0  /\    \_
  }  //      _|    /  /\______/\  \     \_
   //     _|   _/  _|_|      \_\_ \_     \_
};

function reqSerializer(req) {
    return {
        method: req.method,
        url: req.url,
        headers: req.headers
    };
}

function resSerializer(res) {
    return {
        statusCode: res.statusCode,
        header: res._header
    };
}

/* Set up bunyan logging */
let log = bunyan.createLogger({
      name: pkg.name,
      level: conf.LOG_LEVEL,
      src: true,
      serializers: {
         err: bunyan.stdSerializers.err,
         req: reqSerializer,
         res: resSerializer
      },
     streams: [{
         path: conf.LOG_FILE
      }]
});

modules = {
    'spark-config': {
        exports: {
            set: function(key, value, done) {
                let path = key.split(':');
                let target = conf;

                while (path.length > 1) {
                    key = path.shift();
                    if (!(key in target)) {
                        target[key] = {};
                    }
                    target = target[key];
                }
                key = path.shift();
                target[key] = value;

                if (done) return done(null);
            },
            get: function(key, cb) {
                let path = key.split(':');
                let target = conf;

                let err = null;
                while (path.length > 0) {
                    key = path.shift();
                    if (target && target.hasOwnProperty(key))
                    {
                      target = target[key];
                      continue;
                    }
                    err = 'undefined';
                }

                var value = target;

                if(!cb)
                {
                  return value;
                }
                else
                {
                  return cb(err, value);
                }
            },

            listeners: function(){
                return {
                    indexOf: function(){
                        return 1;
                    }
                };
            }
        }
    },
    'spark-alert': {
        exports: {
            getAlerter: function(moduleName) {
                return {clearAll: function(cb) { return cb();}, preLoad: function() {}, clear: function() {}};
            }
        }
    },
    'spark-logging': {
        exports: {
            getLogger: function(moduleName) {
                return log.child({
                    module: moduleName
                });
            }
        }
    },
    'spark-db': {
        exports: {
            add: function(data, done) {

                let variable = data.variable;
                let index = Object.keys(database).length + 1;
                let dataObj = {};

                dataObj[variable] = data[data.variable];

                database[index] = dataObj;

                return done(null);
              },
            get: function(key, cb){
              for(var id in database)
              {
                if(database.variable === key)
                {
                  return cb(database);
                }
              }
            }
        }
    },
    'node-ble': {
      exports: {
        on: function(event, list){
          if(event === "newList")
          {
            return list(testList);
          }
        },
        removeListener: function(event, cb){
          log.debug("Removed Listener");
        },
        stop: function(){
          log.debug("Stopped node-ble");
        }
      }
    }
};
////////////////////////////////////////////////////////////////////////////////

/* Testing the module. */

function countProperties(obj)
{
  let count = 0;
  let size = Object.keys(obj).length;

  for(let i = 1; i < size; i++)
  {
    count = Object.keys(obj[i]).length;
  }

  return count;
}

describe('Spark WAC Machine', () => {

  /* Test that the module has started properly, i.e. the start function has been
   called with the correct arguments and that module is running. */
  it('should start when the inputs are valid', function(done){
    module.start(modules, (err, result) => {
      if (err)
      {
        return done(err);
      }
      else
      {
        module.getState().should.equal(true);
      }
    });

    module.stop(done);
  });

  /* Test that a list of devices is received and filtered. If the filtered output
     is as expected, the list must have been received correctly. */
  it('should recieve a list of bluetooth devices and filter out those that arent WACs', function(done){
    module.start(modules, (err, result) => {
      if (err)
      {
        return done(err);
      }
      else
      {
        module.getFilteredList().should.deep.equal(filteredList);
      }
    });

    module.stop(done);
  });

  /* Test that advertisement data is properly parsed. */
  it('should correctly parse data from the advertisements of each WAC', function(done){
    module.start(modules, (err, result) => {
      if (err)
      {
        return done(err);
      }
      else
      {
        console.log("In test:");
        console.log(WACInfo);
        module.getWacInfo().should.deep.equal(WACInfo);
      }
    });

    module.stop(done);
  });

  /* Test that the database has been correctly written to by checking for the
     correct number of key-value pairs and also making sure the values are
     as expected. */
  it('should write to the database in the correct form', function(done){
    this.timeout(25000); // Make sure it doesn't timeout too early

    module.start(modules, (err, result) => {
      if (err)
      {
        return done(err);
      }
      else
      {
        log.debug({
          result: result
        });
      }
    });

    setTimeout(() => {
      module.stop((err) => {
        if(err)
        {
          log.error(err);
        }
      });

      countProperties(database).should.equal(1); // Test number of key-value pairs per entry
      database[39].should.contain({"00af0bcc0016-count": 23}); // Key-value pairs as expexted

      return done();
    }, 20000);
  });
});
