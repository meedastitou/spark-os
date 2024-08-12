require('chai').should();
const request = require('supertest');
const test = require('./test');

const agent = request.agent(test.httpServer);

describe('Hardware', () => {
  it('GET /hardware - return 200 ok with zero hardware', (done) => {
    agent.get('/hardware')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Array);
        res.body.should.have.lengthOf(0);
        return done();
      });
  });

  it('GET /hardware/invalid - return 404 not found', (done) => {
    agent.get('/hardware/invalid')
      .expect(404)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        return done();
      });
  });

  it('GET /hardware - return 200 ok with two hardware', (done) => {
    test.conf.hardware = {
      hardware1: {
        abc: 11,
      },
      hardware2: {
        def: 22,
      },
    };

    agent.get('/hardware')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Array);
        res.body.should.have.lengthOf(2);
        res.body[0].should.have.all.keys('id', 'abc');
        res.body[0].id.should.equal('hardware1');
        res.body[0].abc.should.equal(11);
        res.body[1].should.have.all.keys('id', 'def');
        res.body[1].id.should.equal('hardware2');
        res.body[1].def.should.equal(22);
        return done();
      });
  });

  it('GET /hardware/hardware1 - return 200 ok', (done) => {
    agent.get('/hardware/hardware1')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.have.all.keys('id', 'abc');
        res.body.id.should.equal('hardware1');
        res.body.abc.should.equal(11);
        return done();
      });
  });

  it('GET /hardware/hardware2 - return 200 ok', (done) => {
    agent.get('/hardware/hardware2')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.have.all.keys('id', 'def');
        res.body.id.should.equal('hardware2');
        res.body.def.should.equal(22);
        return done();
      });
  });

  it('GET /hardware - return 200 ok with zero hardware', (done) => {
    delete test.conf.hardware.hardware1;
    delete test.conf.hardware.hardware2;

    agent.get('/hardware')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Array);
        res.body.should.have.lengthOf(0);
        return done();
      });
  });
});
