var as511bindings = require('bindings')('as511bindings');

function as511(device) {
    this.device = device;
}

as511.prototype.openSync = function() {
    try {
        as511bindings.openSync(this.device);
    }
    catch(e){
        throw new Error(e);
    }
};

as511.prototype.closeSync = function() {
    try {
        as511bindings.closeSync();
    }
    catch(e){
        throw new Error(e);
    }
};

as511.prototype.readSync = function(addr, size) {
    try {
        value = as511bindings.readSync(addr, size);
    }
    catch(e){
        throw new Error(e);
    }
    return value;
};

as511.prototype.writeSync = function(addr, size, buf) {
    try {
        as511bindings.writeSync(addr, size, buf);
    }
    catch(e){
        throw new Error(e);
    }
};

module.exports = as511;
