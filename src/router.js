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
const { Trans, control, lengths } = require('./spec.js');
const Conn = require('./conn.js');


function unPrefix(out, buf) {
  if (buf.length < lengths.PACKET_PREFIX) {
    return false;
  }

  out.encrypted = !!(buf[0] & control.ENCRYPTED);
  out.c = buf[0] & control.MASK;
  let offset = lengths.CONTROL;
  out.id = buf.readUInt32BE(offset);
  offset += lengths.ID;
  out.sequence = buf.slice(offset, offset + 4);

  return true;
}

class State extends Enum {}
State.initEnum({
  CREATE: {
    enter(router) {
      router.map = new Map();

      /**
       * Pass error along.
       */
      function handleError(error) {
        router.state.transition(Trans.ERROR, router, error);
      }

      /**
       * Pass packets along.
       */
      function handleMessage(message, rinfo) {
        const eventData = { packet: message, rinfo: rinfo };
        router.state.transition(Trans.PACKET, router, eventData);
      }

      /**
       * Listen for bind event.
       */
      function handleListening() {
        router.state.transition(Trans.BIND, router);
      }

      /**
       * Listen for close event.
       */
      function handleClose() {
        router.state.transition(Trans.CLOSE, router);
      }

      // Save the event handlers
      router.handleError = handleError;
      router.handleMessage = handleMessage;
      router.handleListening = handleListening;
      router.handleClose = handleClose;

      const socket = router.socket;
      socket.on('error', handleError);
      socket.on('message', handleMessage);
      socket.on('listening', handleListening);
      socket.on('close', handleClose);
    },

    exit(/* router */) {
    },

    transition(transType, router) {
      switch (transType) {
        case Trans.START:
          router.state = State.START;
          break;
        case Trans.STOP:
          router.state = State.END;
          break;
        default:
          {
            const err = new Error('Invalid transition attempt: ' + String(transType));
            router.emit('error', err);
          }
          break;
      }
    }
  },

  START: {
    enter(router) {
      router.emit('start');
      router.socket.bind();
    },

    exit(/* router */) {
    },

    transition(transType, router) {
      switch (transType) {
        case Trans.BIND:
          router.state = State.LISTEN;
          break;
        case Trans.CLOSE:
          {
            const err = new Error('Socket closed when expecting socket bind');
            router.emit('error', err);
            router.state = State.END;
          }
          break;
        case Trans.STOP:
          router.state = State.END;
          break;
        case Trans.ERROR:
          {
            const err = new Error('Unable to bind to socket.');
            router.emit('error', err);
            router.state = State.END;
          }
          break;
        default:
          {
            const err = new Error('Invalid transition attempt: ' + String(transType));
            router.emit('error', err);
          }
          break;
      }
    }
  },

  LISTEN: {
    enter(router) {
      const socket = router.socket;
      router.emit('listen', { port: socket.port, address: socket.address });
    },

    exit(/* router */) {
    },

    transition(transType, router, data) {
      switch (transType) {
        case Trans.PACKET:
          {
            // First, check the length
            const pkt = data.packet;
            const len = pkt.length;
            if (len < lengths.PACKET_MIN) {
              const err = new Error('Invalid packet length: ' + String(len));
              router.emit('error', err);
              break;
            }

            // Second, check that the control character and specific length
            // is correct
            const c = pkt[0];
            const encrypted = c & control.ENCRYPTED;
            let t = Trans.GARBAGE;
            switch (c & control.MASK) {
              case control.STREAM:
                if ((encrypted && len >= lengths.STREAM_ENCRYPT)
                    || (!encrypted && len >= lengths.STREAM_DECRYPT)
                    && (encrypted || router.allowUnsafePacket))
                {
                  t = Trans.STREAM;
                }
                break;
              case control.OPEN:
                if (((encrypted && len === lengths.OPEN_ENCRYPT)
                    || (!encrypted && len === lengths.OPEN_DECRYPT))
                    && router.allowIncoming
                    && (encrypted || router.allowUnsafeOpen))
                {
                  t = Trans.OPEN;
                }
                break;
              case control.REJECT:
                if (((encrypted && len === lengths.REJECT_ENCRYPT)
                    || (!encrypted && len === lengths.REJECT_DECRYPT))
                    && (encrypted || router.allowUnsafePacket))
                {
                  if (control.unReject()) {
                    t = Trans.REJECT;
                  }
                }
                break;
              case control.CHALLENGE:
                if (((encrypted && len === lengths.CHALLENGE_ENCRYPT)
                    || (!encrypted && len === lengths.CHALLENGE_DECRYPT))
                    && (encrypted || router.allowUnsafePacket))
                {
                  t = Trans.CHALLENGE;
                }
                break;
              case control.ACCEPT:
                if (((encrypted && len === lengths.ACCEPT_ENCRYPT)
                    || (!encrypted && len === lengths.ACCEPT_DECRYPT))
                    && router.allowIncoming
                    && (encrypted || router.allowUnsafePacket))
                {
                  t = Trans.ACCEPT;
                }
                break;
              default:
                break;
            }

            if (Trans.GARBAGE === t) {
              const err = new Error('Invalid packet type from: ' + String(data.rinfo));
              router.emit('error', err);
              break;
            }

            // Extract basic header values
            const rest = pkt.slice(lengths.PACKET_PREFIX);
            const info = {
              encrypted: encrypted,
              control: c,
              //id: id,
              //seq: seq,
              buf: rest,
              rinfo: data.rinfo,
            };
            unPrefix(info, pkt);
            const conn = router.getId(id);
            conn.state.transition(t, conn, info);
          }
          break;
        case Trans.CLOSE:
          router.isSocketClosed = true;
          router.state = State.STOP;
          break;
        case Trans.STOP:
          router.state = State.DISCONNECT;
          break;
        default:
          {
            const err = new Error('Invalid transition attempt: ' + String(transType));
            router.emit('error', err);
          }
          break;
      }
    }
  },

  DISCONNECT: {
    enter(router) {
      function signalDisconnect (conn/* , id, map */) {
        conn.close();
      }

      function handleDisconnectTimeout(router) {
        delete router.disconnectTimeout;
        router.state = State.STOP;
      }

      if (router.isSocketClosed || !router.map.size) {
        router.state = State.STOP;
      }
      else {
        router.map.forEach(signalDisconnect);
        router.disconnectTimeoutMs = 5000;
        router.disonnectTimeout = setTimeout(handleDisconnectTimeout, router.disconnectTimeoutMs, router);
      }
    },

    exit(router) {
      function forceDisconnect (conn/* , id, map */) {
        conn.hardClose();
      }

      if (router.disconnectTimeout) {
        clearTimeout(router.disconnectTimeout);
        delete router.disconnectTimeout;
      }

      router.map.forEach(forceDisconnect);
    },

    transition(transType, router) {
      switch (transType) {
        default:
          {
            const err = new Error('Invalid transition attempt: ' + String(transType));
            router.emit('error', err);
          }
          break;
      }
    }
  },

  STOP: {
    enter(router) {
      if (!router.isSocketClosed) {
        router.socket.close();
      }
      else {
        router.state = State.END;
      }
    },

    exit(/* router */) {
    },

    transition(transType, router) {
      switch (transType) {
        case Trans.CLOSE:
          router.state = State.END;
          break;
        default:
          {
            const err = new Error('Invalid transition attempt: ' + String(transType));
            router.emit('error', err);
          }
          break;
      }
    }
  },

  END: {
    enter(router) {
      // Remove listeners
      const socket = router.socket;
      if (router.handleError) {
        socket.off('error', router.handleError);
      }
      if (router.handleMessage) {
        socket.off('message', router.handleMessage);
      }
      if (router.handleListening) {
        socket.off('listening', router.handleListening);
      }
      if (router.handleClose) {
        socket.off('close', router.handleClose);
      }

      // Free resources
      router.map = null;
      router.socket = null;

      router.emit('stop');
    },

    exit(/* router */) {
    },

    transition(transType, router) {
      const err = new Error('Invalid transition attempt: ' + String(transType));
      router.emit('error', err);
    }
  },
});

