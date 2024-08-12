var EventEmitter = require("events").EventEmitter;

var info = {
    name: "spark-other-module"
};

var sparkOtherModule = new EventEmitter();
sparkOtherModule.timer = null;

var d = new Date();
sparkOtherModule.createdAt = d.toISOString();

sparkOtherModule.start = function(modules, done) {
    this.timer = setInterval(function(){
        console.log('restartRequest');
        sparkOtherModule.emit('restartRequest', info.name);
    },4000);

    return done(null, info);
};

sparkOtherModule.stop = function(done) {
    if (this.timer) {
        clearInterval(this.timer);
    }
    return done();
};

sparkOtherModule.require = function() {
    return [];
};

sparkOtherModule.timesTen = function(value) {
    return value * 10;
};

module.exports = sparkOtherModule;
