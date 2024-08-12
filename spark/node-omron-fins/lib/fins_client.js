var dgram = require('dgram');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var constants = require('./constants');

module.exports = FinsClient;

function FinsClient (port,host,options) {
  if(!(this instanceof FinsClient)) return new FinsClient(port,host,options);
    EventEmitter.call(this);
    FinsClient.init.call(this,port,host,options);
};

inherits(FinsClient,EventEmitter);

_startTimeoutTimer = function(self) {
    if(self.timeout){
        self.timer = setTimeout(function cb_setTimeout() {
            self.emit('timeout',self.host);
        },self.timeout);
    }
};

_compareArrays = function(a,b) {
    if(a.length !== b.length)
        return false;
    for(var i = a.length; i--;) {
        if(a[i] !== b[i])
            return false;
    }
    return true;
};


/* Credit to http://tech.karbassi.com/2009/12/17/pure-javascript-flatten-array/ */
_mergeArrays = function(array) {
    var flat = [];
    for (var i = 0, l = array.length; i < l; i++){
        var type = Object.prototype.toString.call(array[i]).split(' ').pop().split(']').shift().toLowerCase();
        if (type) { flat = flat.concat(/^(array|collection|arguments|object)$/.test(type) ? _mergeArrays(array[i]) : array[i]); }
    }
    return flat;
};


_keyFromValue = function(dict,value) {
    var key = Object.keys(dict)
    .filter(function(key){
        return dict[key] === value
    }
    )[0];

    return key;
};



_padHex = function (width,number) {
    return("0"*width + number.toString(16).substr(-width));
};



_wordsToBytes = function(words) {
    var bytes = [];
    if(!words.length) {
        bytes.push((words & 0xff00) >> 8);
        bytes.push((words & 0x00ff));
    } else {
        for(var i in words) {
            bytes.push((words[i] & 0xff00) >> 8);
            bytes.push((words[i] & 0x00ff));
        }
    }
    return bytes;
};

_dwordsToBytes = function(dwords) {
    var bytes = [];
    if(!dwords.length) {
        bytes.push((dwords & 0xff000000) >> 24);
        bytes.push((dwords & 0x00ff0000) >> 16);
        bytes.push((dwords & 0x0000ff00) >> 8);
        bytes.push((dwords & 0x000000ff));
    } else {
        for(var i in dwords) {
            bytes.push((dwords & 0xff000000) >> 24);
            bytes.push((dwords & 0x00ff0000) >> 16);
            bytes.push((dwords & 0x0000ff00) >> 8);
            bytes.push((dwords & 0x000000ff));
        }
    }
    return bytes;
};

_bitsToBytes = function(bits) {
    var bytes = [];
    if(!bits.length) {
        bytes.push(bits > 0 ? 1 : 0);
    } else {
        for(var i in bits) {
            bytes.push(bits[i] > 0 ? 1 : 0);
        }
    }
    return bytes;
};


_translateMemoryAddress = function(memoryAddress) {
    var re = /([A-Z,a-z]{1,3})([0-9]{2,5})\.?([0-9]*)/; // use '.' to seperate bit address, and also now allow for 1 to 3 digits for memory area
    var matches = memoryAddress.match(re);
    var decodedMemory = {
        'MemoryArea':matches[1].toUpperCase(),
        'Address':matches[2],
        'Bit':matches[3]
    };

    var temp = [];
    var byteEncodedMemory = [];

    // first test if bit memory exists in the given address
    var bitAddressing = (decodedMemory.Bit.length > 0);

    // if there is a bit specifier in the address and there no bit memory area for this memory area, create a bit mask to mask of the appropriate bit (0 if not required)
    var bitMask = 0;
    if (bitAddressing && !constants.BitMemoryAreas[decodedMemory.MemoryArea]) {
        bitAddressing = false;
        bitMask = 1 << parseInt(decodedMemory.Bit);
    }

    // also use bit addressing if there is no word area code for this memory area
    if (!constants.WordMemoryAreas[decodedMemory.MemoryArea]) {
        bitAddressing = true;
    }

    //  if so choose the bit memory area code over the word area version
    var memoryArrayArray = bitAddressing ? constants.BitMemoryAreas : constants.WordMemoryAreas;

    // if memory area not recognized default to DM area
    if(!memoryArrayArray[decodedMemory.MemoryArea]) {
        temp.push(bitAddressing ? [0x02] : [0x82]);
    } else {
        // otherwise extract code from correct array
        temp.push([memoryArrayArray[decodedMemory.MemoryArea]]);
    }

    // if any memory address offset required, use it, otherwise use 0
    var addressOffset = constants.MemoryAdressOffsets[decodedMemory.MemoryArea];
    if (!addressOffset) addressOffset = 0;
    temp.push(_wordsToBytes([parseInt(decodedMemory.Address) + addressOffset]));

    // get the number of bytes per address: 1 for bit, 2 for word unless specified otherwise
    var numBytesPerLoc = constants.NumBytesPerLoc[decodedMemory.MemoryArea];
    if (!numBytesPerLoc) {
        numBytesPerLoc = bitAddressing ? 1 : 2;
    }

    // if bit addressing is being used, we are not masking a bit of a word, and the value is a valid index
    if( bitAddressing && (decodedMemory.Bit < 16) ) {
        // add this index to the address
        temp.push(parseInt(decodedMemory.Bit));
    } else {
        // otherwise set to 0
        temp.push([0x00]);
    }

    byteEncodedMemory = _mergeArrays(temp);

    return {address: byteEncodedMemory, numBytesPerLoc: numBytesPerLoc, bitMask: bitMask};
};

