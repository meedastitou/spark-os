var path = require('path');

module.exports = function() {
    "use strict";

    var conf = {
        NODE_ENV: 'development',
        LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
        LOG_FILE: process.env.LOG_FILE,
        LOG_SYSLOG: process.env.LOG_SYSLOG || undefined,
        REDIS_URL: process.env.RESIS_URL || 'redis://localhost:6379/0',
        SPARK_SERVER: process.env.SPARK_SERVER || 'spark.tycoelectronics.com',
        TEST_INTERVAL_SUCCESS: process.env.TEST_INTERVAL_SUCCESS || 60 * 1000,
        TEST_INTERVAL_ERROR: process.env.TEST_INTERVAL_ERROR || 10 * 1000
    };

    switch (process.env.NODE_ENV) {
        default: {
            //Default to the development environment
            process.env.NODE_ENV = 'development';
        }
        /* falls through */
        case 'development':
            {
                conf.NODE_ENV = process.env.NODE_ENV;
                return conf;
            }
        case 'test':
            {
                conf.NODE_ENV = 'test';
                return conf;
            }
        case 'production':
            {
                conf.NODE_ENV = 'production';
                conf.LOG_LEVEL = process.env.LOG_LEVEL || 'info';
                return conf;
            }
    }
};
