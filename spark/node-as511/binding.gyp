{
    "targets": [{
        "target_name": "libas511",
        "type": "static_library",
        "include_dirs": [
            "libas511/src/"
        ],
        'sources': [
            '<!@(ls -1 libas511/src/*.c)'
        ]
    }, {
        "target_name": "as511bindings",
        "sources": [
            '<!@(ls -1 src/*.cpp)'
        ],
        "include_dirs": [
            "src/",
            "libas511/src/",
            "<!(node -e \"require('nan')\")"
        ],
        "dependencies": [
            'libas511',
        ],
    }, {
        "target_name": "as511demo",
        "type": "executable",
        "include_dirs": [
            "libas511/src/",
            "libas511/demo/",
            '<!@(pkg-config popt --cflags-only-I | sed s/-I//g)',
        ],
        'sources': [
            '<!@(ls -1 libas511/demo/*.c)'
        ],
        "libraries": [
            '<!@(pkg-config popt --libs)',
        ],
        "dependencies": [
            'libas511',
        ]
    }]
}
