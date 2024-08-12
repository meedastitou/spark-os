require('chai').should();
const request = require('supertest');
const _ = require('lodash');
const test = require('./test');

const agent = request.agent(test.httpServer);
const { conf } = test;

describe('Networks', () => {
  const validProxy = [{
    method: 'manual',
    netIf: 'eth0',
    url: 'http://some.valid.proxy:1234',
  }, {
    method: 'direct',
  }];

  const invalidProxySettings = [{
    description: 'missing method',
    errMsg: 'data should have required property \'method\'',
    data: {
      netIf: 'eth0',
      url: 'http://myproxy:8080',
    },
  }, {
    description: 'invalid method',
    errMsg: 'data.method should be equal to one of the allowed values',
    data: {
      method: 'magic',
      netIf: 'eth0',
      url: 'http://myproxy:8080',
    },
  }, {
    description: 'invalid netIf',
    errMsg: 'data.netIf should NOT be shorter than 1 characters',
    data: {
      method: 'manual',
      netIf: '',
      url: 'http://myproxy:8080',
    },
  }, {
    description: 'invalid url',
    errMsg: 'data.url should match format "uri"',
    data: {
      method: 'manual',
      netIf: 'eth0',
      url: 'my proxy',
    },
  }];

  it('GET /networks/proxy - return 200 ok', (done) => {
    agent.get('/networks/proxy')
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        return done();
      });
  });

  invalidProxySettings.forEach((invalidProxySetting) => {
    it(`PUT /networks/proxy - return 422, ${invalidProxySetting.description}`, (done) => {
      agent.put('/networks/proxy')
        .send(invalidProxySetting.data)
        .expect(422)
        .expect('Content-Type', /json/)
        .end((err, res) => {
          if (err) return done(err);
          res.body.should.be.instanceof(Object);
          res.body.should.have.all.keys('message');
          res.body.message.should.equal(invalidProxySetting.errMsg);
          return done();
        });
    });
  });

  it('PUT /networks/proxy - return 200, 1st proxy', (done) => {
    agent.put('/networks/proxy')
      .send(validProxy[0])
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.have.all.keys('method', 'netIf', 'url');
        res.body.method.should.equal(validProxy[0].method);
        res.body.netIf.should.equal(validProxy[0].netIf);
        res.body.url.should.equal(validProxy[0].url);
        return done();
      });
  });

  it('PUT /networks/proxy - return 200, 2nd proxy', (done) => {
    agent.put('/networks/proxy')
      .send(validProxy[1])
      .expect(200)
      .expect('Content-Type', /json/)
      .end((err, res) => {
        if (err) return done(err);
        res.body.should.be.instanceof(Object);
        res.body.should.have.all.keys('method');
        res.body.method.should.equal(validProxy[1].method);
        return done();
      });
  });

  if (conf.HAVE_CONNMAN) {
    let networks;
    it('GET /networks - return 200 ok', (done) => {
      agent.get('/networks')
        .expect(200)
        .expect('Content-Type', /json/)
        .end((err, res) => {
          if (err) return done(err);
          res.body.should.be.instanceof(Object);

          networks = _.keyBy(res.body, o => o.Name);
          return done();
        });
    });

    it('GET /networks/:id - return 200 ok', (done) => {
      agent.get(`/networks/${networks.Wired.id}`)
        .expect(200)
        .expect('Content-Type', /json/)
        .end((err, res) => {
          if (err) return done(err);
          res.body.should.eql(networks.Wired);
          return done();
        });
    });

    it('PUT /networks/:id - return 200 ok', (done) => {
      agent.put(`/networks/${networks.Wired.id}`)
        .send(networks.Wired)
        .expect(200)
        .expect('Content-Type', /json/)
        .end((err, res) => {
          if (err) return done(err);
          res.body.should.eql(networks.Wired);
          return done();
        });
    });

    it('PUT /networks/scanwifi - return 200 ok', (done) => {
      agent.put('/networks/scanwifi')
        .expect(200)
        .expect('Content-Type', /json/)
        .end((err, res) => {
          if (err) return done(err);
          res.body.should.be.instanceof(Object);
          return done();
        });
    });

    it('GET /networks - return 200 ok', function getNetworks(done) {
      this.timeout(6000);
      setTimeout(() => {
        agent.get('/networks')
          .expect(200)
          .expect('Content-Type', /json/)
          .end((err, res) => {
            if (err) return done(err);
            res.body.should.be.instanceof(Object);
            networks = _.keyBy(res.body, o => o.Name);
            return done();
          });
      }, 5000);
    });

    it('PUT /networks/:id/connect - return 200 ok', (done) => {
      agent.put(`/networks/${networks.TEguest.id}/connect`)
        .expect(200)
        .expect('Content-Type', /json/)
        .end((err, res) => {
          if (err) return done(err);
          res.body.should.be.instanceof(Object);
          return done();
        });
    });

    it('PUT /networks/:id/disconnect - return 200 ok', function getNetwork(done) {
      this.timeout(3000);

      setTimeout(() => {
        agent.put(`/networks/${networks.TEguest.id}/disconnect`)
          .expect(200)
          .expect('Content-Type', /json/)
          .end((err, res) => {
            if (err) return done(err);
            res.body.should.be.instanceof(Object);
            return done();
          });
      }, 2000);
    });

    it('PUT /networks/:id/remove - return 200 ok', (done) => {
      agent.put(`/networks/${networks.TEguest.id}/remove`)
        .expect(200)
        .expect('Content-Type', /json/)
        .end((err, res) => {
          if (err) return done(err);
          res.body.should.be.instanceof(Object);
          return done();
        });
    });
  } else {
    console.log('Connman not available, skipping tests');
  }
});
