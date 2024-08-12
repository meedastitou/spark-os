const _ = require('lodash');
const router = require('express').Router();

router.param('hardware', (req, res, next, hardware) => {
  req.log.debug({
    hardware,
  });
  next();
});

router.route('/')
  .get((req, res) => {
    const { conf } = req.app;
    conf.getFiltered('hardware', (err, result) => {
      if (err) {
        return res.status(500).jsonp({
          message: 'failed to get hardware',
        });
      }
      // convert the result object to an array
      const resultArray = _.map(result, (value, key) => _.extend({}, value, {
        id: key,
      }));

      return res.status(200).jsonp(resultArray);
    });
  });

router.route('/:hardware')
  .get((req, res) => {
    const { conf } = req.app;
    conf.getFiltered(`hardware:${req.params.hardware}`, (err, result) => {
      if (err) {
        return res.status(404).jsonp({
          message: 'hardware not found',
        });
      }
      return res.status(200).jsonp(_.extend({}, result, {
        id: req.params.hardware,
      }));
    });
  });

module.exports = router;
