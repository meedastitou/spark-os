require('chai').should();
const request = require('supertest');
const test = require('./test');

const agent = request.agent(test.httpServer);

describe('Bluetooth', () => {
  it('GET /ble/list - return 200 ok', (done) => {
    agent.get('/ble/list')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Array);
        return done();
      });
  });
});
