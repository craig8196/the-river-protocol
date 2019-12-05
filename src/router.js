/**
 * @file Router manages each connection.
 * @author Craig Jacobson
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
/* Custom */
const crypto = require('./crypto.js');
const { /* Unused: timeouts, */ lengths, control } = require('./spec.js');
const Conn = require('./conn.js');
const { SocketInterface } = require('./socket.js');
const { trace } = require('./log.js');


/*
 * A state-machine type design was chosen so the desired behavior would
 * be more obvious, even though most functionality is still in the 
 * Router class.
 */

class Event extends Enum {}
Event.initEnum([
  'START',
  'SOCKET_ERROR',
  'SOCKET_MESSAGE',
  'SOCKET_BIND',
  'SOCKET_BIND_TIMEOUT',
  'SOCKET_CLOSE',
  'SOCKET_CLOSE_TIMEOUT',
  'STOP',
  'STOP_TIMEOUT',
  'STOP_ZERO_CONNECTIONS',
]);

class State extends Enum {}
State.initEnum({
  /* All state machines start at START, right? */
  'START': {
    enter(router) {
      router._setListeners();
    },

    transition(e) {
      switch (e) {
        case Event.START:
          return State.BIND;
        default:
          {
            this.emit('error', new Error('Expecting START event. Found: ' + String(e.name)));
          }
          break;
      }
      return this._state;
    },

    exit() {
      // No-op. No cleanup needed.
    },
  },

  /* In process of binding. */
  'BIND': {
    enter() {
      this._socket.bind();
      this._setBindTimeout();
      this.emit('bind');
    },

    transition(e) {
      switch (e) {
        case Event.SOCKET_ERROR:
          this.emit('error', new Error(String(e.name) + ' received before SOCKET_BIND.'));
          return State.ERROR;
        case Event.SOCKET_MESSAGE:
          this.emit('error', new Error(String(e.name) + ' received before SOCKET_BIND.'));
          return State.ERROR;
        case Event.SOCKET_BIND:
          /* Expected path. */
          return State.LISTEN;
        case Event.SOCKET_BIND_TIMEOUT:
          this.emit('error', new Error(String(e.name) + ' received before SOCKET_BIND.'));
          return State.ERROR;
        case Event.SOCKET_CLOSE:
          this.emit('error', new Error(String(e.name) + ' received before SOCKET_BIND.'));
          return State.ERROR;
        case Event.STOP:
          // TODO create special state for this case
          return State.CLOSE;
        default:
          this.emit('error', new Error('Expecting SOCKET* events. Found: ' + String(e.name)));
          return State.ERROR;
      }
      //return this._state;
    },

    exit() {
      this._clearBindTimeout();
    },
  },

  /* Ready for messages. */
  'LISTEN': {
    enter() {
      this.emit('listen');
    },
    
    transition(e, eData) {
      switch (e) {
        case Event.SOCKET_MESSAGE:
          this._processMessage(eData.message, eData.rinfo);
          this.emit('error', new Error('SOCKET_MESSAGE received before SOCKET_CLOSE.'));
          return State.LISTEN;
        case Event.SOCKET_CLOSE:
          this.emit('error', new Error('SOCKET_CLOSE received before STOP.'));
          return State.END;
        case Event.STOP:
          return State.STOP_NOTIFY;
        default:
          this.emit('error', new Error('Expecting SOCKET* events. Found: ' + String(e.name)));
          return State.CLOSE_ERROR;
      }
      //return this._state;
    },

    exit() {
    },
  },

  'STOP_NOTIFY': {
    enter() {
      this._setStopNotifyTimeout();
      /* Odd condition where timeout doesn't get cleared if zero connections
       * and is called before the timeout is set.
       */
      this._signalStop();
    },

    transition(e, eData) {
      switch (e) {
        case Event.SOCKET_MESSAGE:
          /* Expected path. */
          this._processMessage(eData.message, eData.rinfo);
          this.emit('error', new Error('SOCKET_MESSAGE received before SOCKET_CLOSE.'));
          return State.STOP_NOTIFY;
        case Event.SOCKET_CLOSE:
          /* Expected path. */
          return State.END;
        case Event.STOP:
          /* I guess the user really want to stop now. */
          return State.CLOSE;
        case Event.STOP_TIMEOUT:
          /* Remaining connections get hard drop. */
          return State.CLOSE;
        case Event.STOP_ZERO_CONNECTIONS:
          /* Nice exit. */
          return State.CLOSE;
        default:
          this.emit('error', new Error('Expecting TIMEOUT event. Found: ' + String(e.name)));
          return State.CLOSE_ERROR;
      }
    },

    exit() {
      this._clearStopNotifyTimeout();
    },
  },

  /* Stop messages. */
  'CLOSE': {
    enter() {
      this._socket.close();
      this._setCloseTimeout();
    },

    transition(e) {
      switch (e) {
        case Event.SOCKET_CLOSE:
          /* Expected path. */
          return State.END;
        case Event.SOCKET_CLOSE_TIMEOUT:
          return State.ERROR;
        default:
          this.emit('error', new Error('Expecting SOCKET_CLOSE events. Found: ' + String(e.name)));
          return State.ERROR;
      }
      //return this._state;
    },

    exit() {
      this._clearCloseTimeout();
    },
  },

  'CLOSE_ERROR': {
    enter() {
      this._socket.close();
      this._setCloseTimeout();
    },

    transition(e) {
      switch (e) {
        case Event.SOCKET_CLOSE:
          return State.ERROR;
        case Event.SOCKET_CLOSE_TIMEOUT:
          return State.ERROR;
        default:
          this.emit('error', new Error('Expecting SOCKET_CLOSE events. Found: ' + String(e.name)));
          return State.ERROR;
      }
      //return this._state;
    },

    exit() {
      this._clearCloseTimeout();
    },
  },

  'END': {
    enter() {
      this._cleanupListeners();
      this.emit('stop');
    },

    transition(e) {
      this.emit('error', new Error('No events expected. Found: ' + String(e.name)));
      return State.ERROR;
    },

    exit() {
    },
  },

  'ERROR': {
    enter() {
    },

    transition(e) {
      this.emit('error', new Error('No events expected. Found: ' + String(e.name)));
      return State.ERROR;
    },

    exit() {
    },
  },
});

