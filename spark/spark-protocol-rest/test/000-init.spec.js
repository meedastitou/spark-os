require('chai').should();
const http = require('http');
const request = require('supertest');
const test = require('./test');

const agent = request.agent(test.httpServer);

describe('Intialise', () => {
  it('GET /martin - return 403 forbidden', (done) => {
    agent.get('/martin')
      .expect(403)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        return done();
      });
  });

  it('POST /martin - return 403 forbidden', (done) => {
    agent.post('/martin')
      .expect(403)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        return done();
      });
  });

  it('PUT /martin - return 403 forbidden', (done) => {
    agent.put('/martin')
      .expect(403)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        return done();
      });
  });

  it('GET /martin (send bad json)- return 400 not found', (done) => {
    agent.get('/martin')
      .set('Content-Type', 'application/json')
      .send('{bad:json}')
      .expect(400)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        return done();
      });
  });

  it('GET /martin (missing User-Agent) - return 403 forbidden ', (done) => {
    const options = {
      port: test.httpServer.address().port,
      path: '/martin',
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      res.statusCode.should.equal(403);
      res.setEncoding('utf8');
      res.on('data', (dataStr) => {
        const data = JSON.parse(dataStr);
        data.should.be.instanceof(Object);
        data.should.contain.keys('message');
        data.message.should.equal('User-Agent missing');
        return done();
      });
    });

    req.on('error', (e) => {
      done(e);
    });

    // write data to request body
    req.end();
  });

  it('POST /martin (missing Content-Type) - return 403 forbidden', (done) => {
    const options = {
      port: test.httpServer.address().port,
      path: '/martin',
      method: 'POST',
    };

    const req = http.request(options, (res) => {
      res.statusCode.should.equal(403);
      res.setEncoding('utf8');
      res.on('data', (dataStr) => {
        const data = JSON.parse(dataStr);
        data.should.be.instanceof(Object);
        data.should.contain.keys('message');
        data.message.should.equal('Content-Type missing');
        return done();
      });
    });

    req.on('error', (e) => {
      done(e);
    });

    // write data to request body
    req.write('{"martin":"bark"}\n');
    req.end();
  });


  it('POST /martin (invalid Content-Type) - return 415 unsupported media type', (done) => {
    const options = {
      port: test.httpServer.address().port,
      path: '/martin',
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
    };

    const req = http.request(options, (res) => {
      res.statusCode.should.equal(415);
      res.setEncoding('utf8');
      res.on('data', (dataStr) => {
        const data = JSON.parse(dataStr);
        data.should.be.instanceof(Object);
        data.should.contain.keys('message');
        data.message.should.equal('Unsupported Content-Type');
        return done();
      });
    });

    req.on('error', (e) => {
      done(e);
    });

    // write data to request body
    req.write('Martin Bark\n');
    req.end();
  });
});
