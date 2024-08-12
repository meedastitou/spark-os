require('chai').should();
const request = require('supertest');
const _ = require('lodash');
const test = require('./test');

const agent = request.agent(test.httpServer);

const machine1 = _.merge({}, require('./machinedefs/system/dummy/machine1'), {
  id: 'system$dummy$machine1.json',
});

const myMachine = {
  info: {
    name: 'my-machine',
    fullname: 'My Machine',
    version: '1.0.0',
    description: 'My Machine Definition',
    hpl: 'dummy',
  },
  variables: [{
    name: 'temperature',
    description: 'Temperature',
    format: 'float',
    type: 'random',
  }],
};

const myMachineUpdate = {
  id: 'user$dummy$my-machine.json',
  info: {
    name: 'my-machine',
    fullname: 'My Machine',
    version: '1.0.1',
    description: 'My Machine Definition',
    hpl: 'dummy',
  },
  variables: [{
    name: 'temperature',
    description: 'Temperature',
    format: 'float',
    type: 'random',
  }, {
    name: 'pressure',
    description: 'Pressure',
    format: 'float',
    type: 'sine',
  }, {
    name: 'humidity',
    description: 'Humidity',
    format: 'float',
    type: 'cosine',
  }],
};

const invalidMachines = [{
  description: 'Missing info and variables',
  data: {
    hello: true,
  },
  result: {
    message: 'data should have required property \'info\', data should have required property \'variables\'',
  },
}, {
  description: 'Missing variables',
  data: {
    info: {
      name: 'my-machine',
      fullname: 'My Machine',
      version: '1.0.1',
      description: 'My Machine Definition',
      hpl: 'dummy',
    },
  },
  result: {
    message: 'data should have required property \'variables\'',
  },
}, {
  description: 'Missing info.hpl',
  data: {
    info: {
      name: 'my-machine',
      fullname: 'My Machine',
      version: '1.0.1',
      description: 'My Machine Definition',
    },
    variables: [{
      name: 'temperature',
      description: 'Temperature',
      format: 'float',
      type: 'random',
    }],
  },
  result: {
    message: 'data.info should have required property \'hpl\'',
  },
}, {
  description: 'Invalid info.hpl',
  data: {
    info: {
      name: 'my-machine',
      fullname: 'My Machine',
      version: '1.0.1',
      description: 'My Machine Definition',
      hpl: 'invalid',
    },
    variables: [{
      name: 'temperature',
      description: 'Temperature',
      format: 'float',
      type: 'random',
    }],
  },
  result: {
    message: 'data.info.hpl should be equal to one of the allowed values',
  },
}, {
  description: 'Missing variables.type',
  data: {
    info: {
      name: 'my-machine',
      fullname: 'My Machine',
      version: '1.0.1',
      description: 'My Machine Definition',
      hpl: 'dummy',
    },
    variables: [{
      name: 'temperature',
      description: 'Temperature',
      format: 'float',
    }],
  },
  result: {
    message: 'data.variables[0] should have required property \'type\'',
  },
}, {
  description: 'Duplicate variables.name',
  data: {
    info: {
      name: 'my-machine',
      fullname: 'My Machine',
      version: '1.0.1',
      description: 'My Machine Definition',
      hpl: 'dummy',
    },
    variables: [{
      name: 'temperature',
      description: 'Temperature',
      format: 'float',
      type: 'random',
    }, {
      name: 'temperature',
      description: 'Temperature',
      format: 'float',
      type: 'random',
    }],
  },
  result: {
    message: 'variable name temperature is duplicated',
  },
}];

const invalidMachinesUpdate = [{
  description: 'Wrong name',
  data: {
    info: {
      name: 'wrong-machine',
      fullname: 'My Machine',
      version: '1.0.1',
      description: 'My Machine Definition',
      hpl: 'dummy',
    },
    variables: [{
      name: 'temperature',
      description: 'Temperature',
      format: 'float',
      type: 'random',
    }],
  },
  result: {
    message: 'info.name is wrong',
  },
}, {
  description: 'Wrong hpl',
  data: {
    info: {
      name: 'my-machine',
      fullname: 'My Machine',
      version: '1.0.1',
      description: 'My Machine Definition',
      hpl: 'test',
    },
    variables: [{
      name: 'temperature',
      description: 'Temperature',
      type: 'random',
      format: 'int32',
    }],
  },
  result: {
    message: 'info.hpl is wrong',
  },
}];