/**
 * Router is a junction or meeting of connections, thus managing 
 * multiple connections.
 *
 * Duties:
 * Store socket, conns, and state.
 * Route packets to the correct connection.
 * Limit number of connections.
 * Basic protection of denial-of-service.
 * Perform basic packet rejection linting:
 * - Bad length
 * - Bad control
 * - Bad encryption
 * - Bad OPEN request
 */
class Router extends EventEmitter {

  /**
   * Construct Router object from valid socket and options.
   * @private
   */
  constructor(socket, options) {
    super();

    trace();

    if (!options) {
      options = {};
    }

    this._socket = socket;
    this._map = new Map();
    this._addresses = new Map();

    this._keys = options.keys;
    this._maxConnections = options.maxConnections;
    this._allowIncoming = options.allowIncoming;
    this._allowOutgoing = options.allowOutgoing;
    this._allowUnsafeOpen = options.allowUnsafeOpen;
    this._allowUnsafePacket = options.allowUnsafePacket;

    this._bindTimeoutMs = 1000;
    this._closeTimeoutMs = 1000;
    this._stopTimeoutMs = 1000;

    this._internalState = State.START;
    this._internalState.enter(this);
  }

  /**
   * Get the internal state.
   * @private
   * @return {State}
   */
  get _state() {
    return this._internalState;
  }

  /**
   * Set the internal state with appropriate events emitted as needed.
   * @private
   * @param {State} newState - The state to setup with. No-op if same state.
   */
  set _state(newState) {
    if (this._internalState !== newState) {
      this._internalState.exit.call(this);
      this._internalState = newState;
      this._internalState.enter.call(this);
    }
    else {
      /* Transitioning to same state doesn't change anything. */
    }
  }

  /**
   * Perform the transition and change states as needed.
   * @private
   */
  _transition(eventType, eventData) {
    this._state = this._state.transition.call(this, eventType, eventData);
  }

  /**
   * Register listeners.
   * @private
   */
  _setupListeners() {
    trace();

    const router = this;

    /**
     * Pass error along.
     */
    function handleError(error) {
      trace();

      router._socketError(error);
    }

    /**
     * Pass packets along.
     */
    function handleMessage(message, rinfo) {
      trace();

      router._socketMessage(message, rinfo);
    }

    /**
     * Listen for bind event.
     */
    function handleListening() {
      trace();

      router._socketBind();
    }

    /**
     * Listen for close event.
     */
    function handleClose() {
      trace();

      router._socketClose();
    }

    // Save the event handlers
    this._handleSocketError = handleError;
    this._handleSocketMessage = handleMessage;
    this._handleSocketListening = handleListening;
    this._handleSocketClose = handleClose;

    this.socket.on('error', handleError);
    this.socket.on('message', handleMessage);
    this.socket.on('listening', handleListening);
    this.socket.on('close', handleClose);
  }

