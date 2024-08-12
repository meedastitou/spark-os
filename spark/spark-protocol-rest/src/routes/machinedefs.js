const fs = require('fs');
const path = require('path');
const router = require('express').Router();
const async = require('async');
const _ = require('lodash');
const glob = require('glob');
const mkdirp = require('mkdirp');
const Ajv = require('ajv');

const ajv = Ajv({
  allErrors: true,
  unknownFormats: ['tabs'],
});

const resourceIdSep = '$';

function walkSync(dir, _filelist, type, _pathBase) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    files = [];
  }

  const filelist = _filelist || {};
  const pathBase = _pathBase || type;
  files.forEach((file) => {
    const fullpath = path.join(dir, file);
    const fullpathBase = path.join(pathBase, file);

    if (fs.statSync(fullpath).isDirectory()) {
      if ((file !== 'node_modules') && (file !== 'test')) {
        filelist[file] = {
          name: file,
          nodes: {},
        };
        walkSync(fullpath, filelist[file].nodes, type, fullpathBase);
      }
    } else if ((/^.*\.json$/.test(file)) && (file !== 'package.json')) {
      filelist[path.basename(file, '.json')] = {
        name: path.basename(file, '.json'),
        type,
        path: fullpathBase.split(path.sep).join(resourceIdSep),
      };
    }
  });
  return filelist;
}

// load the system machine defs once but load the
// user machine defs on each get
const tree = {
  user: {
    name: 'user',
    nodes: {},
  },
  system: {
    name: 'system',
    nodes: {},
  },
};

/* Serve the Tree */
router.get('/files/tree', (req, res) => {
  const { conf } = req.app;
  if (_.isEmpty(_.get(tree, 'system.nodes'))) {
    tree.system.nodes = walkSync(conf.get('MACHINES_SYSTEM_DIR'), {}, 'system');
  }
  tree.user.nodes = walkSync(conf.get('MACHINES_USER_DIR'), {}, 'user');
  res.status(200).jsonp(tree);
});

router.param('resourceId', (req, res, next, resourceId) => {
  const { conf, schemas } = req.app;
  req.params.resourceId = decodeURIComponent(resourceId);

  // resourceId must be in the format type/hpl/name.json
  // For example, user/modbus/martin-test-machine.json
  const resourceIdSplit = req.params.resourceId.split(resourceIdSep);
  if (resourceIdSplit.length !== 3) {
    req.log.debug('Invalid resource id', req.params.resourceId);
    res.status(422).jsonp({
      message: 'Invalid resource id',
    });
    return next('Invalid resource id');
  }

  let base;
  const type = resourceIdSplit[0];
  switch (type) {
    case 'system': {
      base = conf.get('MACHINES_SYSTEM_DIR');
      break;
    }

    case 'user': {
      base = conf.get('MACHINES_USER_DIR');
      break;
    }

    default: {
      req.log.debug('Invalid resource type', type);
      res.status(422).jsonp({
        message: 'Invalid resource type',
      });
      return next('Invalid resource type');
    }
  }

  const hpl = resourceIdSplit[1];
  if ((!_.hasIn(schemas, hpl)) || (hpl === 'hpl')) {
    res.status(422).jsonp({
      message: 'Invalid resource, unsupported hpl',
    });
    return next('Invalid resource, unsupported hpl');
  }

  const filename = resourceIdSplit[2];
  // only accept json files
  if (!filename.match(/^.*\.json$/)) {
    res.status(422).jsonp({
      message: 'Invalid resource, not a json file',
    });
    return next('Invalid resource, not a json file');
  }
  const name = path.basename(filename, '.json');

  const filePath = path.normalize(path.join(base, hpl, filename));

  // make sure the file exists
  return fs.stat(filePath, (err, stats) => {
    if ((err) || (!stats.isFile())) {
      res.status(404).jsonp({
        message: 'File not found',
      });
      return next('File not found');
    }
    req.resource = {
      filePath,
      filename,
      name,
      hpl,
      type,
      stats,
    };

    return next();
  });
});

