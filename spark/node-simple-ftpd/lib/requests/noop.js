'use strict'
/*
---
NOOP:
  rfc: 'https://tools.ietf.org/html/rfc959'
  help: NOOP
  auth: true
  data: true
  responses:
    - 200 ok
*/

function NOOP () {
//  return this.emitAsync('noop')
return this.respond(200, 'OK')

//  .then(() => {
//    return this.respond(200, 'OK')
//  })
}

exports.handler = NOOP
exports.help = 'NOOP (no operation)'
