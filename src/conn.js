/**
 * @file Connection management code.
 * @author Craig Jacobson
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
const Long = require('long');
/* Custom */
const { version, control, lengths, reject } = require('./spec.js');
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
    message = buf.toString('utf8', offset, buf.length);
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
State.initEnum([
  'CREATE',
  'OPEN',
  'CHALLENGE',
  'ACCEPT',
  'CONNECT',
  'DISCONNECT',
  'END'
]);
/*
  CHALLENGE: {
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
    enter(conn) {
      conn.emit('connect');
      // TODO start ping immediately to better determine rtt and mtu?
    },

    transition(transType, conn, data) {
      switch (transType) {
        case Trans.STREAM:
          if (data.encrypted) {
            const len = data.length - lengths.BOX_PADDING;
            const buf = conn.getInputBuffer(len);
            const nonce = conn.getNonceScratch();
            nonce[0] = (nonce[0] + data.control) & control.BYTE_MASK;
            nonce[lengths.NONCE - 1] = (nonce[lengths.NONCE - 1] + data.seq[0]) & control.BYTE_MASK;
            nonce[lengths.NONCE - 2] = (nonce[lengths.NONCE - 2] + data.seq[1]) & control.BYTE_MASK;
            nonce[lengths.NONCE - 3] = (nonce[lengths.NONCE - 3] + data.seq[2]) & control.BYTE_MASK;
            nonce[lengths.NONCE - 4] = (nonce[lengths.NONCE - 4] + data.seq[3]) & control.BYTE_MASK;
            crypto.unbox(buf, data.data, nonce, conn.peerPublicKey, conn.peerSecretKey);
            data.recycle = buf;
            data.data = buf.slice(0, len);
          }
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
      // TODO disconnect as nicely as possible
      // TODO notify all streams
      // TODO cleanup anything remaining
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

    transition(transType, conn) {
      // We're done, reject any further transitions
      let err = new Error('Invalid transition attempt: ' + String(transType));
      conn.emit('error', err);
    }
  },
  */

class Conn extends EventEmitter {
  constructor(id) {
    super();

    this.plain = false;
    this.id = id;

    this._buffers = [];
    this._buffersOut = 0;
    this._bufferKeep = 0;

    const mtus = this.sender.socket.mtu;
    this._minmtu = mtus[0];
    this._maxmtu = mtus[2];
    this.emtu = mtus[1];

    this._sequence = 0;
    this._minSequence = this._sequence - lengths.WINDOW_REC;

    this._timeoutOpenStart = lengths.OPEN_TIMEOUT_REC;

    this.streams = new Map();

    this.state = State.CREATE;
  }

  // TODO allow the router to set the window

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
  
  seenPeerSequence(seq) {
    //TODO
  }

  hasPeerSequence(seq) {
    // TODO
    return false;
  }

  setPeerPublicKeyOpen(key) {
    this.peerPublicKeyOpen = key;
  }

  /**
   * Protect ourselves through encryption and from packet replay attacks.
   * @return {Buffer} Decrypted buffer if no fishy business detected; null otherwise.
   */
  firewall(buf, seq, c, encrypted, decryptBuf) {
    const sequence = seq.readUInt32BE(0);

    if (sequence < this._minSequence) {
      return null;
    }

    if (this.hasPeerSequence(sequence)) {
      return null;
    }

    if (encrypted) {
      switch (c) {
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
        case control.OPEN:
        case control.REJECT:
        case control.CHALLENGE:
          {
            // Unseal message.
            if (crypto.unseal(decryptBuf, buf, this.publicKeyOpen, this.secretKeyOpen)) {
            }
            else {
              return null;
            }

            // Set return buffer.
            const len = buf.length - lengths.SEAL_PADDING;
            buf = decryptBuf.splice(0, len);
          }
          break;
        default:
          return null;
      }
    }

    this.seenPeerSequence(sequence);

    return buf;
  }

