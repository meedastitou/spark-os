require('chai').should();
const os = require('os');
const { EventEmitter } = require('events');
const bunyan = require('bunyan');
const _ = require('lodash');
const async = require('async');
const moment = require('moment');
const opcua = require('node-opcua');
const pkg = require('../package.json');
const sparkOpcUa = require('../index.js');

const log = bunyan.createLogger({
  name: pkg.name,
  level: 'DEBUG',
  src: true,
  streams: [{
    path: 'test.log',
  }],
});

const opcuaClient = opcua.OPCUAClient.create();
const opcuaUrl = `opc.tcp://${os.hostname()}:4334`;

function createOpcuaSession(done) {
  async.waterfall([
    (cb) => {
      opcuaClient.connect(opcuaUrl, err => cb(err));
    },
    (cb) => {
      opcuaClient.createSession((err, session) => cb(err, session));
    },
  ],
  (err, session) => done(err, session));
}

function browseMachines(session, done) {
  // browse the root folder
  session.browse('RootFolder', (rootErr, rootResults) => {
    if (rootErr) return done(rootErr);

    // find the objects
    const obj = _.find(rootResults.references, o => _.get(o, 'browseName.name') === 'Objects');

    // browse the objects
    return session.browse(obj.nodeId, (objErr, objResults) => {
      if (objErr) return done(objErr);

      // arrange the results to remove items
      // we are not interested in
      const ignoreList = ['Root', 'FolderType', 'Server', 'DeviceSet', 'NetworkSet', 'DeviceTopology'];
      const result = objResults.references
        .map(m => m.browseName.name)
        .filter(f => !ignoreList.includes(f))
        .sort();

      return done(null, result);
    });
  });
}

const sparkdb = new EventEmitter();
sparkdb.db = {};
sparkdb.add = function add(_data, done) {
  const now = moment();
  const data = _data;
  data.createdAt = now.format('x');
  const { machine, variable } = data;
  _.set(sparkdb.db, [machine, variable], data);
  sparkdb.emit('added', data);
  if (done) { return done(null, data); }
  return data;
};
sparkdb.get = function get(key, done) {
  const data = _.get(sparkdb.db, key);
  const err = _.get(data, 'err', null);
  return done(err, _.get(data, 'result', data));
};
sparkdb.getLatest = function getLatest(machine, variable, done) {
  const data = _.get(sparkdb.db, [machine, variable]);
  const err = _.get(data, 'err', null);
  return done(err, _.get(data, 'result', data));
};

const conf = {
  machines: {
    machine1: {
      info: {
        name: 'machine1',
        description: 'i start enabled',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'int16ToBool',
          format: 'int16',
          outputFormat: 'bool',
        },
        {
          name: 'float',
          format: 'float',
        },
        {
          name: 'double',
          format: 'double',
        },
        {
          name: 'int8',
          format: 'int8',
        },
        {
          name: 'int16',
          format: 'int16',
        },
        {
          name: 'int32',
          format: 'int32',
        },
        {
          name: 'uint8',
          format: 'uint8',
        },
        {
          name: 'uint16',
          format: 'uint16',
        },
        {
          name: 'uint32',
          format: 'uint32',
        },
        {
          name: 'char',
          format: 'char',
        },
        {
          name: 'bool',
          format: 'bool',
          array: false,
        },
        {
          name: 'object',
          format: 'object',
          array: false,
        },
        {
          name: 'floatarray',
          format: 'float',
          array: true,
        },
        {
          name: 'doublearray',
          format: 'double',
          array: true,
        },
        {
          name: 'int8array',
          format: 'int8',
          array: true,
        },
        {
          name: 'int16array',
          format: 'int16',
          array: true,
        },
        {
          name: 'int32array',
          format: 'int32',
          array: true,
        },
        {
          name: 'uint8array',
          format: 'uint8',
          array: true,
        },
        {
          name: 'uint16array',
          format: 'uint16',
          array: true,
        },
        {
          name: 'uint32array',
          format: 'uint32',
          array: true,
        },
        {
          name: 'string',
          format: 'char',
          array: true,
        },
        {
          name: 'boolarray',
          format: 'bool',
          array: true,
        },
        {
          name: 'objectarray',
          format: 'object',
          array: true,
        },
        {
          name: 'nodatatype',
        },
      ],
    },
    machine2: {
      info: {
        name: 'machine2',
        description: 'i start disabled',
      },
      settings: {
        model: {
          enable: false,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'pressure',
          format: 'float',
          access: 'read',
        },
        {
          name: 'count',
          format: 'int16',
          access: 'write',
        },
        {
          name: 'countarray',
          format: 'int16',
          access: 'write',
          array: true,
        },
        {
          name: 'readWriteTest',
          format: 'int16',
          access: 'write',
          enableReadWrite: true,
          initialValue: 123,
        },
        {
          name: 'readWriteIntReadTest',
          format: 'int16',
          access: 'write',
          enableReadWrite: true,
        },
        {
          name: 'readWriteBoolReadTest',
          format: 'bool',
          access: 'write',
          enableReadWrite: true,
        },
        {
          name: 'readWriteStringReadTest',
          format: 'char',
          access: 'write',
          enableReadWrite: true,
        },
      ],
    },
    machine3: {
      info: {
        name: 'machine3',
        description: 'i don\'t have unique variable names',
      },
      settings: {
        model: {
          enable: false,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'pressure',
          format: 'float',
        },
        {
          name: 'temperature',
          format: 'float',
        },
        {
          name: 'pressure',
          format: 'float',
        },
      ],
    },
    machine4: {
      // missing info
      settings: {
        model: {
          enable: false,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'pressure',
          format: 'float',
        },
      ],
    },
  },
};

