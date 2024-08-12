require('chai').should();
const request = require('supertest');
const test = require('./test');

const agent = request.agent(test.httpServer);

describe('Protocols', () => {
  it('GET /protocols - return 200 ok', (done) => {
    agent.get('/protocols')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });

  it('GET /protocols/my-protocol - return 200 ok', (done) => {
    agent.get('/protocols/my-protocol')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });

  it('PUT /protocols/my-protocol - missing settings', (done) => {
    agent.put('/protocols/my-protocol')
      .send({})
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

  it('PUT /protocols/my-protocol - missing settings.model', (done) => {
    agent.put('/protocols/my-protocol')
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

  it('PUT /protocols/my-protocol - 200 OK', (done) => {
    agent.put('/protocols/my-protocol')
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
});
