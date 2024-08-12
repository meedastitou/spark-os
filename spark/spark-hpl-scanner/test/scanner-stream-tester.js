/* jshint esversion: 6 */
const { EventEmitter } = require('events');

const ScannerStreamTester = function ScannerStreamTester() {
  const ScannerStream = new EventEmitter();
  ScannerStream.close = function close() {
  };

  this.emit = function emit(emitEvent, emitData) {
    setTimeout(() => {
      ScannerStream.emit(emitEvent, emitData);
    }, 100);
  };

  this.createReadStream = function connect() {
    return ScannerStream;
  };
};

module.exports = new ScannerStreamTester();
