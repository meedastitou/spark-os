{
    "targets": [{
        "target_name": "libnodave",
        "type": "static_library",
        "include_dirs": [
            "libnodave"
        ],
        'cflags': [
             '-DLINUX', '-DDAVE_LITTLE_ENDIAN'
          ],
        'sources': [
      	"libnodave/nodave.c",
        "libnodave/setport.c"
        ]
    }, {
        "target_name": "nodaveBindings",
        'cflags': [
             '-DLINUX', '-DDAVE_LITTLE_ENDIAN'
          ],
          "sources": [
            '<!@(ls -1 src/*.cpp)'
        ],
        "include_dirs": [
            "src/",
            "libnodave/",
            "<!(node -e \"require('nan')\")"
        ],
        "dependencies": [
            'libnodave'
        ],
    }]
}