/**
 * Router is a junction or meeting of conns, thus managing 
 * multiple connections.
 *
 * Duties:
 * Store socket, conns, and state.
 * Route packets to the correct conn.
 * Perform basic packet rejection linting:
 * - Bad length
 * - Bad control
 * - Bad encryption
 * - Bad OPEN request
 */
class Router extends EventEmitter {
  constructor(socket, options) {
    super();

    if (!options) {
      options = {};
    }

    this.socket = socket;

    this.keys = options.keys;
    this.maxConnections = options.maxConnections;
    this.allowIncoming = options.allowIncoming;
    this.allowOutgoing = options.allowOutgoing;
    this.allowUnsafeOpen = options.allowUnsafeOpen;
    this.allowUnsafePacket = options.allowUnsafePacket;

    this._state = State.CREATE;
    this._state.enter(this);
  }

  get state() {
    return this._state;
  }

  set state(s) {
    if (s === this._state) {
      const err = new Error('Transitioning to same state: ' + String(s));
      this.emit('error', err);
    }
    this._state.exit(this);
    this._state = s;
    this._state.enter(this);
  }

  /**
   * Create a new random identifier.
   * @return {number} Non-zero on success, zero otherwise.
   */
  newId() {
    let id = crypto.mkId();
    let count = 1;
    const maxTry = 30;
    while (id === 0 || this.hasId(id)) {
      if (maxTry === count) {
        return 0;
      }
      id = crypto.mkId();
      ++count;
    }
    return id;
  }

