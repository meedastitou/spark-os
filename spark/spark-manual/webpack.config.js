const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const OptimizeCssAssetsWebpackPlugin = require('optimize-css-assets-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ImageminPlugin = require('imagemin-webpack');
const imageminMozjpeg = require('imagemin-mozjpeg');
const imageminPngquant = require('imagemin-pngquant');
const imageminSvgo = require('imagemin-svgo');
const marked = require('marked');
const toc = require('markdown-toc');

const devMode = process.env.NODE_ENV !== 'production';
const MARKDOWN_SRC_DIR = 'src/doc';

// define a custome markdonw renderer
// to customise the html marked produces
// to make syling the html easier
const renderer = new marked.Renderer();

renderer.table = (header, body) => `<table class="table table-striped table-condensed table-bordered"><thead>${header}</thead><tbody>${body}</tbody></table>`;

renderer.image = (href, title, text) => {
  let out = `<img src="${href}" class="center-block img-responsive" alt="${text}"`;
  if (title) {
    out += ` title="${title}"`;
  }
  out += '>';
  return out;
};

renderer.heading = (text, level, raw) => {
  // generate the id the same way as markdown-toc does
  let id = raw.toLowerCase();
  id = id.split(/ /).join('-');
  id = id.split(/\t/).join('--');
  id = id.split(/[|$&`~=\\/@+*!?({[\]})<>=.,;:'"^]/).join('');
  return `<h${level} id="${id}">${text}</h${level}>\n`;
};

const rendererToc = new marked.Renderer();

rendererToc.list = (body, ordered) => {
  const type = ordered ? 'ol' : 'ul';
  return `<${type} class="nav nav-stacked">${body}</${type}>`;
};

// read a list of all the markdown files
const pages = fs.readdirSync(MARKDOWN_SRC_DIR)
  .filter(filename => filename.endsWith('.md'))
  .map(page => ({
    markdownFilename: page,
    title: page.replace(/_/g, ' ').replace(/\.md$/, ''),
    htmlFilename: page.replace(/\.md$/, '.html'),
  }));


function newPage(page) {
  // load the markdown
  const markdown = fs.readFileSync(path.join(MARKDOWN_SRC_DIR, page.markdownFilename), 'utf8');

  // generate a table of contents
  const markdownToc = toc(markdown, {
    bullets: '-',
    maxdepth: 2,
  }).content;

  // return a new HtmlWebpackPlugin to generte a
  // html page for this markdown file
  return new HtmlWebpackPlugin({
    template: 'src/page.hbs',
    cache: true,
    minify: true,
    chunks: ['page'],
    title: page.title,
    filename: page.htmlFilename,
    pageId: page.markdownFilename,
    tocHtml: marked(markdownToc, { renderer: rendererToc }),
  });
}

module.exports = {
  mode: devMode ? 'development' : 'production',
  entry: {
    index: './src/index.js',
    page: './src/page.js',
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [{
          loader: 'cache-loader',
        }, {
          loader: 'babel-loader',
        }, {
          loader: 'eslint-loader',
          options: {
            fix: true,
          },
        }],
      },
      {
        test: /\.css$/,
        use: [
          devMode ? 'style-loader' : MiniCssExtractPlugin.loader,
          'css-loader',
        ],
      },
      {
        test: /\.less$/,
        use: [
          devMode ? 'style-loader' : MiniCssExtractPlugin.loader,
          'css-loader',
          'less-loader',
        ],
      },
      {
        test: /font.*\.(svg|woff|woff2)$/,
        use: [{
          loader: 'url-loader',
          options: {
            limit: 10000,
            name: 'fonts/[name].[ext]',
          },
        }],
      },
      {
        test: /\.(eot|ttf)$/,
        use: [{
          loader: 'file-loader',
          options: {
            name: 'fonts/[name].[ext]',
          },
        }],
      },
      {
        test: /\.svg$/,
        use: [{
          loader: 'raw-loader',
        }],
      },
      {
        test: /\.(png|jpg|gif)$/,
        use: [
          {
            loader: 'file-loader',
            options: {
              name: 'img/[folder]/[name].[ext]',
            },
          },
        ],
      },
      {
        test: /\.html$/,
        use: [{
          loader: 'html-loader',
        }],
      },
      {
        test: /\.md$/,
        use: [
          {
            loader: 'html-loader',
          },
          {
            loader: 'markdown-loader',
            options: {
              renderer,
            },
          },
          {
            loader: 'string-replace-loader',
            options: {
              multiple: [
                { search: 'SPARK-([0-9]+)', replace: '[SPARK-$1](https://makemake.tycoelectronics.com/jira/browse/SPARK-$1)', flags: 'g' },
                { search: '✔', replace: '<span class="glyphicon glyphicon-ok text-success"></span>', flags: 'g' },
                { search: '✘', replace: '<span class="glyphicon glyphicon-remove text-danger"></span>', flags: 'g' },
              ],
            },
          },
        ],
      },
      {
        test: /\.hbs$/,
        use: [{
          loader: 'handlebars-loader',
        }],
      },
    ],
  },
  plugins: [
    new CleanWebpackPlugin('dist'),
    new HtmlWebpackPlugin({
      template: 'src/index.hbs',
      cache: true,
      minify: true,
      chunks: ['index'],
      title: 'Spark Manuals',
      pages,
    }),
    new MiniCssExtractPlugin({
      filename: '[name].css',
    }),
    new OptimizeCssAssetsWebpackPlugin(),
    new CopyWebpackPlugin([
      { from: 'src/doc', to: 'markdown' },
    ]),
    new webpack.LoaderOptionsPlugin({
      minimize: true,
    }),
    new ImageminPlugin({
      bail: false,
      cache: true,
      imageminOptions: {
        plugins: [
          imageminMozjpeg({
            quality: 80,
          }),
          imageminPngquant({
            quality: [0.65, 0.8],
          }),
          imageminSvgo({
            removeViewBox: true,
          }),
        ],
      },
    }),
    ...pages.map(page => newPage(page)),
  ],
  devtool: 'cheap-module-eval-source-map',
  devServer: {
    port: 3000,
    compress: true,
    historyApiFallback: true,
    open: true,
  },
  watchOptions: {
    ignored: /node_modules/,
  },
};
