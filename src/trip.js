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
const { defaults } = require('./spec.js');
const { trace } = require('./log.js');
'use strict';


/**
 * The server wrapper class hides the ability to open connections.
 */
class Server extends EventEmitter {
  constructor(router) {
    super();

    trace();

    this._router = router;
    /* Allow registration. */
    this._allowReg = true;
  }

  on() {
    trace();

    if (this._allowReg) {
      this._router.on.apply(this._router, arguments);
    }
  }

  off() {
    trace();

    if (this._allowReg) {
      this._router.off.apply(this._router, arguments);
    }
  }
  
  start() {
    trace();

    this._allowReg = false;
    this._router.start();
  }

  stop() {
    trace();

    this._router.stop();
  }

  reset() {
    trace();

    this._allowReg = true;
    this._router.reset();
  }
}

/**
 * Create a server object.
 * @param {number,SocketInterface} socket - The socket to communicate on or port.
 * @param {Object} options - See options for mkRouter.
 */
function mkServer(socket, options) {
  trace();

  if (!(socket instanceof 'SocketInterface')) {
    let port = socket;
    if (typeof socket !== 'number') {
      port = defaults.PORT;
    }
    socket = mkSocket({ port: port });
  }

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

    trace();

    this._isListening = false;
    this._router = router;
    this._dest = null;
    this._conn = null;
    this._isClosed = false;
    this._allowReg = true;

    const client = this;

    function handleStart() {
      trace();
      // Hurray. I'm not sure anything should be done here yet.
    }

    function handleListen() {
      trace();

      // Create the connection and emit 'open' when connected.
      client._isListening = true;
      console.log('mkConnection');
      const promise = client._router.mkConnection(client._dest);
      console.log('post mkConnection');
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
      trace();

      // We're done, emit 'close' and deactivate everything.
      client.emit('close');
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
    trace();

    this._router.off('start', this.handleStart);
    this._router.off('listen', this.handleListen);
    this._router.off('stop', this.handleStop);

    this._isListening = false;
    this._router = null;
    this._dest = null;
    this._conn = null;
    this._isClosed = true;
  }

  on() {
    trace();

    if (this._allowReg) {
      this._router.on.apply(this._router, arguments);
    }
  }

  off() {
    trace();

    if (this._allowReg) {
      this._router.off.apply(this._router, arguments);
    }
  }

  /**
   * Start/restart the connection process.
   * TODO implement the next line
   * @param {String} dest - Required. The destination description as 'domain:port'.
   * @param {Object} dest - Required. The destination description. May vary depending on socket type.
   * @param {string} address - IP or URL (or 'localhost' for testing).
   * @param {number} port - Port to attach to, default if not specified.
   */
  open(dest) {
    trace();

    this._allowReg = false;

    this._dest = dest;
    if (!this._isListening) {
      this._router.start();
    }
    else {
      const err = new Error('Unimplemented: reconnect/double connect');
      this.emit('error', err);
    }
  }

  /**
   * Disconnect and close the underlying socket.
   */
  close() {
    trace();

    if (!this._isClosed) {
      this._isClosed = true;
      console.log('close client');
      if (this._isListening) {
        this._router.stop();
      }
      else {
        this.emit('close');
        this._cleanup();
      }
    }
  }

  /**
   * Create a stream object. You may start sending data immediately.
   * @note Don't forget to listen to back pressure in case the stream cannot be created yet.
   * @param {number} id - Optional. Specify a specific identifier for the stream.
   * @param {boolean} [reliable=true] - Flag for reliable stream.
   * @param {boolean} [ordered=true] - Flag for ordered stream.
   * @param {number} [priority=0] - Indicate the priority of this stream over others, higher is more important.
   * @return {Stream} The stream. Null if there is no connection created yet.
   */
  mkStream(id, reliable, ordered) {
    trace();

    if (this._conn) {
      return this._conn.mkStream(id, reliable, ordered);
    }
    else {
      return null;
    }
  }
}

/**
 * Create a client object.
 * @param {SocketInterface} socket - The socket that allows reliable or unreliable communication.
 * @param {Object} options - See options for mkRouter.
 * @return {Client} The client object.
 */
function mkClient(socket, options) {
  trace();

  if (!socket) {
    socket = mkSocket();
  }
  else if (typeof socket === 'number') {
    const port = socket;
    socket = mkSocket({ port: port });
  }

  if (!options) {
    options = {};
  }

  options.maxConnections = 1;
  options.allowIncoming = false;
  options.allowOutgoing = true;

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

