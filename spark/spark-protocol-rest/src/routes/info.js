const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const ini = require('ini');
const _ = require('lodash');
const async = require('async');
const glob = require('glob');
const dbus = require('dbus-native');

const systemBus = dbus.systemBus();

function arrToMap(arr) {
  const output = {};
  for (let i = 0; i < arr.length; i += 1) {
    _.set(output, arr[i][0], arr[i][1][1][0]);
  }
  return output;
}

/* parse the contents of /etc/spark-release */
let sparkRelease = {
  RELEASE: '1.2.3',
  BUILT: '2016-05-10T19:16:52+00:00',
  ARCH: 'rpi2',
  UID: '0123456789ab',
  TYPE: 'Release',
  DEV: false,
};

fs.readFile('/etc/spark-release', 'utf-8', (err, data) => {
  if ((!err) && (data)) {
    sparkRelease = ini.parse(data);

    const releaseRegex = /^([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,2}|[0-9]{1,2}\.0\.0\.(a|b|rc)[0-9]{2})(|-dev)$/;
    const found = sparkRelease.RELEASE.match(releaseRegex);
    if (found) {
      switch (found[2]) {
        case 'a': sparkRelease.TYPE = 'Alpha'; break;
        case 'b': sparkRelease.TYPE = 'Beta'; break;
        case 'rc': sparkRelease.TYPE = 'Release Candidate'; break;
        default: sparkRelease.TYPE = 'Release'; break;
      }
      sparkRelease.DEV = found[3] === '-dev';
    } else {
      sparkRelease.TYPE = 'Invalid';
    }
  }
});

function getInterfaces(done) {
  const netdir = '/sys/class/net';

  glob('**', {
    cwd: netdir,
    ignore: ['lo', 'tether*'],
  }, (errGlob, interfaces) => {
    if (errGlob) {
      return done(errGlob);
    }

    return async.map(interfaces, (iface, cb) => {
      const filename = path.join(netdir, iface, 'address');

      return fs.readFile(filename, 'utf8', (errReadFile, _mac) => {
        let mac = _mac;
        if (!mac) {
          mac = '00:00:00:00:00:00';
        }

        return cb(errReadFile, {
          name: iface,
          mac: mac.trim(),
        });
      });
    }, (err, results) => done(err, results));
  });
}

router.route('/release')
  .get((req, res) => res.status(200).jsonp(sparkRelease));

router.route('/sysinfo')
  .get((req, res) => {
    systemBus.invoke({
      destination: 'org.freedesktop.hostname1',
      path: '/org/freedesktop/hostname1',
      interface: 'org.freedesktop.DBus.Properties',
      member: 'GetAll',
      body: ['org.freedesktop.hostname1'],
      signature: 's',
    }, (errDbus, _data) => {
      if (errDbus) {
        return res.status(500).jsonp({ err: errDbus });
      }

      const data = arrToMap(_data);

      return getInterfaces((err, networkIfaces) => {
        if (err) {
          return res.status(500).jsonp({ err });
        }

        data.networkIfaces = networkIfaces;
        return res.status(200).jsonp(data);
      });
    });
  }).post((req, res) => {
    async.eachOf(req.body, (value, key, cb2) => {
      systemBus.invoke({
        destination: 'org.freedesktop.hostname1',
        path: '/org/freedesktop/hostname1',
        interface: 'org.freedesktop.hostname1',
        member: `Set${key}`,
        body: [value, false],
        signature: 'sb',
      }, err => cb2(err));
    }, (errDbus) => {
      if (errDbus) {
        req.log.error('Error calling Set', { err: errDbus });
        return res.status(500).jsonp({
          message: 'Error calling Set',
          err: errDbus,
        });
      }

      return systemBus.invoke({
        destination: 'org.freedesktop.hostname1',
        path: '/org/freedesktop/hostname1',
        interface: 'org.freedesktop.DBus.Properties',
        member: 'GetAll',
        body: ['org.freedesktop.hostname1'],
        signature: 's',
      }, (err, data) => {
        if (err) {
          return res.status(500).jsonp({ err });
        }

        return res.status(200).jsonp(arrToMap(data));
      });
    });
  }).put((req, res) => {
    systemBus.invoke({
      destination: 'org.freedesktop.hostname1',
      path: '/org/freedesktop/hostname1',
      interface: 'org.freedesktop.DBus.Properties',
      member: 'GetAll',
      body: ['org.freedesktop.hostname1'],
      signature: 's',
    }, (errDbus, _data) => {
      if (errDbus) {
        return res.status(500).jsonp({ err: errDbus });
      }

      const data = arrToMap(_data);
      if (!_.isEqual(data.Location, req.body.Location)) {
        systemBus.invoke({
          destination: 'org.freedesktop.hostname1',
          path: '/org/freedesktop/hostname1',
          interface: 'org.freedesktop.hostname1',
          member: 'SetLocation',
          body: [req.body.Location, false],
          signature: 'sb',
        }, (_errDbus) => {
          if (_errDbus) {
            req.log.error('Error calling Set', { err: _errDbus });
            return res.status(500).jsonp({
              message: 'Error calling Set',
              err: _errDbus,
            });
          }

          return systemBus.invoke({
            destination: 'org.freedesktop.hostname1',
            path: '/org/freedesktop/hostname1',
            interface: 'org.freedesktop.DBus.Properties',
            member: 'GetAll',
            body: ['org.freedesktop.hostname1'],
            signature: 's',
          }, (err, setData) => {
            if (err) {
              return res.status(500).jsonp({ err });
            }
            return res.status(200).jsonp(arrToMap(setData));
          });
        });
      } else {
        return res.status(200).jsonp(data);
      }
      return undefined;
    });
  });

router.route('/sysinfo/:prop')
  .get((req, res) => {
    systemBus.invoke({
      destination: 'org.freedesktop.hostname1',
      path: '/org/freedesktop/hostname1',
      interface: 'org.freedesktop.DBus.Properties',
      member: 'Get',
      body: ['org.freedesktop.hostname1', req.params.prop],
      signature: 'ss',
    }, (err, data) => {
      if (err) {
        return res.status(500).jsonp({
          message: `Error getting ${req.params.prop}`,
          err,
        });
      }

      const result = {};
      _.set(result, req.params.prop, data[1][0]);
      return res.status(200).jsonp(result);
    });
  }).post((req, res) => {
    systemBus.invoke({
      destination: 'org.freedesktop.hostname1',
      path: '/org/freedesktop/hostname1',
      interface: 'org.freedesktop.hostname1',
      member: `Set${req.params.prop}`,
      body: [req.body[req.params.prop], false],
      signature: 'sb',
    }, (err) => {
      if (err) {
        req.log.error(`Error calling Set${req.params.prop}`, { err });
        return res.status(500).jsonp({
          message: `Error calling Set${req.params.prop}`,
          err,
        });
      }

      const result = {};
      result[req.params.prop] = req.body[req.params.prop];
      return res.status(200).jsonp(result);
    });
  });

module.exports = router;
