const mosca = require('mosca');

const REDIS_URI = process.env.REDIS_URI || 'redis://localhost:6379/0';
const MQTT_HOSTNAME = process.env.MQTT_HOSTNAME || '127.0.0.1';
const MQTT_PORT = parseInt(process.env.MQTT_PORT, 10) || 9883;
const MQTT_HTTP_PORT = parseInt(process.env.MQTT_HTTP_PORT, 10) || 9092;

let LOG_LEVEL = 'info';
if (process.env.NODE_ENV === 'development') {
  LOG_LEVEL = 'debug';
}

const moscaSettings = {
  id: 'spark-mqtt-broker',
  stats: false,
  port: MQTT_PORT,
  host: MQTT_HOSTNAME,
  http: {
    port: MQTT_HTTP_PORT,
    bundle: false,
  },
  logger: {
    level: LOG_LEVEL,
  },
  backend: {
    type: 'redis',
    url: REDIS_URI,
  },
  persistence: {
    factory: mosca.persistence.Redis,
    url: REDIS_URI,
  },
};

module.exports = new mosca.Server(moscaSettings);