/* Serve a Resource */
router.route('/files/resource')
  .post((req, res) => {
    const { conf, validate } = req.app;
    async.waterfall([
      (cb) => {
        // validate the json against the hpl schema
        let valid = validate.hpl(req.body);
        if (!valid) {
          return cb({
            code: 422,
            message: ajv.errorsText(validate.hpl.errors),
            err: validate.hpl.errors,
          });
        }

        // now we know this is a valid hpl json object validate it against
        // the specifi hpl schema
        valid = validate[req.body.info.hpl](req.body);
        if (!valid) {
          return cb({
            code: 422,
            message: ajv.errorsText(validate[req.body.info.hpl].errors),
            err: validate[req.body.info.hpl].errors,
          });
        }

        // check for duplicate variables names
        if (req.body.variables.length > 1) {
          let duplicateName;
          const seen = {};
          const hasDuplicates = req.body.variables.some((variable) => {
            if (_.hasIn(seen, variable.name)) {
              // Current name is already seen
              duplicateName = variable.name;
              return true;
            }

            // Current name is being seen for the first time
            seen[variable.name] = false;
            return (seen[variable.name]);
          });

          if (hasDuplicates) {
            return cb({
              code: 422,
              message: `variable name ${duplicateName} is duplicated`,
            });
          }
        }

        const dirPath = path.normalize(path.join(conf.get('MACHINES_USER_DIR'), req.body.info.hpl));
        const fileName = `${req.body.info.name}.json`;
        const filePath = path.join(dirPath, fileName);
        const resourceId = ['user', req.body.info.hpl, fileName].join(resourceIdSep);

        return cb(null, {
          dirPath,
          fileName,
          filePath,
          id: resourceId,
        });
      },
      (resource, cb) => {
        // make sure the same filename does not exist anywhere under MACHINES_USER_DIR
        glob(`**/${resource.fileName}`, {
          cwd: path.normalize(conf.get('MACHINES_USER_DIR')),
        }, (err, files) => {
          req.log.debug('glob returned', {
            err,
            files,
          });
          if ((files) && (files.length > 0)) {
            return cb({
              code: 422,
              message: 'user machine definition already exists with the same name',
              err: null,
            });
          }
          return cb(null, resource);
        });
      },
      (resource, cb) => {
        // make sure the same filename does not exist anywhere under MACHINES_SYSTEM_DIR
        glob(`**/${resource.fileName}`, {
          cwd: conf.get('MACHINES_SYSTEM_DIR'),
        }, (err, files) => {
          req.log.debug('glob returned', {
            err,
            files,
          });
          if ((files) && (files.length > 0)) {
            return cb({
              code: 422,
              message: 'system machine definition already exists with the same name',
              err: null,
            });
          }
          return cb(null, resource);
        });
      },
      (resource, cb) => {
        // make sure the diretory exists
        mkdirp(resource.dirPath, (err) => {
          if (err) {
            return cb({
              code: 500,
              message: `Error creating ${resource.dirPath}`,
              err,
            });
          }
          return cb(null, resource);
        });
      },
      (resource, cb) => {
        // turn the json object into a string
        resource.data = {};
        let err = null;
        try {
          resource.data = JSON.stringify(req.body, null, 2);
        } catch (e) {
          err = e;
        }

        if (err) {
          // should never reach here since at this point we have already
          // verified the json was valid.  This is here just as a precaution
          return cb({
            code: 422,
            message: 'Error calling  JSON.stringify',
            err,
          });
        }

        return cb(null, resource);
      },
      (resource, cb) => {
        // write the file
        fs.writeFile(resource.filePath, resource.data, 'UTF-8', (err) => {
          if (err) {
            return cb({
              code: 500,
              message: `Error writting ${resource.filePath}`,
              err,
            });
          }
          return cb(null, resource);
        });
      },
    ], (err, resource) => {
      if (err) {
        req.log.warn(err);
        return res.status(err.code).jsonp({
          message: err.message,
          err: err.err,
        });
      }

      return res.status(200).jsonp(_.extend({}, req.body, {
        id: resource.id,
      }));
    });
  });

