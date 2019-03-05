/**
 * @file Combines all resources into one module.
 * @author Craig Jacobson
 */
/* Core */
const EventEmitter = require('events');
/* Community */
/* Custom */
const { mkKeyPair } = require('./crypto.js');
const { mkSocket, SocketInterface, SenderInterface } = require('./socket.js');
const { mkRouter } = require('./router.js');
'use strict';


/**
 * The server wrapper class hides the ability to open connections.
 */
class Server extends EventEmitter {
  constructor(socket, options) {
    super();

    this.router = mkRouter(socket, options);
  }
  
  start() {
    // TODO set listeners to forward emitted events
    this.router.start();
  }

  stop() {
    this.router.stop();
    // TODO unset listeners once stopped, and cleanup resources
  }
}

/**
 * Create a server object.
 */
function mkServer(socket, options) {
  options.allowIncoming = true;
  options.allowOutgoing = false;
  return new Server(socket, options);
}

/**
 * The client wrapper class forbids incoming connections and only allows one
 * outgoing connection.
 */
class Client extends EventEmitter {
  constructor(socket, options) {
    super();

    //this.router = new Router(socket, options);
    this.conn = null;
  }

  connect() {
    // TODO set listeners
    this.router.start();
  }

  close() {
    // TODO unset stuff
    this.router.stop();
  }

  mkStream(id) {
    if (this.conn) {
      return this.conn.openStream(id);
    }
    else {
      return null;
    }
  }
}

function mkClient(socket, options) {
  options.connectionLimit = 1;
  return new Client(socket, options);
}

module.exports = {
  // Typical-use API
  mkKeyPair,
  mkSocket,
  mkServer,
  mkClient,
  // Low-level API for Customization
  SocketInterface,
  SenderInterface,
  mkRouter,
};