const sparkConfig = new EventEmitter();
sparkConfig.set = function set(key, value, done) {
  log.debug({ key, value }, 'conf.set');
  _.set(conf, key.split(':'), _.cloneDeep(value));
  sparkConfig.emit('set', key);
  if (done) return done(null);
  return undefined;
};
sparkConfig.get = function get(key, cb) {
  const value = _.cloneDeep(_.get(conf, key.split(':')));
  log.debug({ key, value }, 'conf.get');
  if (!cb) {
    return value;
  }
  return cb(null, value);
};

const sparkAlert = new EventEmitter();
sparkAlert.getAlerter = function getAlerter() {
  return {
    clearAll(done) {
      return done(null);
    },
    preLoad() {},
    raise(data) {
      log.error({ data }, 'Raised alert');
      sparkAlert.emit('raise', data);
    },
    clear(key) {
      log.debug({ key }, 'Cleared alert');
    },
  };
};

const modules = {
  'spark-logging': {
    exports: {
      getLogger(moduleName) {
        return log.child({
          module: moduleName,
        });
      },
    },
  },
  'spark-db': {
    exports: sparkdb,
  },
  'spark-alert': {
    exports: sparkAlert,
  },
  'spark-config': {
    exports: sparkConfig,
  },
};

const validValues = [{
  name: 'int16ToBool',
  value: true,
  dataType: opcua.DataType.Boolean,
}, {
  name: 'float',
  // value: Number.MAX_VALUE,
  value: 100.0,
  dataType: opcua.DataType.Float,
},
{
  name: 'double',
  // value: Number.MAX_VALUE,
  value: 100.0,
  dataType: opcua.DataType.Double,
},
{
  name: 'int8',
  value: ((2 ** 7) - 1),
  dataType: opcua.DataType.SByte,
},
{
  name: 'int16',
  value: ((2 ** 15) - 1),
  dataType: opcua.DataType.Int16,
},
{
  name: 'int32',
  value: ((2 ** 31) - 1),
  dataType: opcua.DataType.Int32,
},
{
  name: 'uint8',
  value: ((2 ** 8) - 1),
  dataType: opcua.DataType.Byte,
},
{
  name: 'uint16',
  value: ((2 ** 16) - 1),
  dataType: opcua.DataType.UInt16,
},
{
  name: 'uint32',
  value: ((2 ** 32) - 1),
  dataType: opcua.DataType.UInt32,
},
{
  name: 'char',
  value: 'A',
  dataType: opcua.DataType.String,
},
{
  name: 'bool',
  value: true,
  dataType: opcua.DataType.Boolean,
},
{
  name: 'object',
  value: { prop1: 0, prop2: 2 },
  dataType: opcua.DataType.String,
},
{
  name: 'floatarray',
  value: [1.0, 2.0, 3.0, 4.0],
  dataType: opcua.DataType.Float,
},
{
  name: 'doublearray',
  value: [1.0, 2.0, 3.0, 4.0],
  dataType: opcua.DataType.Double,
},
{
  name: 'int8array',
  value: [1, 2, 3, 4],
  dataType: opcua.DataType.SByte,
},
{
  name: 'int16array',
  value: [1, 2, 3, 4],
  dataType: opcua.DataType.Int16,
},
{
  name: 'int32array',
  value: [1, 2, 3, 4],
  dataType: opcua.DataType.Int32,
},
{
  name: 'uint8array',
  value: [1, 2, 3, 4],
  dataType: opcua.DataType.Byte,
},
{
  name: 'uint16array',
  value: [1, 2, 3, 4],
  dataType: opcua.DataType.UInt16,
},
{
  name: 'uint32array',
  value: [1, 2, 3, 4],
  dataType: opcua.DataType.UInt32,
},
{
  name: 'string',
  value: 'ABCDEFG',
  dataType: opcua.DataType.String,
},
{
  name: 'boolarray',
  value: [true, false, true, false],
  dataType: opcua.DataType.Boolean,
},
{
  name: 'objectarray',
  value: [{ prop1: 0, prop2: 2 }, { prop1: 1, prop2: 3 }],
  dataType: opcua.DataType.String,
},
];

