const fs = require('fs');

// process the cmd line inputs
const args = process.argv.slice(2);

if (args.length !== 4) {
  // eslint-disable-next-line no-console
  console.log('\nPlease call with correct args including ip address, port, path to directory of the data files to serve and tick rate in seconds e.g.');
  // eslint-disable-next-line no-console
  console.log('node testPublishClientOttoPc8578.js 192.168.0.1 7501 ../../spark-machines/net/test/ 20\n');
  process.exit(0);
}

const ipAddress = args[0];
const port = parseInt(args[1], 10);
const directory = args[2];
const tickMs = 1000 * parseInt(args[3], 10);

const net = require('net');

let timer = null;
let socket = null;

const file1 = fs.readFileSync(`${directory}otto-pc-8578-publish-data-pt1.xml`, 'utf8');
const file2 = fs.readFileSync(`${directory}otto-pc-8578-publish-data-pt2.xml`, 'utf8');
const file3 = fs.readFileSync(`${directory}otto-pc-8578-publish-data-pt3.xml`, 'utf8');

const buf1 = Buffer.from(file1, 'utf-8');
const buf2 = Buffer.from(file2, 'utf-8');
const buf3 = Buffer.from(file3, 'utf-8');

const buf1Copy = Buffer.alloc(buf1.length - 1);
const buf2Copy = Buffer.alloc(buf2.length - 1);
const buf3Copy = Buffer.alloc(buf3.length - 1);

buf1.copy(buf1Copy, 0, 0, buf1.length - 1);
buf2.copy(buf2Copy, 0, 0, buf2.length - 1);
buf3.copy(buf3Copy, 0, 0, buf3.length - 1);

function sendData3() {
  // eslint-disable-next-line no-console
  console.log(buf3Copy[buf3Copy.length - 1]);
  socket.write(buf3Copy);
}

function sendData2() {
  // eslint-disable-next-line no-console
  console.log(buf2Copy[buf2Copy.length - 1]);
  socket.write(buf2Copy);
  setTimeout(sendData3, 1000);
}

function myTimer() {
  // use timer publish new data at intervals
  // eslint-disable-next-line no-console
  console.log(buf1Copy[buf1Copy.length - 1]);
  socket.write(buf1Copy);

  setTimeout(sendData2, 1000);
}

socket = net.createConnection(port, ipAddress, () => {
  // 'connect' listener

  // enters here when it connects to the server
  // eslint-disable-next-line no-console
  console.log(`connected to server: ${ipAddress} Start timer task to send data`);
  timer = setInterval(myTimer, tickMs);
});

socket.on('error', (error) => {
  // eslint-disable-next-line no-console
  console.log(error);
});

socket.on('end', () => {
  // eslint-disable-next-line no-console
  console.log('Server closed the connection, stop attempting to send data');
  // cancel timer
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
});
