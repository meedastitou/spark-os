const { EventEmitter } = require('events');

const bleTester = new EventEmitter();

bleTester.start = function start() {
};

bleTester.stop = function stop() {
};

module.exports = bleTester;
