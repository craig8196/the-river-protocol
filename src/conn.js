/**
 * @file Connection management code.
 * @author Craig Jacobson
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
/* Custom */
const { Trans, control, lengths } = require('./spec.js');
const crypto = require('./crypto.js');
const shared = require('./shared.js');
'use strict';


function mkPrefix(buf, encrypted, c, id, sequence) {
  if (buf.length < lengths.PACKET_PREFIX) {
    return 0;
  }

  let offset = 0;
  if (encrypted) {
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

function unPrefix(out, buf) {
  if (buf.length < lengths.PACKET_PREFIX) {
    return false;
  }

  out.encrypted = buf[0] & control.ENCRYPTED ? true : false;
  out.c = buf[0] & control.MASK;
  let offset = lengths.CONTROL;
  out.id = readUInt32BE(offset);
  offset += lengths.ID;
  out.sequence = readUInt32BE(offset);

  return true;
}

/**
 * Create the OPEN message buffer.
 * @return {[Buffer]} 
 */
function mkOpen(buf, id, timestamp, version, nonce, publicKey) {
  if (buf.length < lengths.OPEN_DECRYPT) {
    return 0;
  }

  let offset = 0;
  buf.writeUInt32BE(id, offset);
  offset += lengths.ID;
  buf.writeUInt32BE(timestamp.getHighBitsUnsigned(), offset);
  offset += lengths.TIMESTAMP/2;
  buf.writeUInt32BE(timestamp.getLowBitsUnsigned(), offset);
  offset += lengths.TIMESTAMP/2;
  buf.writeUInt16BE(version, offset);
  offset += lengths.VERSION;
  nonce.copy(buf, offset, 0, lengths.NONCE);
  offset += lengths.NONCE;
  publicKey.copy(buf, offset, 0, lengths.PUBLIC_KEY);
  offset += lengths.PUBLIC_KEY;

  return offset;
}

/**
 * @return {boolean} True if successful, false otherwise.
 */
function unOpen(out, buf) {
  if (buf.length !== lengths.OPEN_DECRYPT) {
    return false;
  }

  let offset = 0;
  out.id = buf.readUInt32BE(offset);
  offset += lengths.ID;
  out.timestamp = Long.fromBytesBE(buf.slice(offset, offset + lengths.TIMESTAMP));
  offset += lengths.TIMESTAMP;
  out.version = buf.readUInt16BE(offset);
  offset += lengths.VERSION;
  out.nonce = Buffer.allocUnsafe(lengths.NONCE);
  buf.copy(out.nonce, 0, offset, offset + lengths.NONCE);
  offset += lengths.NONCE;
  out.peerPublicKey = Buffer.allocUnsafe(lengths.PUBLIC_KEY);
  buf.copy(out.peerPublicKey, 0, offset, offset + lengths.PUBLIC_KEY);

  return true;
}

/**
 * @return {number} Zero on failure; length written otherwise.
 */
function mkReject(buf, timestamp, rejectCode, rejectMessage) {
  let len = lengths.TIMESTAMP + lengths.REJECT_CODE;
  if (rejectMessage) {
    if (rejectMessage.length <= lengths.REJECT_MESSAGE) {
      len += rejectMessage.length;
    }
  }

  if (buf.length < len) {
    return 0;
  }

  let offset = 0;
  buf.writeUInt32BE(timestamp.getHighBitsUnsigned(), offset);
  offset += lengths.TIMESTAMP/2;
  buf.writeUInt32BE(timestamp.getLowBitsUnsigned(), offset);
  offset += lengths.TIMESTAMP/2;
  buf.writeUInt16BE(rejectCode, offset);
  if (rejectMessage && rejectMessage.length) {
    offset += lengths.REJECT_CODE;
    rejectMessage.copy(buf, offset);
  }

  return len;
}

/**
 * @return {boolean} True on success; false otherwise.
 */
function unReject(out, buf, prevTimestamp) {
  let offset = 0;
  const timestamp = Long.fromBytesBE(buf.slice(0, lengths.TIMESTAMP));
  offset += lengths.TIMESTAMP;

  if (!prevTimestamp.lessThan(timestamp)) {
    return false;
  }

  const code = buf.readUInt16BE(offset);
  if (code < reject.UNKNOWN || code > reject.ERROR) {
    return false;
  }

  offset += lengths.REJECT_CODE;
  let message = null;
  if (buf.length > offset) {
    message = utf8.toString('utf8', offset, buf.length);
  }
  out.code = code;
  out.message = message;
  return true;
}

const mkChallenge = mkOpen;

const unChallenge = unOpen;

function mkAccept(buf, maxStreams, maxCurrency, nonce) {
  if (buf.length < lengths.ACCEPT_DECRYPT) {
    return 0;
  }

  let offset = 0;
  buf.writeUInt16BE(maxStreams, offset);
  offset += lengths.MAX_STREAMS;
  buf.writeUInt16BE(maxCurrency, offset);
  offset += lengths.MAX_CURRENCY;
  nonce.copy(buf, offset, 0, lengths.NONCE);
  return lengths.ACCEPT_DECRYPT;
}

function unAccept(out, buf, expectedNonce) {
  let offset = 0;
  const maxStreams = buf.readUInt16BE(offset);
  offset += lengths.MAX_STREAMS;
  const maxCurrency = buf.readUInt16BE(offset);
  offset += lengths.MAX_CURRENCY;
  const token = buf.slice(offset);
  if (token !== expectedNonce) {
    return false;
  }

  out.maxStreams = maxStreams;
  out.maxCurrency = maxCurrency;
  return true;
}

function mkPing(buf) {
}

function unPing(out, buf) {
}

class State extends Enum {}
State.initEnum({
  CREATE: {
    enter(/* conn */) {
    },

    exit(/* conn */) {
    },

    transition(transType, conn, data) {
      switch (transType) {
        case Trans.START:
          conn.sender = data.sender;
          conn.publicKeyOpen = data.publicKey;
          conn.state = State.OPEN;
          break;
        case Trans.STOP:
          conn.state = State.END;
          break;
        case Trans.OPEN:
          if (unOpen(conn, data)) {
            conn.state = State.CHALLENGE;
          }
          break;
        default:
          {
            const err = new Error('Invalid transition attempt: ' + String(transType));
            conn.emit('error', err);
          }
          break;
      }
    }
  },

  OPEN: {
    enter(conn) {
      conn.emit('open');
      conn.keys = crypto.mkKeyPair();
      conn.nonce = crypto.mkNonce();
      conn.streams = new Map();

      conn.timestamp = shared.mkTimeNow();
      const buf = mkOpen(0, conn.sequence,
        conn.peerPublicKey,
        conn.id, conn.timestamp, conn.owner.version,
        conn.maxSequence, conn.maxCurrency,
        conn.nonce, conn.keys.publicKey);
      conn.sender.send(buf);
    },

    exit(/* conn */) {
    },

    transition(transType, conn, data) {
      switch (transType) {
        case Trans.CHALLENGE:
          {
            const out = {};
            if (unChallenge(out, data.data, conn.keys.publicKey, conn.keys.secretKey)) {
              conn.peerId = out.id;
              conn.peerTimestamp = out.timestamp;
              conn.peerVersion = out.version;
              conn.streams.maxStreams = out.maxStreams;
              conn.streams.maxCurrency = out.maxCurrency;
              conn.peerNonce = out.nonce;
              conn.peerPublicKey = out.publicKey;
              conn.state = State.ACCEPT;
            }
            else {
              // TODO
            }
          }
          break;
        case Trans.STOP:
          conn.state = State.END;
          break;
        default:
          {
            const err = new Error('Invalid transition attempt: ' + String(transType));
            conn.emit('error', err);
          }
          break;
      }
    }
  },

  CHALLENGE: {
    enter(conn) {
      conn.emit('challenge');
      conn.keys = crypto.mkKeyPair();
      conn.nonce = crypto.mkNonce();
      conn.streams = new Map();

      conn.timestamp = shared.mkTimeNow();
      const buf = mkChallenge(conn.peerId, conn.sequence,
        conn.peerPublicKey,
        conn.id, conn.timestamp, conn.owner.version,
        conn.maxSequence, conn.maxCurrency,
        conn.nonce, conn.keys.publicKey);
      conn.sender.send(buf);
    },

    exit(/* conn */) {
    },

    transition(transType, conn, data) {
      switch (transType) {
        case Trans.ACCEPT:
          if (unAccept(data.data)) {
            conn.state = State.CONNECT;
          }
          else {
            const err = new Error('Invalid ACCEPT message... discarding');
            conn.emit('error', err);
          }
          break;
        case Trans.STOP:
          conn.state = State.END;
          break;
        default:
          {
            const err = new Error('Invalid transition attempt: ' + String(transType));
            conn.emit('error', err);
          }
          break;
      }
    }
  },

  ACCEPT: {
    enter(/* conn */) {
    },

    exit(/* conn */) {
    },

    transition(transType, conn, data) {
      switch (transType) {
        case Trans.MESSAGE:
        case Trans.PING:
          conn.state = State.CONNECT;
          conn.state.transition(transType, conn, data);
          break;
        case Trans.REJECT:
          {
            const out = {};
            if (unReject(out, data.data, conn.peerTimestamp)) {
              conn.peerTimestamp = out.timestamp;
              // TODO we're rejected
            }
            else {
              const err = new Error('Invalid REJECT message... discarding');
              conn.emit('error', err);
            }
          }
          break;
        case Trans.STOP:
          conn.state = State.DISCONNECT;
          break;
        default:
          {
            const err = new Error('Invalid transition attempt: ' + String(transType));
            conn.emit('error', err);
          }
          break;
      }
    }
  },

  CONNECT: {
    enter(/* conn */) {
      // TODO start ping immediately to better determine rtt and mtu?
    },

    exit(/* conn */) {
      // TODO destroy any ping context
    },

    transition(transType, conn, data) {
      switch (transType) {
        case Trans.STREAM:
          if (unStream(data.data)) {
            // TODO handle stream data and detect malicious breach of protocol
          }
          else {
            const err = new Error('Invalid STREAM message... discarding');
            conn.emit('error', err);
          }
          break;
        case Trans.PING:
          if (unPing(data.data)) {
            // TODO handle ping
          }
          else {
            const err = new Error('Invalid PING message... discarding');
            conn.emit('error', err);
          }
          break;
        case Trans.STOP:
          conn.state = State.DISCONNECT;
          break;
          // TODO handle underlying socket disconnecting?
        default:
          {
            const err = new Error('Invalid transition attempt: ' + String(transType));
            conn.emit('error', err);
          }
          break;
      }
    }
  },

  DISCONNECT: {
    enter(/* conn */) {
      // TODO disconnect as nicely as possible
      // TODO notify all streams
    },

    exit(/* conn */) {
      // TODO cleanup anything remaining
    },

    transition(transType, conn, data) {
      switch (transType) {
        case Trans.STREAM:
          if (unStream(data.data)) {
            // TODO handle stream data and detect malicious breach of protocol
          }
          else {
            const err = new Error('Invalid STREAM message... discarding');
            conn.emit('error', err);
          }
          break;
        case Trans.PING:
          if (unPing(data.data)) {
            // TODO handle ping
          }
          else {
            const err = new Error('Invalid PING message... discarding');
            conn.emit('error', err);
          }
          break;
        default:
          {
            const err = new Error('Invalid transition attempt: ' + String(transType));
            conn.emit('error', err);
          }
          break;
      }
    }
  },

  END: {
    enter(conn) {
      conn.emit('end');
      // TODO notify owner
    },

    exit(/* conn */) {
    },

    transition(transType, conn) {
      // We're done, reject any further transitions
      let err = new Error('Invalid transition attempt: ' + String(transType));
      conn.emit('error', err);
    }
  },
});

class Conn extends EventEmitter {
  constructor(owner, id) {
    super();

    this.plain = false;
    this.owner = owner;
    this.id = id;
    this._state = State.CREATE;

    this._buffers = [];
    this._buffersOut = 0;
    this._bufferKeep = 0;

    const mtus = this.sender.socket.mtu;
    this._minmtu = mtus[0];
    this._maxmtu = mtus[2];
    this.emtu = mtus[1];

    this._sequence = 0;
  }

  /**
   * Set the effective MTU. If different than before, clear.
   */
  set emtu(mtu) {
    if (this._effmtu && this._effmtu !== mtu) {
      this._buffers = [];
    }

    this._effmtu = mtu;
  }

  /**
   * @return {number} The effective MTU for outgoing buffers.
   */
  get emtu() {
    return this._effmtu;
  }

  /**
   * Any value less than or equal to is guaranteed single packet delivery.
   * @return {number} The user MTU.
   */
  get umtu() {
    if (!this.plain) {
      return this.emtu - lengths.PACKET_PREFIX - lengths.BOX_PADDING - lengths.STREAM_DATA;
    }
    else {
      return this.emtu - lengths.PACKET_PREFIX - lengths.STREAM_DATA;
    }
  }

  /**
   * This is the maximum message unit/size, in bytes, for a stream.
   * @return {number} The user MMU.
   */
  get ummu() {
    return this.umtu * lengths.MAX_FRAGMENT;
  }

  /**
   * The input buffers may differ in size from the output buffers.
   */
  getInputBuffer(min) {
    return Buffer.allocUnsafe(min);
  }

  /**
   * Eventually we'll want to recycle buffers during high load periods.
   */
  recycleInputBuffer(buf) {
    buf = null;
  }

  /**
   * Get a recycled buffer or a newly allocated buffer.
   * @return {Buffer} The length is the maximum that can be sent.
   */
  getBuffer() {
    ++this._buffersOut;
    if (this._buffers.length) {
      return this._buffers.pop();
    }
    else {
      return Buffer.allocUnsafe(this.emtu);
    }
  }

  /**
   * Recycle the buffer. During times of lower use, discard every 8th buffer.
   */
  recycleBuffer(buf) {
    --this._buffersOut;
    this._bufferKeep = (1 + this._bufferKeep) & 0x07;
    if (buf.length === this.emtu) {
      if (this._buffersOut < this._buffers.length || this._bufferKeep) {
        this._buffers.push(buf);
      }
    }
  }

  get sequence() {
    return this._sequence++;
  }

  get state() {
    return this._state;
  }

  set state(s) {
    if (s === this._state) {
      let err = new Error('Transitioning to same state: ' + String(s));
      this.emit('error', err);
    }
    this._state.exit(this);
    this._state = s;
    this._state.enter(this);
  }

  open(sender, publicKey) {
    const data = {
      sender,
      publicKey,
    };
    this.state.transition(Trans.START, this, data);
  }

  close() {
    this.state.transition(Trans.STOP, this);
  }
}

module.exports = Conn;

