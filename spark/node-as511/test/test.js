var as511 = require('../index.js');

var ttyDev = process.env.TTY_DEV || '/dev/ttyUSB0';

try {
    var client = new as511(ttyDev);
    client.openSync();

    var value;
    value = client.readSync(parseInt('0FAE', 16), 512);
    console.log(JSON.stringify(value));

    for (var i=0; i<500; i++) {
        value = client.readSync(parseInt('0FAF', 16), 1);
        console.log(JSON.stringify(value));
    }

    client.closeSync();
} catch(e) {
    console.log(e);
}
