const router = require('express').Router();
const _ = require('lodash');

router.param('protocol', (req, res, next, protocol) => {
  req.log.debug({
    protocol,
  });
  next();
});

router.route('/')
  .get((req, res) => {
    const { conf } = req.app;
    conf.getFiltered('protocols', (err, result) => {
      if (err) {
        return res.status(500).jsonp(err);
      }
      // convert the result object to an array
      const resultArray = _.map(result, (value, key) => _.extend({}, value, {
        id: key,
      }));

      return res.status(200).jsonp(resultArray);
    });
  });

router.route('/:protocol')
  .get((req, res) => {
    const { conf } = req.app;
    conf.getFiltered(`protocols:${req.params.protocol}`, (err, result) => {
      if (err) {
        return res.status(500).jsonp(err);
      }
      return res.status(200).jsonp(_.extend({}, result, {
        id: req.params.protocol,
      }));
    });
  })
  .put((req, res) => {
    const { conf } = req.app;
    if (!_.hasIn(req, 'body.settings.model')) {
      return res.status(422).jsonp({
        message: 'settings.model missing',
      });
    }

    return conf.set(`protocols:${req.params.protocol}:settings:model`, req.body.settings.model, (err) => {
      if (err) {
        return res.status(500).jsonp(err);
      }
      return conf.getFiltered(`protocols:${req.params.protocol}`, (errGetFiltered, result) => {
        if (errGetFiltered) {
          return res.status(500).jsonp(errGetFiltered);
        }
        return res.status(200).jsonp(_.extend({}, result, {
          id: req.params.protocol,
        }));
      });
    });
  });

module.exports = router;
