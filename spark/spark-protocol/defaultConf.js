module.exports.config = function() {
    "use strict";

    var conf = {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
        HTTP_PORT: 8081,
        HTTP_HOSTNAME: '0.0.0.0',
        MACHINES_SYSTEM_DIR: '/data/machines/system',
        MACHINES_USER_DIR: '/data/machines/user'
    };

    switch (process.env.NODE_ENV) {
        default: {
            //Default to the development environment
            process.env.NODE_ENV = 'development';
        }
        /* falls through */
        case 'development':
            {
                return conf;
            }
        case 'production':
            {
                conf.NODE_ENV = 'production';
                conf.LOG_LEVEL = 'info';
                return conf;
            }
    }
};