const outOfBoundsValues = [
  {
    name: 'int8',
    value: 128,
  },
  {
    name: 'int16',
    value: 32768,
  },
  {
    name: 'int32',
    value: 2147483648,
  },
  {
    name: 'uint8',
    value: 256,
  },
  {
    name: 'uint16',
    value: 65536,
  },
  {
    name: 'uint32',
    value: 4294967296,
  },
];

const typeErrorValues = [
  {
    name: 'bool',
    value: 'TRUE',
  },
  {
    name: 'int16',
    value: '1234',
  },
  {
    name: 'char',
    value: 1234,
  },
];


describe('Spark OPC-UA', () => {
  it('require should succeed', (done) => {
    const result = sparkOpcUa.require();
    result.should.be.instanceof(Array);
    result.should.eql(['spark-logging', 'spark-db', 'spark-alert', 'spark-config']);
    return done();
  });

  it('stop should error when not started', (done) => {
    sparkOpcUa.stop((err, result) => {
      if (result) throw new Error('result should not be set');
      if (!err) throw new Error('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('opcua should start disabled when no model is defined', (done) => {
    sparkOpcUa.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-protocol-opcua');
      return done();
    });
  });

  it('Enabling a machine should be ignored when opcua is disabled', (done) => {
    sparkConfig.set('machines:machine1:settings:model:enable', true);
    return done();
  });

  it('stop should succeed when started', (done) => {
    sparkOpcUa.stop((err) => {
      if (err) done(err);
      return done();
    });
  });

  it('start should raise and alert when passed invalid inputs', (done) => {
    conf.protocols = {
      'spark-protocol-opcua': {
        settings: {
          model: {
            enable: true,
            opcuaPort: 4334,
          },
        },
      },
    };

    const configGet = sparkConfig.get;
    sparkConfig.get = function get(key, cb) {
      if (key === 'machines') return cb(new Error('this is an error'));
      return configGet(key, cb);
    };

    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('initialization-error');
      alert.msg.should.equal('OPC-UA: Error whilst Initializing');
      alert.description.should.equal('Error: this is an error');
      sparkAlert.removeAllListeners('raise');
    });

    sparkOpcUa.start(modules, (err) => {
      if (err) return done(err);
      sparkConfig.get = configGet;
      return done();
    });
  });

  it('start should succeed when passed valid inputs', (done) => {
    sparkOpcUa.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-protocol-opcua');
      return done();
    });
  });

  it('start should error when already started', (done) => {
    sparkOpcUa.start(modules, (err, result) => {
      if (result) throw new Error('result should not be set');
      if (!err) throw new Error('err not set');
      err.should.be.instanceof(Error);
      return done();
    });
  });

  it('stop should succeed when started', (done) => {
    sparkOpcUa.stop((err) => {
      if (err) done(err);
      return done();
    });
  });

  it('start should succeed but raise an alert for machines with no unique variables', (done) => {
    conf.machines.machine5 = {
      info: {
        name: 'machine5',
        description: 'i don\'t have unique variable names',
      },
      settings: {
        model: {
          enable: true,
          publishDisabled: false,
        },
      },
      variables: [
        {
          name: 'pressure',
          format: 'float',
        },
        {
          name: 'temperature',
          format: 'float',
        },
        {
          name: 'pressure',
          format: 'float',
        },
      ],
    };

    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('invalid-machine-machine5');
      alert.msg.should.equal('OPC-UA: Machine contains non-unique variable names');
      alert.description.should.equal('OPC-UA is not able to add the machine5 machine to its list as it contains non-unique variable names. Please fix its machine definition.');
      sparkAlert.removeAllListeners('raise');
    });

    sparkOpcUa.start(modules, (err, result) => {
      if (err) return done(err);
      result.name.should.equal('spark-protocol-opcua');
      return done();
    });
  });

  let theSession;
  it('opcua client connect should succeed', (done) => {
    createOpcuaSession((createErr, session) => {
      if (createErr) return done(createErr);
      theSession = session;

      return browseMachines(theSession, (browseErr, result) => {
        if (browseErr) return done(browseErr);
        result.should.be.instanceof(Array);
        result.should.eql(['machine1']);
        return done();
      });
    });
  });

  validValues.forEach((v) => {
    it(`Reading a valid ${v.name} from machine1 should succeed`, (done) => {
      const data = {
        machine: 'machine1',
        variable: v.name,
      };
      data[v.name] = v.value;
      sparkdb.add(data);

      const a = Array.isArray(v.value) ? 'A' : 'S';
      const nodeToRead = {
        nodeId: `ns=2;s=machine1,${v.name},${a}`,
        attributeId: opcua.AttributeIds.Value,
      };
      theSession.read(nodeToRead, 0, (err, result) => {
        if (err) return done(err);
        if (Array.isArray(v.value)) {
          result.value.arrayType.should.eql(opcua.VariantArrayType.Array);
          if (v.name === 'objectarray') {
            Object.values(_.map(result.value.value, JSON.parse)).should.eql(v.value);
          } else {
            Object.values(result.value.value).should.eql(v.value);
          }
        } else {
          result.value.arrayType.should.eql(opcua.VariantArrayType.Scalar);
          if (v.name === 'object') {
            JSON.parse(result.value.value).should.eql(v.value);
          } else {
            result.value.value.should.eql(v.value);
          }
        }
        result.value.dataType.should.eql(v.dataType);
        result.statusCode.name.should.equal('Good');
        return done();
      });
    });
  });

  outOfBoundsValues.forEach((v) => {
    it(`Reading an out of bounds ${v.name} from machine1 should raise and alert`, (done) => {
      sparkAlert.on('raise', (alert) => {
        alert.should.be.instanceof(Object);
        alert.should.have.all.keys('key', 'msg', 'description');
        alert.key.should.equal(`bounds-error-machine1-${v.name}`);
        alert.msg.should.equal('OPC-UA: Data out of bounds');
        alert.description.should.equal(`OPC-UA detected an out of bounds value of ${v.value} for variable ${v.name} in machine machine1. Try using an unsigned type format or changing to a larger one. If you are manipulating the data you made need to set an output format.`);
        sparkAlert.removeAllListeners('raise');
        return done();
      });

      const data = {
        machine: 'machine1',
        variable: v.name,
      };
      data[v.name] = v.value;
      sparkdb.add(data);

      const nodeToRead = {
        nodeId: `ns=2;s=machine1,${v.name},S`,
        attributeId: opcua.AttributeIds.Value,
      };
      theSession.read(nodeToRead, 0, (err, result) => {
        if (err) return done(err);
        result.statusCode.name.should.equal('GoodNoData');
        return undefined;
      });
    });
  });

  typeErrorValues.forEach((v) => {
    it(`Reading a ${v.name} with a type error from machine1 should raise and alert`, (done) => {
      sparkAlert.on('raise', (alert) => {
        alert.should.be.instanceof(Object);
        alert.should.have.all.keys('key', 'msg', 'description');
        alert.key.should.equal(`type-error-machine1-${v.name}`);
        alert.msg.should.equal('OPC-UA: Type error with data');
        alert.description.should.equal(`OPC-UA cannot match the value to the format for the variable ${v.name} in machine machine1. Please check the format or outputFormat is correctly set for the variable.`);
        sparkAlert.removeAllListeners('raise');
        return done();
      });

      const data = {
        machine: 'machine1',
        variable: v.name,
      };
      data[v.name] = v.value;
      sparkdb.add(data);

      const nodeToRead = {
        nodeId: `ns=2;s=machine1,${v.name},S`,
        attributeId: opcua.AttributeIds.Value,
      };
      theSession.read(nodeToRead, 0, (err, result) => {
        if (err) return done(err);
        result.statusCode.name.should.equal('GoodNoData');
        return undefined;
      });
    });
  });

  it('Reading from a disabled machine should fail', (done) => {
    sparkdb.add({
      machine: 'machine2',
      variable: 'pressure',
      pressure: 50,
    });

    const nodeToRead = {
      nodeId: 'ns=2;s=machine2,pressure,S',
      attributeId: opcua.AttributeIds.Value,
    };
    theSession.read(nodeToRead, 0, (err, result) => {
      if (err) return done(err);
      result.statusCode.name.should.equal('BadNodeIdUnknown');
      return done();
    });
  });

  it('Enable machine2 should add it to the browse list', (done) => {
    sparkConfig.set('machines:machine2:settings:model:enable', true);

    browseMachines(theSession, (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.should.eql(['machine1', 'machine2']);
      return done();
    });
  });

  it('Read GoodNoData if the database returns null and no data is cached', (done) => {
    sparkdb.add({
      machine: 'machine2',
      variable: 'pressure',
      pressure: 40,
      result: null,
    });

    const nodeToRead = {
      nodeId: 'ns=2;s=machine2,pressure,S',
      attributeId: opcua.AttributeIds.Value,
    };
    theSession.read(nodeToRead, 0, (err, result) => {
      if (err) return done(err);
      result.statusCode.name.should.equal('GoodNoData');
      return done();
    });
  });

  it('Reading a machine2 variable should succeed', (done) => {
    sparkdb.add({
      machine: 'machine2',
      variable: 'pressure',
      pressure: 50,
    });

    const nodeToRead = {
      nodeId: 'ns=2;s=machine2,pressure,S',
      attributeId: opcua.AttributeIds.Value,
    };
    theSession.read(nodeToRead, 0, (err, result) => {
      if (err) return done(err);
      result.value.value.should.equal(50);
      result.statusCode.name.should.equal('Good');
      return done();
    });
  });

  it('Reading a machine2 read/write variable should succeed', (done) => {
    const nodeToRead = {
      nodeId: 'ns=2;s=machine2,readWriteTest,S',
      attributeId: opcua.AttributeIds.Value,
    };
    theSession.read(nodeToRead, 0, (err, result) => {
      if (err) return done(err);
      result.value.value.should.equal(123);
      result.statusCode.name.should.equal('Good');
      return done();
    });
  });

  it('Reading a machine2 read/write int variable should succeed', (done) => {
    const nodeToRead = {
      nodeId: 'ns=2;s=machine2,readWriteIntReadTest,S',
      attributeId: opcua.AttributeIds.Value,
    };
    theSession.read(nodeToRead, 0, (err, result) => {
      if (err) return done(err);
      result.value.value.should.equal(0);
      result.statusCode.name.should.equal('Good');
      return done();
    });
  });

  it('Reading a machine2 read/write bool variable should succeed', (done) => {
    const nodeToRead = {
      nodeId: 'ns=2;s=machine2,readWriteBoolReadTest,S',
      attributeId: opcua.AttributeIds.Value,
    };
    theSession.read(nodeToRead, 0, (err, result) => {
      if (err) return done(err);
      result.value.value.should.equal(false);
      result.statusCode.name.should.equal('Good');
      return done();
    });
  });

  it('Reading a machine2 read/write string variable should succeed', (done) => {
    const nodeToRead = {
      nodeId: 'ns=2;s=machine2,readWriteStringReadTest,S',
      attributeId: opcua.AttributeIds.Value,
    };
    theSession.read(nodeToRead, 0, (err, result) => {
      if (err) return done(err);
      result.value.value.should.equal('');
      result.statusCode.name.should.equal('Good');
      return done();
    });
  });

  it('Database errors should raise an alert', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('db-read-error');
      alert.msg.should.equal('OPC-UA: Error reading from database');
      alert.description.should.equal('Error: out of cheese error');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkdb.add({
      machine: 'machine2',
      variable: 'pressure',
      pressure: 60,
      err: new Error('out of cheese error'),
    });

    const nodeToRead = {
      nodeId: 'ns=2;s=machine2,pressure,S',
      attributeId: opcua.AttributeIds.Value,
    };
    theSession.read(nodeToRead, 0, (err, result) => {
      if (err) return done(err);
      result.statusCode.name.should.equal('GoodNoData');
      return undefined;
    });
  });

  it('Read last good data if the database returns null and data is cached', (done) => {
    sparkdb.add({
      machine: 'machine2',
      variable: 'pressure',
      pressure: 70,
      result: null,
    });

    const nodeToRead = {
      nodeId: 'ns=2;s=machine2,pressure,S',
      attributeId: opcua.AttributeIds.Value,
    };
    theSession.read(nodeToRead, 0, (err, result) => {
      if (err) return done(err);
      result.value.value.should.equal(50);
      result.statusCode.name.should.equal('Good');
      return done();
    });
  });

  it('Add a new variable to machine2 should succeed', (done) => {
    conf.machines.machine2.variables.push({
      name: 'flags',
      format: 'bool',
      array: true,
    });
    sparkConfig.emit('set', 'machines:machine2:variables');

    browseMachines(theSession, (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.should.eql(['machine1', 'machine2']);
      return done();
    });
  });

  it('Single values in and array variable should raise an alert', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('type-error-machine2-flags');
      alert.msg.should.equal('OPC-UA: Type error with data');
      alert.description.should.equal('OPC-UA cannot match the value to the format for the variable flags in machine machine2. Please check the format or outputFormat is correctly set for the variable.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkdb.add({
      machine: 'machine2',
      variable: 'flags',
      flags: false,
    });

    const nodeToRead = {
      nodeId: 'ns=2;s=machine2,flags,A',
      attributeId: opcua.AttributeIds.Value,
    };
    theSession.read(nodeToRead, 0, (err, result) => {
      if (err) return done(err);
      result.statusCode.name.should.equal('GoodNoData');
      return undefined;
    });
  });

  it('An empty array variable should not raise an alert', (done) => {
    sparkAlert.on('raise', alert => done(new Error(`alert should not trigger ${alert}`)));

    sparkdb.add({
      machine: 'machine2',
      variable: 'flags',
      flags: [],
    });

    const nodeToRead = {
      nodeId: 'ns=2;s=machine2,flags,A',
      attributeId: opcua.AttributeIds.Value,
    };
    theSession.read(nodeToRead, 0, (err, result) => {
      if (err) return done(err);
      result.statusCode.name.should.equal('GoodNoData');
      return undefined;
    });

    setTimeout(() => {
      sparkAlert.removeAllListeners('raise');
      return done();
    }, 1000);
  });

  it('Add a non unique variable to machine2 should raise and alert', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('invalid-machine-machine2');
      alert.msg.should.equal('OPC-UA: Machine contains non-unique variable names');
      alert.description.should.equal('OPC-UA is not able to add the machine2 machine to its list as it contains non-unique variable names. Please fix its machine definition.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    conf.machines.machine2.variables.push({
      name: 'pressure',
      format: 'float',
    });
    sparkConfig.emit('set', 'machines:machine2:variables');
  });

  it('Writing a machine2 single variable should succeed', (done) => {
    sparkdb.on('added', (data) => {
      data.should.be.instanceof(Object);
      data.machine.should.equal('machine2');
      data.variable.should.equal('count');
      data.count.should.equal(100);
      sparkdb.removeAllListeners('added');
    });

    const nodeId = 'ns=2;s=machine2,count,S';
    const dataToWrite = {
      dataType: opcua.DataType.Int16,
      value: 100,
    };
    theSession.writeSingleNode(nodeId, dataToWrite, (err, statusCode) => {
      if (err) return done(err);
      statusCode.name.should.equal('Good');
      return done();
    });
  });

  it('Writing a machine2 array variable should succeed', (done) => {
    sparkdb.on('added', (data) => {
      data.should.be.instanceof(Object);
      data.machine.should.equal('machine2');
      data.variable.should.equal('countarray');
      data.countarray.should.eql([1, 2, 3, 4]);
      sparkdb.removeAllListeners('added');
    });

    const nodeId = 'ns=2;s=machine2,countarray,A';
    const dataToWrite = {
      dataType: opcua.DataType.Int16,
      arrayType: opcua.VariantArrayType.Array,
      value: [1, 2, 3, 4],
    };
    theSession.writeSingleNode(nodeId, dataToWrite, (err, statusCode) => {
      if (err) return done(err);
      statusCode.name.should.equal('Good');
      return done();
    });
  });

  it('Writing a machine2 single read/write variable should succeed', (done) => {
    sparkdb.on('added', (data) => {
      data.should.be.instanceof(Object);
      data.machine.should.equal('machine2');
      data.variable.should.equal('readWriteTest');
      data.readWriteTest.should.equal(100);
      sparkdb.removeAllListeners('added');
    });

    const nodeId = 'ns=2;s=machine2,readWriteTest,S';
    const dataToWrite = {
      dataType: opcua.DataType.Int16,
      value: 100,
    };
    theSession.writeSingleNode(nodeId, dataToWrite, (err, statusCode) => {
      if (err) return done(err);
      statusCode.name.should.equal('Good');
      return done();
    });
  });

  it('Writing a read-only machine2 variable should error', (done) => {
    sparkdb.on('added', data => done(new Error(`db add should not be called ${data}`)));

    const nodeId = 'ns=2;s=machine2,pressure,S';
    const dataToWrite = {
      dataType: opcua.DataType.Float,
      value: 100,
    };
    theSession.writeSingleNode(nodeId, dataToWrite, (err, statusCode) => {
      if (err) return done(err);
      statusCode.name.should.equal('BadNotWritable');
      sparkdb.removeAllListeners('added');
      return done();
    });
  });

  it('Writing a machine2 variable with db error should raise and alert', (done) => {
    const dbAdd = sparkdb.add;
    sparkdb.add = function add(data, cb) {
      return cb(new Error('this is an error'));
    };

    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('db-add-error-machine2-count');
      alert.msg.should.equal('OPC-UA: Error attempting to add to database');
      alert.description.should.equal('Database set failed for count in machine machine2');
      sparkAlert.removeAllListeners('raise');
    });

    const nodeId = 'ns=2;s=machine2,count,S';
    const dataToWrite = {
      dataType: opcua.DataType.Int16,
      value: 110,
    };
    theSession.writeSingleNode(nodeId, dataToWrite, (err, statusCode) => {
      if (err) return done(err);
      statusCode.name.should.equal('GoodNoData');
      sparkdb.add = dbAdd;
      return done();
    });
  });

  it('Enabled machine1 again should be ignored since nothing changed', (done) => {
    sparkConfig.set('machines:machine1:settings:model:enable', true);

    browseMachines(theSession, (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.should.eql(['machine1', 'machine2']);
      return done();
    });
  });

  it('Disable machine1 should remove it to the browse list', (done) => {
    sparkConfig.set('machines:machine1:settings:model:enable', false);

    browseMachines(theSession, (err, result) => {
      if (err) return done(err);
      result.should.be.instanceof(Array);
      result.should.eql(['machine2']);
      return done();
    });
  });

  it('Enable machine without unique vairable names should raise an alert', (done) => {
    sparkAlert.on('raise', (alert) => {
      alert.should.be.instanceof(Object);
      alert.should.have.all.keys('key', 'msg', 'description');
      alert.key.should.equal('invalid-machine-machine3');
      alert.msg.should.equal('OPC-UA: Machine contains non-unique variable names');
      alert.description.should.equal('OPC-UA is not able to add the machine3 machine to its list as it contains non-unique variable names. Please fix its machine definition.');
      sparkAlert.removeAllListeners('raise');
      return done();
    });

    sparkConfig.set('machines:machine3:settings:model:enable', true);
  });

  it('Changing opcua settings should trigger a restart request', (done) => {
    sparkOpcUa.on('restartRequest', (data) => {
      data.should.equal('spark-protocol-opcua');
      sparkOpcUa.removeAllListeners('restartRequest');
      return done();
    });
    sparkConfig.set('protocols:spark-protocol-opcua:settings:model:something', 42);
  });

  it('Changing opcua settings to the same value should not trigger a restart request', (done) => {
    sparkOpcUa.on('restartRequest', data => done(new Error(`restartRequest should not trigger ${data}`)));

    setTimeout(() => {
      sparkOpcUa.removeAllListeners('restartRequest');
      return done();
    }, 1000);
    sparkConfig.set('protocols:spark-protocol-opcua:settings:model:something', 42);
  });

  it('stop should succeed when started', (done) => {
    sparkOpcUa.stop((err) => {
      if (err) done(err);
      return done();
    });
  });
});
