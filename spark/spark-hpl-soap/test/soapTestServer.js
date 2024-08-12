/* jshint esversion: 6 */

const MES_TABLE = 'DBKEY STRINGTEST UINT8TEST UINT16TEST UINT32TEST UINT64TEST '
+ 'INT8TEST INT16TEST INT32TEST INT64TEST BITTEST FLOATTEST DOUBLETEST\r\n'
+ 'YYY            0         0          0          0          0 '
+ '       0         0         0         0       0         0          0\r\n'
+ 'XXX   1-23456789       123       1234     123456    1234567 '
+ '      34      2345    234567  12345678    true 1234567.0  2345678.0\r\n';

const SoapTestServer = function SoapTestServer() {
  const SoapClient = function SoapClient() {
    this.HDVEGetCurrentProductionInformationList = function
    HDVEGetCurrentProductionInformationList(args, callback) {
      callback(null, {
        HDVEGetCurrentProductionInformationListResult:
                      {
                        CurrentProductionInfo:
                       [{
                         ORDER_NUMBER: '200219349135001',
                         PART_NUMBER: '2296724-4',
                         TOOL_NUMBER: '1234',
                       }],
                      },
      });
    };
    /* eslint-enable */
    this.HDVEGetData = function HDVEGetData(args, callback) {
      callback(null, { HDVEGetDataResult: MES_TABLE });
    };
    this.HDVEGetDataMachineBased = function HDVEGetDataMachineBased(args, callback) {
      callback(null, { HDVEGetDataMachineBasedResult: MES_TABLE });
    };
    this.HDVEGetRunningOrders = function HDVEGetRunningOrders(args, callback) {
      callback(null, { HDVEGetRunningOrdersResult: MES_TABLE });
    };
  };
  this.createClient = function createClient(clientURL, callback) {
    callback(null, new SoapClient());
  };
};

module.exports = new SoapTestServer();
