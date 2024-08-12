const nodeBle = require('node-ble');
const _ = require('lodash');
const router = require('express').Router();

let tempList = {};

nodeBle.start();
nodeBle.on('newList', (list) => {
  tempList = list;
});

router.route('/list').get((req, res) => {
  // return the object as an array
  if (Object.keys(tempList).length === 0) {
    return res.status(200).jsonp([]);
  }
  return res.status(200).jsonp(_.values(tempList));
});

module.exports = router;
