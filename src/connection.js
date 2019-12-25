/**
 * @file Connection management code.
 * @author Craig Jacobson
 *
 * TODO use allocUnsafeSlow for longer lived values
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
const Long = require('long');
/* Custom */
const { version, lengths, control, reject } = require('./spec.js');
const crypto = require('./crypto.js');
const { trace } = require('./log.js');
'use strict';


/**
 * Encode prefix.
 */
function mkPrefix(buf, encrypted, c, id, sequence) {
  let offset = 0;
  if (encrypted) {
    console.log('Encrypted!!!');
    buf[0] = c | control.ENCRYPTED;
  }
  else {
    buf[0] = c;
  }

  offset += lengths.CONTROL;
  buf.writeUInt32BE(id, offset);
  offset += lengths.ID;
  buf.writeUInt32BE(sequence, offset);
  offset += lengths.ID;

  return offset;
}

/**
 * Encode unencrypted open information.
 */
function mkOpen(buf, id, timestamp, version, currency, streams, messages, nonce, publicKey) {
  console.log(buf.length);
  console.log(lengths.OPEN_DATA);
  if (buf.length < lengths.OPEN_DATA) {
    return 0;
  }

  let offset = 0;
  buf.writeUInt32BE(id, offset);
  offset += lengths.ID;
  console.log(offset);
  buf.writeUInt32BE(timestamp.getHighBitsUnsigned(), offset);
  offset += lengths.TIMESTAMP/2;
  console.log(offset);
  buf.writeUInt32BE(timestamp.getLowBitsUnsigned(), offset);
  offset += lengths.TIMESTAMP/2;
  console.log(offset);
  buf.writeUInt16BE(version, offset);
  offset += lengths.VERSION;
  buf.writeUInt32BE(currency, offset);
  offset += lengths.CURRENCY;
  buf.writeUInt32BE(streams, offset);
  offset += lengths.STREAMS;
  buf.writeUInt32BE(messages, offset);
  offset += lengths.MESSAGE;
  nonce.copy(buf, offset, 0, lengths.NONCE);
  offset += lengths.NONCE;
  publicKey.copy(buf, offset, 0, lengths.PUBLIC_KEY);
  offset += lengths.PUBLIC_KEY;

  return offset;
}

/**
 * Decode open information.
 * @return {boolean} True if successful, false otherwise.
 */
function unOpen(out, buf) {
  if (buf.length !== lengths.OPEN_DATA) {
    return false;
  }

  let offset = 0;
  out.id = buf.readUInt32BE(offset);
  offset += lengths.ID;
  out.timestamp = Long.fromBytesBE(buf.slice(offset, offset + lengths.TIMESTAMP));
  offset += lengths.TIMESTAMP;
  out.version = buf.readUInt16BE(offset);
  offset += lengths.VERSION;
  out.currency = buf.readUInt32BE(offset);
  offset += lengths.CURRENCY;
  out.streams = buf.readUInt32BE(offset);
  offset += lengths.STREAMS;
  out.messages = buf.readUInt32BE(offset);
  offset += lengths.MESSAGE;
  out.nonce = Buffer.allocUnsafeSlow(lengths.NONCE);
  buf.copy(out.nonce, 0, offset, offset + lengths.NONCE);
  offset += lengths.NONCE;
  out.publicKey = Buffer.allocUnsafeSlow(lengths.PUBLIC_KEY);
  buf.copy(out.publicKey, 0, offset, offset + lengths.PUBLIC_KEY);

  return true;
}

/**
 * @return {number} Zero on failure; length written otherwise.
 */
function mkReject(buf, timestamp, rejectCode, rejectMessage) {
  if (buf.length < lengths.REJECT_DATA) {
    return 0;
  }

  let offset = 0;
  buf.writeUInt32BE(timestamp.getHighBitsUnsigned(), offset);
  offset += lengths.TIMESTAMP/2;
  buf.writeUInt32BE(timestamp.getLowBitsUnsigned(), offset);
  offset += lengths.TIMESTAMP/2;
  buf.writeUInt16BE(rejectCode, offset);
  offset += lengths.REJECT_CODE;

  if (rejectMessage) {
    Buffer.from(rejectMessage, 'utf8').copy(buf, offset, 0);
    offset += Buffer.byteLength(rejectMessage, 'utf8');
  }

  buf[offset] = 0;

  ++offset;

  return offset;
}

