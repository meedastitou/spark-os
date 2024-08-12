require('chai').should();
const request = require('supertest');
const test = require('./test');

const agent = request.agent(test.httpServer);

describe('Machines', () => {
  it('GET /machines - return 200 ok', (done) => {
    agent.get('/machines')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Array);
        res.body.length.should.equal(1);
        res.body[0].should.be.instanceof(Object);
        res.body[0].should.have.all.keys('id', 'info', 'settings', 'variables');
        res.body[0].id.should.equal('spark-machine-dummy');
        return done();
      });
  });

  it('GET /machines/spark-machine-dummy - return 200 ok', (done) => {
    agent.get('/machines/spark-machine-dummy')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });

  it('PUT /machines/spark-machine-dummy - missing settings', (done) => {
    agent.put('/machines/spark-machine-dummy')
      .send({})
      .expect(422)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.have.all.keys('message');
        res.body.message.should.equal('settings missing');
        return done();
      });
  });

  it('PUT /machines/spark-machine-dummy - missing settings.model', (done) => {
    agent.put('/machines/spark-machine-dummy')
      .send({
        settings: {},
      })
      .expect(422)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.have.all.keys('message');
        res.body.message.should.equal('settings.model missing');
        return done();
      });
  });

  it('PUT /machines/spark-machine-dummy - 200 OK', (done) => {
    agent.put('/machines/spark-machine-dummy')
      .send({
        settings: {
          model: {
            enable: true,
          },
        },
      })
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });

  it('GET /machines/spark-machine-dummy/data - return 200 ok', (done) => {
    agent.get('/machines/spark-machine-dummy/data')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });

  it('GET /machines/spark-machine-dummy/data/temperature - return 200 ok', (done) => {
    agent.get('/machines/spark-machine-dummy/data/temperature')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.eql({
          machine: 'spark-machine-dummy',
          variable: 'temperature',
          temperature: '76.62304046091846',
          _id: '36189',
          createdAt: '2017-02-17T17:12:33.271Z',
        });
        return done();
      });
  });
});
