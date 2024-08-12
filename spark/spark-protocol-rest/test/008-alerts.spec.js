require('chai').should();
const request = require('supertest');
const test = require('./test');

const agent = request.agent(test.httpServer);

describe('Alerts', () => {
  it('GET /alerts/list - return 200 ok', (done) => {
    agent.get('/alerts/list')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Array);
        return done();
      });
  });

  it('GET /alerts/count - return 200 ok', (done) => {
    agent.get('/alerts/count')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.count.should.equal(0);
        return done();
      });
  });
});
