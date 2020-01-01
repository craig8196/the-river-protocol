/**
 * @file Connection management code.
 * @author Craig Jacobson
 *
 * TODO use allocUnsafeSlow for longer lived values
 * TODO move spec specific things to spec file
 * TODO rename spec.js to protocol.js???
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
/* Custom */
const crypto = require('./crypto.js');
const { trace } = require('./log.js');
const p = require('./protocol.js');
const { SenderInterface } = require('./socket.js');
const { version, length, limit, control, reject } = p;
'use strict';


class Event extends Enum {}
Event.initEnum([
  'OPEN',
  'OPEN_RECV',
  'OPEN_TIMEOUT',
  'OPEN_ERROR',
  'CHALLENGE',
  'CHALLENGE_RECV',
  'CHALLENGE_TIMEOUT',
  'RESPONSE',
  'RESPONSE_RECV',
  'RESPONSE_TIMEOUT',
  'STREAM_RECV',
  'REJECT_RECV',
  'DISCONNECT',
]);

class State extends Enum {}
State.initEnum({
  'START': {
    enter() {
    },

    transition(e) {
      switch (e) {
        case Event.OPEN:
          return State.OPEN;
        case Event.OPEN_RECV:
          // TODO parse open message
          return State.CHALLENGE;
        default:
          this.emit('error', new Error('Expected OPEN* events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'OPEN': {
    enter() {
      if (!this._selfKeys && this._allowUnsafePacket) {
        this._selfKeys = crypto.mkKeyPair();
        this._selfNonce = crypto.mkNonce();
      }
      this._startOpenAlgorithm();
    },

    transition(e) {
      switch (e) {
        case Event.OPEN_TIMEOUT:
          //TODO handle open timeout event
          this.emit('error', new Error('Unimplemented case: ' + String(e.name)));
          return State.ERROR;
        case Event.CHALLENGE_RECV:
          // TODO process CHALLENGE
          this.emit('error', new Error('Unimplemented case: ' + String(e.name)));
          return State.RESPONSE;
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
      this._stopOpenAlgorithm();
    },
  },

  'CHALLENGE': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'RESPONSE': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'READY': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'DISCONNECT_SOFT': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'DISCONNECT_HARD': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'DISCONNECT_ERROR': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'END': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'ERROR': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },
});

// TODO make sure that streams obey pipe semantics
// TODO add mkStream method on connection
// TODO add hasStream method to determine if an ID is taken
// TODO add getStreamId for random, or next, stream ID
class Connection extends EventEmitter {

  /**
   * Construct Connection object from valid socket and options.
   * @private
   * @param {SenderInterface} sender - Required. For communication.
   * @param {object} options - Required. See mkConnection for details.
   */
  constructor(id, sender, options) {
    super();

    trace();

    // TODO move all settings to mkConnection

    this._id = id;
    this._sender = sender;
    this._streams = new Map();

    /*
    // TODO verify how these need to be organized
    this.data = null;

    this.buffers = [];
    this.bufferKeep = 0;

    this.minmtu = length.UDP_MTU_DATA_MIN;
    this.effmtu = length.UDP_MTU_DATA_REC;
    this.maxmtu = length.UDP_MTU_DATA_MAX;

    this.sequenceWindow = length.WINDOW;

    this.rttMs = timeouts.RTT;
    this.rttTotal = timeouts.RTT;
    this.rttCount = 1;

    this._peerMinSeq = -1;
    this._peerMidSeq = -1;
    this._peerMaxSeq = -1;
    */

    this._allowUnsafePacket = options.allowUnsafePacket;
    this._openKey = options.openKey;
    this._peerKey = null;
    this._selfKeys = options.keys;
    this._peerNonce = null;
    this._selfNonce = options.nonce;

    // TODO make sure these are checked on making
    this._maxCurrency = limit.CURRENCY;
    this._regenCurrency = limit.CURRENCY_REGEN;
    this._maxStreams = limit.STREAMS;
    this._maxMessage = limit.MESSAGE;

    this._curCurrency = this._maxCurrency;
    this._curStreams = this._maxStreams;

    this.sequence = 0;

    this._timestamp = p.mkTimeNow();

    // TODO determine better default timeout?
    this._openMaxTimeout = 60000; /* 1 minute */

    this._internalState = State.START;
    this._internalState.enter();

    // TODO
    //this._flagPeerSequence(0);
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
   * Start the open connection handshake.
   */
  _startOpenAlgorithm() {
    trace();

    const maxTime = this._openMaxTimeout;

    function _openCycle(conn, counter, timeout, totalTime) {
      trace();

      totalTime += timeout;
      if (totalTime > maxTime) {
        conn.emit('error', new Error('Open message timed out.'));
        conn._transition(Event.OPEN_TIMEOUT);
        return;
      }

      counter++;

      if (counter === 3) {
        counter = 0;
        timeout *= 2;
      }

      if (conn._sendOpen()) {
        conn._timeoutOpenHandle =
          setTimeout(_openCycle, timeout, conn, counter, timeout, totalTime);
      }
      else {
        conn.emit('error', new Error('Unable to create/send open message'));
        conn._transition(Event.OPEN_ERROR);
      }
    }

    _openCycle(this, 0, (this.rttMs > 200 ? 200 : this.rttMs), 0);
  }

  /**
   * Stop the open connection.
   */
  _stopOpenAlgorithm() {
    trace();

    if (this._timeoutOpenHandle) {
      clearTimeout(this._timeoutOpenHandle);
    }
  }

  /**
   * Create and send the open packet.
   */
  _sendOpen() {
    trace();

    const buf = p.mkOpen(
      this._openKey,
      version,
      null,
      this._id,
      this._timestamp,
      this._selfNonce,
      this._selfKeys.publicKey,
      this._maxCurrency,
      this._regenCurrency,
      this._maxStreams,
      this._maxMessage,
    );

    if (!buf) {
      return false;
    }

    this._sender.send(buf);

    return true;
  }

  /**
   * Update the sender. Useful if you are using DDNS.
   */
  setSender(sender) {
    this._sender = sender;
  }
















  // TODO allow the router to set the window

  /**
   * Any value less than or equal to is guaranteed single packet delivery.
   * @return {number} The user MTU.
   */
  get umtu() {
    if (this.encrypted) {
      return this.effmtu - length.PREFIX - length.BOX_PADDING - length.STREAM_DATA;
    }
    else {
      return this.effmtu - length.PREFIX - length.STREAM_DATA;
    }
  }

  /**
   * This is the maximum message unit/size, in bytes, for a stream.
   * @return {number} The user MMU.
   */
  get ummu() {
    return this.umtu * length.MAX_FRAGMENT;
  }

  get sequence() {
    return this._sequence++;
  }

  set sequence(val) {
    this._sequence = val;
  }
  
  validatePeerSequence(seq) {
    if (seq < this.peer.minSequence || seq > this.peer.maxSequence) {
      return false;
    }

    return true;
  }

  _flagPeerSequence(seq) {
    if (seq > this.peer.midSequence) {
      this.peer.minSequence = seq - this.sequenceWindow;
      this.peer.midSequence = seq;
      this.peer.maxSequence = seq + this.sequenceWindow;
    }
    else {
      /* I'm not sure if this is a great idea, but we can shrink the window. */
      ++this.peer.minSequence;
    }
  }

  /**
   * Protect ourselves through encryption and from packet replay attacks.
   * @param {Buffer} buf - The incoming buffer slice.
   * @param {Buffer} seq - The binary sequence slice.
   * @param {integer} c - The control number.
   * @param {boolean} encrypted - Whether or not the buffer is encrypted.
   * @return {Buffer} Decrypted buffer if no fishy business detected; null otherwise.
   */
  firewall(buf, seq, c, encrypted) {
    const sequence = seq.readUInt32BE(0);

    if (!this.validatePeerSequence(sequence)) {
      return null;
    }

    if (encrypted) {
      switch (c) {
        /*
        case control.STREAM:
        case control.ACCEPT:
        case control.PING:
          {
            // Create specific nonce for this packet.
            const nonce = this.getNonceScratch();
            nonce[0] = (nonce[0] + data.control) & control.BYTE_MASK;
            nonce[length.NONCE - 1] = (nonce[length.NONCE - 1] + seq[0]) & control.BYTE_MASK;
            nonce[length.NONCE - 2] = (nonce[length.NONCE - 2] + seq[1]) & control.BYTE_MASK;
            nonce[length.NONCE - 3] = (nonce[length.NONCE - 3] + seq[2]) & control.BYTE_MASK;
            nonce[length.NONCE - 4] = (nonce[length.NONCE - 4] + seq[3]) & control.BYTE_MASK;

            // Unbox message.
            if (crypto.unbox(decryptBuf, buf, nonce, this.keys.publicKey, this.keys.secretKey)) {
            }
            else {
              return null;
            }

            // Set return buffer.
            const len = buf.length - length.BOX_PADDING;
            buf = decrypteBuf.slice(0, len);
          }
          break;
          */
        case control.OPEN:
          {
            const decryptBuf = Buffer.allocUnsafe(length.OPEN_DATA);
            const pk = this.router.keys.publicKey;
            const sk = this.router.keys.secretKey;

            // Unseal message.
            if (!crypto.unseal(decryptBuf, buf, pk, sk)) {
              this.emit('error', new Error('Unable to decrypt buffer'));
              return null;
            }

            // Set return buffer.
            buf = decryptBuf;
          }
          break;
        case control.REJECT:
        //case control.CHALLENGE:
          {
            const decryptBuf = Buffer.allocUnsafe(buf.length - length.SEAL_PADDING);
            const pk = this.keys.publicKey;
            const sk = this.keys.secretKey;

            // Unseal message.
            if (!crypto.unseal(decryptBuf, buf, pk, sk)) {
              this.emit('error', new Error('Unable to decrypt buffer'));
              return null;
            }

            // Set return buffer.
            buf = decryptBuf;
          }
          break;
        default:
          return null;
      }
    }

    this._flagPeerSequence(sequence);

    return buf;
  }

  // TODO handleOpen... data decrypted prior since keys are at router level

  handleOpenPacket(buf, allowUnsafePacket) {
    switch (this.state) {
      case State.CREATE:
      case State.CHALLENGE:
        {
          const out = {};
          if (unOpen(out, buf)) {
            if (!out.id) {
              this.emit('error', new Error('Invalid peer id'));
              break;
            }

            // TODO check timestamp

            if (version !== out.version) {
              this.emit('error', new Error('Invalid peer version'));
              this.sendReject(reject.VERSION);
              break;
            }

            if (crypto.NO_NONCE.equals(out.nonce) && crypto.NO_KEY.equals(out.publicKey)) {
              if (!allowUnsafePacket) {
                this.emit('error', new Error('Unsafe packets not allowed'));
                this.sendReject(reject.UNSAFE);
                break;
              }
            }
            else if (crypto.NO_NONCE.equals(out.nonce) || crypto.NO_KEY.equals(out.publicKey)) {
              this.emit('error', new Error('Invalid credentials'));
              this.sendReject(reject.INVALID);
              break;
            }

            this.peer.id = out.id;
            this.peer.timestamp = out.timestamp;
            this.peer.version = out.version;
            this.peer.currency = out.currency;
            this.peer.streamsLimit = out.streams;
            this.peer.messagesLimit = out.messages;
            this.peer.nonce = out.nonce;
            this.peer.publicKey = out.publicKey;

            if (!this.id) {
              this.emit('error', new Error('Reject due to business'));
              this.sendReject(reject.BUSY);
              break;
            }

            this.challenge();
          }
          else {
            this.emit('error', new Error('Invalid open request'));
            this.end();
          }
        }
        break;
      default:
        {
          this.emit('error', new Error('Unexpected handle open call'));
        }
        break;
    }
  }

  handleRejectPacket(buf) {
    /* Any state */
    const out = {};
    if (unReject(out, buf)) {
      // TODO check timestamp

      this.emit('reject', out.code, out.message);

      this.cleanup();
    }
    else {
      this.emit('error', new Error('Invalid reject response'));
    }
  }

  handleChallengePacket(buf, allowUnsafePacket) {
    switch (this.state) {
      case State.OPEN:
        {
          const out = {};
          if (unChallenge(out, buf)) {
            if (!out.id) {
              this.emit('error', new Error('Invalid peer id'));
              break;
            }

            // TODO check timestamp

            if (version !== out.version) {
              this.emit('error', new Error('Invalid peer version'));
              this.sendReject(reject.VERSION);
              break;
            }

            if (crypto.NO_NONCE.equals(out.nonce) && crypto.NO_KEY.equals(out.publicKey)) {
              if (!allowUnsafePacket) {
                this.emit('error', new Error('Unsafe packets not allowed'));
                this.sendReject(reject.UNSAFE);
                break;
              }
            }
            else if (crypto.NO_NONCE.equals(out.nonce) || crypto.NO_KEY.equals(out.publicKey)) {
              this.emit('error', new Error('Invalid credentials'));
              this.sendReject(reject.INVALID);
              break;
            }

            this.peer.id = out.id;
            this.peer.timestamp = out.timestamp;
            this.peer.version = out.version;
            this.peer.currency = out.currency;
            this.peer.streamsLimit = out.streams;
            this.peer.messagesLimit = out.messages;
            this.peer.nonce = out.nonce;
            this.peer.publicKey = out.publicKey;

            if (!this.id) {
              this.emit('error', new Error('Reject due to business'));
              this.sendReject(reject.BUSY);
              break;
            }

            this.accept();
          }
          else {
            this.emit('error', new Error('Invalid open request'));
            this.end();
          }
        }
        break;
      default:
        {
          const err = new Error('Unexpected challenge packet');
          this.emit('error', err);
        }
        break;
    }
  }

  handleAcceptPacket(buf) {
    switch (this.state) {
      case State.CHALLENGE:
        {
          const out = {};
          if (unAccept(out, buf)) {
            if (!this.nonce.equals(out.nonce)) {
              this.emit('error', new Error('Invalid nonce'));
              this.sendReject(reject.INVALID);
              break;
            }

            this.state = State.CONNECT;
            this.emit('connect');
            this.ping();
          }
          else {
            this.emit('error', new Error('Invalid accept request'));
          }
        }
        break;
      default:
        {
          const err = new Error('Unexpected accept packet');
          this.emit('error', err);
        }
        break;
    }
  }

  handlePingPacket(buf) {
    switch (this.state) {
      case State.ACCEPT:
      case State.CONNECT:
        {
          const out = {};

          if (unPing(out, buf)) {
            // TODO return if init ping, else disable our ping if matching
            // TODO delete this.pingNonce once this is over
            this.state = State.CONNECT;
          }
          else {
            this.emit('error', new Error('Invalid ping request'));
          }
        }
        break;
      default:
        {
          const err = new Error('Unexpected ping packet');
          this.emit('error', err);
        }
        break;
    }
  }

  sendReject(rejectCode, message, cb) {
    let bufAllocLen = this.peer.publicKey ? length.REJECT_ENCRYPT : length.REJECT_DECRYPT;

    const difference = this.effmtu - bufAllocLen;

    /* Determine how much of the string can be sent. */
    let messageByteLen = 0;
    if (message) {
      messageByteLen = Buffer.byteLength(message, 'utf8');
      while (messageByteLen > difference) {
        if (message.length > difference) {
          message = message.slice(0, difference);
        }
        else {
          message = message.slice(0, message.length/2);
        }
        messageByteLen = Buffer.byteLength(message, 'utf8');
      }
    }

    bufAllocLen += messageByteLen;

    const buf = Buffer.allocUnsafe(bufAllocLen);

    let len = mkPrefix(buf, !!this.peer.publicKey, control.REJECT, 0, this.sequence);

    if (!len) {
      return false;
    }

    let bufTmp = null;
    if (this.peer.publicKey) {
      bufTmp = Buffer.allocUnsafe(length.REJECT_DATA + messageByteLen);
    }
    else {
      bufTmp = buf.slice(length.PREFIX);
    }

    len = mkReject(bufTmp, this.timestamp, rejectCode, message);

    if (!len) {
      return false;
    }

    if (this.peer.publicKey) {
      if (!crypto.seal(buf.slice(length.PREFIX), bufTmp, this.peer.publicKey)) {
        return false;
      }
    }

    this.sender.send(buf, cb);
    return true;
  }

  sendChallenge(cb) {
    const bufAllocLen = this.peer.publicKey ? length.CHALLENGE_DECRYPT : length.CHALLENGE_ENCRYPT;
    const buf = Buffer.allocUnsafe(bufAllocLen);

    let len = mkPrefix(buf, !!this.peer.publicKey, control.CHALLENGE, 0, this.sequence);

    if (!len) {
      return false;
    }

    let bufTmp = null;
    if (this.peer.publicKey) {
      bufTmp = Buffer.allocUnsafe(length.CHALLENGE_DATA);
    }
    else {
      bufTmp = buf.slice(length.PREFIX);
    }

    let n = crypto.NO_NONCE;
    let pk = crypto.NO_KEY;
    if (this.encrypted) {
      n = this.nonce;
      pk = this.keys.publicKey;
    }

    len = mkChallenge(bufTmp, this.id, this.timestamp, version,
      this.limits.currency, this.limits.streams,
      this.limits.messages, n, pk);

    if (!len) {
      return false;
    }

    if (this.peer.publicKey) {
      if (!crypto.seal(buf.slice(length.PREFIX), bufTmp, this.peer.publicKey)) {
        return false;
      }
    }

    this.sender.send(buf, cb);
    return true;
  }

  sendAccept(cb) {
    const bufAllocLen = this.peer.publicKey ? length.ACCEPT_DECRYPT : length.ACCEPT_ENCRYPT;
    const buf = Buffer.allocUnsafe(bufAllocLen);

    let len = mkPrefix(buf, !!this.peer.publicKey, control.ACCEPT, 0, this.sequence);

    if (!len) {
      return false;
    }

    let bufTmp = null;
    if (this.peer.publicKey) {
      bufTmp = Buffer.allocUnsafe(length.ACCEPT_DATA);
    }
    else {
      bufTmp = buf.slice(length.PREFIX);
    }

    len = mkAccept(bufTmp, this.timestamp, this.peer.nonce);

    if (!len) {
      return false;
    }

    if (this.peer.publicKey) {
      if (!crypto.seal(buf.slice(length.PREFIX), bufTmp, this.peer.publicKey)) {
        return false;
      }
    }

    this.sender.send(buf, cb);
    return true;
  }

  sendPing(cb) {
    const bufAllocLen = this.peer.publicKey ? length.PING_DECRYPT : length.PING_ENCRYPT;
    const buf = Buffer.allocUnsafe(bufAllocLen);

    let len = mkPrefix(buf, !!this.peer.publicKey, control.PING, 0, this.sequence);

    if (!len) {
      return false;
    }

    let bufTmp = null;
    if (this.peer.publicKey) {
      bufTmp = Buffer.allocUnsafe(length.PING_DATA);
    }
    else {
      bufTmp = buf.slice(length.PREFIX);
    }

    if (!this.pingNonce) {
      this.pingNonce = crypto.mkNonce(Buffer.allocUnsafe(length.NONCE));
    }

    len = mkPing(bufTmp, this.timestamp, this.rttMs, this.pingNonce);

    if (!len) {
      return false;
    }

    if (this.peer.publicKey) {
      if (!crypto.seal(buf.slice(length.PREFIX), bufTmp, this.peer.publicKey)) {
        return false;
      }
    }

    this.sender.send(buf, cb);
    return true;
  }

  /**
   * Open this connection. The handshake process will begin.
   */
  open() {
    this._transition(Event.OPEN);
  }

  /**
   * Parse and process a packet.
   */
  packet() {
    // TODO
  }

  reject() {
    this.sendReject(reject.USER);
  }

  challenge() {
    switch (this.state) {
      case State.CREATE:
      case State.CHALLENGE:
        {
          this.state = State.CHALLENGE;
          this.emit('challenge');

          this.startChallenge();
        }
        break;
      default:
        {
          this.emit('error', new Error('Unexpected challenge call'));
        }
        break;
    }
  }

  startChallenge() {
    function challengeCycle(conn, counter, timeout) {
      if (conn.state === State.CHALLENGE) {
        counter++;

        if (counter === 3) {
          // TODO set timeout to cleanup connection object
        }
        else {
          if (conn.sendChallenge()) {
            conn.timeoutChallengeHandle = setTimeout(challengeCycle, timeout, conn, counter, timeout);
          }
          else {
            conn.emit('error', new Error('Unable to create/send open message'));
            clearTimeout(conn.timeoutChallengeHandle);
            // TODO clear connection object?
          }
        }
      }
      else {
        clearTimeout(conn.timeoutChallengeHandle);
      }
    }

    challengeCycle(this, 0, this.rttMs);
  }

  accept() {
    switch (this.state) {
      case State.OPEN:
        {
          this.state = State.ACCEPT;
          this.emit('accept');
          this.sendAccept();
        }
        break;
      default:
        {
          this.emit('error', new Error('Unexpected challenge call'));
        }
        break;
    }
  }

  stop() {
    // Start disconnect process.
  }

  close() {
    switch (this.state) {
      case State.CREATE:
        this.cleanup();
        break;
      case State.OPEN:
        this.cleanup();
        break;
      default:
        {
          this.emit('error', new Error('Unexpected close call'));
        }
        break;
    }
  }

  cleanup() {
    this.state = State.END;
    this.emit('close');
    this.streams = null;
    this.keys = null;
    this.nonce = null;
    this.timestamp = null;
  }
}

/**
 * Create a Connection.
 * @param {number} id - Required. Positive ID value.
 * @param {SenderInterface} sender - Required. Valid socket sender type.
 * @param {object} [options] - Options object.
 * @param {Buffer} [options.openKey] - Valid binary key.
 * @param {boolean} [options.allowUnsafePacket=false] - Allow unencrypted traffic.
 * @param {object} keys - Valid keys from crypto.
 * @param {Buffer} nonce - Valid nonce from crypto.
 * @return {Connection}
 */
function mkConnection(id, sender, options) {
  if (!id) {
    throw new Error('Invalid ID.');
  }

  if (!(sender instanceof SenderInterface)) {
    throw new Error('Invalid sender type.');
  }

  if (!options) {
    options = {};
  }

  options.openKey =
    'openKey' in options ? options.openKey : null;
  options.allowUnsafePacket =
    'allowUnsafePacket' in options ? (!!options.allowUnsafePacket) : false;

  if (!options.allowUnsafePacket) {
    options.keys = crypto.mkKeyPair();
    options.nonce = crypto.mkNonce();
  }
  else {
    options.keys = null;
    options.nonce = null;
  }

  return new Connection(id, sender, options);
}

module.exports = {
  mkConnection,
};

