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
const { timeouts, lengths, control } = require('./spec.js');
const Conn = require('./conn.js');


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
  // TODO document
  constructor(socket, options) {
    super();

    if (!options) {
      options = {};
    }

    this.socket = socket;
    this.map = new Map();
    // TODO determine if this could be hash map attack vector...
    // TODO determine how timeouts are handled (should be shorter during busier periods)
    this.addresses = new Map();

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

  cleanupListeners() {
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
    if (this.state === State.LISTEN && this.map.size < this.maxConnections) {
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
    else {
      return 0;
    }
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
    if (id) {
      return this.map.getId(id);
    }
    else {
      return null;
    }
  }

  setId(id, conn) {
    if (id) {
      this.map.set(id, conn);
    }
  }

  delId(id) {
    this.map.delete(id);
  }

  setAddress(rinfo, conn) {
    const key = this.socket.mkKey(rinfo);
    this.addresses[key] = conn;
  }

  getAddress(rinfo) {
    const key = this.socket.mkKey(rinfo);
    return this.addresses[key];
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
    const conn = id ? this.getId(id) : null;
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
    console.log('socket close router');
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
          this.disconnect(0);
        }
        break;
      case State.DISCONNECT:
        {
          this.state = State.END;
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
    if (!Number.isInteger(graceMs)) {
      graceMs = timeouts.DEFAULT_GRACE;
    }

    this.disconnect(graceMs);
  }

  disconnect(graceMs) {
    console.log('stop router');
    switch (this.state) {
      case State.CREATE:
      case State.START:
        {
          this.state = State.END;
          this.cleanupListeners();
        }
        break;
      case State.LISTEN:
        {
          console.log('router listening');
          this.state = State.DISCONNECT;
          this.signalDisconnect(graceMs);
        }
        break;
      default:
        {
          const err = new Error('Invalid attempt to disconnect');
          this.emit('error', err);
        }
        break;
    }
  }

  signalDisconnect(graceMs) {
    if (!Number.isInteger(graceMs)) {
      graceMs = 0;
    }

    function signalSoftDisconnect(conn/* Unused: id, map */) {
      conn.stop();
    }

    function signalHardDisconnect(conn/* Unused: id, map */) {
      conn.close();
    }

    function handleDisconnectTimeout(router) {
      console.log('hard disconnect router');
      delete router.disconnectTimeout;
      router.state = State.END;
      router.map.forEach(signalHardDisconnect);
      router.map = null;
      this.socket.close();
    }

    if (this.socket.isClosed()) {
      this.state = State.END;
      this.cleanupListeners();
      this.map.forEach(signalHardDisconnect);
      this.map.clear();
    }
    else if (!this.map.size) {
      this.map.forEach(signalHardDisconnect);
      this.map.clear();
      this.socket.close();
    }
    else {
      console.log('soft disconnect router');
      this.map.forEach(signalSoftDisconnect);
      this.disconnectTimeout = setTimeout(handleDisconnectTimeout, graceMs, this);
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

