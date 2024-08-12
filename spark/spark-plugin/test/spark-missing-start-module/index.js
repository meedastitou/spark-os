var EventEmitter = require("events").EventEmitter;

var info = {
    name: "spark-missing-start-module"
};

var sparkMissingStartModule = new EventEmitter();
sparkMissingStartModule.timer = null;

var d = new Date();
sparkMissingStartModule.createdAt = d.toISOString();

sparkMissingStartModule.stop = function(done) {
    return done();
};

sparkMissingStartModule.require = function() {
    return [];
};

module.exports = sparkMissingStartModule;
