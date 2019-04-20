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
const { control, lengths } = require('./spec.js');
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
State.initEnum([
  'CREATE',
  'START',
  'LISTEN',
  'DISCONNECT',
  'END',
]);

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
    this.map = new Map();

    this.keys = options.keys;
    this.maxConnections = options.maxConnections;
    this.allowIncoming = options.allowIncoming;
    this.allowOutgoing = options.allowOutgoing;
    this.allowUnsafeOpen = options.allowUnsafeOpen;
    this.allowUnsafePacket = options.allowUnsafePacket;

    this.state = State.CREATE;

    this.setupListeners();
  }

  setupListeners() {
    const router = this;

    /**
     * Pass error along.
     */
    function handleError(error) {
      router.socketError(error);
    }

    /**
     * Pass packets along.
     */
    function handleMessage(message, rinfo) {
      router.socketMessage(message, rinfo);
    }

    /**
     * Listen for bind event.
     */
    function handleListening() {
      router.socketBind();
    }

    /**
     * Listen for close event.
     */
    function handleClose() {
      router.socketClose();
    }

    // Save the event handlers
    this.handleError = handleError;
    this.handleMessage = handleMessage;
    this.handleListening = handleListening;
    this.handleClose = handleClose;

    this.socket.on('error', handleError);
    this.socket.on('message', handleMessage);
    this.socket.on('listening', handleListening);
    this.socket.on('close', handleClose);
  }

  cleanup() {
    this.socket.off('error', this.handleError);
    this.socket.off('message', this.handleMessage);
    this.socket.off('listening', this.handleListening);
    this.socket.off('close', this.handleClose);
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
    if (this.state === State.CREATE) {
      this.state = State.START;
      this.emit('start');
      this.socket.bind();
    }
    else {
      const err = new Error('Already started/stopped');
      this.emit('error', err);
    }
  }

  socketError(error) {
    switch (this.state) {
      case State.START:
        {
          const err = new Error('Unable to bind to socket.');
          this.emit('error', err);
          this.state = State.END;
        }
        break;
      default:
        {
          const err = new Error('Unexpected error on socket: ' + String(error));
          this.emit('error', err);
        }
        break;
    }
  }

  /**
   * Process the message and information.
   */
  processMessage(msg, rinfo) {
    // HERE
    console.log('Receiving message...');
    console.log(msg.toString('hex'));
    console.log(msg.length);
    console.log(rinfo.size);

    // First, check the length
    const len = msg.length;
    if (len < lengths.PACKET_MIN) {
      const err = new Error('Invalid packet length: ' + String(len));
      this.emit('error', err);
      return;
    }

    const prefix = {};
    if (!unPrefix(prefix, msg)) {
      return false;
    }

    // Second, check that the control character and specific length
    // is correct
    const c = msg[0];
    const encrypted = !!(c & control.ENCRYPTED);
    let isValid = false;
    switch (c & control.MASK) {
      case control.STREAM:
        if ((encrypted && len >= lengths.STREAM_ENCRYPT)
            || (!encrypted && len >= lengths.STREAM_DECRYPT)
            && prefix.id
            && (encrypted || this.allowUnsafePacket))
        {
          isValid = true;
        }
        break;
      case control.OPEN:
        if (((encrypted && len === lengths.OPEN_ENCRYPT)
            || (!encrypted && len === lengths.OPEN_DECRYPT))
            && this.allowIncoming
            && !prefix.id
            && (encrypted || this.allowUnsafeOpen))
        {
          isValid = true;
        }
        break;
      case control.REJECT:
        if (((encrypted && len === lengths.REJECT_ENCRYPT)
            || (!encrypted && len === lengths.REJECT_DECRYPT))
            && prefix.id
            && (encrypted || this.allowUnsafePacket))
        {
          isValid = true;
        }
        break;
      case control.CHALLENGE:
        if (((encrypted && len === lengths.CHALLENGE_ENCRYPT)
            || (!encrypted && len === lengths.CHALLENGE_DECRYPT))
            && prefix.id
            && (encrypted || this.allowUnsafePacket))
        {
          isValid = true;
        }
        break;
      case control.ACCEPT:
        if (((encrypted && len === lengths.ACCEPT_ENCRYPT)
            || (!encrypted && len === lengths.ACCEPT_DECRYPT))
            && this.allowIncoming
            && prefix.id
            && (encrypted || this.allowUnsafePacket))
        {
          isValid = true;
        }
        break;
      default:
        break;
    }

    if (!isValid) {
      const err = new Error('Invalid packet type from: ' + String(rinfo));
      this.emit('error', err);
      return;
    }

    // Extract basic header values
    // TODO const rest = msg.slice(lengths.PACKET_PREFIX);
    const conn = this.getId(prefix.id);
    if (conn) {
      // TODO pass through firewall
      // TODO decrypt
      // TODO pass along to connection
    }
    else {
      // TODO handle case of non-exist
      return false;
    }
  }

  socketMessage(message, rinfo) {
    switch (this.state) {
      case State.LISTEN:
        {
          this.processMessage(message, rinfo);
        }
        break;
      default:
        {
          const err = new Error('Received unexpected packet');
          this.emit('error', err, rinfo);
        }
        break;
    }
  }

  socketBind() {
    if (this.state === State.START) {
      this.state = State.LISTEN;
      this.emit('listen');
    }
    else {
      const err = new Error('Already bound');
      this.emit('error', err);
    }
  }

  socketClose() {
    switch (this.state) {
      case State.START:
        {
          const err = new Error('Socket closed when expecting socket bind');
          this.emit('error', err);
          this.state = State.END;
        }
        break;
      case State.LISTEN:
        {
          this.state = State.HARDSTOP;
          this.closeConnections(0);
        }
        break;
      default:
        {
          const err = new Error('Unexpected socket close event');
          this.emit('error', err);
        }
        break;
    }
  }

  stop(graceMs) {
    switch (this.state) {
      case State.CREATE:
        {
          this.state = State.END;
          this.cleanup();
        }
        break;
      case State.START:
        {
          this.state = State.END;
          this.cleanup();
        }
        break;
      case State.LISTEN:
        {
          this.state = State.DISCONNECT;
          this.closeConnections(graceMs);
        }
        break;
      default:
        {
          const err = new Error('Invalid attempt to stop');
          this.emit('error', err);
        }
        break;
    }
  }

  closeConnections(graceMs) {
    const router = this;

    function signalSoftDisconnect(conn/* Unused: id, map */) {
      conn.stop();
    }

    function signalHardDisconnect(conn/* Unused: id, map */) {
      conn.close();
    }

    function handleDisconnectTimeout(router) {
      delete router.disconnectTimeout;
      router.state = State.END;
      router.map.forEach(signalHardDisconnect);
      router.map = null;
      this.cleanup();
    }

    if (router.socket.isClosed() || !router.map.size) {
      router.state = State.END;
      this.cleanup();
    }
    else {
      router.map.forEach(signalSoftDisconnect);
      router.disonnectTimeout = setTimeout(handleDisconnectTimeout, graceMs, router);
    }
  }

  /**
   * Attempts to create a new connection over the socket.
   * @param {Object} dest - Required. The destination description. May vary depending on socket type.
   * @return A promise that will either return a connection or an error.
   */
  mkConnection(dest) {
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
      if (id) {
        console.log('id = ' + String(id));
        try {
          // Do we need to make the sender before the id?
          const conn = new Conn(id);
          router.setId(id, conn);
          conn.on('connect', () => {
            resolve(conn);
          });
          conn.on('error', (err) => {
            router.setId(id, null);
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
        const err = new Error('Could not generate a unique ID');
        reject(err);
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
    'allowUnsafePacket' in options ? (!!options.allowUnsafePacket) : false;
  if (!options.keys) {
    options.keys = crypto.mkKeyPair();
  }
  return new Router(socket, options);
}

module.exports = {
  Router,
  mkRouter,
};