  /**
   * Deregister listeners on socket.
   * @private
   */
  _cleanupListeners() {
    trace();

    this.socket.off('error', this._handleSocketError);
    this.socket.off('message', this._handleSocketMessage);
    this.socket.off('listening', this._handleSocketListening);
    this.socket.off('close', this._handleSocketClose);
  }

  /**
   * Create a new identifier.
   * @private
   * @warn NOT guaranteed to be random.
   * @return {number} Non-zero on success, zero otherwise.
   */
  _newId() {
    if (this._state === State.LISTEN && this._map.size < this._maxConnections) {
      let id = crypto.mkId();
      let count = 1;
      const maxTry = 30;
      while (id === 0 || this._hasId(id)) {
        if (maxTry === count) {
          return 0;
        }
        id = crypto.mkId();
        ++count;
      }
      return id;
    }
    else {
      return 0;
    }
  }

  /**
   * @private
   * @return {boolean} True if the map contains the given id; false otherwise.
   */
  _hasId(id) {
    return this._map.has(id);
  }

  /**
   * Get the conn as specified. If not found, return a dummy conn.
   * @private
   * @param {number} id - The id of the conn to be found.
   * @return Conn if exists, undefined otherwise.
   */
  _getId(id) {
    return this._map.get(id);
  }

  /**
   * Associate the id and the connection.
   * @private
   * @param {number} id - The id of the connection.
   * @param {Conn} - The connection.
   */
  _setId(id, conn) {
    if (id) {
      this._map.set(id, conn);
    }
  }

  /**
   * Remove the id from the map.
   * @private
   * @param {number} id - The id to delete.
   */
  _delId(id) {
    this._map.delete(id);
  }

  /**
   * Set the return information of the given route to prevent creating new
   * objects after failure for peer to receive response.
   * @private
   * @warn It is an error to try and OPEN a connection to the same location.
   * @param {*} rinfo - The return information, type is determined by socket.
   * @param {Conn} conn - The connection information.
   */
  _setAddress(rinfo, conn) {
    const key = this._socket.mkKey(rinfo);
    this._addresses[key] = conn;
  }

  /**
   * Get any already associated connection.
   * @private
   * @return {Conn} if exists, undefined otherwise.
   */
  _getAddress(rinfo) {
    const key = this._socket.mkKey(rinfo);
    return this._addresses[key];
  }

  /**
   * Handle when there is an error on the socket.
   * @private
   */
  _socketError(error) {
    trace();

    this._transition(Event.SOCKET_ERROR, error);
  }

