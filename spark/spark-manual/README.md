# Spark Manual

Spark manual repository.  The documentation is written in markdown in the `src/doc` directory.  [webpack](https://webpack.js.org/) is used to compile the markdown into html and pdf output using the following packages:

- Custom [bootstrap](http://getbootstrap.com) css file to minimise it's size
- html generated using [marked](https://github.com/chjj/marked)
- table of contents generated using [markdown-toc](https://github.com/jonschlinkert/markdown-toc)
- pages templated using [handlebars](http://handlebarsjs.com)
- images optimised using [imagemin](https://github.com/imagemin/imagemin)
- pdfs generated from html using [wkhtmltopdf](http://http://wkhtmltopdf.org)

# Setup

## Docker

Install [Docker](https://docs.docker.com/install/) and [Docker Compose](https://docs.docker.com/compose/install/).  Docker is the recommended method to build the Spark Manuals.

## Node.js

To develop the Spark Manuals on your host system install Node.js using [NVM](https://github.com/creationix/nvm) and install the latest Long Term Support (LTS) version of Node.js

Next install all the Node.js modules needed by Spark Manual as follows

```
yarn install
```

Optionally to build the pdf files install [wkhtmltopdf](http://wkhtmltopdf.org/downloads.html).  Note: It is recommended to build the pdf files using docker.

# Development

To develop run the command:

```
yarn start
```

This will build the html manual, open a web browser, display the output and watch for any changes.  If any files are changed then the manual will be rebuilt and the web page updated.

# Building

It is recommended to build spark-manual using docker

```
./dockerbuild
```

This will build the spark manuals into the `dist` directory.  Alternatively to build locally on your host system install Node.js and wkhtmltopdf then run:

```
yarn build
```

# Authors
[Martin Bark](mailto:martin.bark@te.com)