  handleOpenPacket(buf) {
    switch (this.state) {
      case State.CREATE:
        {
          const out = {};
          if (unOpen(out, buf)) {
            //
          }
          else {
            const err = new Error('Invalid open request');
            this.emit('error', err);
            this.end();
          }
        }
        break;
      default:
        {
          const err = new Error('Unexpected open call');
          this.emit('error', err);
        }
        break;
    }
  }

  handleChallengePacket(buf, seq, encrypted) {
    switch (this.state) {
      case State.OPEN:
        {
          const out = {};
          if (unChallenge(out, buf)) {
            this.peerId = out.peerId;
            this.peerTimestamp = out.timestamp;
            this.peerVersion = out.version;
            this.peerMaxStreams = out.maxStreams;
            this.peerMaxCurrency = out.maxCurrency;
            this.peerNonce = out.nonce;
            this.peerPublicKey = out.publicKey;
            this.state = State.ACCEPT;
            // TODO send the accept packet
          }
          else {
            const err = new Error('Invalid challenge');
            this.emit('warn', err);
          }
        }
        break;
      default:
        {
          const err = new Error('Unexpected challenge packet');
          this.emit('error', err)
        }
        break;
    }
  }

  send(buf, len) {
    // TODO
    this.sender.send();
  }

  sendOpen() {
    const buf = this.getBuffer();
    
    let openLen = 0;
    if (this.encrypted) {
      len = mkOpen(buf, id, timestamp, version, nonce, publicKey);
    }
    else {
      len = mkOpen(buf, id, timestamp, version, null, null);
    }

    if (!len) {
      return false;
    }

    return this.send(this.encryptOpen, buf, len);
  }

  startOpen() {
    function openCycle(conn, counter, timeout) {
      if (conn.state === State.OPEN) {
        counter++;

        if (counter === 3) {
          counter = 0;
          timeout *= 2;
        }

        if (conn.sendOpen()) {
          conn._timeoutOpenHandle = setTimeout(openCycle, timeout, conn, counter, timeout);
        }
        else {
          clearTimeout(conn._timeoutOpenHandle);
          conn.close();
        }
      }
      else {
        clearTimeout(conn._timeoutOpenHandle);
      }
    }

    openCycle(this, 0, this._timeoutOpenStart);
  }

  clearOpen() {
    if (this._timeoutOpenHandle) {
      clearTimeout(this._timeoutOpenHandle);
    }
  }

  open(sender, options) {
    // HERE
    exit(1);
    switch (this.state) {
      case State.CREATE:
        {
          // Save the sender.
          this.sender = sender;

          // Encrypt the open request.
          if (options && options.publicKey) {
            this.setPeerPublicKeyOpen(options.publicKey);
          }

          // Encrypt packets.
          if (options && options.encrypt) {
            this.keys = crypto.mkKeyPair();
            this.nonce = crypto.mkNonce();
            this.encrypt = true;
          }

          // Go to new state.
          this.state = State.OPEN;
          this.emit('open');

          // Set our timestamp.
          this.timestamp = shared.mkTimeNow();

          // Start open algorithm.
          this.startOpen();
        }
        break;
      default:
        {
          const err = new Error('Unexpected open call');
          this.emit('warn', err)
        }
        break;
    }
  }

  challenge() {
    switch (this.state) {
      case State.CHALLENGE:
        if (mkChallenge()) {
          conn.emit('challenge');

          conn.timestamp = shared.mkTimeNow();
          const buf = mkChallenge(conn.peerId, conn.sequence,
            conn.peerPublicKey,
            conn.id, conn.timestamp, conn.owner.version,
            conn.maxSequence, conn.maxCurrency,
            conn.nonce, conn.keys.publicKey);
          conn.sender.send(buf);
        }
        else {
        }
        break;
      default:
        {
          const err = new Error('Unexpected open call');
          this.emit('error', err)
        }
        break;
    }
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
          const err = new Error('Unexpected open call');
          this.emit('warn', err)
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

module.exports = Conn;

