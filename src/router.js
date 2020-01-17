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
const { trace, debug, warn, crit } = require('./log.js');
const p = require('./protocol.js');
const { SocketInterface } = require('./socket.js');
const { control, length, reject, version } = p;
'use strict';


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
          this.emit('error', new Error('Expecting START event. Found: ' + String(e.name)));
          return State.START;
      }
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
        case Event.SOCKET_BIND:
          /* Expected path. */
          return State.LISTEN;
        case Event.STOP:
          this._setExpectSocketEvents();
          return State.CLOSE;
        default:
          this.emit('error', new Error(String(e.name) + ' received before SOCKET_BIND.'));
          return State.ERROR;
      }
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
    
    transition(e, data) {
      switch (e) {
        case Event.SOCKET_MESSAGE:
          this._processSegment(data.message, data.rinfo);
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

    transition(e, data) {
      switch (e) {
        case Event.SOCKET_MESSAGE:
          /* Expected path. */
          this._processSegment(data.message, data.rinfo);
          return State.STOP_NOTIFY;
        case Event.SOCKET_CLOSE:
          /* Expected path. */
          return State.END;
        case Event.STOP:
          /* I guess the user really wants to stop now. */
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
 * Route segments to the correct connection.
 * Limit number of connections.
 * Basic protection of denial-of-service.
 * Perform basic segment rejection linting:
 * - Bad length
 * - Bad control
 * - Bad encryption
 * - Bad OPEN request
 */
class Router extends EventEmitter {

  /**
   * Construct Router object from valid socket and options.
   * @private
   * @param {SocketInterface} socket - Required. For communication.
   * @param {object} options - Required. See mkRouter for details.
   */
  constructor(socket, options) {
    super();

    trace();

    this._socket = socket;
    this._map = new Map();
    this._addresses = new Map();
    this._reported = new Map();

    this._openKeys = options.openKeys;
    this._signKeys = options.signKeys;
    this._maxConnections = options.maxConnections;
    this._allowIncoming = options.allowIncoming;
    this._allowOutgoing = options.allowOutgoing;
    this._allowUnsafeOpen = options.allowUnsafeOpen;
    this._allowUnsafeSegment = options.allowUnsafeSegment;
    this._allowUnsafeSign = options.allowUnsafeSign;

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
    /* Save the event handlers. */
    this._handleSocketError = this._socketError.bind(this);
    this._handleSocketMessage = this._socketMessage.bind(this);
    this._handleSocketListening = this._socketBind.bind(this);
    this._handleSocketClose = this._socketClose.bind(this);

    this._socket.on('error', this._handleSocketError);
    this._socket.on('message', this._handleSocketMessage);
    this._socket.on('listening', this._handleSocketListening);
    this._socket.on('close', this._handleSocketClose);
  }

  /**
   * Deregister listeners on socket.
   * @private
   */
  _cleanupListeners() {
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
   * Send the reject message.
   * Don't allow reflection attacks.
   * Don't flag any source for very long.
   * @private
   */
  _reject(/*key, rinfo, code*/) {
    //TODO
  }

  /**
   * Process the message and return information.
   * @private
   */
  _processSegment(seg, rinfo) {
    trace();

    debug('rinfo:', rinfo);
    const sourceKey = this._socket.mkKey(rinfo);
    debug('source key:', sourceKey);

    if (this._isReported(sourceKey)) {
      /* We just drop the segment. This is not an error to report. */
      return;
    }

    // First, check the length
    const len = seg.length;
    if (len < length.SEGMENT_MIN) {
      /* We cannot accurately determine the source. Drop segment. */
      this._reject(sourceKey, rinfo, reject.MALFORMED);
      return;
    }

    /* Unpack prefix. */
    const pre = p.unPrefix(seg);

    debug('Prefix:', pre);

    if (pre.control > control.MAX) {
      /* We cannot accurately determine the source. Drop segment. */
      warn('Unknown segment type:', pre, rinfo);
      this._reject(sourceKey, rinfo, reject.MALFORMED);
      return;
    }

    /* OPEN segments must be unpacked by the router. */
    if (pre.control === control.OPEN) {
      if (!this._allowIncoming) {
        /* Only outgoing connections allowed. */
        this._reject(sourceKey, rinfo, reject.INCOMING);
        return;
      }

      if (!pre.encrypted && !this._allowUnsafeOpen) {
        /* Ugh. Not encrypted. */
        warn('Not encrypted:', rinfo);
        this._reject(sourceKey, rinfo, reject.UNSAFE);
        return;
      }

      debug('OPEN unpacking now.');
      const open = p.unOpen(seg, this._openKeys.publicKey, this._openKeys.secretKey);

      if (!open) {
        crit('Whycome no open???');
        /* Again. Still not enough information to report. Dropping segment. */
        this._reject(sourceKey, rinfo, reject.KEY);
        return;
      }

      debug('OPEN data: ', open);

      if (open.version !== version) {
        /* No way to verify sender. Reject with caution. */
        this._reject(sourceKey, rinfo, reject.VERSION);
        return;
      }

      let connection = this._getAddress(sourceKey);
      if (!connection) {
        if (!this._screenCb(pre.id, open.route, open.signatureBuffer, open.signature, rinfo)) {
          /* Cannot verify sender. Reject with caution. */
          this._reject(sourceKey, rinfo, reject.USER);
          return;
        }

        const newId = this._newId();
        if (!newId) {
          /* Cannot verify sender. Reject with caution. */
          this._reject(sourceKey, rinfo, reject.BUSY);
          return;
        }

        connection = mkConnection(
          this,
          newId,
          this._socket.mkSender(rinfo),
          {
            signKey: this._signKeys.secretKey,
            allowUnsafeSign: true
          }
        );

        if (!connection) {
          this._reject(sourceKey, rinfo, reject.SERVER);
          return;
        }

        this._setId(newId, connection);
        this._setAddress(sourceKey, connection);
        connection.challenge();
      }

      connection.handleOpen(pre, open);
    }
    else {
      /* Everything else gets routed to the connection. */
      if (!pre.encrypted && !this._allowUnsafeSegment) {
        /* Ugh. Not encrypted. */
        warn('Not encrypted:', pre, rinfo);
        this._reject(sourceKey, rinfo, reject.UNSAFE);
        return;
      }


      const connection = pre.id ? this._getId(pre.id) : null;
      if (connection) {
        connection.handleSegment(pre, seg);
      }
      else {
        /* Unverified sender. Reject with caution. */
        this._reject(sourceKey, rinfo, reject.ID);
        return;
      }
    }
  }

  /**
   * Report source for poor conformance to protocol.
   * @private
   */
  _report(sourceKey) {
    if (this._reported[sourceKey]) {
      this._reported[sourceKey] = this._reported + 1;
    }
    else {
      this._reported[sourceKey] = 1;
    }
  }

  /**
   * Check if the sender has been reported before.
   * @private
   */
  _isReported(sourceKey) {
    const val = this._reported[sourceKey];
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
   * @param {Object} options - Optional. See mkConnection documentation.
   * @return A promise that will either return a connection or an error.
   */
  mkConnection(dest, options) {
    trace();

    const router = this;

    if (!options) {
      options = {};
    }

    options.allowUnsafeSegment =
      'allowUnsafeSegment' in options ? (!!options.allowUnsafeSegment) : false;

    const promise = new Promise((resolve, reject) => {
      setTimeout(() => {
        const id = router._newId();
        if (id && router._allowOutgoing) {
          debug('Connection.id = ' + String(id));
          debug('Connection.dest = ' + JSON.stringify(dest));

          try {
            const sender = router._socket.mkSender(dest);
            const conn = mkConnection(router, id, sender, options);
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
 * @param {object} [options.openKeys] - Valid key pair from crypto.
 * @param {number} [options.maxConnections=1024] - The max connections, minimum of 1.
 * @param {boolean} [options.allowIncoming=false] - Allow incoming connections.
 * @param {boolean} [options.allowOutgoing=false] - Allow outgoing connections.
 * @param {boolean} [options.allowUnsafeOpen=false] - Allow unencrypted OPEN requests.
 * @param {boolean} [options.allowUnsafeSegment=false] - Allow all traffic to be unencrypted.
 * @param {boolean} [options.allowUnsafeSign=false] - Allow not signing CHALLENGE segments. Acts as a safety to remind users to specify a key or explicitly take the risk.
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
  options.allowUnsafeSegment =
    'allowUnsafeSegment' in options ? (!!options.allowUnsafeSegment) : false;
  options.allowUnsafeSign =
    'allowUnsafeSign' in options ? (!!options.allowUnsafeSign) : false;

  if (!options.signKeys && !options.allowUnsafeSign) {
    throw new Error(
      'Incompatible settings. ' +
      'Either set options.allowUnsafeSign=true or specify options.signKeys'
    );
  }

  if (!options.openKeys && !options.allowUnsafeOpen) {
    options.openKeys = crypto.mkKeyPair();
  }

  return new Router(socket, options);
}

module.exports = {
  mkRouter,
};