  /**
   * Process the message and return information.
   * @private
   */
  _processMessage(msg, rinfo) {
    trace();

    // HERE
    console.log('Receiving message...');
    console.log(msg.toString('hex'));
    console.log(msg.length);
    console.log(rinfo);

    // First, check the length
    const len = msg.length;
    if (len < lengths.PACKET_MIN) {
      const err = new Error('Invalid packet length: ' + String(len));
      this.emit('error', err);
      return;
    }

    const id = msg.readUInt32BE(lengths.CONTROL);

    // Second, check that the control character and specific length are correct
    const c = msg[0] & control.MASK;
    console.log('Control: ' + c);
    const encrypted = !!(c & control.ENCRYPTED);
    let isValid = false;
    switch (c & control.MASK) {
      case control.STREAM:
        if ((encrypted && len >= lengths.STREAM_ENCRYPT)
            || (!encrypted && len >= lengths.STREAM_DECRYPT)
            && id
            && (encrypted || this.allowUnsafePacket))
        {
          isValid = true;
        }
        break;
      case control.OPEN:
        console.log('e: ' + lengths.SEAL_PADDING);
        console.log('d: ' + lengths.OPEN_DECRYPT);
        if (((encrypted && len === lengths.OPEN_ENCRYPT)
            || (!encrypted && len === lengths.OPEN_DECRYPT))
            && !id
            && this.allowIncoming
            && (encrypted || this.allowUnsafeOpen))
        {
          isValid = true;
        }
        break;
      case control.REJECT:
        if (((encrypted && len === lengths.REJECT_ENCRYPT)
            || (!encrypted && len === lengths.REJECT_DECRYPT))
            && id
            && (encrypted || this.allowUnsafePacket))
        {
          isValid = true;
        }
        break;
      case control.CHALLENGE:
        if (((encrypted && len === lengths.CHALLENGE_ENCRYPT)
            || (!encrypted && len === lengths.CHALLENGE_DECRYPT))
            && id
            && (encrypted || this.allowUnsafePacket))
        {
          isValid = true;
        }
        break;
      case control.ACCEPT:
        if (((encrypted && len === lengths.ACCEPT_ENCRYPT)
            || (!encrypted && len === lengths.ACCEPT_DECRYPT))
            && id
            && this.allowIncoming
            && (encrypted || this.allowUnsafePacket))
        {
          isValid = true;
        }
        break;
      default:
        break;
    }

    if (!isValid) {
      const err = new Error('Invalid packet type from: ' + JSON.stringify(rinfo));
      this.emit('error', err);
      return;
    }

    // Extract basic header values
    // TODO const rest = msg.slice(lengths.PACKET_PREFIX);
    const conn = id ? this._getId(id) : null;
    const seq = msg.slice(lengths.CONTROL, lengths.CONTROL + lengths.SEQUENCE);
    if (conn) {
      //const offset = lengths.CONTROL + lengths.ID;
      // TODO pass through firewall
      // TODO decrypt
      // TODO pass along to connection
    }
    else if (c === control.OPEN) {
      let connection = this.getAddress(rinfo);
      if (!connection) {
        const newId = this.newId();
        connection = new Conn(newId);
        connection.setSender(this.socket.mkSender(rinfo));
        this.setId(newId, connection);
        this.setAddress(rinfo, connection);
      }

      if (connection) {
        const buf = connection.firewall(msg.slice(lengths.PREFIX), seq, c, encrypted);
        if (buf) {
          connection.handleOpenPacket(buf, this.allowUnsafePacket);
        }
        else {
          this.emit('error', new Error('Packet failed to pass firewall from: ' + JSON.stringify(rinfo)));
          return;
        }
      }
      else {
        /* Connection object will automatically reject as too busy. */
        this.emit('error', new Error('Unable to create a connection object'));
      }
    }
    else {
      /* Error, ignore. */
      this.emit('error', new Error('Invalid packet referencing non-existant connection'));
      return;
    }
  }

  /**
   * Handle when there is a message on the socket.
   * @private
   */
  _socketMessage(message, rinfo) {
    trace();

    this._transition(Event.SOCKET_MESSAGE, { message, rinfo });
  }

  /**
   * Handle when socket is bound.
   * @private
   */
  _socketBind() {
    trace();

    this._transition(Event.SOCKET_CLOSE);
  }

  /**
   * Handle when the socket is closed.
   * @private
   */
  _socketClose() {
    trace();

    this._transition(Event.SOCKET_CLOSE);
  }

  /**
   * Create a timeout so we don't hang forever trying to bind.
   * @private
   */
  _setBindTimeout() {
    trace();

    const router = this;
    function _bindTimeout() {
      router.transition(Event.SOCKET_CLOSE_TIMEOUT);
    }
    this._bindTimeoutHandle = setTimeout(_bindTimeout, this._bindTimeoutMs);
  }

  /**
   * Clear the timeout so we don't get unexpected events.
   * @private
   */
  _clearBindTimeout() {
    trace();

    if (this._bindTimeoutHandle) {
      clearTimeout(this._bindTimeoutHandle);
      this._bindTimeoutHandle = null;
    }
  }

  /**
   * Create a timeout so we don't hang forever trying to close.
   * @private
   */
  _setCloseTimeout() {
    trace();

    const router = this;
    function _closeTimeout() {
      router.transition(Event.SOCKET_CLOSE_TIMEOUT);
    }
    this._closeTimeoutHandle = setTimeout(_closeTimeout, this._closeTimeoutMs);
  }

  /**
   * Clear the timeout so we don't get unexpected events.
   * @private
   */
  _clearCloseTimeout() {
    trace();

    if (this._closeTimeoutHandle) {
      clearTimeout(this._closeTimeoutHandle);
      this._closeTimeoutHandle = null;
    }
  }

  /**
   * Notify all connections of shutdown.
   * @private
   */
  _signalStop() {
    trace();

    const router = this;

    function signalSoftDisconnect(conn/* Unused: id, map */) {
      trace();

      conn.stop();
    }

    function signalHardDisconnect(conn/* Unused: id, map */) {
      trace();

      conn.close();
    }

    function zeroConnections() {
      router.transition(Event.STOP_ZERO_CONNECTIONS);
    }

    if (!this.map.size) {
      setImmediate(zeroConnections);
    }
    else if (this._socket.isClosed()) {
      this.map.forEach(signalHardDisconnect);
      this.map.clear();
      setImmediate(zeroConnections);
    }
    else {
      this.map.forEach(signalSoftDisconnect);
    }
  }