  /**
   * @return {boolean} True if the map contains the given id; false otherwise.
   */
  hasId(id) {
    return this.map.has(id);
  }

  /**
   * Get the conn as specified. If not found, return a dummy conn.
   * @param {number} id - The id of the conn to be found.
   * @return {Conn}
   */
  getId(id) {
    const conn = this.map.get(id);
    if (conn) {
      return conn;
    }
    else {
      // TODO return the prepared conn object
      // TODO create default/dummy rejection conn objects for different situations
      return null;
    }
  }

  setId(id, conn) {
    if (conn) {
      this.map.set(id, conn);
    }
    else {
      this.map.delete(id);
    }
  }

  start() {
    this.state.transition(Trans.START, this);
  }

  stop() {
    this.state.transition(Trans.STOP, this);
  }

  /**
   * Attempts to create a new connection over the socket.
   * @param {Object} dest - The destination description.
   * @param {number} dest.port - Required. The destination port.
   * @param {string} dest.address - Required. The destination address.
   * @return A promise that will either return a connection or an error.
   */
  mkConnection(dest, options) {
    // Internally the connection is called a conn, but these details don't
    // need to be known to the user
    const router = this;

    if (!options) {
      options = {};
    }

    if (options.encrypt === undefined) {
      options.encrypt = true;
    }

    const promise = new Promise((resolve, reject) => {
      const id = router.newId();
      if (id) {
        console.log('id = ' + String(id));
        dest.socket = router.socket;
        try {
          const sender = router.socket.mkSender(dest);
          console.log(sender);
          const conn = new Conn(router, id);
          router.setId(id, conn);
          conn.on('connect', () => {
            resolve(conn);
          });
          conn.on('error', (err) => {
            router.setId(id, null);
            reject(err);
          });
          conn.open(sender, options);
        }
        catch (err) {
          reject(err);
        }
      }
    });
    return promise;
  }
}

function mkRouter(socket, options) {
  if (!options) {
    options = {};
  }
  options.allowIncoming =
    'allowIncoming' in options ? (!!options.allowIncoming) : false;
  options.allowOutgoing =
    'allowOutgoing' in options ? (!!options.allowOutgoing) : false;
  options.allowUnsafeOpen =
    'allowUnsafeOpen' in options ? (!!options.allowUnsafeOpen) : false;
  options.allowUnsafePacket =
    'allowUnsafePacket' in options ? (!! options.allowUnsafePacket) : false;
  if (!options.keys) {
    options.keys = crypto.mkKeyPair();
  }
  return new Router(socket, options);
}

module.exports = {
  Router,
  mkRouter,
};

