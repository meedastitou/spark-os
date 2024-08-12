var path = require('path');
var glob = require('glob');
var _ = require('lodash');
var Ajv = require('ajv');
var ajv = Ajv({
    allErrors: true,
    unknownFormats: ['tabs']
});
var async = require('async');

var hplSchema = require(path.join(__dirname, '..', 'spark-machine-hpl', 'schemas', 'hpl.json'));

var validate = {
    hpl: ajv.compile(hplSchema)
};

function getSchema(schemaPath) {

    //load the schema
    var schema = require(schemaPath);

    //merge in the hpl definitions
    return _.merge({}, schema, {
        definitions: {
            hpl: hplSchema
        }
    });
}

function loadSchema(schemaPath, done) {
    var err = null;
    var result = {
        path: path.join(schemaPath, 'schema.json'),
        name: path.basename(schemaPath).replace(/^.*-hpl-/, '')
    };

    try {
        result.schema = _.merge({}, require(result.path), {
            definitions: {
                hpl: hplSchema
            }
        });
    } catch (e) {
        err = e;
        result = null;
    }

    return done(err, result);
}

function loadValidators(done) {
    glob(path.join(__dirname, '..', '*-hpl-*'), function(err, schemas) {
        if (err) {
            return done(err);
        }

        async.map(schemas, function(schema, cb) {
            loadSchema(schema, cb);
        }, function(err, results) {
            if (err) {
                return done(err);
            }

            //remove empty results
            results = results.filter(function(n) {
                return ((n !== undefined) && (n !== null));
            });

            for (var i = 0; i < results.length; i++) {
                validate[results[i].name] = ajv.compile(results[i].schema);
            }

            return done(null);
        });
    });
}

loadValidators(function(err) {
    if (err) {
        throw new Error(err);
    }

    glob("**/*.json", {
        ignore: ['package.json', 'package-lock.json', 'node_modules/**', '**/test/*']
    }, function(err, files) {

        if (err) {
            throw new Error(err);
        }

        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            console.log(file);

            var data = require(path.join(__dirname, file));
            var valid = validate.hpl(data);
            if (!valid) {
                throw new Error("Failed processsing " + file + ", " + ajv.errorsText(validate.hpl.errors));
            }

            valid = validate[data.info.hpl](data);
            if (!valid) {
                throw new Error("Failed processsing " + file + ", " + ajv.errorsText(validate[data.info.hpl].errors));
            }

            // check the name and filename match
            let name = file.split('/')[1]
            if (name !== data.info.name + '.json') {
                throw new Error(`${file} has wrong filename, name is '${data.info.name}' but filename is '${name}'`)
            }

            // check the hpl matches the directory
            let hpl = file.split('/')[0]
            if ((hpl !== data.info.hpl) && (hpl !== 'senselinc')) {
                throw new Error(`${file} is in the wrong directory, hpl is '${data.info.hpl}' but directory is '${hpl}'`)
            }
        }

        console.log("All OK");
    });

});
