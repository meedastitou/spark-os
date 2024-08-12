/* jshint esversion: 6 */
const { EventEmitter } = require('events');


const SparkplugTester = function SparkplugTester() {
  const SparkplugTesterClient = new EventEmitter();
  SparkplugTesterClient.publishNodeBirth = function publishNodeBirth(payload) {
    this.emit('testerPublishNodeBirth', payload);
  };
  SparkplugTesterClient.publishDeviceBirth = function publishDeviceBirth(machineName, payload) {
    this.emit('testerPublishDeviceBirth', machineName, payload);
  };
  SparkplugTesterClient.publishDeviceData = function publishDeviceData(deviceId, payload) {
    this.emit('testerPublishDeviceData', deviceId, payload);
  };
  SparkplugTesterClient.publishNodeData = function publishNodeData(payload) {
    this.emit('testerPublishNodeData', payload);
  };
  SparkplugTesterClient.publishDeviceDeath = function publishDeviceDeath(machineName, payload) {
    this.emit('testerPublishDeviceDeath', machineName, payload);
  };
  SparkplugTesterClient.stop = function stop() {
  };

  this.newClient = function newClient() {
    return SparkplugTesterClient;
  };
};

module.exports = new SparkplugTester();
