require('chai').should();
const request = require('supertest');
const test = require('./test');

const agent = request.agent(test.httpServer);

describe('Logs', () => {
  it('GET /logs/list - return 200 ok', (done) => {
    agent.get('/logs/list')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.length.should.equal(0);
        return done();
      });
  });

  it('GET /logs/create - return 200 ok', (done) => {
    agent.get('/logs/create')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.length.should.equal(1);
        return done();
      });
  });

  it('GET /logs/list - return 200 ok', (done) => {
    agent.get('/logs/list')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.length.should.equal(1);
        return done();
      });
  });

  it('GET /logs/create - return 200 ok', (done) => {
    agent.get('/logs/create')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.length.should.equal(2);
        return done();
      });
  });

  it('GET /logs/list - return 200 ok', (done) => {
    agent.get('/logs/list')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.length.should.equal(2);
        return done();
      });
  });

  it('GET /logs/create - return 200 ok', (done) => {
    agent.get('/logs/create')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.length.should.equal(3);
        return done();
      });
  });

  it('GET /logs/list - return 200 ok', (done) => {
    agent.get('/logs/list')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.length.should.equal(3);
        return done();
      });
  });

  let logFile;
  it('GET /logs/create - return 200 ok', (done) => {
    agent.get('/logs/create')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.length.should.equal(3);
        logFile = res.body[0].filename;
        return done();
      });
  });

  it('GET /logs/files/xxx.tar.gz - return 200 ok', (done) => {
    agent.get(`/logs/files/${logFile}`)
      .expect(200)
      .expect('Content-Type', 'application/gzip')
      .end((err) => {
        if (err) return done(err);
        return done();
      });
  });
});
