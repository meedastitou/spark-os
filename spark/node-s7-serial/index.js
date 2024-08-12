/*jshint esversion: 6 */

var nodaveBindings = require('bindings')('nodaveBindings');
var constants = require('./constants.js');

const async = require('async');

const NUMBER_OF_REQUESTS_IN_MULTIREAD = 10;

function NodeS7Serial(protocolMode, device, baudRate, parity, mpiMode, mpiSpeed, localAddress, plcAddress) {
    var self = this;

    self.connected = false;
    self.readRequestArray = [];
    self.resultsObject = {};

    self.protocolMode = protocolMode;
    self.localAddress = localAddress;
    self.plcAddress = plcAddress;
    self.serialDevice = device;
    self.serialBaudRate = baudRate; // keep baud rate as a string (for PPI default is 9600, for MPI 38400)
    self.serialParity = parity.charAt(0); // shorten parity string to first char e.g. 'e' 'o' or 'n' (for PPI default is even, for MPI odd)

    // mpi only settings
    if (self.protocolMode === 'MPI') {
        self.mpiMode = constants.mpiModeTranslate[mpiMode] !== null ? constants.mpiModeTranslate[mpiMode] : constants.mpiModeTranslate['MPI v1'];
        self.mpiSpeed = constants.mpiSpeedTranslate[mpiSpeed] !== null ? constants.mpiSpeedTranslate[mpiSpeed] : constants.mpiSpeedTranslate['187K'];
    }

    // create context and keep a reference to it
    self.context = nodaveBindings.createContext();
}

// helper functions

function getReadType(inputStringCode) {
    // converts a length code to a read type
    if (inputStringCode === "B") {
        return constants.READ_BYTE;
    } else if (inputStringCode === "W") {
        return constants.READ_WORD;
    } else if (inputStringCode === "D") {
        return constants.READ_DWORD;
    } else {
        return constants.READ_BIT; // don't explicitly check for 'X' here as for s7-200 the lack of a read code means a bit
    }
}


function convertReadTypeToLength(readType) {
    if ((readType === constants.READ_BIT) || (readType === constants.READ_BYTE)) {
        return 1;
    } else if (readType === constants.READ_WORD) {
        return 2;
    } else {
        return 4;
    }
}


// api functions

NodeS7Serial.prototype.initiateConnection = function(callback) {
    var self = this;

    try {
        // call async c function
        if (self.protocolMode === 'MPI') {
            nodaveBindings.connectMPI(self.context, self.serialDevice, self.serialBaudRate, self.serialParity, self.mpiMode, self.mpiSpeed, self.localAddress, self.plcAddress, function(err) {
                if (err) {
                    return callback(err);
                } else {
                    self.connected = true;
                    return callback(null);
                }
            });
        } else {
            nodaveBindings.connectPPI(self.context, self.serialDevice, self.serialBaudRate, self.serialParity, self.localAddress, self.plcAddress, function(err) {
                if (err) {
                    return callback(err);
                } else {
                    self.connected = true;
                    return callback(null);
                }
            });
        }
    } catch (err) {
        return callback(err);
    }

};

NodeS7Serial.prototype.dropConnection = function(callback) {
    var self = this;

    // clear read list
    self.readRequestArray = [];

    //if we successfuly connected
    if (self.connected === true) {
        self.connected = false;

        // try and disconnect
        try {
            // call async c function
            nodaveBindings.disconnect(self.context, function(err) {
                if (err) {
                    return callback(err);
                } else {
                    return callback(null);
                }
            });
        } catch (err) {
            return callback(err);
        }
    } else {
        return callback(null);
    }
};



