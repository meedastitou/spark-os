/*  Publish  type test for use with spark serial machines

File format of input data file should be a json array of published data
from the machine to be either extracted via regex or csv style seperations
e.g. for spark-machine-ppt-datalogic

["03-10-2016, 10:05:05 am, count= 3427, Clip1 dim = 0.120228, Clip2 dim=0.113907, fail",
"03-10-2016, 10:05:10 am, count= 3530, Clip1 dim = 0.119027, Clip2 dim=0.099294, pass",
...

This program publishes each line of the array in turn to a connected device at a rate
determined by tick rate passed in

*/

// process the cmd line inputs
const args = process.argv.slice(2);

if (args.length !== 5) {
  // eslint-disable-next-line no-console
  console.log('\nPlease call with correct args including device, baudrate, path to data file to serve, CR or CRLF ending, and tick rate in seconds e.g.');
  // eslint-disable-next-line no-console
  console.log('node testPublishSerial.js /dev/ttyUSB0 9600 ../../spark-machines/serial/test/mitutoyo-callipers-publish-data.json CRLF 2\n');
  process.exit(0);
}

const device = args[0];
const baudRate = parseInt(args[1], 10);
// eslint-disable-next-line import/no-dynamic-require
const dataArray = require(args[2]);
const endChars = (args[3] === 'CRLF') ? '\r\n' : '\r';
const tickMs = 1000 * parseInt(args[4], 10);

const SerialPort = require('serialport');
// var SerialPort = require("/usr/lib/node_modules/spark-hardware/node_modules/serialport");

let serialPort = null;
let timer = null;
let index = 0;

function myTimer() {
  // use timer publish new data at intervals
  // var sendData = dataArray[index] + endChars ;
  const sendData = `\u0002${dataArray[index]}${endChars}\u0003`; // can add on some start and end text special chars to test more thoroughly
  // eslint-disable-next-line no-console
  console.log(`Sending: ${sendData}`);
  serialPort.write(sendData, (err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.log(`Error sending request: ${err}`);
    }
  });

  index += 1;
  if (index === dataArray.length) {
    index = 0;
  }
}


// create a serial port with the correct configuration
serialPort = new SerialPort(device, {
  baudRate,
  autoOpen: false,
});


// attempt to open the serial port
serialPort.open((err) => {
  if (err) {
    // eslint-disable-next-line no-console
    console.log(`Error opeing serial port: ${err}`);
    return;
  }


  // subscribe to on 'close' events
  serialPort.on('close', () => {
    // eslint-disable-next-line no-console
    console.log('Serial port closed');

    // stop the request timer task if applicable (i.e. if not closed by our request)
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });

  index = 0;
  // eslint-disable-next-line no-console
  console.log('Start timer task to send data');
  timer = setInterval(myTimer, tickMs);
});