/**
 * @return {boolean} True on success; false otherwise.
 */
function unReject(out, buf) {
  if (buf.length < lengths.REJECT_DATA) {
    return 0;
  }

  let offset = 0;
  out.timestamp = Long.fromBytesBE(buf.slice(0, lengths.TIMESTAMP));
  offset += lengths.TIMESTAMP;

  out.code = buf.readUInt16BE(offset);
  if (out.code < reject.UNKNOWN || out.code > reject.ERROR) {
    return false;
  }
  offset += lengths.REJECT_CODE;

  if (buf[buf.length - 1] !== 0) {
    return false;
  }

  let message = '';
  if ((buf.length - 1) > offset) {
    message = buf.toString('utf8', offset, buf.length);
  }
  out.message = message;
  return true;
}

const mkChallenge = mkOpen;

const unChallenge = unOpen;

function mkAccept(buf, timestamp, nonce) {
  if (buf.length !== lengths.ACCEPT_DATA) {
    return 0;
  }

  let offset = 0;
  buf.writeUInt32BE(timestamp.getHighBitsUnsigned(), offset);
  offset += lengths.TIMESTAMP/2;
  buf.writeUInt32BE(timestamp.getLowBitsUnsigned(), offset);
  offset += lengths.TIMESTAMP/2;
  nonce.copy(buf, offset, 0, lengths.NONCE);
  offset += lengths.NONCE;

  return offset;
}

function unAccept(out, buf) {
  if (buf.length !== lengths.ACCEPT_DATA) {
    return false;
  }

  let offset = 0;
  out.timestamp = Long.fromBytesBE(buf.slice(offset, offset + lengths.TIMESTAMP));
  offset += lengths.TIMESTAMP;
  out.nonce = buf.slice(offset, offset + lengths.NONCE);

  return true;
}

function mkPing(buf, timestamp, rtt, nonce) {
  if (buf.length !== lengths.PING_DATA) {
    return 0;
  }

  let offset = 0;
  buf.writeUInt32BE(timestamp.getHighBitsUnsigned(), offset);
  offset += lengths.TIMESTAMP/2;
  buf.writeUInt32BE(timestamp.getLowBitsUnsigned(), offset);
  offset += lengths.TIMESTAMP/2;
  buf.writeUInt32BE(rtt, offset);
  offset += lengths.RTT;
  nonce.copy(buf, offset, 0, lengths.NONCE);
  offset += lengths.NONCE;

  return offset;
}

function unPing(out, buf) {
  if (buf.length !== lengths.PING_DATA) {
    return false;
  }

  let offset = 0;
  out.timestamp = Long.fromBytesBE(buf.slice(offset, offset + lengths.TIMESTAMP));
  offset += lengths.TIMESTAMP;
  out.rtt = buf.readUInt32BE(offset);
  offset += lengths.RTT;
  out.nonce = buf.slice(offset, offset + lengths.NONCE);

  return true;
}