NodeS7Serial.prototype.addItems = function(address, format) {
    var self = this;

    // parse the item into a request object
    var memoryArea;
    var blockIndex = 0;
    var readType;
    var startAddress;

    var splitAddress = address.split(".");
    if (splitAddress.length === 3) {
        // must be block address style - DB1.DBX0.0

        // get the area code (first two characters)
        var areaCode = splitAddress[0].substr(0, 2);
        if (areaCode === 'DB') {
            memoryArea = constants.S7_300_AREA_DB;
        } else if (areaCode === 'DI') {
            memoryArea = constants.S7_300_AREA_DI;
        } else {
            return -1;
        }

        // get the block index (as an integer)
        blockIndex = parseInt(splitAddress[0].substr(2));
        if (isNaN(blockIndex)) {
            return -1;
        }

        // convert the length code to a read type, should be X (for bit) as a bit address follows
        readType = getReadType(splitAddress[1].substr(2, 1));
        if (readType !== constants.READ_BIT) {
            return -1;
        }

        // create a start address from the address + bit address
        var byteAddress = parseInt(splitAddress[1].substr(3));
        var bitAddress = parseInt(splitAddress[2]);
        if (isNaN(byteAddress) || isNaN(bitAddress)) {
            return -1;
        }
        // convert byteAddress to bits when we are doing a bit access
        startAddress = (byteAddress * 8) + bitAddress;

    } else if (splitAddress.length === 2) {
        // either a non bit addressed block address (B1.DBW0), or a bit address normal address (V0.3)

        // get the (possible) block area code
        var possibleAreaCode = splitAddress[0].substr(0, 2);

        // if it is a block area code we have something like this DB1.DBW0
        if ((possibleAreaCode === 'DB') || (possibleAreaCode === 'DI')) {
            if (possibleAreaCode === 'DB') {
                memoryArea = constants.S7_300_AREA_DB;
            } else {
                memoryArea = constants.S7_300_AREA_DI;
            }

            // get the block index (as an integer)
            blockIndex = parseInt(splitAddress[0].substr(2));
            if (isNaN(blockIndex)) {
                return -1;
            }

            // convert the length code to a read type, should NOT be X (for bit) as a bit address follows
            readType = getReadType(splitAddress[1].substr(2, 1));
            if (readType === constants.READ_BIT) {
                return -1;
            }

            // get the start address from the byte address
            startAddress = parseInt(splitAddress[1].substr(3));
            if (isNaN(startAddress)) {
                return -1;
            }

        } else {
            // if it is NOT a block area code we have something like this V0.3 (shouldn't be any two char address codes as AI and AQ can only be word addressed)

            // it is going to be a bit address, should not have a type code, set as a bit read
            readType = constants.READ_BIT;

            // extract the memory area code
            if (self.protocolMode === 'MPI') {
                memoryArea = constants.mpiAreaTranslate[splitAddress[0].substr(0, 1)];
            } else {
                memoryArea = constants.ppiAreaTranslate[splitAddress[0].substr(0, 1)];
                // block index should be 1 if accessing V memory
                if (memoryArea === constants.S7_200_AREA_V) {
                    blockIndex = 1;
                }
            }
            if ((memoryArea === undefined) || (memoryArea === null)) {
                return -1;
            }

            // create a start address from the address + bit address
            var byteAddress2 = parseInt(splitAddress[0].substr(1));
            var bitAddress2 = parseInt(splitAddress[1]);
            if (isNaN(byteAddress2) || isNaN(bitAddress2)) {
                return -1;
            }
            // convert byteAddress to bits when we are doing a bit access
            startAddress = (byteAddress2 * 8) + bitAddress2;
        }

    } else {
        var lengthCodeIndex;
        var addressIndex;
        // VW0 or AIW10 or T3
        //do special case for AI and AQ as 2 chars long

        // check for 2 byte are codes
        var longAreaCode = splitAddress[0].substr(0, 2);
        if ((longAreaCode === 'AI') || (longAreaCode === 'AQ')) {
            // AI and AQ are only on S7-200, so can assume ppi
            memoryArea = constants.ppiAreaTranslate[longAreaCode];
            lengthCodeIndex = 2;
        } else {
            // extract the one byte memory area code
            if (self.protocolMode === 'MPI') {
                memoryArea = constants.mpiAreaTranslate[splitAddress[0].substr(0, 1)];
            } else {
                memoryArea = constants.ppiAreaTranslate[splitAddress[0].substr(0, 1)];
                // block index should be 1 if accessing V memory
                if (memoryArea === constants.S7_200_AREA_V) {
                    blockIndex = 1;
                }
            }
            lengthCodeIndex = 1;
        }

        // no read type included for the timers and counters, they are 16 bit accesses
        if( (memoryArea === constants.S7_300_AREA_C) || (memoryArea === constants.S7_200_AREA_C) || (memoryArea === constants.S7_300_AREA_T) || (memoryArea === constants.S7_200_AREA_T)) {
            readType = constants.READ_WORD;
            addressIndex = lengthCodeIndex;
        } else {
            // extract the length code from the correct location and convert to a read type (shouldn't be a bit type)
            readType = getReadType(splitAddress[0].substr(lengthCodeIndex, 1));
            if (readType === constants.READ_BIT) {
                return -1;
            }
            // point to the address index
            addressIndex = lengthCodeIndex+1;
        }

        // get the start address from the byte address
        startAddress = parseInt(splitAddress[0].substr(addressIndex));
        if (isNaN(startAddress)) {
            return -1;
        }
    }

    //  add the new item to our request list
    var newRequest = {
        address: address,
        format: format,
        readType: readType,
        memoryArea: memoryArea,
        blockIndex: blockIndex,
        startAddress: startAddress
    };

    self.readRequestArray.push(newRequest);
};

