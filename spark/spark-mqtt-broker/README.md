# spark-mqtt-broker

MQTT broker based on [mosca](https://github.com/mcollina/mosca).  The broker is setup to be accessible for standard MQTT and MQTT over WebSockets.  The broker is also setup to use [redis](https://redis.io/) as the broker and for persistent storage.

spark-mqtt-broker can be configured with the following environment variables

| _Environment  Vairable_ | _Description_                                     |
| ----------------------- | ------------------------------------------------- |
| REDIS_URL               | point to the redis database                       |
| MQTT_HOSTNAME           | host name to listen on, defaults to 127.0.0.1     |
| MQTT_PORT               | mqtt port to listen on, default to 9883           |
| MQTT_HTTP_PORT          | mqtt websocket port to listen on, default to 9092 |

# Authors

[Martin Bark](mailto:martin.bark@te.com)
