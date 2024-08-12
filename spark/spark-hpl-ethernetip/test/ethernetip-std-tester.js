/* jshint esversion: 6 */

let variables;
let rejectConnection = false;

const EthernetStdControllerTester = function EthernetStdControllerTester() {
  this.connect = function connect() {
    return new Promise((resolve, reject) => {
      if (rejectConnection) {
        reject(Error('Connection failed'));
      } else {
        resolve();
      }
    });
  };

  this.readTag = function readTag(tag) {
    let found = false;
    for (let iVar = 0; iVar < variables.length; iVar += 1) {
      const variable = variables[iVar];
      if ((variable.requestType === 'variable')
       && (variable.controllerVariable === tag.controllerVariable)) {
        // eslint-disable-next-line no-param-reassign
        tag.value = variable.value;
        found = true;
        break;
      }
    }
    return new Promise((resolve, reject) => {
      if (!found) {
        reject(Error('Read tag failed'));
      } else {
        resolve();
      }
    });
  };

  this.properties = {
    version: [1, 2],
    status: 0x550,
    serial_number: 2345,
    name: 'NJ501-1400',
  };
};

const EthernetStdTagTester = function EthernetStdTagTester(controllerVariable, programName) {
  this.controllerVariable = controllerVariable;
  this.programName = programName;
  this.value = 0;
};

EthernetStdControllerTester.prototype.setVariables = function setVariables(machineVariables) {
  variables = machineVariables;
};

EthernetStdControllerTester.prototype
  .setRejectConnection = function setsetRejectConnectionVariables(rejectConn) {
    rejectConnection = rejectConn;
  };

module.exports = {
  EthernetStdControllerTester,
  EthernetStdTagTester,
};
