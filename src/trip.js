/**
 * @file Combines all resources into one module.
 * @author Craig Jacobson
 */
/* Core */
/* Community */
/* Custom */
const { mkKeyPair } = require('./crypto.js');
const { mkSocket, SocketInterface, SenderInterface } = require('./socket.js');
//const Confluence = require('./confluence.js');
'use strict';


function mkServer(socket, options) {
}

function mkClient(socket, options) {
}

module.exports = {
  // Typical-use API
  mkKeyPair,
  mkSocket,
  mkServer,
  mkClient,
  // Low-level API
  SocketInterface,
  SenderInterface,
  //Confluence,
};

