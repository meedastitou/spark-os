const router = require('express').Router();
const _ = require('lodash');
const async = require('async');
const ConnMan = require('connman-api');
const Ajv = require('ajv');
const proxyJsonSchema = require('../json-schemas/network/proxy.json');

const connman = new ConnMan(true); // true == agent on

const ajv = Ajv({
  allErrors: true,
});
const validateProxy = ajv.compile(proxyJsonSchema);

const Store = {};

function connectWithRetry() {
  connman.init((errInit) => {
    if (errInit) {
      setTimeout(connectWithRetry, 5000);
      // console.error(errInit);
      return;
    }

    // console.log('Connman initialised Successfull');

    /* connman.on('PropertyChanged', (name, value) => {
      console.log('Connman PropertyChanged', { name, value });
    }); */

    /* connman.on('ServicesChanged', (changes, removed) => {
      console.log('Connman ServicesChanged', { changes, removed });
    }); */

    /* connman.Agent.on('Release', () => {
      console.log('Connman Agent Release');
    }); */

    /* connman.Agent.on('ReportError', (path, err) => {
      console.log('Connman Agent ReportError', { err });
    }); */

    /* connman.Agent.on('RequestBrowser', (path, url) => {
      console.log('Connman Agent RequestBrowser', { path, url });
    }); */

    connman.Agent.on('RequestInput', (serviceName, dict, callback) => {
      // console.log('Connman Agent RequestInput', { serviceName, dict });

      const result = {};
      if (serviceName in Store) {
        if (('Passphrase' in dict) && ('Passphrase' in Store[serviceName])) {
          result.Passphrase = Store[serviceName].Passphrase;

          if ('PreviousPassphrase' in dict) {
            if (dict.PreviousPassphrase === Store[serviceName].Passphrase) {
              // console.error('Giving up as Passphrase == PreviousPassphrase');
              return callback({});
            }
          }
        }

        if (('Name' in dict) && ('Name' in Store[serviceName])) {
          result.Name = Store[serviceName].Name;
        }
      }

      return callback(result);
    });

    /* connman.Agent.on('Cancel', () => {
      console.log('Connman Agent Cancel');
    }); */
  });
}

connectWithRetry();

const configItems = [
  'AutoConnect',
  'IPv4.Configuration',
  'IPv6.Configuration',
  'Nameservers.Configuration',
  'Timeservers.Configuration',
  'Domains.Configuration',
  'Proxy.Configuration',
];

function setConfigItem(req, service, currentProps, configItem, done) {
  const reqConfigItem = configItem.replace('.', '');

  // check configItem exists in the request body
  if (!_.hasIn(req, `body.${reqConfigItem}`)) {
    req.log.warn(`${reqConfigItem} missing from request body, can't setProperty.  Continuing.`);
    return done(null);
  }

  req.log.debug(reqConfigItem, {
    old: currentProps[reqConfigItem],
    new: req.body[reqConfigItem],
  });

  // remove empty values from arrays
  let newConfiguration;
  if (_.isArray(req.body[reqConfigItem])) {
    newConfiguration = req.body[reqConfigItem].filter(n => ((n !== undefined) && (n !== null)));
  } else {
    newConfiguration = req.body[reqConfigItem];
  }

  // ignore is nothing has changed
  if (_.isEqual(currentProps[reqConfigItem], newConfiguration)) {
    req.log.debug(`${reqConfigItem} has not changed, ignoring`);
    return done(null);
  }

  req.log.debug(`${reqConfigItem} updated, calling setProperty()`);
  return service.setProperty(configItem, newConfiguration, (err) => {
    if (err) {
      return done(err);
    }
    return done(null);
  });
}

