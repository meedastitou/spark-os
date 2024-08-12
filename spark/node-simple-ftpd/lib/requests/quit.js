'use strict'
/*
---
QUIT:
  rfc: 'https://tools.ietf.org/html/rfc959'
  help: QUIT
  auth: true
  data: true
  responses:
    - 200 ok
*/

function QUIT () {
//  return this.emitAsync('quit')
return this.respond(200, 'OK')

//  .then(() => {
//    return this.respond(200, 'OK')
//  })
}

exports.handler = QUIT
exports.help = 'QUIT (no operation)'
