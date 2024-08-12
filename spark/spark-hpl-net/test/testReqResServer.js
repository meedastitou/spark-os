/*  Request Response type test server for use with spark net machines

File format of input data file should be a json array of key value pair objects
e.g. for spark-machine-ppt-datalogic

[{"Date": "03-10-2016", "Time": "10:05:05 am", "Count": "3427",
 "Clip1Dim": "0.120228", "Clip2Dim": "0.113907", "Result": "fail"},
{"Date": "03-10-2016", "Time": "10:05:10 am", "Count": "3530",
 "Clip1Dim": "0.119027", "Clip2Dim": "0.099294", "Result": "pass"},
...

The server should revieve request containing a key to be used. The server then
sends back the value associated with that key as the current index of the array
(which increments based on the tick rate passed in )

*/

// process the cmd line inputs
const args = process.argv.slice(2);

if (args.length !== 3) {
  // eslint-disable-next-line no-console
  console.log('\nPlease call with correct args including port, path to data file to serve and tick rate in seconds e.g.');
  // eslint-disable-next-line no-console
  console.log('node testReqResServer.js 10000 ../../spark-machines/net/test/ppt-datalogic-req-res-data.json 2\n');
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
  // use timer to increment data index
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
  console.log('Client has connected');
  timer = setInterval(myTimer, tickMs);

  socket.on('data', (data) => {
    // got req from client

    // send back response based on request (use request data as key to object list at current index)
    const key = data.toString();
    if (dataArray[index][key]) {
      mySocket.write(dataArray[index][key]);
    } else {
      mySocket.write('');
    }
  });

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


// example method for converting between publish data format and an key value object
// format used by this req/res server
let strTextArray;
// eslint-disable-next-line no-unused-vars
function convertPubDataToReqResFormat() {
  for (let i = 0; i < strTextArray.length; i += 1) {
    const Date = strTextArray[i].match('^([^,]+)')[1];
    const Time = strTextArray[i].match(', (.*?),')[1];
    const Count = strTextArray[i].match('count= ([^,]+)')[1];
    const Clip1Dim = strTextArray[i].match('Clip1 dim = ([^,]+)')[1];
    const Clip2Dim = strTextArray[i].match('Clip2 dim=([^,]+)')[1];
    const Result = strTextArray[i].match('(pass|fail)$')[1];

    // eslint-disable-next-line no-console
    console.log(`{'Date': '${Date}', 'Time': '${Time}', 'Count': '${Count}', 'Clip1Dim': '${Clip1Dim}', 'Clip2Dim': '${Clip2Dim}', 'Result': '${Result}'},`);
  }
}
