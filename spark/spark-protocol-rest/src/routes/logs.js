const router = require('express').Router();
const glob = require('glob');
const moment = require('moment');
const { exec } = require('child_process');

function listLogs(logStoreDir, done) {
  glob('*.tar.gz', {
    cwd: logStoreDir,
  }, (err, files) => {
    if (err) {
      return done(err);
    }

    const res = [];
    files.forEach((filename) => {
      const timestampStr = filename.replace(/.*-([0-9]*-[0-9]*)\.tar\.gz/, '$1');
      const timestamp = moment(timestampStr, 'YYYYMMDD-HHmmss');

      res.push({
        timestamp: timestamp.toJSON(),
        filename,
      });
    });

    return done(null, res);
  });
}

router.route('/list')
  .get((req, res) => {
    const { conf } = req.app;
    const logStoreDir = conf.get('LOG_STORE_DIR') || '/var/lib/spark/logs';

    listLogs(logStoreDir, (err, files) => {
      if (err) {
        return res.status(500).jsonp({
          message: 'Failed to list logs',
          err,
        });
      }

      return res.status(200).jsonp(files);
    });
  });

router.route('/create')
  .get((req, res) => {
    const { conf } = req.app;
    const logStoreDir = conf.get('LOG_STORE_DIR') || '/var/lib/spark/logs';
    const getSparkLogs = conf.get('GET_SPARK_LOGS_SCRIPT') || '/usr/bin/get-spark-logs';

    exec(`${getSparkLogs} ${logStoreDir}`, (err, stdout, stderr) => {
      req.log.debug({ stdout, stderr, err });

      if (err) {
        return res.status(500).jsonp({
          message: 'Failed to create new logs',
          err,
        });
      }

      return listLogs(logStoreDir, (errListLogs, files) => {
        if (errListLogs) {
          return res.status(500).jsonp({
            message: 'Failed to list logs',
            err: errListLogs,
          });
        }

        return res.status(200).jsonp(files);
      });
    });
  });

module.exports = router;
