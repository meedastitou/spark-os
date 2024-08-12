/* jshint esversion: 6 */
const { EventEmitter } = require('events');

let forceDeviceErr = false;

const AWSIoTTester = function AWSIoTTester() {
  const AWSIoTTesterClient = new EventEmitter();
  AWSIoTTesterClient.publish = function publish(topic, payload) {
    this.emit('testerPublish', topic, payload);
  };
  AWSIoTTesterClient.subscribe = function subscribe(topic) {
    this.emit('testerSubscribe', topic);
  };
  AWSIoTTesterClient.unsubscribe = function subscribe(topic) {
    this.emit('testerUnsubscribe', topic);
  };
  AWSIoTTesterClient.end = function end(callback) {
    callback();
  };

  this.device = function device() {
    if (forceDeviceErr) throw (Error('Error creating device'));
    return AWSIoTTesterClient;
  };

  this.forceDeviceError = function forceDeviceError(forceError) {
    forceDeviceErr = forceError;
  };
};

module.exports = new AWSIoTTester();
