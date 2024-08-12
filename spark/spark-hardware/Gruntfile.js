module.exports = function(grunt) {

    //Configure grunt
    grunt.initConfig({
        jshint: {
            files: [
                '*.js',
                'bin/*.js',
                'src/**/*.js'
            ],
            options: {
                // options here to override JSHint defaults
                globals: {
                    jQuery: true,
                    console: true,
                    module: true,
                    document: true
                }
            }
        },
        jsbeautifier: {
            files: [
                '*.js',
                '*.json',
                'bin/*.js',
                'src/**/*.js',
                'src/**/*.json'
            ],
            options: {
                html: {
                    end_with_newline: true
                }
            }
        },
        watch: {
            dev: {
                files: ['*.md', '*.js', '*.json', 'bin/*.js', 'src/**']
            }
        },
        nodemon: {
            dev: {
                script: 'bin/spark-hardware',
                options: {
                    args: ['|bunyan'],
                    watch: ['*.md', '*.js', '*.json', 'bin/*.js', 'src/**']
                }
            }
        },
        concurrent: {
            dev: {
                options: {
                    logConcurrentOutput: true
                },
                tasks: ['nodemon:dev', 'watch:dev']
            }
        }
    });

    grunt.event.on("git-describe", function(rev) {
        grunt.config('gitRevision', rev.toString());
    });

    // Load all grunt tasks
    require('load-grunt-tasks')(grunt);

    /* grunt tasks */

    // development build task
    grunt.registerTask('dev', [
        'concurrent:dev'
    ]);

    // Beautify task
    grunt.registerTask('beaut', [
        'jshint',
        'jsbeautifier'
    ]);

    // Default task
    grunt.registerTask('default', 'dev');
};
