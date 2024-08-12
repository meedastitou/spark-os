const router = require('express').Router();
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const sslUtils = require('ssl-utils');

router.route('/reset')
  .post((req, res) => {
    const { conf } = req.app;
    const genSelfSignedCert = conf.get('GEN_SELF_CERT_SCRIPT') || '/etc/systemd/scripts/genselfcert';

    exec(genSelfSignedCert, (err, stdout, stderr) => {
      req.log.debug({ stdout, stderr, err });

      if (err) {
        return res.status(500).jsonp({
          message: 'Failed to reset self-signed certificate',
          err,
        });
      }

      return res.status(200).jsonp({
        reset: 'reset',
      });
    });
  });

router.route('/checkcsr')
  .post((req, res) => {
    const { conf } = req.app;
    const CSRFileName = conf.get('CSR_FILE') || '/data/sysroot/etc/nginx/ssl/csr/cert.csr';
    fs.access(CSRFileName, fs.constants.F_OK, err => res.status(200).jsonp({
      csrExists: err === null,
    }));
  });

router.route('/gencsr')
  .post((req, res) => {
    const { conf } = req.app;
    const genCSR = conf.get('GEN_CSR_SCRIPT') || '/etc/systemd/scripts/gencsr';
    exec(genCSR, (err, stdout, stderr) => {
      req.log.debug({ stdout, stderr, err });

      if (err) {
        return res.status(500).jsonp({
          message: 'Failed to generate a CSR',
          err,
        });
      }

      // read the contents of the CSR files
      const CSRFileName = conf.get('CSR_FILE') || '/data/sysroot/etc/nginx/ssl/csr/cert.csr';
      return fs.readFile(CSRFileName, 'utf8', (readErr, data) => {
        if (readErr) {
          return res.status(500).jsonp({
            message: 'Failed to read CSR file',
            err: readErr,
          });
        }
        return res.status(200).jsonp({
          csr: data,
          hostname: os.hostname(),
        });
      });
    });
  });

router.route('/importcert')
  .post((req, res) => {
    const { conf } = req.app;
    // read the key from the CSR
    const CSRKeyFileName = conf.get('CSR_KEY_FILE') || '/data/sysroot/etc/nginx/ssl/csr/key.pem';
    fs.readFile(CSRKeyFileName, 'utf8', (readErr, key) => {
      if (readErr) {
        return res.status(500).jsonp({
          message: 'Failed to read key for signed certificate',
          err: readErr,
        });
      }

      // verify that the certificate and key are a valid and a pair
      return sslUtils.verifyCertificateKey(req.body.cert, key, (verErr, result) => {
        if (!result.certStatus.valid) {
          return res.status(500).jsonp({
            message: 'Imported certificate is not valid',
          });
        }

        if (!result.keyStatus.valid) {
          return res.status(500).jsonp({
            message: 'Key for imported certificate is not valid',
          });
        }

        if (!result.match) {
          return res.status(500).jsonp({
            message: 'Imported certificate and CSR key do not match',
          });
        }

        const SignedCertFileName = conf.get('SIGNED_CERT_FILE') || '/data/sysroot/etc/nginx/ssl/cert.pem';
        return fs.writeFile(SignedCertFileName, req.body.cert, (writeCertErr) => {
          if (writeCertErr) {
            return res.status(500).jsonp({
              message: 'Failed write signed certificate',
              err: writeCertErr,
            });
          }

          const SignedKeyFileName = conf.get('SIGNED_KEY_FILE') || '/data/sysroot/etc/nginx/ssl/key.pem';
          return fs.writeFile(SignedKeyFileName, key, (writeKeyErr) => {
            if (writeKeyErr) {
              return res.status(500).jsonp({
                message: 'Failed write the key for signed certificate',
                err: writeKeyErr,
              });
            }

            return res.status(200).jsonp({
              imported: 'imported',
            });
          });
        });
      });
    });
  });

module.exports = router;
