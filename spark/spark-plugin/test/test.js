var pkg = require('../package.json');
var bunyan = require('bunyan');
var log = bunyan.createLogger({
    name: pkg.name,
    level: 'DEBUG',
    src: true
});

var sparkPlugin = require('../index.js');
sparkPlugin.log = log;
sparkPlugin.dir = __dirname;

sparkPlugin.loadModules('spark-*',function(err, modules) {
    if (err) log.error(err);
    log.info(modules);

    sparkPlugin.startModule('spark-dummy-module',function(err) {
        if (err) log.error(err);
    });
});

setTimeout(function(){
    sparkPlugin.stopModules(function(err){
        if (err) log.error(err);
    });
},10000);