NodeS7Serial.prototype.readAllItems = function(callback) {
    var self = this;

    try {

        var startingReadIndex = 0;
        var currentReadIndex = 0;
        var readRequest;

        // clear the results object
        self.resultsObject = {};

        async.whilst (
            function () { return startingReadIndex < self.readRequestArray.length; },
            function (cb) {

                nodaveBindings.prepareReadRequest(self.context);

                var requestCount = 0;
                currentReadIndex = startingReadIndex;
                while ((requestCount < NUMBER_OF_REQUESTS_IN_MULTIREAD) &&
                       (currentReadIndex < self.readRequestArray.length)) {
                    readRequest = self.readRequestArray[currentReadIndex];
                    var length = convertReadTypeToLength(readRequest.readType);
                    nodaveBindings.addVarToRequest(self.context,
                                                    readRequest.readType,
                                                     readRequest.memoryArea,
                                                      readRequest.blockIndex,
                                                       readRequest.startAddress,
                                                        length);
                    requestCount = requestCount + 1;
                    currentReadIndex = currentReadIndex + 1;
                }

                // peform the actual reads (asyncronous)
                nodaveBindings.execReadRequest(self.context, function(err, data) {
                    if (err) {
                        return callback(err);
                    }

                    // now need to get the results back out
                    var responseIndex = 0;
                    currentReadIndex = startingReadIndex;
                    // loop through the same self.readRequestArray elements we just added to the read request (syncronously)
                    while (responseIndex < requestCount) {
                        readRequest = self.readRequestArray[currentReadIndex];
                        var result = nodaveBindings.getResult(self.context, responseIndex, readRequest.readType, readRequest.format, readRequest.memoryArea);
                        // add to the results object with the key of the address string (result could be a bool, integer or float)
                        self.resultsObject[readRequest.address] = result;
                        responseIndex = responseIndex + 1;
                        currentReadIndex = currentReadIndex + 1;
                    }

                    // free the memory used for the results
                    nodaveBindings.freeResults(self.context);

                    startingReadIndex = currentReadIndex;
                    cb(null);
                });
            },
            function () { return callback(null, self.resultsObject); }
        );

    } catch (err) {
        return callback(err);
    }
};

NodeS7Serial.prototype.writeItems = function(variable, data, callback) {
    let self = this;

    //NOTE: Only one element can be written at once.

    try{
        let writeRequest = getWriteParam(variable, self);
        nodaveBindings.prepareWriteRequest(self.context);

        let length = convertReadTypeToLength(writeRequest.readType);
        const buff = Buffer.allocUnsafe(length);

        if (length == 2){
            buff.writeInt16BE(data,0);
        } else if (length == 4){
            buff.writeInt32BE(data,0);
        }
        else{
            buff.writeInt8(data,0);
        }
        nodaveBindings.addWriteVarToRequest(self.context, writeRequest.readType, writeRequest.memoryArea, writeRequest.blockIndex, writeRequest.startAddress, length, buff);

        nodaveBindings.execWriteRequest(self.context, (err)=>{
            if (err) {
                return callback(err);
            }
            return callback(null);
        });

    } catch (err){
        return callback(err);
    }
};

