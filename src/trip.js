/**
 * @file Combines all resources into one module.
 * @author Craig Jacobson
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
/* Custom */
const { mkKeyPair } = require('./crypto.js');
const { mkSocket, SocketInterface, SenderInterface } = require('./socket.js');
const { mkRouter } = require('./router.js');
const { defaults } = require('./spec.js');
const { trace } = require('./log.js');
'use strict';


/**
 * The server wrapper class hides the ability to open connections.
 * Events are forwarded to the router instance.
 */
class Server extends EventEmitter {
  constructor(router) {
    super();

    trace();

    this._router = router;
    this._allowRegistration = true;
  }

  on() {
    trace();

    if (this._allowRegistration) {
      this._router.on.apply(this._router, arguments);
    }
  }

  off() {
    trace();

    if (this._allowRegistration) {
      this._router.off.apply(this._router, arguments);
    }
  }
  
  start() {
    trace();

    this._allowRegistration = false;
    this._router.start();
  }

  screen(cb) {
    this._router.screen(cb);
  }

  stop() {
    trace();

    this._router.stop();
  }

  reset() {
    trace();

    this._allowRegistration = true;
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

  if (!(socket instanceof SocketInterface)) {
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
 * Events are intercepted since the terminology with a Client is different
 * from the Router/Server.
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
    this._allowRegistration = true;

    this._setListeners();
  }

  _setListeners() {
    const client = this;

    function handleError(err) {
      trace();

      client.emit('error', err);
    }

    function handleStart() {
      trace();
      // Hurray. I'm not sure anything should be done here yet.
    }

    function handleListen() {
      trace();

      // Create the connection and emit 'open' when connected.
      client._isListening = true;
      const promise = client._router.mkConnection(client._dest);
      promise
        .then((conn) => {
          trace();

          client.emit('open');
          client._conn = conn;
        })
        .catch((err) => {
          trace();

          client.emit('error', err);
          client.close();
        });
    }

    function handleStop() {
      trace();

      // We're done, emit 'close' and deactivate everything.
      client.emit('close');
      client._clearListeners();
    }

    // TODO prefix with _
    this._handleRouterError = handleError;
    this._handleRouterStart = handleStart;
    this._handleRouterListen = handleListen;
    this._handleRouterStop = handleStop;

    this._router.on('error', this._handleRouterError);
    this._router.on('start', this._handleRouterStart);
    this._router.on('listen', this._handleRouterListen);
    this._router.on('stop', this._handleRouterStop);
  }

  _clearListeners() {
    trace();

    this._router.off('error', this._handleRouterError);
    this._router.off('start', this._handleRouterStart);
    this._router.off('listen', this._handleRouterListen);
    this._router.off('stop', this._handleRouterStop);

    this._isListening = false;
    this._router = null;
    this._dest = null;
    this._conn = null;
    this._isClosed = true;
  }

  on() {
    trace();

    if (this._allowRegistration) {
      EventEmitter.prototype.on.apply(this, arguments);
    }
  }

  off() {
    trace();

    if (this._allowRegistration) {
      EventEmitter.prototype.off.apply(this, arguments);
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

    this._allowRegistration = false;

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
      if (this._isListening) {
        this._router.stop();
      }
      else {
        this.emit('close');
        this._clearListeners();
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

class SettingPreset extends Enum {}
SettingPreset.initEnum([
  'WEB_CLIENT',
  'WEB_SERVER',
  'IOT_CLIENT',
  'IOT_SERVER',
  'GAME_CLIENT',
  'GAME_SERVER',
  'HIGH_VOLUME',
  'LOW_VOLUME',
]);

/**
 * @param {SettingPreset} presetType - Specify what you are doing.
 */
function mkSettings(/* TODO presetType */) {
  const settings = {};
  // TODO create and maintain settings that are available for different settups
  return settings;
}

module.exports = {
  // Typical-use API
  mkKeyPair,
  mkSocket,
  mkServer,
  mkClient,
  SettingPreset,
  mkSettings,
  // Low-level API for Customization
  SocketInterface,
  SenderInterface,
  mkRouter,
};

