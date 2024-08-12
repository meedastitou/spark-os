require('chai').should();
const request = require('supertest');
const test = require('./test');

const agent = request.agent(test.httpServer);

describe('Certificates', () => {
  it('POST /certs/reset - return 200 ok', (done) => {
    agent.post('/certs/reset')
      .send({
        reset: 'reset',
      })
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });

  it('POST /certs/gencsr - return 200 ok', (done) => {
    agent.post('/certs/gencsr')
      .send({
        generate: 'csr',
      })
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });

  it('POST /certs/checkcsr - return 200 ok', (done) => {
    agent.post('/certs/checkcsr')
      .send({
        check: 'csr',
      })
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });

  it('POST /certs/importcert - return 500 invalid key', (done) => {
    agent.post('/certs/importcert')
      .send({
        cert: 'Invalid Key',
      })
      .expect(500)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });
});
