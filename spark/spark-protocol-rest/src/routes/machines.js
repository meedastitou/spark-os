const router = require('express').Router();
const _ = require('lodash');

router.param('machine', (req, res, next, machine) => {
  req.log.debug({
    machine,
  });
  next();
});

router.route('/')
  .get((req, res) => {
    const { conf } = req.app;
    conf.getFiltered('machines', (err, result) => {
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

router.route('/:machine')
  .get((req, res) => {
    const { conf } = req.app;
    conf.getFiltered(`machines:${req.params.machine}`, (err, result) => {
      if (err) {
        return res.status(500).jsonp(err);
      }
      return res.status(200).jsonp(_.extend({}, result, {
        id: req.params.machine,
      }));
    });
  })
  .put((req, res) => {
    const { conf } = req.app;

    if (!_.hasIn(req, 'body.settings')) {
      return res.status(422).jsonp({
        message: 'settings missing',
      });
    }

    if (!_.hasIn(req, 'body.settings.model')) {
      return res.status(422).jsonp({
        message: 'settings.model missing',
      });
    }

    return conf.set(`machines:${req.params.machine}:settings:model`, req.body.settings.model, (err) => {
      if (err) {
        return res.status(500).jsonp(err);
      }
      return conf.getFiltered(`machines:${req.params.machine}`, (errGetFiltered, result) => {
        if (errGetFiltered) {
          return res.status(500).jsonp(errGetFiltered);
        }
        return res.status(200).jsonp(_.extend({}, result, {
          id: req.params.machine,
        }));
      });
    });
  });

router.route('/:machine/data')
  .get((req, res) => {
    const { db } = req.app;
    db.getAll(req.params.machine, (err, result) => {
      if (err) {
        return res.status(500).jsonp(err);
      }
      return res.status(200).jsonp(result);
    });
  });

router.route('/:machine/data/:field')
  .get((req, res) => {
    const { db } = req.app;
    db.getLatest(req.params.machine, req.params.field, (err, result) => {
      if (err) {
        return res.status(500).jsonp(err);
      }
      return res.status(200).jsonp(result);
    });
  });

router.route('/:machine/reset')
  .post((req, res) => {
    const { db, conf } = req.app;
    db.deleteAll(req.params.machine, (dbErr) => {
      if (dbErr) {
        return res.status(500).jsonp(dbErr);
      }
      return conf.clear(`machines:${req.params.machine}:data`, (confErr) => {
        if (confErr) {
          return res.status(500).jsonp(confErr);
        }
        return res.status(204);
      });
    });
  });

module.exports = router;