function getWriteParam(variable, self) {

    let address = variable.address;
    let format = variable.format;

    // parse the item into a request object
    var memoryArea;
    var blockIndex = 0;
    var readType;
    var startAddress;

    var splitAddress = address.split(".");
    if (splitAddress.length === 3) {
        // must be block address style - DB1.DBX0.0

        // get the area code (first two characters)
        var areaCode = splitAddress[0].substr(0, 2);
        if (areaCode === 'DB') {
            memoryArea = constants.S7_300_AREA_DB;
        } else if (areaCode === 'DI') {
            memoryArea = constants.S7_300_AREA_DI;
        } else {
            return -1;
        }

        // get the block index (as an integer)
        blockIndex = parseInt(splitAddress[0].substr(2));
        if (isNaN(blockIndex)) {
            return -1;
        }

        // convert the length code to a read type, should be X (for bit) as a bit address follows
        readType = getReadType(splitAddress[1].substr(2, 1));
        if (readType !== constants.READ_BIT) {
            return -1;
        }

        // create a start address from the address + bit address
        var byteAddress = parseInt(splitAddress[1].substr(3));
        var bitAddress = parseInt(splitAddress[2]);
        if (isNaN(byteAddress) || isNaN(bitAddress)) {
            return -1;
        }
        // convert byteAddress to bits when we are doing a bit access
        startAddress = (byteAddress * 8) + bitAddress;

    } else if (splitAddress.length === 2) {
        // either a non bit addressed block address (B1.DBW0), or a bit address normal address (V0.3)

        // get the (possible) block area code
        var possibleAreaCode = splitAddress[0].substr(0, 2);

        // if it is a block area code we have something like this DB1.DBW0
        if ((possibleAreaCode === 'DB') || (possibleAreaCode === 'DI')) {
            if (possibleAreaCode === 'DB') {
                memoryArea = constants.S7_300_AREA_DB;
            } else {
                memoryArea = constants.S7_300_AREA_DI;
            }

            // get the block index (as an integer)
            blockIndex = parseInt(splitAddress[0].substr(2));
            if (isNaN(blockIndex)) {
                return -1;
            }

            // convert the length code to a read type, should NOT be X (for bit) as a bit address follows
            readType = getReadType(splitAddress[1].substr(2, 1));
            if (readType === constants.READ_BIT) {
                return -1;
            }

            // get the start address from the byte address
            startAddress = parseInt(splitAddress[1].substr(3));
            if (isNaN(startAddress)) {
                return -1;
            }

        } else {
            // if it is NOT a block area code we have something like this V0.3 (shouldn't be any two char address codes as AI and AQ can only be word addressed)

            // it is going to be a bit address, should not have a type code, set as a bit read
            readType = constants.READ_BIT;

            // extract the memory area code
            if (self.protocolMode === 'MPI') {
                memoryArea = constants.mpiAreaTranslate[splitAddress[0].substr(0, 1)];
            } else {
                memoryArea = constants.ppiAreaTranslate[splitAddress[0].substr(0, 1)];
                // block index should be 1 if accessing V memory
                if (memoryArea === constants.S7_200_AREA_V) {
                    blockIndex = 1;
                }
            }
            if ((memoryArea === undefined) || (memoryArea === null)) {
                return -1;
            }

            // create a start address from the address + bit address
            var byteAddress2 = parseInt(splitAddress[0].substr(1));
            var bitAddress2 = parseInt(splitAddress[1]);
            if (isNaN(byteAddress2) || isNaN(bitAddress2)) {
                return -1;
            }
            // convert byteAddress to bits when we are doing a bit access
            startAddress = (byteAddress2 * 8) + bitAddress2;
        }

    } else {
        var lengthCodeIndex;
        var addressIndex;
        // VW0 or AIW10 or T3
        //do special case for AI and AQ as 2 chars long

        // check for 2 byte are codes
        var longAreaCode = splitAddress[0].substr(0, 2);
        if ((longAreaCode === 'AI') || (longAreaCode === 'AQ')) {
            // AI and AQ are only on S7-200, so can assume ppi
            memoryArea = constants.ppiAreaTranslate[longAreaCode];
            lengthCodeIndex = 2;
        } else {
            // extract the one byte memory area code
            if (self.protocolMode === 'MPI') {
                memoryArea = constants.mpiAreaTranslate[splitAddress[0].substr(0, 1)];
            } else {
                memoryArea = constants.ppiAreaTranslate[splitAddress[0].substr(0, 1)];
                // block index should be 1 if accessing V memory
                if (memoryArea === constants.S7_200_AREA_V) {
                    blockIndex = 1;
                }
            }
            lengthCodeIndex = 1;
        }

        // no read type included for the timers and counters, they are 16 bit accesses
        if( (memoryArea === constants.S7_300_AREA_C) || (memoryArea === constants.S7_200_AREA_C) || (memoryArea === constants.S7_300_AREA_T) || (memoryArea === constants.S7_200_AREA_T)) {
            readType = constants.READ_WORD;
            addressIndex = lengthCodeIndex;
        } else {
            // extract the length code from the correct location and convert to a read type (shouldn't be a bit type)
            readType = getReadType(splitAddress[0].substr(lengthCodeIndex, 1));
            if (readType === constants.READ_BIT) {
                return -1;
            }
            // point to the address index
            addressIndex = lengthCodeIndex+1;
        }

        // get the start address from the byte address
        startAddress = parseInt(splitAddress[0].substr(addressIndex));
        if (isNaN(startAddress)) {
            return -1;
        }
    }

    //  add the new item to our request list
    var newRequest = {
        address: address,
        format: format,
        readType: readType,
        memoryArea: memoryArea,
        blockIndex: blockIndex,
        startAddress: startAddress
    };

    return newRequest;
};

module.exports.constructor = NodeS7Serial;
module.exports.constants = constants;
