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


function mkStream() {
}

function unStream() {
}

function mkOpen(peerId, sequence,
  publicKeyOpen,
  id, timestamp, version, maxStreams, maxCurrency,
  nonce, publicKey)
{
  let packetPrefix = Buffer.allocUnsafe(lengths.PACKET_PREFIX);
  if (publicKeyOpen) {
    packetPrefix[0] = control.OPEN | control.ENCRYPTED;
  }
  else {
    packetPrefix[0] = control.OPEN;
  }
  let offset = lengths.CONTROL;
  packetPrefix.writeUInt32BE(peerId, offset);
  offset += lengths.ID;
  packetPrefix.writeUInt32BE(sequence, offset);

  let buf = Buffer.allocUnsafe(lengths.OPEN_DECRYPT);
  offset = 0;
  buf.writeUInt32BE(id, offset);
  offset += lengths.ID;
  timestamp.copy(buf, offset, 0, lengths.TIMESTAMP);
  offset += lengths.TIMESTAMP;
  buf.writeUInt16BE(version, offset);
  offset += lengths.VERSION;
  buf.writeUInt16BE(maxStreams, offset);
  offset += lengths.MAX_STREAMS;
  buf.writeUInt16BE(maxCurrency, offset);
  offset += lengths.MAX_CURRRENCY;
  nonce.copy(buf, offset, 0, lengths.NONCE);
  offset += lengths.NONCE;
  publicKey.copy(buf, offset, 0, lengths.PUBLIC_KEY);

  if (publicKeyOpen) {
    let ebuf = Buffer.allocUnsafe(lengths.OPEN_ENCRYPT);
    if (!crypto.seal(ebuf, buf, publicKeyOpen)) {
      return null;
    }
    buf = ebuf;
  }

  return [packetPrefix, buf];
}

/**
 * @return {boolean} True if successful, false otherwise.
 */
function unOpen(out, buf, publicKey, secretKey) {
  if (buf.length === lengths.OPEN_ENCRYPT) {
    let unbuf = Buffer.allocUnsafe(lengths.OPEN_DECRYPT);
    if (!crypto.unseal(unbuf, buf, publicKey, secretKey)) {
      return false;
    }
    buf = unbuf;
  }

  let offset = 0;
  const id = buf.readUInt32BE(offset);
  offset += lengths.ID;
  const timestamp = buf.slice(offset, offset + lengths.TIMESTAMP);
  offset += lengths.TIMESTAMP;
  const version = buf.readUInt16BE(offset);
  offset += lengths.VERSION;
  const maxStreams = buf.readUInt16BE(offset);
  offset += lengths.MAX_STREAMS;
  const maxCurrency = buf.readUInt16BE(offset);
  offset += lengths.MAX_CURRRENCY;
  const nonce = Buffer.allocUnsafe(lengths.NONCE);
  buf.copy(nonce, 0, offset, offset + lengths.NONCE);
  offset += lengths.NONCE;
  const peerPublicKey = Buffer.allocUnsafe(lengths.PUBLIC_KEY);
  buf.copy(peerPublicKey, 0, offset, offset + lengths.PUBLIC_KEY);

  out.id = id;
  out.timestamp = timestamp;
  out.version = version;
  out.maxStreams = maxStreams;
  out.maxCurrency = maxCurrency;
  out.nonce = nonce;
  out.publicKey = peerPublicKey;
  return true;
}

function mkReject() {
}

function unReject() {
}

const mkChallenge = mkOpen;

const unChallenge = unOpen;

function mkAccept() {
}

function unAccept() {
}

function mkPing() {
}

function unPing() {
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
          if (unReject()) {
            // TODO we're rejected
          }
          else {
            const err = new Error('Invalid REJECT message... discarding');
            conn.emit('error', err);
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

    this._sequence = 0;
    this.owner = owner;
    this.id = id;
    this._state = State.CREATE;
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

