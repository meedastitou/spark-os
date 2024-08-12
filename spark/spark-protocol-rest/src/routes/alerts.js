const router = require('express').Router();

router.route('/list')
  .get((req, res) => {
    const { alert } = req.app;
    alert.getAlerts((err, result) => {
      if (err) {
        return res.status(500).jsonp(err);
      }
      return res.status(200).jsonp(result);
    });
  });

router.route('/count')
  .get((req, res) => {
    const { alert } = req.app;
    alert.getAlertsCount((err, count) => {
      if (err) {
        return res.status(500).jsonp(err);
      }
      return res.status(200).jsonp({
        count,
      });
    });
  });

module.exports = router;
