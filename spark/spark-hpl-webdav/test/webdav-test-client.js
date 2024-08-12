/* jshint esversion: 6 */

const CSV_FILE_CONTENTS = 'Date,Time,"Good Count",Temperature,Pressure,OK\r\n'
+ '20191110,17:15:56,12345,25.0,1234.0,true\r\n'
+ '20191110,17:15:58,12346,24.0,1235.0,false\r\n'
+ '20191110,17:16:60,NaN,NaN,1233.0,true\r\n'
+ '20191110,17:16:02,12348,23.0,1236.0,true\r\n'
+ '20191110,17:16:04,12349,27.0,1237.0,false\r\n'
+ '20191110,17:16:05,12350,28.0,1232.0,true\r\n'
+ '\r\n';


const filenames = ['/test1.csv', '/test2.csv', '/test3.csv', '/readalltest.csv', '/invalidtest.csv'];

const WebDAVTestClient = function WebDAVTestClient() {
  const Client = function Client() {
    this.getFileContents = function getFileContents(filename) {
      if (filenames.includes(filename)) {
        return new Promise((resolve) => {
          resolve(CSV_FILE_CONTENTS);
        });
      }

      return new Promise((resolve, reject) => {
        reject(Error('File not found'));
      });
    };
    this.getDirectoryContents = function getDirectoryContents() {
      const content = [];
      let dateOffset = 1000;
      filenames.forEach((filename) => {
        const date = new Date(dateOffset);
        content.push({
          filename,
          basename: filename.slice(1),
          lastmod: date.toISOString(),
          type: 'file',
          size: 100,
        });
        dateOffset += 1000;
      });

      return new Promise((resolve) => {
        resolve(content);
      });
    };
    this.deleteFile = function deleteFile(filename) {
      const index = filenames.indexOf(filename);
      if (index !== -1) {
        filenames.splice(index, 1);
        return new Promise(((resolve) => {
          resolve();
        }));
      }

      return new Promise((resolve, reject) => {
        reject(Error('File not found'));
      });
    };
  };
  return new Client();
};

module.exports = WebDAVTestClient;
