//load the configuration file
var path = require('path');
var pkg = require(path.join(__dirname, '..', 'package.json'));
var sd = require('systemd-daemon');

var sparkLogging;
var conf;

(function() {
    "use strict";

    var sparkPlugin = require('spark-plugin');
    sparkPlugin.dir = path.join(__dirname, '..', 'node_modules');

    sparkPlugin.loadModules('spark-*', function(err, moduleNames) {
        if (err) {
            console.trace(err);
            process.exit(1);
        }

        //setup the logging module
        sparkLogging = sparkPlugin.getModule('spark-logging');
        sparkLogging.name = pkg.name;

        //setup the config module
        conf = sparkPlugin.getModule('spark-config');
        conf.defaultConf = path.join(__dirname, '..', 'defaultConf');

        //start the machine plugins
        sparkPlugin.startModules(moduleNames, function(err) {
            if (err) {
                console.trace(err);
                process.exit(1);
            }

            //the logging module has now started so use it
            var log = sparkLogging.getLogger(pkg.name);

            //enabled logging in spark-plugin
            sparkPlugin.log = sparkLogging.getLogger('spark-plugin');

            log.info("Started in " + conf.get('NODE_ENV') + ' mode');

            // enable systemd watchdog once all modules have started
            sd.notify('READY=1');
            sd.watchdog.start();

            // Workoung around SPARK-413
            process.removeAllListeners('SIGSEGV');
        });
    });

})();
