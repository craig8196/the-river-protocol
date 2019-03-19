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
  constructor(router) {
    super();

    this._router = router;
  }

  on() {
    this._router.on.apply(this._router, arguments);
  }

  off() {
    this._router.off.apply(this._router, arguments);
  }
  
  start() {
    this._router.start();
  }

  stop() {
    this._router.stop();
  }
}

/**
 * Create a server object.
 */
function mkServer(socket, options) {
  if (!options) {
    options = {};
  }
  options.allowIncoming = true;
  options.allowOutgoing = false;
  return new Server(mkRouter(socket, options));
}

/**
 * The client wrapper class forbids incoming connections and only allows one
 * outgoing connection.
 */
class Client extends EventEmitter {
  /*
   * Notes:
   * Once the connection object is created then we emit 'open'.
   * Then streams can be made.
   */
  constructor(router) {
    super();

    this._router = router;
    this._dest = null;
    this._conn = null;

    const client = this;

    function handleStart() {
      // Hurray. I'm not sure anything should be done here yet.
    }

    function handleListen() {
      // Create the connection and emit 'open' when connected.
      client._isListening = true;
      console.log('mkConnection');
      const promise = client._router.mkConnection(client._dest, client._destOptions);
      promise
        .then((conn) => {
          client.emit('open');
          client._conn = conn;
        })
        .catch((err) => {
          client.emit('error', err);
          client.close();
        });
    }

    function handleStop() {
      // We're done, emit 'close' and deactivate everything.
      client.emit('close');
      client._router.off('start', client.handleStart);
      client._router.off('listen', client.handleListen);
      client._router.off('stop', client.handleStop);
      client._cleanup();
    }

    this.handleStart = handleStart;
    this.handleListen = handleListen;
    this.handleStop = handleStop;

    router.on('start', this.handleStart);
    router.on('listen', this.handleListen);
    router.on('stop', this.handleStop);
  }

  _cleanup() {
    client._router = null;
    client._dest = null;
    client._conn = null;
  }

  /**
   * Start the connection process.
   * @param {Object} dest - The destination description. May vary depending on socket type.
   * @param {string} address - The address to connect to for UDP sockets.
   * @param {number} port - The port to connect to for UDP sockets.
   */
  connect(dest, options) {
    this._dest = dest;
    this._destOptions = options;
    if (!this._isListening) {
      this._router.start();
    }
    else {
      const err = new Error('Unimplemented: reconnect to different server');
      this.emit('error', err);
    }
  }

  /**
   * Disconnect and close the underlying socket.
   */
  close() {
    if (this._isListening) {
      this._router.stop();
    }
    else {
      this.emit('close');
    }
  }

  /**
   * Create a stream object. You may start sending data immediately.
   * @note Don't forget to listen to back pressure in case the stream cannot be created yet.
   * @param {number} id - Optional. Specify a specific identifier for the stream.
   * @return {Stream} The stream. Null if there is no connection created yet.
   */
  mkStream(id) {
    if (this._conn) {
      return this._conn.mkStream(id);
    }
    else {
      return null;
    }
  }
}

/**
 * Create a client object.
 * @param {SocketInterface} socket - The socket that allows reliable or unreliable communication.
 * @param {Object} options - The configuration for the server.
 * @param {boolean} options.allowUnsafeOpen - Allow the opening packet to be unencrypted. Assuming noone is packet sniffing, this is relatively safe. However, for better security it isn't recommended.
 * @param {boolean} options.allowUnsafePacket - Allow all communication to be unencrypted.
 * @return {Client} The client object.
 */
function mkClient(socket, options) {
  if (!options) {
    options = {};
  }
  options.maxConnections = 1;
  options.allowIncoming = true;
  options.allowOutgoing = false;
  return new Client(mkRouter(socket, options));
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

