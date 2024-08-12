/* First instance of the ble module. */
var nodeBtle = require('../index');
let i = 1;
var list_one = {};

nodeBtle.start();

let stopWrapperOne = function() {
    nodeBtle.removeListener('newList', function() {
        console.log();
        console.log("Removed first BTLE listener.");
    });

    nodeBtle.stop();

    clearInterval(timerOne);
};

nodeBtle.on('newList', (list) => {
    list_one = list;
});

let wrapperOne = function() {
    console.log();
    console.log("Btle Scan #" + i);

    for (var id in list_one) {
        console.log(list_one[id].id + ": " + list_one[id].localName);
    }

    i++;
};
//setTimeout(stopWrapperOne, 20000);
let timerOne = setInterval(wrapperOne, 5000);



/* Another instance of the ble module. */
var nodeBtleTwo = require('../index');
let j = 1;
var list_two = {};

nodeBtleTwo.start();

let stopWrapperTwo = function() {
    nodeBtleTwo.removeListener('newList', function() {
        console.log();
        console.log("Removed second BTLE Listener.");
    });

    nodeBtleTwo.stop();

    clearInterval(timerTwo);
};

nodeBtleTwo.on('newList', (list) => {
    list_two = list;
});

let wrapperTwo = function() {
    console.log();
    console.log("Btle Two Scan #" + j);

    // Only display selected information
    for (var id in list_two) {
        console.log(list_two[id].id + ": " + list_two[id].localName);
    }

    j++;
};
//setTimeout(stopWrapperTwo, 25000);
let timerTwo = setInterval(wrapperTwo, 5000);
