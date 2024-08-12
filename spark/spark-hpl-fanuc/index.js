/*jshint esversion: 6 */

var path = require('path');
var _ = require('lodash');
var async = require('async');
var net = require('net');
var SerialPort = require("serialport");
const Readline = SerialPort.parsers.Readline;

var defaults = require(path.join(__dirname, 'defaults.json'));
var schema = require(path.join(__dirname, 'schema.json'));

const MAX_PUBLISH_BUFFER_SIZE = (50 * 1024);
const START_OF_V2_PACKET_DATA = 36;
const START_OF_V3_PACKET_DATA = 4152;

var v3buffer = Buffer.alloc(MAX_PUBLISH_BUFFER_SIZE);
var v3bufferSize = 0;

//MATTMATT - diagnostics - tag used to designate diagnostic code left in to determine the extent of data corruption.
// can be removed when that tracking is no longer necessary.

// constructor
var hplFanuc = function(log, machine, model, conf, db, alert) {
    // preload alert messages that have known keys
    alert.preLoad({
      'connect-error': {
        msg: 'Fanuc: Failed to Connect to Controller',
        description: 'Could not connect to the controller.  Check the connection to the controller and its settings.'
      },
      'host-connect-error': {
        msg: 'Fanuc: Error Connecting to Controller',
        description: x => `Error connecting to the controller. Error: ${x.errorMsg}. Check the connection to the controller and its settings.`
      },
      'invalid-packet-error': {
        msg: 'Fanuc: Invalid Packets Received',
        description: x => `Invalid packets received - exceeded retry count of ${x.retryCount}. Check the serial port configuration and connection.`
      },
      'database-error': {
        msg: 'Fanuc: Error Writing to Database',
        description: x => `An error occurred writing a variable value to the database. Error: ${x.errorMsg}`
      },
      'close-error': {
        msg: 'Fanuc: Error Closing Connection',
        description: x => `An error occurred while trying to close the connection to the controller. Error: ${x.errorMsg}`
      }
    });

    //Private variables
    var that = this;
    var sendingActive = false;
    var receiveWaitCount = 0;
    var queryRetryCount = 0;
//MATTMATT - diagnostics
    var showNextValidResultsFlag = false;
    var previousResultsArray = [];
    var corruptResultsArray = [];
//end MATTMATT - diagnostics
    var timer = null;
    var v3ResponseTimer = null;
    var interface;
    var version;
    var serialPort = null;
    var server = null;
    var clientSocket = null;
    var resultsArray = [];

    var connectTimer = null;
    const CONNECT_TIME_OUT = 60 * 1000;

    var initRequestV2packet1 = Buffer.from([
        0x4c,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x00,0x00,
        0x00,0x3b,0x3b,0x3b,0x3b,0x34,0x00,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x05,0x00,0x00,0x00,0x07,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x06,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x3b,0x3b,0x3b,0x3b]);

    var initRequestV2packet2 = Buffer.from([
        0x4c,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x00,0x00,
        0x00,0x3b,0x3b,0x3b,0x3b,0x34,0x00,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x05,0x00,0x00,0x00,0x07,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x06,0x00,0x00,0x00,0x01,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x3b,0x3b,0x3b,0x3b]);

        var initRequestV2packet3 = Buffer.from(
        [0x4c,0x07,0x00,0x00,0x01,0x00,0x00,0x00,0x80,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x01,0x00,0x00,0x00,0x3b,0x3b,0x3b,0x3b,0x34,0x07,0x00,0x00,0x80,0x00,0x00,0x00,
        0x39,0x04,0x00,0x00,0x00,0x00,0x00,0x00,0x20,0x07,0x00,0x00,0x20,0x00,0x00,0x00,
        0x01,0x00,0x70,0x00,0x00,0x7d,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x03,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x05,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x06,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x07,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x08,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x09,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x0a,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x0b,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x0c,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x0d,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x0e,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x0f,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x10,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x11,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x12,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x13,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x15,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x17,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x18,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x19,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x1a,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x1b,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x1c,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x1d,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x1e,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x1f,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x20,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x21,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x22,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x23,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x24,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x25,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x26,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x27,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x28,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x29,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x2a,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x2b,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x2c,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x2d,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x2e,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x2f,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x30,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x31,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x32,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x33,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x34,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x35,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x36,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x37,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x38,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x39,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x3a,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x3b,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x3c,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x3d,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x3e,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x3f,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x40,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x41,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x42,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x43,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x44,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x45,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x46,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x47,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x48,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x49,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x4a,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x4b,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x4c,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x4d,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x4e,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x4f,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x50,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x51,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x52,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x53,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x54,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x55,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x56,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x57,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x58,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x59,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x5a,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x5b,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x5c,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x5d,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x5e,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x5f,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x60,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x61,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x62,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x63,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x64,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x65,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x66,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x67,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x68,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x69,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x6a,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x6b,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x6c,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x6d,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x6e,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x6f,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x3b,0x3b,0x3b,0x3b]);

    var v2responseToPcDate = Buffer.from([
        0x38,0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x00,0x00,0x00,
        0x01,0x00,0x00,0x00,0x3b,0x3b,0x3b,0x3b,0x20,0x00,0x00,0x00,0x00,0x04,0x00,0x00,
        0x47,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xe0,0x07,0x0c,0x00,0x07,0x00,0x10,0x00,
        0x18,0x00,0x06,0x00,0x3b,0x3b,0x3b,0x3b]);

    var v2responseToDummy1 = Buffer.from([
            0x34,0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,
            0x01,0x00,0x00,0x00,0x3b,0x3b,0x3b,0x3b,0x1c,0x00,0x00,0x00,0x00,0x00,0x01,0x00,
            0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x2d,0x4e,0x4f,0x20,0x41,0x52,0x47,0x2d,
            0x3b,0x3b,0x3b,0x3b]);

    var v2packetTypeReq556 = Buffer.from([0x3b, 0x3b, 0x3b, 0x3b, 0x14, 0x02]);

    var v2responseToReq556 = Buffer.from([
        0x30,0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x40,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x01,0x00,0x00,0x00,0x3b,0x3b,0x3b,0x3b,0x18,0x00,0x00,0x00,0x40,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x3b,0x3b,0x3b,0x3b]);

    var v2packetTypeReq48 = Buffer.from([0x3b, 0x3b, 0x3b, 0x3b, 0x18, 0x00]);

    var v2responseToReq48 = Buffer.from([
        0x34,0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x00,0x00,0x00,
        0x01,0x00,0x00,0x00,0x3b,0x3b,0x3b,0x3b,0x1c,0x00,0x00,0x00,0x00,0x04,0x00,0x00,
        0x51,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x57,0x41,0x56,0x45,0x49,0x4e,0x46,0x4f,
        0x3b,0x3b,0x3b,0x3b
    ]);

    var requestPayloadV1 = Buffer.from([0x02, 0x49, 0x4b, 0x34, 0x03, 0x33, 0x35, 0x0d, 0x0a]);

    var requestPayloadV2 = Buffer.from([
        0x34,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x20,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x00,
        0x00,0x00,0x3b,0x3b,0x3b,0x3b,0x1c,0x00,0x00,0x00,0x20,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x2d,0x4e,0x4f,0x20,0x41,0x52,0x47,0x2d,0x3b,0x3b,0x3b,0x3b]);

    var packetTypeDataResponseV2_type1 = Buffer.from([0x3b, 0x3b, 0x3b, 0x3b, 0x14, 0x28]);
    var packetTypeDataResponseV2_type2 = Buffer.from([0x3b, 0x3b, 0x3b, 0x3b, 0x24, 0x27]);

    var v2initMode = false;
    var v2packetsSent = 0;
    var firstPacketThrown = false;

    const MAX_WAIT_COUNT = 1;
    const MAX_QUERY_RETRY_COUNT = 10;

    //public variables
    that.dataCb = null;
    that.configUpdateCb = null;
    that.machine = _.merge({}, defaults, machine);
    if (model) {
        that.machine.settings.model = _.cloneDeep(model);
    }

    //private methods

    function validateV1ResponseData(dataString) {

        var responseBuffer = new Buffer(dataString);

        var checksumTotal = 0;
        var i;
        for (i = 1; i < responseBuffer.length - 3; i++) {
            checksumTotal ^= responseBuffer[i];
        }
        var checksumTotalHex = checksumTotal.toString(16).toUpperCase();

        if ((dataString[i] + dataString[i + 1]) == checksumTotalHex) {
            return true;
        } else {
            return false;
        }
    }

    function processResponseData(dataString) {

        // point to the variable array
        var variables = that.machine.variables;

        // reset results array
        resultsArray = [];

        // loop through the stored variable array
        for (var i = 0; i < variables.length; i++) {

            // start with a null value in case we do not have valid data for this variable, or a way of extracting it
            var processedValue = null;

            // extract this variables value (as a string) using its offset and length parameters
            var varAsString;
            if (version === 'v3') {
                varAsString = dataString.substr(variables[i].charOffset, (variables[i].charLength - 1)).trim();
            } else {
                varAsString = dataString.substr(variables[i].charOffset, variables[i].charLength).trim();
            }

            if ((Object.prototype.hasOwnProperty.call(variables[i], 'alarmCode') === true) && (variables[i].alarmCode === true)) {
                // special case handler for alarm code field
                if (varAsString.length > 0) {
                    if (varAsString.substr(0, 1) === '*') {
                        // tagged as an alarm, get the actual value, skipping the first '*' character
                        varAsString = varAsString.substr(1).trim();
                        if (varAsString.length > 0) {
                            processedValue = convertType('int16', varAsString);
                        } else {
                            processedValue = 0; // empty field reported as alarm code 0.
                        }
                    } else {
                        processedValue = 0;
                    }
                } else {
                    // for alarm code, empty field always reported as 0.
                    processedValue = 0;
                }
            } else {
                // if some data is found
                if (varAsString.length > 0) {
                    // convert type based on variables format property
                    var varAsValue = convertType(variables[i].format, varAsString);

                    if (version === 'v3') {
                        processedValue = varAsValue;  // for v3, no post-processing is necessary.
                    } else {
                        // if conversion was succesful
                        if (varAsValue !== null) {
                            // post process this data based on the variables measurment type
                            processedValue = postProcessValue(variables[i].measType, varAsValue);
                        }
                    }

                } else {
                    // if no data, and we have been asked to convert this lack of data to a zero, then do so
                    if ((Object.prototype.hasOwnProperty.call(variables[i], 'convertNullToZero') === true) && (variables[i].convertNullToZero === true)) {
                        processedValue = 0;
                    }
                }
            }

            // if we had data for this variable, store it in the variable's results array
            resultsArray.push(processedValue);
        }

//MATTMATT - diagnostics
        if (showNextValidResultsFlag === true) {
            if (((resultsArray[5] !== null) && (corruptResultsArray[5] !== null) &&
                 ((resultsArray[5] > (corruptResultsArray[5] + 2)) || (resultsArray[5] < (corruptResultsArray[5] - 2)))) ||
                ((resultsArray[6] !== null) && (corruptResultsArray[6] !== null) &&
                    ((resultsArray[6] > (corruptResultsArray[6] + 2)) || (resultsArray[6] < (corruptResultsArray[6] - 2))))) {
                log.info('potential fixed corrupt reply:');
                log.info('previous resultsArray:');
                log.info(previousResultsArray);
                log.info('corrupt resultsArray:');
                log.info(corruptResultsArray);
                log.info('corrected resultsArray:');
                log.info(resultsArray);
            }
            showNextValidResultsFlag = false;
        }
//end MATTMATT - diagnostics

        // we have finished processing this response
        sendingActive = false;
        // save all results to the database
        saveResultsToDb();

    }

    function processV2V3ResponsePacket(packetData, packetSize) {

        //  if running then compare packet area with reference that we know means a response packet
        var thisPacketType= packetData.slice(20,26);

        if ((packetTypeDataResponseV2_type1.equals(thisPacketType)) ||    // a-S100iA response
            (packetTypeDataResponseV2_type2.equals(thisPacketType))) {    //  S2000-i50B response
            // if a match, then trim so that status is at char offset 4 (as per v1)
            var trimmedData;
            if (version === 'v3') {
                if (packetSize > START_OF_V3_PACKET_DATA) {
                    trimmedData = packetData.slice([START_OF_V3_PACKET_DATA]);
                    // and pass to process response as a string
                    processResponseData(trimmedData.toString());
                }
            } else {
                if (packetSize > START_OF_V2_PACKET_DATA) {
                    trimmedData = packetData.slice([START_OF_V2_PACKET_DATA]);
                    // and pass to process response as a string
                    processResponseData(trimmedData.toString());
                }
            }
        } else {
            // might be a request packet we should respond to
            if( packetData.lastIndexOf('-PCDATE-') !== -1 ) {
                // SPARK-676 ignore PCDATE request, otherwise incorrect time will be set by the pre-canned response
                //clientSocket.write(v2responseToPcDate);
            } else if( packetData.lastIndexOf('-DUMMY1-') !== -1 ) {
                    clientSocket.write(v2responseToDummy1);
            } else if ( v2packetTypeReq556.equals(thisPacketType) ) {
                clientSocket.write(v2responseToReq556);
            } else if ( v2packetTypeReq48.equals(thisPacketType) ) {
                clientSocket.write(v2responseToReq48);
            } else {
                // ignore any other packets sent by client
            }
        }
    }

//MATTMATT - diagnostics
    function processInvalidResponseData(dataString) {

        // point to the variable array
        var variables = that.machine.variables;

        // reset results array
        corruptResultsArray = [];

        // loop through the stored variable array
        for (var i = 0; i < variables.length; i++) {

            // start with a null value in case we do not have valid data for this variable, or a way of extracting it
            var processedValue = null;

            // extract this variables value (as a string) using its offset and length parameters
            var varAsString = dataString.substr(variables[i].charOffset, variables[i].charLength).trim();

            // if some data is found
            if (varAsString.length > 0) {
                // convert type based on variables format property
                var varAsValue = convertType(variables[i].format, varAsString);

                // if conversion was succesful
                if (varAsValue !== null) {
                    // post process this data based on the variables measurment type
                    processedValue = postProcessValue(variables[i].measType, varAsValue);
                }

            } else {
                // if no data, and we have been asked to convert this lack of data to a zero, then do so
                if ((Object.prototype.hasOwnProperty.call(variables[i], 'convertNullToZero') === true) && (variables[i].convertNullToZero === true)) {
                    processedValue = 0;
                }
            }

            // if we had data for this variable, store it in the variable's results array
            corruptResultsArray.push(processedValue);
        }
        showNextValidResultsFlag = true;
    }
//end MATTMATT - diagnostics

    function requestTimer() {

        // only start a new request if previous set has finished and we have an open interface to write to (note v2 ethernet does not use this flag)
        if (sendingActive === false) {

            receiveWaitCount = 0;
            if ((interface === 'ethernet') && (clientSocket !== null)) {

                if( version === 'v1') {
                    // make a tcp request for the data
                    sendingActive = true;
                    clientSocket.write(requestPayloadV1);
                    // now wait for processResponseData method to be called by 'on data'
                } else {
                    clientSocket.write(requestPayloadV2);
                }
            } else if ((interface === 'serial') && (serialPort.isOpen)) {

                // make a serial request for the data
                sendingActive = true;
                async.series([

                    function(cb) {
                        serialPort.flush(function(err) {
                            cb(err);
                        });
                    },

                    function(cb) {
                        serialPort.write(requestPayloadV1, function(err) {
                            if(!err) {
                                connected = true;
                            }
                            cb(err);
                        });
                    }]
                );

                // serialPort.write(requestPayloadV1, function(err) {
                //     if (err) {
                //         log.error('Error sending request: ' + err);
                //         sendingActive = false;
                //     }
                // });
                // now wait for processResponseData method to be called by 'on data'
            }
        } else {
            // we're waiting on a reply, so we don't send the new request.
            // but update our wait count to make sure that we eventually recover and re-request.
            receiveWaitCount++;
            if (receiveWaitCount >= MAX_WAIT_COUNT) {
                // stop waiting - next time the timer expires, we WILL send the request.
                log.error('no response received - re-send request next cycle');
                sendingActive = false;
            }
        }
    }

    function convertType(format, resultAsString) {
        if (resultAsString !== null) {
            var result;
            var isNumber;

            switch (format) {
                case 'char':
                    {
                        result = resultAsString;
                        break;
                    }
                case 'int8':
                case 'int16':
                case 'int32':
                case 'int64':
                case 'uint8':
                case 'uint16':
                case 'uint32':
                case 'uint64':
                    {
                        isNumber = /^[0-9]+$/.test(resultAsString);
                        if (isNumber) {
                            result = parseInt(resultAsString);
                        } else {
                            result = null;
                        }
                        break;
                    }
                case 'float':
                case 'double':
                    {
                        isNumber = /^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$/.test(resultAsString);
                        if (isNumber) {
                            result = parseFloat(resultAsString);
                        } else {
                            result = null;
                        }
                        break;
                    }
                case 'boolean':
                    {
                        result = resultAsString === 'true';
                        break;
                    }
                default:
                    {
                        result = null;
                        break;
                    }
            }

            return result;
        } else {
            return null;
        }
    }

    function postProcessValue(measurementType, value) {
        var result;

        switch (measurementType) {

            default:
                case 'None (N/A)':
                case 'Force':
            {
                result = value;
                break;
            }
            case 'Temperature':
                    case 'Percentage (0.1%)':
                    case 'Power (0.1kw)':
                    case 'Consumption (0.1w)':
                {
                    result = value / 10;
                    break;
                }
            case 'Time (0.01s)':
                    case 'Percentage (0.01%)':
                    case 'Precision Power (0.01kw)':
                    case 'Flow':
                {
                    result = value / 100;
                    break;
                }
            case 'Precision Time (0.001s)':
                {
                    result = value / 1000;
                    break;
                }
            case 'Length/Distance':
                {
                    if (that.machine.settings.model.units === "Metric") {
                        result = value / 100;
                    } else {
                        result = value / 1000;
                    }
                    break;
                }
            case 'Pressure':
                {
                    if (that.machine.settings.model.units === "Metric") {
                        result = value / 10;
                    } else {
                        result = value;
                    }
                    break;
                }
            case 'Volume':
                {
                    if (that.machine.settings.model.units === "Metric") {
                        result = value / 100;
                    } else {
                        result = value / 10;
                    }
                    break;
                }
        }
        return result;
    }

    function saveResultsToDb() {

        // process the array of results
        async.forEachOfSeries(resultsArray, function(dataItem, index, callback) {
            var variable = that.machine.variables[index];
            // if there wasn't a result
            if (dataItem === null) {
                // alert that there was an error getting this variables data
                alert.raise({
                    key: "read-fail-" + variable.name,
                    msg: "Fanuc: Read Failed for Variable",
                    description: "Read failed for variable '" + variable.name + "'. Check that this variable is defined correctly in the machine."
                });
                // and just move onto next item
                return callback();
            }
            // othewise update the database
            that.dataCb(that.machine, variable, dataItem, function(err, res) {
                alert.clear("read-fail-" + variable.name);

                if (err) {
                    alert.raise({ key: 'database-error', errorMsg: err.message });
                }
                else {
                  alert.clear('database-error');
                }
                if (res) log.debug(res);
                // move onto next item once stored in db
                callback();
            });
        });
    }

    function v3ResponseTimeout() {

        processV2V3ResponsePacket(v3buffer, v3bufferSize);

        v3bufferSize = 0;
        v3ResponseTimer = null;

    }

    function open(callback) {

        interface = that.machine.settings.model.interface;
        var requestFrequencyMs = that.machine.settings.model.requestFrequency * 1000;
        var variables = that.machine.variables;
        version = that.machine.settings.model.version;

        // check whether configured for ethernet or serial
        if (interface === 'ethernet') {

            var port = that.machine.settings.model.port;

            // create a one-shot timer to check for a connection error
            connectTimer = setTimeout(function () {
              alert.raise({ key: 'connect-error'});
              connectTimer = null;
            }, CONNECT_TIME_OUT);

            // create the server
            server = net.createServer(function(socket) {
                // client succesfully connected our server
                // clear the connection timer and any connection alert
                clearTimeout(connectTimer);
                connectTimer = null;
                alert.clear('connect-error');

                // succesfully connected to server
                alert.clear('host-connect-error');

                // if we are already connected to a client
                if (clientSocket !== null) {
                    // if v1 , don't allow any more connections
                    if( version === 'v1') {
                        log.info('Multiple client connection attempt from: ' + socket.remoteAddress + ', ignoring');
                        socket.destroy();
                        return;
                    } else {
                        // with v2, the same machine can connect again (thinking it has lost connection), so instead release the old socket and connect to the new one instead
                        clientSocket.destroy();
                        if (timer) {
                            clearInterval(timer);
                            timer = null;
                        }
                    }
                }

                log.info('Connected to client: ' + socket.remoteAddress);

                // store a reference to the socket (so we can destroy it if we need to close the server)
                clientSocket = socket;

                // start the timer that will trigger the requests
                if( version === 'v1') {
                    timer = setInterval(requestTimer, requestFrequencyMs);
                } else {
                    // or if v2, send first inititialization packet
                    v2initMode = true;
                    v2packetsSent = 1;
                    clientSocket.write(initRequestV2packet1);
                }

                // subscribe to on 'data' events
                socket.on('data', function(data) {

                    if( version === 'v1') {  // 180is-IA
                        // got data from client

                        // only attempt processing if we are expecting it (note v2 ethernet does not use this flag)
                        if (sendingActive === true ) {

                            //  convert whole buffer to a string and send for processing
                            processResponseData(data.toString());
                        }
                    } else {
                        // v2 or v3, so first check mode we are in (init or running)
                        if( v2initMode === true ) {

                            // if init then send next packet
                            if( v2packetsSent === 1) {
                                v2packetsSent = 2;
                                clientSocket.write(initRequestV2packet2);
                            } else if ( v2packetsSent === 2) {
                                v2packetsSent = 3;
                                clientSocket.write(initRequestV2packet3);
                            } else if ( v2packetsSent === 3) {
                                // or change out of init mode
                                v2initMode = false;
                                // and start a timer to start requesting data
                                timer = setInterval(requestTimer, requestFrequencyMs);
                            }
                        } else {

                            if (version === 'v3') {
                                if (v3ResponseTimer) {
                                    clearTimeout(v3ResponseTimer);
                                    v3ResponseTimer = null;
                                }
                                if ((v3bufferSize + data.length) <= MAX_PUBLISH_BUFFER_SIZE) {
                                    data.copy(v3buffer, v3bufferSize);
                                    v3bufferSize += data.length;
                                }
                                v3ResponseTimer = setTimeout(v3ResponseTimeout, 100); // wait 100 msec for more response packets, then process

                            } else {
                                processV2V3ResponsePacket(data, data.length);
                            }
                        }
                    }
                });

                // subscribe to on 'error' events
                socket.on('error', function(err) {
                    alert.raise({ key: 'host-connect-error', errorMsg: err.message });
                    socketDownHelper();
                });

                // subscribe to on 'end' events
                socket.on('end', function() {
                    log.info('Client disconnected');
                    socketDownHelper();
                });

                socket.on('close', function() {
                    log.info('Socket closed');
                    // probably don't need, initiated by us
                    socketDownHelper();
                });

            }).listen(port);

            // for a server, the callback happens immediately, we do not wait for a client connection to declare 'open' a success
            callback(null);
        } else {
            var device = that.machine.settings.model.device;
            var baudRate = parseInt(that.machine.settings.model.baudRate, 10);

            // create a serial port with the correct configuration
            serialPort = new SerialPort(device, {
                baudRate: baudRate,
                autoOpen: false
            });

            const parser = serialPort.pipe(new Readline());

            // attempt to open the serial port
            serialPort.open(function(err) {

                if (err) {
                    return callback(err);
                }

                // subscribe to on 'data' events
                parser.on('data', function(data) {

                    // got string data from client

                    // only attempt processing if we are expecting it (note v2 ethernet does not use this flag)
                    if (sendingActive === true ) {

                        if (firstPacketThrown === false) {
                            // throw away first payload as may not be complete
                            firstPacketThrown = true;
                            sendingActive = false;
                        } else {
                            if (validateV1ResponseData(data.toString()) === true) {
                            // otherwise send for processing
                                queryRetryCount = 0;
                                alert.clear('invalid-packet-error');
                                processResponseData(data.toString());
                            } else {
                                sendingActive = false;
                                if (queryRetryCount < MAX_QUERY_RETRY_COUNT) {
//MATTMATT - diagnostics
                                    previousResultsArray = resultsArray;
                                    processInvalidResponseData(data.toString());
//end MATTMATT - diagnostics
                                    queryRetryCount++;
                                    if (timer) {
                                        // clear out the exisiting request timer, reset it, but immediately call for a retry
                                        clearInterval(timer);
                                    }
                                    timer = setInterval(requestTimer, requestFrequencyMs);
                                    setImmediate(requestTimer);
                                } else {
                                    alert.raise({ key: 'invalid-packet-error', retryCount: queryRetryCount });
                                    queryRetryCount = 0;
                                }
                            }
                        }
                    }
                });

                // subscribe to on 'close' events
                serialPort.on('close', function(err) {
                    log.debug('Serial port closed');

                    // stop the request timer task
                    if (timer) {
                        clearInterval(timer);
                        timer = null;
                    }
                    // reset flags
                    sendingActive = false;
                    firstPacketThrown = false;
                    v2initMode =  false;
                });

                // set up a repeat task to trigger the requests
                timer = setInterval(requestTimer, requestFrequencyMs);

                // trigger callback on succesful connection
                callback(null);
            });
        }
    }

    function close(callback) {

        sendingActive = false;
        if (interface === 'ethernet') {

            // if v2, check if we are in initial phase, if so hold off the close until the end of that exchange to keep the client happier
            if (((version === 'v2') || (version === 'v3')) && (v2initMode === true)) {
                var waitCounter = 0;
                var activeWait = setInterval(function() {
                    if ( (v2initMode === false) || ( waitCounter > 20 )){
                        clearInterval(activeWait);
                        // timer will have got set upon leaving init mode, so will need to cancel it here
                        if (timer) {
                            clearInterval(timer);
                            timer = null;
                        }
                        // close server, disconnecting the client
                        serverCloseHelper(callback);
                    }
                    waitCounter++;
                }, 100); // interval set at 100 milliseconds
            } else {
                // close server, disconnecting the client
                serverCloseHelper(callback);
            }
        } else {
            if (serialPort.isOpen) {
                serialPort.close(callback);
            } else {
                callback();
            }
        }
    }

    function socketDownHelper() {
        clientSocket = null;
        // stop the request timer task
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        // reset flags
        sendingActive = false;
        v2initMode =  false;
    }

    function serverCloseHelper(callback) {
        server.close(callback); // callback only triggers when all sockets have been destroyed
        //  if server has an active connection, the socket used must also be destoyed for the above close to be succesful
        if (clientSocket !== null) {
            clientSocket.destroy();
            clientSocket = null;
        }
    }

    //Privileged methods
    this.start = function(dataCb, configUpdateCb, done) {
        if (!that.machine) {
            return done("machine undefined");
        }

        if (typeof dataCb !== "function") {
            return done("dataCb not a function");
        }
        that.dataCb = dataCb;

        if (typeof configUpdateCb !== "function") {
            return done("configUpdateCb not a function");
        }
        that.configUpdateCb = configUpdateCb;

        //check if the machine is enabled
        if (!that.machine.settings.model.enable) {
            log.debug(that.machine.info.name + ' Disabled');
            return done(null);
        }

        open(function(err) {
            if (err) {
                return done(err);
            }

            log.info('Started');
            return done(null);
        });
    };

    this.stop = function(done) {
        if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = null;
        }

        if (v3ResponseTimer) {
            clearTimeout(v3ResponseTimer);
            v3ResponseTimer = null;
        }

        if (!that.machine) {
          alert.clearAll(function(){
              return done("machine undefined");
          });
        }

        // stop the request timer task (if being used)
        if (timer) {
            clearInterval(timer);
            timer = null;
        }

        // close interface if open
        if (server || serialPort) {
            close(function(err) {
                if (err) {
                    alert.raise({ key: 'close-error', errorMsg: err.message });
                }
                else {
                    alert.clear('close-error');
                }
                server = null;
                serialPort = null;
                // reset flags
                sendingActive = false;
                firstPacketThrown = false;
                v2initMode =  false;

                log.info('Stopped');
                alert.clearAll(function(){
                    return done(null);
                });
            });
        } else {
            log.info('Stopped');
            alert.clearAll(function(){
                return done(null);
            });
        }
    };

    this.restart = function(done) {
        log.debug("Restarting");
        that.stop(function(err) {
            if (err) return done(err);
            that.start(that.dataCb, that.configUpdateCb, function(err) {
                return done(err);
            });
        });
    };

    this.updateModel = function updateModel(newModel, done) {
      log.debug('Updating');
      that.machine.settings.model = _.merge({}, defaults.settings.model, newModel);
      that.restart(err => done(err));
    };

    return true;
};

module.exports = {
    hpl: hplFanuc,
    defaults: defaults,
    schema: schema
};
