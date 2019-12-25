/**
 * @file Router manages each connection.
 * @author Craig Jacobson
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
/* Custom */
const { mkConnection } = require('./connection.js');
const crypto = require('./crypto.js');
const p = require('./parse.js');
const { SocketInterface } = require('./socket.js');
const { control, length, offset, reject, version } = require('./spec.js');
const { debug, trace } = require('./log.js');


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

/* Note that "this" refers to the associated Router object. */
class State extends Enum {}
State.initEnum({
  /* All state machines start at START. */
  'START': {
    enter() {
      this._setListeners();
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
          this._setExpectSocketEvents();
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
          return State.ERROR;
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
      this._setStopTimeout();
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
      this._clearStopTimeout();
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
          if (e.name.startsWith('SOCKET')) {
            if (this._expectSocketEvents) {
              return State.CLOSE;
            }
          }
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

    this._socket = socket;
    this._map = new Map();
    this._addresses = new Map();

    this._openKeys = options.keys;
    this._maxConnections = options.maxConnections;
    this._allowIncoming = options.allowIncoming;
    this._allowOutgoing = options.allowOutgoing;
    this._allowUnsafeOpen = options.allowUnsafeOpen;
    this._allowUnsafePacket = options.allowUnsafePacket;

    this._bindTimeoutMs = 1000;
    this._closeTimeoutMs = 1000;
    this._stopTimeoutMs = 1000;

    this._screenCb = () => { return true; };

    this._expectSocketEvents = true;

    this._internalState = State.START;
    this._internalState.enter.call(this);
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
  _setListeners() {
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

    this._socket.on('error', handleError);
    this._socket.on('message', handleMessage);
    this._socket.on('listening', handleListening);
    this._socket.on('close', handleClose);
  }

  /**
   * Deregister listeners on socket.
   * @private
   */
  _cleanupListeners() {
    trace();

    this._socket.off('error', this._handleSocketError);
    this._socket.off('message', this._handleSocketMessage);
    this._socket.off('listening', this._handleSocketListening);
    this._socket.off('close', this._handleSocketClose);
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
   * @return Connection if exists, undefined otherwise.
   */
  _getId(id) {
    return this._map.get(id);
  }

  /**
   * Associate the id and the connection.
   * @private
   * @param {number} id - The id of the connection.
   * @param {Connection} - The connection.
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
   * @warn It is an error to OPEN a connection to the same location after established.
   * @param {*} rinfo - The return information, type is determined by socket.
   * @param {Connection} conn - The connection information.
   */
  _setAddress(sourceKey, conn) {
    this._addresses[sourceKey] = conn;
  }

  /**
   * Get any already associated connection for duplicate sent info.
   * @private
   * @return {Connection} if exists, undefined otherwise.
   */
  _getAddress(sourceKey) {
    return this._addresses[sourceKey];
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

    debug(msg.toString('hex'));
    debug(String(rinfo));
    const sourceKey = this._socket.mkKey(rinfo);

    if (this._isReported(sourceKey)) {
      this.emit('error', new Error('Packet source was previously reported: ' + String(rinfo)));
      return;
    }

    // First, check the length
    const len = msg.length;
    if (len < length.PACKET_MIN) {
      this._report(rinfo);
      this.emit('error', new Error('Invalid packet length: ' + String(len)));
      return;
    }

    const id = msg.readUInt32BE(offset.ID);

    // Second, check that the control character and specific length are correct
    const c = msg[0] & control.MASK;
    debug('Control: ' + c);
    const encrypted = !!(c & control.ENCRYPTED);
    let isValid = false;
    // TODO create isSafe variable to give better reject codes
    switch (c & control.MASK) {
      case control.STREAM:
        if ((encrypted && len >= length.STREAM_ENCRYPT)
            || (!encrypted && len >= length.STREAM_DECRYPT)
            && id
            && (encrypted || this._allowUnsafePacket))
        {
          isValid = true;
        }
        break;
      case control.OPEN:
        debug('e: ' + length.SEAL_PADDING);
        debug('d: ' + length.OPEN_DECRYPT);
        if (((encrypted && len === length.OPEN_ENCRYPT)
            || (!encrypted && len === length.OPEN_DECRYPT))
            && !id
            && this._allowIncoming
            && (encrypted || this._allowUnsafeOpen))
        {
          isValid = true;
        }
        break;
      case control.REJECT:
        if (((encrypted && len === length.REJECT_ENCRYPT)
            || (!encrypted && len === length.REJECT_DECRYPT))
            && id
            && (encrypted || this._allowUnsafePacket))
        {
          isValid = true;
        }
        break;
      case control.CHALLENGE:
        if (((encrypted && len === length.CHALLENGE_ENCRYPT)
            || (!encrypted && len === length.CHALLENGE_DECRYPT))
            && id
            && (encrypted || this._allowUnsafePacket))
        {
          isValid = true;
        }
        break;
      case control.ACCEPT:
        if (((encrypted && len === length.ACCEPT_ENCRYPT)
            || (!encrypted && len === length.ACCEPT_DECRYPT))
            && id
            && this._allowIncoming
            && (encrypted || this._allowUnsafePacket))
        {
          isValid = true;
        }
        break;
      default:
        break;
    }

    if (!isValid) {
      this._report(rinfo);
      this.emit('error', new Error('Invalid packet type from: ' + JSON.stringify(rinfo)));
      return;
    }

    if (c === control.OPEN) {
      const ver = msg.readUInt16BE(offset.VERSION);
      if (ver !== version) {
        this._reject(msg, rinfo, reject.VERSION);
        return;
      }

      let connection = this._getAddress(sourceKey);
      if (!connection) {
        const { routeLength, routeLengthOctets } = p.parseVarLength(msg, offset.ROUTE_LENGTH, 4);
        if (routeLength < 0) {
          this._report(sourceKey);
          this._reject(msg, rinfo, reject.INVALID);
          return;
        }
        const rOffset = offset.ROUTE_LENGTH + routeLengthOctets;
        const routeBinary = msg.slice(rOffset, rOffset + routeLength);
        if (!this._screenCb(routeBinary, rinfo)) {
          // TODO need a feature in report to indicate reject message or not, to prevent reflection attacks
          this._report(sourceKey);
          this.emit('error', new Error('Encountered screen offense.'));
          this._reject(msg, rinfo, reject.USER);
          return;
        }

        const newId = this._newId();
        if (!newId) {
          this._reject(msg, rinfo, reject.BUSY);
          return;
        }
        connection = mkConnection(newId, this._socket.mkSender(rinfo));
        this.setId(newId, connection);
        this.setAddress(sourceKey, connection);
      }

      if (connection) {
        const seq = msg.readUInt32BE(offset.SEQUENCE);
        const buf = this._firewall(encrypted, c, seq, msg.slice(offset.OPEN_ENCRYPT));
        if (buf) {
          connection.handleOpenPacket(buf, this._allowUnsafePacket);
        }
        else {
          this._report(sourceKey);
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
      const connection = id ? this._getId(id) : null;
      if (connection) {
        // TODO
        const buf = connection.firewall();
        if (buf) {
          connection.packet();
        }
        else {
          this._report(sourceKey);
          this.emit('error', new Error('Packet failed the firewall: ' + String(rinfo)));
        }
      }
      else {
        this._report(sourceKey);
        this.emit('error', new Error('Invalid packet referencing non-existant connection: ' + String(rinfo)));
      }
    }
  }

  /**
   * Report source for poor conformance to protocol.
   * @private
   */
  _report(sourceKey) {
    if (this._delinq[sourceKey]) {
      this._delinq[sourceKey] = this._delinq + 1;
    }
    else {
      this._delinq[sourceKey] = 1;
    }
  }

  /**
   * Check if the sender has been reported before.
   * @private
   */
  _isReported(sourceKey) {
    const val = this._delinq[sourceKey];
    if (val && val > 1) {
      return true;
    }
    else {
      return false;
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

    this._transition(Event.SOCKET_BIND);
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
   * Indicate that we may get some stray socket events.
   * @private
   */
  _setExpectSocketEvents() {
    this._expectSocketEvents = true;
  }

  /**
   * Create a timeout so we don't hang forever trying to bind.
   * @private
   */
  _setBindTimeout() {
    trace();

    const router = this;
    function _bindTimeout() {
      router._transition(Event.SOCKET_CLOSE_TIMEOUT);
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
      router._transition(Event.SOCKET_CLOSE_TIMEOUT);
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
      router._transition(Event.STOP_ZERO_CONNECTIONS);
    }

    if (!this._map.size) {
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
      router._transition(Event.STOP_TIMEOUT);
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

    this._transition(Event.STOP);
  }

  /**
   * Set the screen callback function.
   * @param {function} cb - The screening function.
   */
  screen(cb) {
    this._screenCb = cb;
  }

  /**
   * Attempts to create a new connection over the socket.
   * @param {Object} dest - Required. The destination description. May vary depending on socket type.
   * @param {Object} options - Optional.
   * @param {keys} options.keys - TODO.
   * @param {boolean} [options.allowUnsafePacket=false] - Allow unsafe communications.
   * @return A promise that will either return a connection or an error.
   */
  mkConnection(dest, options) {
    trace();

    const router = this;

    if (!options) {
      options = {};
    }

    options.allowUnsafePacket =
      'allowUnsafePacket' in options ? (!!options.allowUnsafePacket) : false;

    const promise = new Promise((resolve, reject) => {
      setTimeout(() => {
        const id = router._newId();
        if (id && router._allowOutgoing) {
          debug('Connection.id = ' + String(id));
          debug('Connection.dest = ' + String(dest));
          try {
            const sender = router._socket.mkSender(dest);
            const conn = mkConnection(id, sender, options);
            router._setId(id, conn);
            conn.on('connect', () => {
              resolve(conn);
            });
            conn.on('error', (err) => {
              router._delId(id);
              try {
                reject(err);
              }
              catch (errReject) {
                router.emit('error', errReject);
              }
            });
            conn.open();
          }
          catch (err) {
            router.emit('error', err);
            try {
              reject(err);
            }
            catch (errReject) {
              router.emit('error', errReject);
            }
          }
        }
        else {
          try {
            if (!id) {
              reject(new Error('Could not generate a unique ID'));
            }
            else {
              reject(new Error('Router does not allow out-going connections.'));
            }
          }
          catch (errReject) {
            router.emit('error', errReject);
          }
        }
      }, 0);
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