function getServiceProps(serviceName, done) {
  try {
    return connman.getService(serviceName, (err, service) => {
      if (err) {
        return done(err);
      }

      return service.getProperties((errGetProp, props) => {
        // Annoyingly some of the keys have a dot (.) in them
        // which makes handling them awkward.  Instead simply remove them
        const propsMapped = _.mapKeys(props, (v, k) => k.replace('.', ''));

        return done(null, service, _.extend({}, propsMapped, {
          serviceName,
          id: serviceName.replace(/^\/net\/connman\/service\//, ''),
        }));
      });
    });
  } catch (e) {
    return done({
      err: e,
      message: 'Failed calling setting service properties',
    });
  }
}

router.param('serviceName', (req, res, next, serviceName) => {
  // add back the /net/connman/service/ prefix
  req.serviceName = `/net/connman/service/${serviceName}`;
  req.log.debug({
    serviceName: req.serviceName,
  });
  next();
});

router.route('/')
  .get((req, res) => {
    // get all services
    try {
      return connman.getServices((err, services) => {
        if (err) {
          return res.status(500).jsonp(err);
        }

        // convert the services object to an array
        const servicesArray = _.map(services, (value, key) => {
          // Annoyingly some of the keys have a dot (.) in them
          // which makes handling them awkward.  Instead simply remove them
          const valueMapped = _.mapKeys(value, (v, k) => k.replace('.', ''));

          return _.extend({}, valueMapped, {
            // strip off the /net/connman/service/ this means
            // id will now be url safe
            id: key.replace(/^\/net\/connman\/service\//, ''),
          });
        });

        return res.status(200).jsonp(servicesArray);
      });
    } catch (e) {
      return res.status(500).jsonp({
        err: e,
        message: 'Failed calling getting services',
      });
    }
  });

router.route('/scanwifi')
  .put((req, res) => {
    try {
      if (!('WiFi' in connman.technologies)) {
        return res.status(500).jsonp({
          message: 'Wifi unavailable',
        });
      }

      const wifi = connman.technologies.WiFi;

      return wifi.scan((err) => {
        if (err) {
          return res.status(500).jsonp(err);
        }

        return res.status(200).jsonp({});
      });
    } catch (e) {
      return res.status(500).jsonp({
        err: e,
        message: 'Failed scanning wifi',
      });
    }
  });

router.route('/proxy')
  .get((req, res) => {
    const { conf } = req.app;
    conf.get('network:proxy', (err, _result) => {
      let result = _result;
      if (err || !result) {
        result = {};
      }

      return res.status(200).jsonp(result);
    });
  }).put((req, res) => {
    const { conf } = req.app;
    // validate the recived json against the json schema
    if (!validateProxy(req.body)) {
      req.log.debug({
        err: validateProxy.errors,
      });
      return res.status(422).jsonp({
        message: ajv.errorsText(validateProxy.errors),
      });
    }

    return conf.set('network:proxy', req.body, (err) => {
      if (err) {
        return res.status(500).jsonp(err);
      }
      return conf.get('network:proxy', (errGet, result) => {
        if (errGet) {
          return res.status(500).jsonp(errGet);
        }
        return res.status(200).jsonp(result);
      });
    });
  });

router.route('/:serviceName')
  .get((req, res) => {
    // get the chosen service
    getServiceProps(req.serviceName, (err, service, props) => {
      if (err) {
        return res.status(500).jsonp(err);
      }

      return res.status(200).jsonp(props);
    });
  })
  .put((req, res) => {
    async.waterfall([
      (cb) => {
        // get the current service
        getServiceProps(req.serviceName, (err, service, currentProps) => {
          if (err) {
            return cb({ err, code: 500 });
          }
          // req.log.debug('Current properties', { currentProps });
          return cb(null, service, currentProps);
        });
      },
      (service, currentProps, cb) => {
        async.each(configItems, (configItem, cbEach) => {
          setConfigItem(req, service, currentProps, configItem, err => cbEach(err));
        }, (err) => {
          if (err) {
            return cb({ err, code: 500 });
          }

          return cb(null);
        });
      },
      (cb) => {
        // now the properties have been updated get a new copy of
        // the updated service to return back in the response
        getServiceProps(req.serviceName, (err, service, updatedProps) => {
          if (err) {
            return cb({ err, code: 500 });
          }

          return cb(null, updatedProps);
        });
      },
    ], (err, result) => {
      if (err) {
        return res.status(err.code).jsonp(err.err);
      }

      // return the updated service
      return res.status(200).jsonp(result);
    });
  });

router.route('/:serviceName/connect')
  .put((req, res) => {
    // store the Passphrase
    if ('body' in req) {
      Store[req.serviceName] = req.body;
    }

    getServiceProps(req.serviceName, (err, service, props) => {
      if ((err) || (!service)) {
        return res.status(500).jsonp(err);
      }

      return service.connect((errConnect) => {
        if (errConnect) {
          return res.status(500).jsonp(errConnect);
        }

        return res.status(200).jsonp(props);
      });
    });
  });

router.route('/:serviceName/disconnect')
  .put((req, res) => {
    getServiceProps(req.serviceName, (err, service, props) => {
      if ((err) || (!service)) {
        return res.status(500).jsonp(err);
      }

      return service.disconnect((errDisconnect) => {
        if (errDisconnect) {
          return res.status(500).jsonp(errDisconnect);
        }

        return res.status(200).jsonp(props);
      });
    });
  });

router.route('/:serviceName/remove')
  .put((req, res) => {
    getServiceProps(req.serviceName, (err, service, props) => {
      if ((err) || (!service)) {
        return res.status(500).jsonp(err);
      }

      if (typeof service.remove !== 'function') {
        // service does not have a remove method
        return res.status(500).jsonp(`Cannot remove ${req.serviceName}`);
      }

      return service.remove((errRemove) => {
        if (errRemove) {
          return res.status(500).jsonp(errRemove);
        }

        return res.status(200).jsonp(props);
      });
    });
  });

module.exports = router;
