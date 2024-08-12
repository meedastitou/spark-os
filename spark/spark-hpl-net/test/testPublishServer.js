/*  Publish  type test server for use with spark net machines

File format of input data file should be a json array of published data from the machine
to be either extracted via regex or csv style seperations
e.g. for spark-machine-ppt-datalogic

["03-10-2016, 10:05:05 am, count= 3427, Clip1 dim = 0.120228, Clip2 dim=0.113907, fail",
"03-10-2016, 10:05:10 am, count= 3530, Clip1 dim = 0.119027, Clip2 dim=0.099294, pass",
...

The server publishes each line of the array in turn to a connected client at a rate
determined by tick rate passed in

*/

// process the cmd line inputs
const args = process.argv.slice(2);

if (args.length !== 3) {
  // eslint-disable-next-line no-console
  console.log('\nPlease call with correct args including port, path to data file to serve and tick rate in seconds e.g.');
  // eslint-disable-next-line no-console
  console.log('node testPublishServer.js 10000 ../../spark-machines/net/test/ppt-datalogic-publish-data.json 2\n');
  process.exit(0);
}

const tickMs = 1000 * parseInt(args[2], 10);
const port = parseInt(args[0], 10);
// eslint-disable-next-line import/no-dynamic-require
const dataArray = require(args[1]);

const net = require('net');

let timer = null;
let mySocket = null;
let index;

function myTimer() {
  // use timer publish new data at intervals
  mySocket.write(dataArray[index]);
  index += 1;
  if (index === dataArray.length) {
    index = 0;
  }
}

net.createServer((socket) => {
  // enters here when a client connects
  index = 0;
  mySocket = socket;

  // eslint-disable-next-line no-console
  console.log('Client has connected, start timer task to send data');
  timer = setInterval(myTimer, tickMs);

  // pick up connection end signals to stop the timer task
  socket.on('end', () => {
    // eslint-disable-next-line no-console
    console.log('Client closed the connection, stop attempting to send data');
    // cancel timer
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });
}).listen(port);
