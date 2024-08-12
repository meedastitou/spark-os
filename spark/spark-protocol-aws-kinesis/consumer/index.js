/* eslint-disable no-console */
const aws = require('aws-sdk');

const dynamodb = new aws.DynamoDB();
const _ = require('lodash');

const dataTableName = 'SparkData';
const metadataTableName = 'SparkMetadata';

// Time-to-Live offset (in seconds)
const ttlOffset = 1800;


function UTCtoUNIX(timestamp) {
  // takes a timestamp string in UTC format
  // (YYYY-MM-DDThh:mm:ss.sssTZD) and returns the
  // corresponding UNIX epoch integer
  const year = parseInt(timestamp.slice(0, 4), 10);
  const month = parseInt(timestamp.slice(5, 7), 10) - 1;
  const day = parseInt(timestamp.slice(8, 10), 10);
  const hour = parseInt(timestamp.slice(11, 13), 10);
  const minute = parseInt(timestamp.slice(14, 16), 10);
  const second = parseInt(timestamp.slice(17, 19), 10);
  // let millisecond = parseInt(timestamp.slice(20, 23), 10);
  // let timezone = parseInt(timestamp.slice(23), 10);

  // ignores milliseconds and timezones
  const date = new Date(year, month, day, hour, minute, second, 0);

  // adjust for time zone
  const time = date.getTime();

  return (time / 1000);
}

exports.handler = function handler(event, context, callback) {
  event.Records.forEach((recordRaw) => {
    console.log('Raw record: ', recordRaw);

    // Kinesis data is base64 encoded so decode here
    const payload = Buffer.from(recordRaw.kinesis.data, 'base64').toString('ascii');
    console.log('Decoded payload:', payload);

    const record = JSON.parse(payload);
    if (record.type === 'connection_test') {
      // ignore connection tests
      return;
    } if (record.type === 'metadata') {
      // update metadata in DynamoDB

      // build the params to update the DynamoDB metadata record
      const params = {
        ExpressionAttributeNames: {
          '#M': record.data.info.fullname,
        },
        ExpressionAttributeValues: {
          ':m': {
            S: JSON.stringify(record.data),
          },
        },
        Key: {
          spark_id: {
            S: record.host,
          },
        },
        ReturnValues: 'ALL_NEW',
        TableName: metadataTableName,
        UpdateExpression: 'SET #M = :m',
      };

      // log the DynamoDB params
      console.log(params);

      // put the data into the database
      dynamodb.updateItem(params, (err) => {
        if (err) {
          console.log(err, err.stack);
        } else {
          console.log(`successfully stored to DB - ${metadataTableName}`);
        }
      });
    } else if (record.type === 'record') {
      // put the data into DynamoDB

      // build the basic params for the DynamoDB data record
      const params = {
        Item: {
          machine_id: {
            S: (`${record.host}/${record.data.machine}`),
          },
          timestamp: {
            N: (UTCtoUNIX(record.data.time) + ttlOffset).toString(),
          },
        },
        ReturnConsumedCapacity: 'TOTAL',
        TableName: dataTableName,
      };

      // populate the attributes in the DynamoDB params
      Object.keys(record.data.attributes).forEach((attribute) => {
        // extract relevant information
        const attributeName = record.data.attributes[attribute].name;
        const attributeType = record.data.attributes[attribute].format;
        const outputType = record.data.attributes[attribute].outputFormat;
        const attributeValue = record.data.attributes[attribute].value.toString();

        const validTypes = { char: 'S', bool: 'BOOL', number: 'N' };
        let i;
        if (outputType === undefined) {
          i = _.get(validTypes, attributeType, 'N');
        } else {
          i = _.get(validTypes, outputType, 'N');
        }

        params.Item[attributeName] = {};
        if (i === 'BOOL') {
          params.Item[attributeName][i] = JSON.parse(attributeValue.toLowerCase());
        } else {
          params.Item[attributeName][i] = attributeValue;
        }
      });

      // log the DynamoDB params
      console.log(params);

      // put the data into the database
      dynamodb.putItem(params, (err) => {
        if (err) {
          console.log(err, err.stack);
          return;
        }
        console.log(`successfully stored to DB - ${dataTableName}`);
      });
    }
  });
  callback(null, 'message');
};