const defaultTree = {
  system: {
    name: 'system',
    nodes: {
      dummy: {
        name: 'dummy',
        nodes: {
          machine1: {
            name: 'machine1',
            type: 'system',
            path: 'system$dummy$machine1.json',
          },
          machine2: {
            name: 'machine2',
            type: 'system',
            path: 'system$dummy$machine2.json',
          },
        },
      },
    },
  },
  user: {
    name: 'user',
    nodes: {},
  },
};


describe('Machine Definitions', () => {
  it('GET /machinedefs/schemas - return 200 ok', (done) => {
    agent.get('/machinedefs/schemas')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.have.all.keys('hpl', 'dummy', 'test');
        return done();
      });
  });

  it('GET /machinedefs/schemas/hpl - return 200 ok', (done) => {
    agent.get('/machinedefs/schemas/hpl')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });

  it('POST /machinedefs/schemas/hpl - return 403 forbidden', (done) => {
    agent.post('/machinedefs/schemas/hpl')
      .expect(403)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });

  it('GET /machinedefs/schemas/invalid - return 404 not found', (done) => {
    agent.get('/machinedefs/schemas/invalid')
      .expect(404)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        return done();
      });
  });

  it('GET /machinedefs/files/tree - return 200 ok', (done) => {
    agent.get('/machinedefs/files/tree')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.eql(defaultTree);
        return done();
      });
  });

  it('GET /machinedefs/files/resource/system$dummy$machine1.json - return 200 ok', (done) => {
    agent.get('/machinedefs/files/resource/system$dummy$machine1.json')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.eql(machine1);
        return done();
      });
  });

  invalidMachines.forEach((invalidMachine) => {
    it(`POST /machinedefs/files/resource (${invalidMachine.description}) - return 422 Unprocessable Entity`, (done) => {
      agent.post('/machinedefs/files/resource')
        .send(invalidMachine.data)
        .expect(422)
        .expect('Content-Type', /json/)
        .end((err, res) => {
          if (err) return done(err);
          res.body.should.be.instanceof(Object);
          res.body.should.contain.keys('message');
          res.body.message.should.eql(invalidMachine.result.message);
          return done();
        });
    });
  });

  it('POST /machinedefs/files/resource - return 200 ok', (done) => {
    agent.post('/machinedefs/files/resource')
      .send(myMachine)
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.eql(_.merge({}, myMachine, {
          id: 'user$dummy$my-machine.json',
        }));
        return done();
      });
  });

  it('POST /machinedefs/files/resource - return 422 Unprocessable Entity', (done) => {
    agent.post('/machinedefs/files/resource')
      .send(myMachine)
      .expect(422)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        res.body.message.should.eql('user machine definition already exists with the same name');
        return done();
      });
  });

  it('POST /machinedefs/files/resource - return 422 Unprocessable Entity', (done) => {
    agent.post('/machinedefs/files/resource')
      .send(_.merge({}, myMachine, {
        info: {
          name: 'machine1',
        },
      }))
      .expect(422)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        res.body.message.should.eql('system machine definition already exists with the same name');
        return done();
      });
  });

  it('GET /machinedefs/files/tree - return 200 ok', (done) => {
    agent.get('/machinedefs/files/tree')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.eql(_.merge({}, defaultTree, {
          user: {
            name: 'user',
            nodes: {
              dummy: {
                name: 'dummy',
                nodes: {
                  'my-machine': {
                    name: 'my-machine',
                    type: 'user',
                    path: 'user$dummy$my-machine.json',
                  },
                },
              },
            },
          },
        }));
        return done();
      });
  });

  it('GET /machinedefs/files/resource/invalid - return 422 Unprocessable Entity', (done) => {
    agent.get('/machinedefs/files/resource/invalid')
      .expect(422)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        res.body.message.should.eql('Invalid resource id');
        return done();
      });
  });

  it('GET /machinedefs/files/resource/invalid$dummy$my%2dmachine.json - return 422 Unprocessable Entity', (done) => {
    agent.get('/machinedefs/files/resource/invalid$dummy$my%2dmachine.json')
      .expect(422)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        res.body.message.should.eql('Invalid resource type');
        return done();
      });
  });

  it('GET /machinedefs/files/resource/user$invalid$my%2dmachine.json - return 422 Unprocessable Entity', (done) => {
    agent.get('/machinedefs/files/resource/user$invalid$my%2dmachine.json')
      .expect(422)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        res.body.message.should.eql('Invalid resource, unsupported hpl');
        return done();
      });
  });

  it('GET /machinedefs/files/resource/user$dummy$my%2dmachine - return 422 Unprocessable Entity', (done) => {
    agent.get('/machinedefs/files/resource/user$dummy$my%2dmachine')
      .expect(422)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        res.body.message.should.eql('Invalid resource, not a json file');
        return done();
      });
  });

  it('GET /machinedefs/files/resource/user$dummy$invalid.json - return 422 Unprocessable Entity', (done) => {
    agent.get('/machinedefs/files/resource/user$dummy$invalid.json')
      .expect(404)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        res.body.message.should.eql('File not found');
        return done();
      });
  });

  it('GET /machinedefs/files/resource/user$dummy$my%2dmachine.json - return 200 ok', (done) => {
    agent.get('/machinedefs/files/resource/user$dummy$my%2dmachine.json')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.eql(_.merge({}, myMachine, {
          id: 'user$dummy$my-machine.json',
        }));
        return done();
      });
  });

  it('POST /machinedefs/files/resource/system$dummy%2machine1.json - return 422 Unprocessable Entity', (done) => {
    agent.post('/machinedefs/files/resource/system$dummy$machine1.json')
      .send(myMachineUpdate)
      .expect(422)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        res.body.message.should.eql('Invalid resource type');
        return done();
      });
  });

  invalidMachines.forEach((invalidMachine) => {
    it(`POST /machinedefs/files/resource/user$dummy$my%2dmachine.json (${invalidMachine.description}) - return 422 Unprocessable Entity`, (done) => {
      agent.post('/machinedefs/files/resource/user$dummy$my%2dmachine.json')
        .send(invalidMachine.data)
        .expect(422)
        .expect('Content-Type', /json/)
        .end((err, res) => {
          if (err) return done(err);
          res.body.should.be.instanceof(Object);
          res.body.should.contain.keys('message');
          res.body.message.should.eql(invalidMachine.result.message);
          return done();
        });
    });
  });

  invalidMachinesUpdate.forEach((invalidMachineUpdate) => {
    it(`POST /machinedefs/files/resource/user$dummy$my%2dmachine.json (${invalidMachineUpdate.description}) - return 422 Unprocessable Entity`, (done) => {
      agent.post('/machinedefs/files/resource/user$dummy$my%2dmachine.json')
        .send(invalidMachineUpdate.data)
        .expect(422)
        .expect('Content-Type', /json/)
        .end((err, res) => {
          if (err) return done(err);
          res.body.should.be.instanceof(Object);
          res.body.should.contain.keys('message');
          res.body.message.should.eql(invalidMachineUpdate.result.message);
          return done();
        });
    });
  });

  it('POST /machinedefs/files/resource/user$dummy$my%2dmachine.json - return 200 ok', (done) => {
    agent.post('/machinedefs/files/resource/user$dummy$my%2dmachine.json')
      .send(myMachineUpdate)
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.eql(myMachineUpdate);
        return done();
      });
  });

  it('DELETE /machinedefs/files/resource/system$dummy$machine1.json - return 422 Unprocessable Entity', (done) => {
    agent.delete('/machinedefs/files/resource/system$dummy$machine1.json')
      .expect(422)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        res.body.message.should.eql('Invalid resource type');
        return done();
      });
  });

  it('DELETE /machinedefs/files/resource/user$dummy$my%2dmachine.json - return 200 ok', (done) => {
    agent.delete('/machinedefs/files/resource/user$dummy$my%2dmachine.json')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.eql({
          id: 'user$dummy$my-machine.json',
        });
        return done();
      });
  });

  it('DELETE /machinedefs/files/resource/user$dummy$my%2dmachine.json - return 404 not found', (done) => {
    agent.delete('/machinedefs/files/resource/user$dummy$my%2dmachine.json')
      .expect(404)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        res.body.message.should.eql('File not found');
        return done();
      });
  });
});