  /**
   * Create a timeout so we don't hang forever trying to shutdown.
   * @private
   */
  _setStopTimeout() {
    const router = this;
    function _stopTimeout() {
      router.transition(Event.STOP_TIMEOUT);
    }
    this._stopTimeoutHandle = setTimeout(_stopTimeout, this._stopTimeoutMs);
  }

  /**
   * Clear the timeout so we don't get unexpected events.
   * @private
   */
  _clearStopTimeout() {
    if (this._stopTimeoutHandle) {
      clearTimeout(this._stopTimeoutHandle);
      this._stopTimeoutHandle = null;
    }
  }

  /**
   * Start the router.
   */
  start() {
    trace();

    this._transition(Event.START);
  }

  /**
   * Stop the router.
   * @param {number} [graceMs=1000] - The amount of time to give connections to wrap up.
   */
  stop(graceMs) {
    trace();

    if (Number.isInteger(graceMs)) {
      if (graceMs < 0) {
        graceMs = 0;
      }
      this._stopTimeoutMs = graceMs;
    }

    this.transition(Event.STOP);
  }

  /**
   * Attempts to create a new connection over the socket.
   * @param {Object} dest - Required. The destination description. May vary depending on socket type.
   * @return A promise that will either return a connection or an error.
   */
  mkConnection(dest) {
    trace();

    // Internally the connection is called a conn, but these details don't
    // need to be known to the user
    const router = this;
    const options = {};

    if (dest.publicKey) {
      options.publicKey = dest.publicKey;
      delete dest.publicKey;
    }

    if (dest.encrypt) {
      options.encrypt = true;
      delete options.encrypt;
    }
    else if (dest.encrypt === undefined || dest.encrypt === null) {
      options.encrypt = true;
    }

    const promise = new Promise((resolve, reject) => {
      const id = router.newId();
      if (id && router.allowOutgoing) {
        console.log('id = ' + String(id));
        try {
          // Do we need to make the sender before the id?
          const conn = new Conn(id);
          router.setId(id, conn);
          conn.on('connect', () => {
            resolve(conn);
          });
          conn.on('error', (err) => {
            router.delId(id);
            reject(err);
          });
          conn.open(router.socket.mkSender(dest), options);
        }
        catch (err) {
          console.log(err);
          reject(err);
        }
      }
      else {
        let err = null;
        if (!id) {
          err = new Error('Could not generate a unique ID');
        }
        else {
          err = new Error('Router does not allow out-going connections.');
        }
        reject(err);
      }
    });
    return promise;
  }
}

/**
 * Create a Router.
 * @param {SocketInterface} socket - Valid socket type.
 * @param {object} [options] - Options object.
 * @param {object} [options.keys] - Valid key pair from crypto.
 * @param {number} [options.maxConnections=1024] - The max connections, minimum of 1.
 * @param {boolean} [options.allowIncoming=false] - Allow incoming connections.
 * @param {boolean} [options.allowOutgoing=false] - Allow outgoing connections.
 * @param {boolean} [options.allowUnsafeOpen=false] - Allow unencrypted OPEN requests.
 * @param {boolean} [options.allowUnsafePacket=false] - Allow all traffic to be unencrypted.
 * @return {Router}
 */
function mkRouter(socket, options) {
  trace();

  if (!(socket instanceof SocketInterface)) {
    throw new Error('Invalid socket type.');
  }

  if (!options) {
    options = {};
  }

  const defaultConnections = 1024;
  options.maxConnections =
    'maxConnections' in options ? (options.maxConnections) : defaultConnections;
  if (options.maxConnections < 1) {
    options.maxConnections = 1;
  }

  options.allowIncoming =
    'allowIncoming' in options ? (!!options.allowIncoming) : false;
  options.allowOutgoing =
    'allowOutgoing' in options ? (!!options.allowOutgoing) : false;
  options.allowUnsafeOpen =
    'allowUnsafeOpen' in options ? (!!options.allowUnsafeOpen) : false;
  options.allowUnsafePacket =
    'allowUnsafePacket' in options ? (!!options.allowUnsafePacket) : false;

  if (!options.keys) {
    options.keys = crypto.mkKeyPair();
  }

  return new Router(socket, options);
}

module.exports = {
  mkRouter,
};