_incrementSID = function(sid) {
    return (sid % 254) + 1;
};

_buildHeader = function(header) {
    var builtHeader =  [
        header.ICF,
        header.RSV,
        header.GCT,
        header.DNA,
        header.DA1,
        header.DA2,
        header.SNA,
        header.SA1,
        header.SA2,
        header.SID
    ];
    return builtHeader;

};

_buildPacket = function(raw) {
    var packet = [];
    packet = _mergeArrays(raw);
    return packet;
};

_getResponseType = function(buf) {

    var response = [];
    response.push(buf[10]);
    response.push(buf[11]);
    return response;
};

_processDefault = function(buf,rinfo) {
    var sid = buf[9];
    var command = (buf.slice(10,12)).toString("hex");
    var response = buf.readUInt16BE(12);
    return {remotehost:rinfo.address,sid:sid,command:command,response:response};

};

_processStatusRead = function(buf,rinfo) {
    var sid = buf[9];
    var command = (buf.slice(10,12)).toString("hex");
    var response = buf.readUInt16BE(12);
    var status = buf[14];
    var mode = buf[15];
    var fatalErrorData = {};
    var nonFatalErrorData = {};
    for(var iFatal in constants.FatalErrorData) {
        if((buf.readInt16BE(17) & constants.FatalErrorData[iFatal]) !==0 )
            fatalErrorData.push(iFatal);
    }

    for(var iNonFatal in constants.nonFatalErrorData) {
        if((buf.readInt16BE(18) & constants.nonFatalErrorData[iNonFatal]) !==0 )
            nonFatalErrorData.push(iNonFatal);
    }
    var statusCodes = constants.Status;
    var runModes = constants.Modes;


    return {
        remotehost:rinfo.address,
        sid:sid,
        command:command,
        response:response,
        status:_keyFromValue(statusCodes,status),
        mode:_keyFromValue(runModes,mode),
        fatalErrorData : fatalErrorData || null,
        nonFatalErrorData : nonFatalErrorData || null
    };
};

_processMemoryAreaRead = function(self,buf,rinfo) {
    var data = [];
    var sid = buf[9];
    var command = (buf.slice(10,12)).toString("hex");
    var response = buf.readUInt16BE(12);
    var values = (buf.slice(14,buf.length));
    var i;
    var readInfo = self.readInfoQueue[sid];
    var bitMask = readInfo.bitMask;

    // need to know if it was a bit read, a word read, or a double word read: look it up in our object referenced by the sid number
    switch (readInfo.numBytesPerLoc) {
        case 1:
            for(i = 0; i < values.length; i++) {
                if (bitMask === 0) {
                    data.push(values.readUInt8(i));
                } else {
                    data.push((values.readUInt8(i) & bitMask) === 0 ? 0 : 1);
                }
            }
            break;
        case 4:
            for(i = 0; i < values.length; i+=4) {
                if (bitMask === 0) {
                    data.push(values.readUInt32BE(i));
                } else {
                    data.push((values.readUInt32BE(i) & bitMask) === 0 ? 0 : 1);
                }
            }
            break;
        default:
            for(i = 0; i < values.length; i+=2) {
                if (bitMask === 0) {
                    data.push(values.readUInt16BE(i));
                } else {
                    data.push((values.readUInt16BE(i) & bitMask) === 0 ? 0 : 1);
                }
            }
            break;
    }

    // remove the entries from the queue objects
    delete self.readInfoQueue[sid];

    return {remotehost:rinfo.address,sid:sid,command:command,response:response,values:data};
};


_processReply = function(self,buf,rinfo) {
    var commands = constants.Commands;
    var responseType = (_getResponseType(buf)).join(' ');

    switch(responseType) {

        case commands.CONTROLLER_STATUS_READ.join(' ') :
            return _processStatusRead(buf,rinfo);

        case commands.MEMORY_AREA_READ.join(' '):
            return _processMemoryAreaRead(self,buf,rinfo);

        default:
            return _processDefault(buf,rinfo);

    }

};


