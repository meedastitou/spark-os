var info = {
    name: "spark-dummy-module"
};

module.exports.start = function(modules, done) {
    console.log('10*10 =',modules['spark-other-module'].exports.timesTen(10));
    return done(null, info);
};

module.exports.stop = function(done) {
    return done();
};

module.exports.require = function(){
    return ['spark-other-module'];
};