router.route('/files/resource/:resourceId')
  .get((req, res) => {
    fs.readFile(req.resource.filePath, 'UTF-8', (errReadFile, _data) => {
      if (errReadFile) {
        return res.status(500).jsonp({
          message: `Error readng ${req.params.resourceId}`,
          err: errReadFile,
        });
      }

      let err = null;
      let data;
      try {
        data = JSON.parse(_data);
      } catch (e) {
        err = e;
      }

      if (err) {
        return res.status(500).jsonp({
          message: 'Failed reading file',
          err,
        });
      }

      // in the response add the id
      return res.status(200).jsonp(_.extend({}, data, {
        id: req.params.resourceId,
      }));
    });
  }).post((req, res) => {
    const { validate } = req.app;
    // only allow writing user file
    if (req.resource.type !== 'user') {
      req.log.debug('Invalid resource type', req.resource.type);
      return res.status(422).jsonp({
        message: 'Invalid resource type',
      });
    }

    // remove id as we don't want to save it
    if (_.hasIn(req, 'body.id')) {
      delete req.body.id;
    }

    // validate the json against the hpl schema
    let valid = validate.hpl(req.body);
    if (!valid) {
      return res.status(422).jsonp({
        message: ajv.errorsText(validate.hpl.errors),
        err: validate.hpl.errors,
      });
    }

    // now we know this is a valid hpl json object validate it against
    // the specifi hpl schema
    valid = validate[req.body.info.hpl](req.body);
    if (!valid) {
      return res.status(422).jsonp({
        message: ajv.errorsText(validate[req.body.info.hpl].errors),
        err: validate[req.body.info.hpl].errors,
      });
    }

    // check for duplicate variables names
    if (req.body.variables.length > 1) {
      let duplicateName;
      const seen = {};
      const hasDuplicates = req.body.variables.some((variable) => {
        if (_.hasIn(seen, variable.name)) {
          // Current name is already seen
          duplicateName = variable.name;
          return true;
        }

        // Current name is being seen for the first time
        seen[variable.name] = false;
        return (seen[variable.name]);
      });

      if (hasDuplicates) {
        return res.status(422).jsonp({
          message: `variable name ${duplicateName} is duplicated`,
        });
      }
    }

    // we are updating an existing definition so the name and hpl can't change
    if (req.body.info.name !== req.resource.name) {
      return res.status(422).jsonp({
        message: 'info.name is wrong',
      });
    }
    if (req.body.info.hpl !== req.resource.hpl) {
      return res.status(422).jsonp({
        message: 'info.hpl is wrong',
      });
    }

    let data = {};
    try {
      data = JSON.stringify(req.body, null, 2);
    } catch (e) {
      req.log.err({ err: e }, 'Failed to parse JSON');
    }

    return fs.writeFile(req.resource.filePath, data, 'UTF-8', (errWriteFile) => {
      if (errWriteFile) {
        return res.status(500).jsonp({
          message: `Error writting ${req.params.resourceId}`,
          err: errWriteFile,
        });
      }

      return res.status(200).jsonp(_.extend({}, req.body, {
        id: req.params.resourceId,
      }));
    });
  }).delete((req, res) => {
    // only allow deleting user file
    if (req.resource.type !== 'user') {
      req.log.debug('Invalid resource type', req.resource.type);
      return res.status(422).jsonp({
        message: 'Invalid resource type',
      });
    }

    return fs.unlink(req.resource.filePath, (err) => {
      if (err) {
        return res.status(500).jsonp({
          message: 'Error deleting file',
          err,
        });
      }

      // in the response add the id
      return res.status(200).jsonp({
        id: req.params.resourceId,
      });
    });
  });

router.route('/schemas')
  .get((req, res) => {
    const { schemas } = req.app;
    res.status(200).jsonp(schemas);
  });

router.route('/schemas/:schema')
  .get((req, res) => {
    const { schemas } = req.app;
    if (_.hasIn(schemas, req.params.schema)) {
      return res.status(200).jsonp(schemas[req.params.schema]);
    }
    return res.status(404).jsonp({
      message: 'Schema not found',
    });
  });

module.exports = router;