class Event extends Enum {}
Event.initEnum([
  'OPEN',
  'OPEN_RECV',
  'OPEN_TIMEOUT',
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
  constructor(id, sender, options) {
    super();

    trace();

    this._id = id;
    this._sender = sender;
    this._streams = new Map();
    this._openKey = options.keys;
    this._allowUnsafePacket = options.allowUnsafePacket;

    /*
    // TODO verify how these need to be organized
    this.data = null;

    this.buffers = [];
    this.bufferKeep = 0;

    this.minmtu = lengths.UDP_MTU_DATA_MIN;
    this.effmtu = lengths.UDP_MTU_DATA_REC;
    this.maxmtu = lengths.UDP_MTU_DATA_MAX;

    this.sequence = 0;
    this.sequenceWindow = lengths.WINDOW;

    this.rttMs = timeouts.RTT;
    this.rttTotal = timeouts.RTT;
    this.rttCount = 1;

    this._maxCurrency = limits.CURRENCY;
    this._maxStreams = limits.STREAMS;
    this._maxMessages = limits.MESSAGES;

    this._curCurrency = limits.CURRENCY;
    this._curStreams = limits.STREAMS;
    this._curMessages = limits.MESSAGES;

    this._peerMinSeq = -1;
    this._peerMidSeq = -1;
    this._peerMaxSeq = -1;
    */
    this._peerKey = null;
    this._selfKeys = null;
    this._peerNonce = null;
    this._selfNonce = null;

    this._internalState = State.START;
    this._internalState.enter();

    // TODO
    //this._flagPeerSequence(0);
    console.log('sequences: ' + JSON.stringify(this.peer));
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
   * Add the sender.
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
      return this.effmtu - lengths.PREFIX - lengths.BOX_PADDING - lengths.STREAM_DATA;
    }
    else {
      return this.effmtu - lengths.PREFIX - lengths.STREAM_DATA;
    }
  }

  /**
   * This is the maximum message unit/size, in bytes, for a stream.
   * @return {number} The user MMU.
   */
  get ummu() {
    return this.umtu * lengths.MAX_FRAGMENT;
  }

  get sequence() {
    return this._sequence++;
  }

  set sequence(val) {
    this._sequence = val;
  }
  
  validatePeerSequence(seq) {
    console.log(seq);
    console.log(JSON.stringify(this.peer));
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

    console.log('seq: ' + String(sequence));

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
            nonce[lengths.NONCE - 1] = (nonce[lengths.NONCE - 1] + seq[0]) & control.BYTE_MASK;
            nonce[lengths.NONCE - 2] = (nonce[lengths.NONCE - 2] + seq[1]) & control.BYTE_MASK;
            nonce[lengths.NONCE - 3] = (nonce[lengths.NONCE - 3] + seq[2]) & control.BYTE_MASK;
            nonce[lengths.NONCE - 4] = (nonce[lengths.NONCE - 4] + seq[3]) & control.BYTE_MASK;

            // Unbox message.
            if (crypto.unbox(decryptBuf, buf, nonce, this.keys.publicKey, this.keys.secretKey)) {
            }
            else {
              return null;
            }

            // Set return buffer.
            const len = buf.length - lengths.BOX_PADDING;
            buf = decrypteBuf.slice(0, len);
          }
          break;
          */
        case control.OPEN:
          {
            const decryptBuf = Buffer.allocUnsafe(lengths.OPEN_DATA);
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
            const decryptBuf = Buffer.allocUnsafe(buf.length - lengths.SEAL_PADDING);
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

  handleOpenPacket(buf, allowUnsafePacket) {
    switch (this.state) {
      case State.CREATE:
      case State.CHALLENGE:
        {
          const out = {};
          console.log(buf.length);
          console.log(lengths.OPEN_DATA);
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
    console.log(buf.length);
    console.log(lengths.OPEN_DATA);
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
          console.log(buf.length);
          console.log(lengths.OPEN_DATA);
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
          console.log(buf.length);
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

  sendOpen(cb) {
    const bufAllocLen = lengths.PREFIX
                        + (this.peer.publicKeyOpen ? lengths.SEAL_PADDING : 0)
                        + lengths.OPEN_DATA;
    const buf = Buffer.allocUnsafe(bufAllocLen);

    let len = mkPrefix(buf, !!this.peer.publicKeyOpen, control.OPEN, 0, this.sequence);

    if (!len) {
      return false;
    }

    let bufTmp = null;
    if (this.peer.publicKeyOpen) {
      bufTmp = Buffer.allocUnsafe(lengths.OPEN_DATA);
    }
    else {
      bufTmp = buf.slice(lengths.PREFIX);
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

    if (this.peer.publicKeyOpen) {
      if (!crypto.seal(buf.slice(lengths.PREFIX), bufTmp, this.peer.publicKeyOpen)) {
        return false;
      }
    }

    this.sender.send(buf, cb);
    return true;
  }

  sendReject(rejectCode, message, cb) {
    let bufAllocLen = this.peer.publicKey ? lengths.REJECT_ENCRYPT : lengths.REJECT_DECRYPT;

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
      bufTmp = Buffer.allocUnsafe(lengths.REJECT_DATA + messageByteLen);
    }
    else {
      bufTmp = buf.slice(lengths.PREFIX);
    }

    len = mkReject(bufTmp, this.timestamp, rejectCode, message);

    if (!len) {
      return false;
    }

    if (this.peer.publicKey) {
      if (!crypto.seal(buf.slice(lengths.PREFIX), bufTmp, this.peer.publicKey)) {
        console.log('here3');
        return false;
      }
    }

    this.sender.send(buf, cb);
    return true;
  }

  sendChallenge(cb) {
    const bufAllocLen = this.peer.publicKey ? lengths.CHALLENGE_DECRYPT : lengths.CHALLENGE_ENCRYPT;
    const buf = Buffer.allocUnsafe(bufAllocLen);

    let len = mkPrefix(buf, !!this.peer.publicKey, control.CHALLENGE, 0, this.sequence);

    if (!len) {
      return false;
    }

    let bufTmp = null;
    if (this.peer.publicKey) {
      bufTmp = Buffer.allocUnsafe(lengths.CHALLENGE_DATA);
    }
    else {
      bufTmp = buf.slice(lengths.PREFIX);
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
      if (!crypto.seal(buf.slice(lengths.PREFIX), bufTmp, this.peer.publicKey)) {
        return false;
      }
    }

    this.sender.send(buf, cb);
    return true;
  }

  sendAccept(cb) {
    const bufAllocLen = this.peer.publicKey ? lengths.ACCEPT_DECRYPT : lengths.ACCEPT_ENCRYPT;
    const buf = Buffer.allocUnsafe(bufAllocLen);

    let len = mkPrefix(buf, !!this.peer.publicKey, control.ACCEPT, 0, this.sequence);

    if (!len) {
      return false;
    }

    let bufTmp = null;
    if (this.peer.publicKey) {
      bufTmp = Buffer.allocUnsafe(lengths.ACCEPT_DATA);
    }
    else {
      bufTmp = buf.slice(lengths.PREFIX);
    }

    len = mkAccept(bufTmp, this.timestamp, this.peer.nonce);

    if (!len) {
      return false;
    }

    if (this.peer.publicKey) {
      if (!crypto.seal(buf.slice(lengths.PREFIX), bufTmp, this.peer.publicKey)) {
        return false;
      }
    }

    this.sender.send(buf, cb);
    return true;
  }

  sendPing(cb) {
    const bufAllocLen = this.peer.publicKey ? lengths.PING_DECRYPT : lengths.PING_ENCRYPT;
    const buf = Buffer.allocUnsafe(bufAllocLen);

    let len = mkPrefix(buf, !!this.peer.publicKey, control.PING, 0, this.sequence);

    if (!len) {
      return false;
    }

    let bufTmp = null;
    if (this.peer.publicKey) {
      bufTmp = Buffer.allocUnsafe(lengths.PING_DATA);
    }
    else {
      bufTmp = buf.slice(lengths.PREFIX);
    }

    if (!this.pingNonce) {
      this.pingNonce = crypto.mkNonce(Buffer.allocUnsafe(lengths.NONCE));
    }

    len = mkPing(bufTmp, this.timestamp, this.rttMs, this.pingNonce);

    if (!len) {
      return false;
    }

    if (this.peer.publicKey) {
      if (!crypto.seal(buf.slice(lengths.PREFIX), bufTmp, this.peer.publicKey)) {
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

  /**
   * Start the open connection handshake.
   */
  _startOpen() {
    function openCycle(conn, counter, timeout) {
      if (conn.state === State.OPEN) {
        counter++;

        if (counter === 3) {
          counter = 0;
          timeout *= 2;
        }

        if (conn.sendOpen()) {
          conn.timeoutOpenHandle = setTimeout(openCycle, timeout, conn, counter, timeout);
        }
        else {
          const err = new Error('Unable to create/send open message');
          conn.emit('error', err);
          clearTimeout(conn.timeoutOpenHandle);
          conn.close();
        }
      }
      else {
        clearTimeout(conn.timeoutOpenHandle);
      }
    }

    openCycle(this, 0, (this.rttMs > 200 ? 200 : this.rttMs));
  }

  /**
   * Clear any timeouts or variables from startOpen.
   */
  clearOpen() {
    if (this.timeoutOpenHandle) {
      clearTimeout(this.timeoutOpenHandle);
    }
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


function mkConnection(id, sender, options) {
  // TODO vet options and set smart defaults
  return new Connection(id, sender, options);
}

module.exports = {
  mkConnection,
};