FinsClient.init = function (port,host,options) {
    var self = this;
    var defaultHost = constants.DefaultHostValues;
    var defaultOptions = constants.DefaultOptions;
    this.port = port || defaultHost.port;
    this.host = host || defaultHost.host;
    this.timeout = (options && options.timeout) || defaultOptions.timeout;
    self.timer = null;
    this.socket = dgram.createSocket('udp4');
    this.header = constants.DefaultFinsHeader;
    this.header.DA1 = (options && options.destinationNode) ? options.destinationNode : 0;
    this.readInfoQueue = {};

    function receive (buf,rinfo) {
        if (self.timer) {
            clearTimeout(self.timer);
            self.timer = null;
        }
        var msg = _processReply(self,buf,rinfo);

        // if no error emit reply event
        if (msg.response === 0) {
            self.emit('reply',msg);
        }
        // if error response, emit error messge event
        else {
            self.emit('error',new Error("Error Non Zero response code: " +  (msg.response >>> 8).toString(16) + ":" + (msg.response & 0xFF).toString(16)));
        }
    }

    function listening() {
        self.emit('open');
    }

    function close() {
        self.emit('close');
    }

    function error(err) {
        self.emit('error',err);
    }

    this.socket.on('message',receive);
    this.socket.on('listening',listening);
    this.socket.on('close',close);
    this.socket.on('error',error);

};


FinsClient.prototype.read = function(address,regsToRead,callback) {
    var self = this;
    self.header.SID = _incrementSID(self.header.SID);
    var header = _buildHeader(self.header);
    var addressTranslation = _translateMemoryAddress(address);
    var startAddress = addressTranslation.address;
    // store whether this particular read was a bit or word type and any required bit mask for areas without bit addressing
    self.readInfoQueue[self.header.SID] = {numBytesPerLoc: addressTranslation.numBytesPerLoc, bitMask: addressTranslation.bitMask};
    var command = constants.Commands.MEMORY_AREA_READ;
    var regsToReadInBytes = _wordsToBytes(regsToRead);
    var commandData = [startAddress,regsToReadInBytes];
    var packet = _buildPacket([header,command,commandData]);
    var buffer = new Buffer(packet);
    _startTimeoutTimer(self);
    this.socket.send(buffer,0,buffer.length,self.port,self.host,callback);
};

FinsClient.prototype.write = function(address,dataToBeWritten,callback) {
    var self = this;
    self.header.SID = _incrementSID(self.header.SID);
    var header = _buildHeader(self.header);
    var addressTranslation = _translateMemoryAddress(address);
    var startAddress = addressTranslation.address;
    var regsToWriteInBytes = _wordsToBytes((dataToBeWritten.length || 1));
    var command = constants.Commands.MEMORY_AREA_WRITE;
    var dataToBeWrittenInBytes = addressTranslation.numBytesPerLoc <= 2 ? (addressTranslation.numBytesPerLoc < 2 ?_bitsToBytes(dataToBeWritten) : _wordsToBytes(dataToBeWritten)) : _dwordsToBytes(dataToBeWritten);
    var commandData = [startAddress,regsToWriteInBytes,dataToBeWrittenInBytes];
    var packet = _buildPacket([header,command,commandData]);
    var buffer = new Buffer(packet);
    _startTimeoutTimer(self);
    this.socket.send(buffer,0,buffer.length,self.port,self.host,callback);
};

FinsClient.prototype.fill = function(address,dataToBeWritten,regsToWrite,callback) {
    var self = this;
    self.header.SID = _incrementSID(self.header.SID);
    var header = _buildHeader(self.header);
    var addressTranslation = _translateMemoryAddress(address);
    var startAddress = addressTranslation.address;
    var regsToWriteInBytes = _wordsToBytes(regsToWrite);
    var command = constants.Commands.MEMORY_AREA_FILL;
    var dataToBeWrittenInBytes = addressTranslation.numBytesPerLoc <= 2 ? (addressTranslation.numBytesPerLoc < 2 ?_bitsToBytes(dataToBeWritten) : _wordsToBytes(dataToBeWritten)) : _dwordsToBytes(dataToBeWritten);
    var commandData = [startAddress,regsToWriteInBytes,dataToBeWrittenInBytes];
    var packet = _buildPacket([header,command,commandData]);
    var buffer = new Buffer(packet);
    _startTimeoutTimer(self);
    this.socket.send(buffer,0,buffer.length,self.port,self.host,callback);
};

FinsClient.prototype.run = function(callback) {
    var self = this;
    self.header.SID = _incrementSID(self.header.SID);
    var header = _buildHeader(self.header);
    var command = constants.Commands.RUN;
    var packet = _buildPacket([header,command]);
    var buffer = new Buffer(packet);
    _startTimeoutTimer(self);
    this.socket.send(buffer,0,buffer.length,self.port,self.host,callback);
};

FinsClient.prototype.stop = function(callback) {
    var self = this;
    self.header.SID = _incrementSID(self.header.SID);
    var header = _buildHeader(self.header);
    var command = constants.Commands.STOP;
    var packet = _buildPacket([header,command]);
    var buffer = new Buffer(packet);
    _startTimeoutTimer(self);
    this.socket.send(buffer,0,buffer.length,self.port,self.host,callback);
};


FinsClient.prototype.status = function(callback) {
    var self = this;
    self.header.SID = _incrementSID(self.header.SID);
    var header = _buildHeader(self.header);
    var command = constants.Commands.CONTROLLER_STATUS_READ;
    var packet = _buildPacket([header,command]);
    var buffer = new Buffer(packet);
    _startTimeoutTimer(self);
    this.socket.send(buffer,0,buffer.length,self.port,self.host,callback);


};


FinsClient.prototype.close = function(){
    this.socket.close();
};
