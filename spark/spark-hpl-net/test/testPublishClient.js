/*  Publish  type test client for use with spark net machines

File format of input data file should be a json array of published data from the machine
to be either extracted via regex or csv style seperations
e.g. for spark-machine-ppt-datalogic

["03-10-2016, 10:05:05 am, count= 3427, Clip1 dim = 0.120228, Clip2 dim=0.113907, fail",
"03-10-2016, 10:05:10 am, count= 3530, Clip1 dim = 0.119027, Clip2 dim=0.099294, pass",
...

The client publishes each line of the array in turn to the server it has connected to at a
rate determined by tick rate passed in

*/

// process the cmd line inputs
const args = process.argv.slice(2);

if (args.length !== 4) {
  // eslint-disable-next-line no-console
  console.log('\nPlease call with correct args including ip address, port, path to data file to serve and tick rate in miliiseconds e.g.');
  // eslint-disable-next-line no-console
  console.log('node testPublishClient.js 192.168.0.1 10000 ../../spark-machines/net/test/ppt-datalogic-publish-data.json 2000\n');
  process.exit(0);
}

const tickMs = parseInt(args[3], 10);

const ipAddress = args[0];
const port = parseInt(args[1], 10);
// eslint-disable-next-line import/no-dynamic-require
const dataArray = require(args[2]);

const net = require('net');

let publishTimer = null;
let connectionRetryTimer = null;
let socket = null;
let index = 0;
let connected = false;

function connectionRetry() {
  if (connected === false) {
    // eslint-disable-next-line no-console
    console.log('Attempting connection...');
    // eslint-disable-next-line no-use-before-define
    attemptConnection();
  }
}

function startConnectionTimer() {
  connectionRetryTimer = setInterval(connectionRetry, 5000);
}

function myTimer() {
  // use timer to publish new data at intervals
  socket.write(dataArray[index]);
  index += 1;
  if (index === dataArray.length) {
    index = 0;
  }
}

function attemptConnection() {
  socket = net.createConnection(port, ipAddress, () => {
    // 'connect' listener
    if (connectionRetryTimer) {
      connected = true;
      clearInterval(connectionRetryTimer);
      connectionRetryTimer = null;
    }

    // enters here when it connects to the server
    // eslint-disable-next-line no-console
    console.log(`connected to server: ${ipAddress} Start timer task to send data at ${tickMs}ms intervals`);

    publishTimer = setInterval(myTimer, tickMs);
  });

  socket.on('error', (error) => {
    // eslint-disable-next-line no-console
    console.log(error);
  });

  socket.on('end', () => {
    // eslint-disable-next-line no-console
    console.log('Server closed the connection, stop attempting to send data');

    // cancel publishTimer
    if (publishTimer) {
      clearInterval(publishTimer);
      publishTimer = null;
    }

    // don't exit, retry connection
    connected = false;
    startConnectionTimer();
  });
}

startConnectionTimer();
