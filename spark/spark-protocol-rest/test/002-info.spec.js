require('chai').should();
const os = require('os');
const request = require('supertest');
const test = require('./test');

const agent = request.agent(test.httpServer);
const TEST_HOSTNAME = process.env.TEST_HOSTNAME || os.hostname();
const TEST_LOCATION = 'TestLocation';

describe('Info', () => {
  it('GET /info/release - return 200 ok', (done) => {
    agent.get('/info/release')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.have.all.keys('RELEASE', 'BUILT', 'ARCH', 'UID', 'TYPE', 'DEV');
        return done();
      });
  });

  it('POST /info/release - return 403 forbidden', (done) => {
    agent.post('/info/release')
      .expect(403)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        return done();
      });
  });

  it('GET /info/invalid - return 403 forbidden', (done) => {
    agent.get('/info/invalid')
      .expect(403)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        return done();
      });
  });

  it('GET /info/sysinfo - return 200 ok', (done) => {
    agent.get('/info/sysinfo')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('Hostname',
          'StaticHostname',
          'PrettyHostname',
          'IconName',
          'Chassis',
          'Deployment',
          'Location',
          'KernelName',
          'KernelRelease',
          'KernelVersion',
          'OperatingSystemPrettyName',
          'OperatingSystemCPEName',
          'networkIfaces');
        return done();
      });
  });


  it('PUT /info/sysinfo - return 200 ok', (done) => {
    agent.put('/info/sysinfo')
      .send({
        Location: TEST_LOCATION,
      })
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('Hostname',
          'StaticHostname',
          'PrettyHostname',
          'IconName',
          'Chassis',
          'Deployment',
          'Location',
          'KernelName',
          'KernelRelease',
          'KernelVersion',
          'OperatingSystemPrettyName',
          'OperatingSystemCPEName');
        res.body.Location.should.equal(TEST_LOCATION);
        return done();
      });
  });

  it('PUT /info/sysinfo - return 200 ok', (done) => {
    agent.post('/info/sysinfo')
      .send({
        PrettyHostname: TEST_HOSTNAME,
      })
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('Hostname',
          'StaticHostname',
          'PrettyHostname',
          'IconName',
          'Chassis',
          'Deployment',
          'Location',
          'KernelName',
          'KernelRelease',
          'KernelVersion',
          'OperatingSystemPrettyName',
          'OperatingSystemCPEName');
        res.body.PrettyHostname.should.equal(TEST_HOSTNAME);
        return done();
      });
  });

  it('GET /info/sysinfo/Hostname - return 200 ok', (done) => {
    agent.get('/info/sysinfo/Hostname')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.have.all.keys('Hostname');
        res.body.Hostname.should.equal(TEST_HOSTNAME);
        return done();
      });
  });


  it('POST /info/sysinfo/PrettyHostname - return 200 ok', (done) => {
    agent.post('/info/sysinfo/PrettyHostname')
      .send({
        PrettyHostname: TEST_HOSTNAME,
      })
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.have.all.keys('PrettyHostname');
        res.body.PrettyHostname.should.equal(TEST_HOSTNAME);
        return done();
      });
  });

  it('GET /info/sysinfo/invalid - return 500', (done) => {
    agent.get('/info/sysinfo/invalid')
      .expect(500)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        return done();
      });
  });

  it('POST /info/sysinfo/invalid - return 500', (done) => {
    agent.post('/info/sysinfo/invalid')
      .send({
        invalid: 'invalid',
      })
      .expect(500)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.contain.keys('message');
        return done();
      });
  });
});
