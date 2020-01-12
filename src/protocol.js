/**
 * @file Miscellaneous code to share between different modules.
 * @author Craig Jacobson
 */
/* Core */
/* Community */ const Long = require('long'); /* Custom */
const { trace, debug, warn } = require('./log.js');
const crypto = require('./crypto.js');
'use strict';


/**
 * Starts at zero.
 * @const {integer}
 */
const version = 0;

/**
 * Default timeout values in milliseconds.
 * @namespace
 */
const timeout = {
// TODO refind the source for these (ICMP?)
  /* Similar to TCP keep-alive. */
  PING_MIN:         15 * 1000, /* 15 seconds */
  PING_REC:         20 * 1000, /* 20 seconds */
  PING_MAX:         60 * 60 * 1000, /* 1 hour */
  /* TODO what is GRACE for again? */
  DEFAULT_GRACE:    500, /* 0.5 seconds */
  /* Round-trip Time */
  RTT:              500, /* 0.5 seconds */
};
Object.freeze(timeout);

/**
 * Lengths of certain fields in octets.
 * @namespace
 */
const length = {
  CONTROL: 1,
  ID: 4,
  SEQUENCE: 4,
  TIMESTAMP: 8,
  VERSION: 2,

  REJECT_CODE: 1,

  RANDOM: crypto.NONCE_BYTES,

  HASH: crypto.HASH_BYTES,
  NONCE: crypto.NONCE_BYTES,
  PUBLIC_KEY: crypto.PUBLIC_KEY_BYTES,
  SECRET_KEY: crypto.SECRET_KEY_BYTES,
  BOX_PADDING: crypto.BOX_MAC_BYTES,
  SEAL_PADDING: crypto.SEAL_MAC_BYTES,
  SIGN_PADDING: crypto.SIGN_MAC_BYTES,

  UUID: 16,
  CURRENCY: 4,
  RATE: 4,
  STREAMS: 4,
  MESSAGE: 4,
  RTT: 4,
  SENT: 4,
  RECV: 4,
  /* See article on NodeJS and UDP MTU, and RFC on maximum IP header size.
   * Recommended MTU is 576 for IPv4, 60 octet max for IP header size,
   * 8 octet UDP header size.
   */
  IP_HEADER: 60,// I've read that this can be as high as 60...
  UDP_HEADER: 8,// 2 For each port, 2 for length, 2 for 1's complement
  UDP_MTU_MIN: 576,
  UDP_MTU_REC: 1400,
  UDP_MTU_MAX: 1500,
  UINT64: 8,

  WINDOW: 256,
};
/* Use these values for determining our own payload size. */
length.UDP_MTU_DATA_MIN = length.UDP_MTU_MIN - length.IP_HEADER - length.UDP_HEADER;
length.UDP_MTU_DATA_REC = length.UDP_MTU_REC - length.IP_HEADER - length.UDP_HEADER;
length.UDP_MTU_DATA_MAX = length.UDP_MTU_MAX - length.IP_HEADER - length.UDP_HEADER;
/* Required prefix of every segment. */
length.PREFIX = length.CONTROL + length.ID + length.SEQUENCE;
/* OPEN payload length. */
length.OPEN_DATA =
  length.HASH +
  length.ID + length.TIMESTAMP +
  length.NONCE + length.PUBLIC_KEY +
  length.CURRENCY + length.RATE + length.STREAMS + length.MESSAGE;
/* CHALLENGE payload length. */
length.CHALLENGE_DATA = length.OPEN_DATA;
/* PING payload */
length.PING_DATA =
  length.RANDOM +
  length.TIMESTAMP +
  length.RTT + 
  length.SENT +
  length.RECV;
/* REJECT segment length. */
length.REJECT_DATA = length.TIMESTAMP + length.REJECT_CODE + 1;
length.REJECT_DECRYPT = length.PREFIX + length.REJECT_DATA;
length.REJECT_ENCRYPT = length.REJECT_DECRYPT + length.SEAL_PADDING;
/* Min segment length. */
length.SEGMENT_MIN = Math.min(length.PREFIX);
Object.freeze(length);

/**
 * Offsets for values.
 * @namespace
 */
const offset = {
  CONTROL: 0,
};
offset.ID = length.CONTROL;
offset.SEQUENCE = offset.ID + length.ID;
offset.VERSION = offset.ID + length.ID;
offset.ROUTE_LENGTH = offset.VERSION + length.VERSION;
Object.freeze(offset);

/**
 * Default limit.
 * @namespace
 */
const limit = {
  STREAMS: 1,
  CURRENCY: 256,
  CURRENCY_REGEN: 256,
  MESSAGE: 65535,
};
Object.freeze(limit);

/**
 * Control values to identify different messages.
 * @namespace
 */
const control = {
  MASK:      0x07F,
  ENCRYPTED: 0x080,
  BYTE_MASK: 0x0FF,

  STREAM:    0x00,
  OPEN:      0x01,
  CHALLENGE: 0x02,
  RESPONSE:  0x03,//TODO replace with immediate ping?
  FORWARD:   0x04,
  PING:      0x05,
  RENEW:     0x06,
  RENEWR:    0x07,
  NOTIFY:    0x08,
  NOTIFYR:   0x09,
  KILL:      0x0A,
  KILLR:     0x0B,
  REJECT:    0x0C,
  MAX:       0x0C,
};
Object.freeze(control);

/**
 * Reject codes.
 * @namespace
 */
const reject = {
  UNKNOWN:   0x00,
  BUSY:      0x01,
  VERSION:   0x02,
  UNSAFE:    0x03,
  INVALID:   0x04,
  VIOLATE:   0x05,
  USER:      0x06,
  ERROR:     0x07,
};
Object.freeze(reject);

/**
 * Default values.
 * @namespace
 */
const defaults = {
  PORT: 42443, /* Encrypted connection. */
  PORT_ANY: 42442, /* Encrypted connection without encrypted OPEN. */
  PORT_MEH: 42080, /* Unencrypted connection. Meh. */
};
Object.freeze(defaults);

/**
 * Create a timestamp from the bytes.
 * @return {Long} Time in Unix epock milliseconds.
 * TODO return error if doesn't pass lint check/validation.
 */
function mkTime(buf) {
  return Long.fromBytesBE(buf);
}

/**
 * Create the current time.
 * @return {Long} Time in Unix epoch milliseconds.
 */
function mkTimeNow() {
  const time = Date.now();
  return Long.fromNumber(time, true);
}

// TODO yes, I know, I need to address the Int part if all numbers are actually positive

function lenVarInt(n) {
  let octets = 0;

  do {
    octets += 1;
    n >>= 7;
  } while (n);

  return octets;
}

// TODO document
function serializeVarInt(n, msg, off, maxOctets) {
  if (n < 0 || n >= (1 << (maxOctets * 7))) {
    return 0;
  }

  let octet = 0;
  let octets = 0;

  do {
    if (octets >= maxOctets) {
      return 0;
    }

    octet = n & 0x7F;
    if (n >= 128) {
      octet = octet | 0x80;
    }
    msg[off + octets] = octet;

    n >>= 7;
    ++octets;
  } while (n);

  return octets;
}

// TODO document
function parseVarInt(msg, off, maxOctets) {
  let len = 0;
  let octet = 0;
  let octets = 0;
  do {
    octet = msg[off + octets];
    len ^= (octet & 0x7F) << (7 * octets);
    ++octets;
    --maxOctets;
  } while ((octet & 0x80) && maxOctets);

  if (octet & 0x80) {
    return { len: -1, octets: 0 };
  }

  return { len, octets };
}

/**
 * Calculate the length of the prefix.
 */
function lenPrefix() {
  trace();

  const l = length;

  return l.PREFIX;
}

/**
 * Encode prefix.
 */
function addPrefix(buf, encrypted, c, id, sequence) {
  trace();

  const l = length;

  let offset = 0;
  if (encrypted) {
    buf[0] = c | control.ENCRYPTED;
  }
  else {
    buf[0] = c;
  }
  offset += l.CONTROL;

  buf.writeUInt32BE(id, offset);
  offset += l.ID;
  buf.writeUInt32BE(sequence, offset);
  offset += l.SEQUENCE;

  return offset;
}

function unPrefix(buf) {
  const o = offset;

  const pre = {};
  pre.encrypted = !!(buf[o.CONTROL] & 0x80);
  pre.control = buf[o.CONTROL] & 0x7F;
  pre.id = buf.readUInt32BE(o.ID);
  pre.seq = buf.readUInt32BE(o.SEQUENCE);

  return pre;
}

/**
 * @return {number} Zero on failure; length written otherwise.
 */
function mkReject(buf, time, rejectCode, rejectMessage) {
  if (buf.length < length.REJECT_DATA) {
    return 0;
  }

  let offset = 0;
  buf.writeUInt32BE(time.getHighBitsUnsigned(), offset);
  offset += length.TIMESTAMP/2;
  buf.writeUInt32BE(time.getLowBitsUnsigned(), offset);
  offset += length.TIMESTAMP/2;
  buf.writeUInt16BE(rejectCode, offset);
  offset += length.REJECT_CODE;

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
  if (buf.length < length.REJECT_DATA) {
    return 0;
  }

  let offset = 0;
  out.time = Long.fromBytesBE(buf.slice(0, length.TIMESTAMP));
  offset += length.TIMESTAMP;

  out.code = buf.readUInt16BE(offset);
  if (out.code < reject.UNKNOWN || out.code > reject.ERROR) {
    return false;
  }
  offset += length.REJECT_CODE;

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

function lenOpen(routingLen) {
  trace();

  const l = length;

  const unencrypted = l.VERSION + lenVarInt(routingLen) + routingLen;
  const encrypted = l.SEAL_PADDING + l.OPEN_DATA + l.SIGN_PADDING;

  return lenPrefix() + unencrypted + encrypted;
}

/**
 * Encode unencrypted open information.
 */
function mkOpen(openKey, ver, routing, id, time, selfNonce, selfKey, currency, rate, streams, messages, signKey) {
  trace();

  const l = length;

  const routingLen = routing ? routing.length : 0;

  const bufLen = lenOpen(routingLen);
  const buf = Buffer.allocUnsafe(bufLen);
  let len = 0;

  /* Write unencrypted portion of data to the buffer. */

  let preLen = addPrefix(buf, !!openKey, control.OPEN, 0, 0);
  if (!preLen) {
    warn('Invalid prefix length');
    return null;
  }
  
  len += preLen;

  buf.writeUInt16BE(ver, len);
  len += l.VERSION;

  if (routing && routing.length) {
    const rOctets = serializeVarInt(routing.length, buf, len, 4);
    if (!rOctets) {
      return 0;
    }
    len += rOctets;
    routing.copy(buf, len, 0, routing.length);
    len += routing.length;
  }
  else {
    buf[len] = 0;
    len += 1;
  }

  /* Unencrypted data has been written. Write encrypted to tmp. */
  const tmp = Buffer.allocUnsafe(l.OPEN_DATA);
  let tlen = 0;

  /* Hash unencrypted data to help ensure it wasn't tampered with. */
  const hash = crypto.mkHash(buf.slice(0, len));
  hash.copy(tmp, 0, 0, l.HASH);
  tlen += l.HASH;

  tmp.writeUInt32BE(id, tlen);
  tlen += l.ID;
  Buffer.from(time.toBytesBE()).copy(tmp, tlen, 0, l.TIMESTAMP);
  tlen += l.TIMESTAMP;
  /*
  tmp.writeUInt32BE(time.getHighBitsUnsigned(), tlen);
  tlen += l.TIMESTAMP/2;
  buf.writeUInt32BE(time.getLowBitsUnsigned(), tlen);
  tlen += l.TIMESTAMP/2;
  */

  selfNonce.copy(tmp, tlen, 0, length.NONCE);
  tlen += l.NONCE;
  selfKey.copy(tmp, tlen, 0, length.PUBLIC_KEY);
  tlen += l.PUBLIC_KEY;

  tmp.writeUInt32BE(currency, tlen);
  tlen += l.CURRENCY;
  tmp.writeUInt32BE(rate, tlen);
  tlen += l.RATE;
  tmp.writeUInt32BE(streams, tlen);
  tlen += l.STREAMS;
  tmp.writeUInt32BE(messages, tlen);
  tlen += l.MESSAGE;

  if (openKey) {
    if (!crypto.seal(buf.slice(len), tmp.slice(0, tlen), openKey)) {
      warn('Unable to seal OPEN.');
      return null;
    }
  }
  else {
    tmp.copy(buf, len, 0, tlen);
  }

  const signOffset = len + l.OPEN_DATA + l.SEAL_PADDING;
  if (signKey) {
    if (!crypto.sign(buf.slice(signOffset), buf.slice(0, signOffset), signKey)) {
      warn('Unable to sign OPEN.');
      return null;
    }
  }
  else {
    /* Zero fill the signature section. */
    buf.fill(0, signOffset);
  }

  return buf;
}

function unOpen(buf, publicKey, secretKey) {
  const l = length;

  let len = l.PREFIX;
  const open = {};
  open.version = buf.readUInt16BE(len);
  len += l.VERSION;
  const { len: routeLen, octets } = parseVarInt(buf, len, 4);
  len += octets;

  if ((len + routeLen) > buf.length) {
    warn('Invalid OPEN segment length.');
    return null;
  }

  open.route = buf.slice(len, routeLen);
  len += routeLen;

  open.signatureBuffer = buf.slice(0, buf.length - l.SIGN_PADDING);
  open.signature = buf.slice(buf.length - l.SIGN_PADDING);

  /* Check route length's validity. */
  if ((l.OPEN_DATA + l.SEAL_PADDING + l.SIGN_PADDING) !== (buf.length - len)) {
    warn('Invalid OPEN length.');
    return null;
  }

  const m = Buffer.allocUnsafe(l.OPEN_DATA);

  if (!crypto.unseal(m, buf.slice(len, buf.length - l.SIGN_PADDING), publicKey, secretKey)) {
    warn('Unable to unseal OPEN.');
    return null;
  }

  /*
   * TODO lint key and nonce
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
  */

  const hash = m.slice(0, l.HASH);
  if (!crypto.verifyHash(buf.slice(0, len), hash)) {
    warn('Bad hash for OPEN!');
    return null;
  }

  let off = l.HASH;
  open.id = m.readUInt32BE(off);
  off += l.ID;
  open.time = mkTime(m.slice(off, l.TIMESTAMP));
  off += l.TIMESTAMP;
  open.nonce = Buffer.allocUnsafeSlow(l.NONCE);
  m.copy(open.nonce, 0, off, off + l.NONCE);
  off += l.NONCE;
  open.key = Buffer.allocUnsafeSlow(l.PUBLIC_KEY);
  m.copy(open.key, 0, off, off + l.PUBLIC_KEY);
  off += l.PUBLIC_KEY;
  open.currency = m.readUInt32BE(off);
  off += l.CURRENCY;
  open.rate = m.readUInt32BE(off);
  off += l.RATE;
  open.maxStreams = m.readUInt32BE(off);
  off += l.STREAMS;
  open.maxMessage = m.readUInt32BE(off);
  off += l.MESSAGE;

  open.segment = buf;

  return open;
}

/**
 * @return Length of the challenge segment buffer.
 */
function lenChallenge() {
  trace();

  const l = length;

  const encrypted = l.SEAL_PADDING + l.CHALLENGE_DATA + l.SIGN_PADDING;

  return lenPrefix() + encrypted;
}

function mkChallenge(peerId, seq, peerKey, id, time, selfNonce, selfKey, currency, rate, streams, messages, openBuf, signKey) {
  trace();

  const l = length;
  warn('Signing with:', signKey);

  const bufLen = lenChallenge();
  const buf = Buffer.allocUnsafe(bufLen);
  let len = 0;

  /* Write unencrypted portion of data to the buffer. */

  let preLen = addPrefix(buf, !!peerKey, control.CHALLENGE, peerId, seq);
  if (!preLen) {
    warn('Invalid prefix length for CHALLENGE.');
    return null;
  }
  
  len += preLen;

  /* Unencrypted data has been written. Write encrypted to tmp. */
  const tmp = Buffer.allocUnsafe(l.CHALLENGE_DATA);
  let tlen = 0;

  /* Hash unencrypted data to help ensure it wasn't tampered with. */
  const hash = crypto.mkHash(buf.slice(0, len));
  hash.copy(tmp, 0, 0, l.HASH);
  tlen += l.HASH;

  tmp.writeUInt32BE(id, tlen);
  tlen += l.ID;
  Buffer.from(time.toBytesBE()).copy(tmp, tlen, 0, l.TIMESTAMP);
  tlen += l.TIMESTAMP;
  /*
  tmp.writeUInt32BE(time.getHighBitsUnsigned(), tlen);
  tlen += l.TIMESTAMP/2;
  buf.writeUInt32BE(time.getLowBitsUnsigned(), tlen);
  tlen += l.TIMESTAMP/2;
  */

  selfNonce.copy(tmp, tlen, 0, l.NONCE);
  tlen += l.NONCE;
  selfKey.copy(tmp, tlen, 0, l.PUBLIC_KEY);
  tlen += l.PUBLIC_KEY;

  tmp.writeUInt32BE(currency, tlen);
  tlen += l.CURRENCY;
  tmp.writeUInt32BE(rate, tlen);
  tlen += l.RATE;
  tmp.writeUInt32BE(streams, tlen);
  tlen += l.STREAMS;
  tmp.writeUInt32BE(messages, tlen);
  tlen += l.MESSAGE;

  if (peerKey) {
    if (!crypto.seal(buf.slice(len), tmp.slice(0, tlen), peerKey)) {
      warn('Could not seal CHALLENGE.');
      return null;
    }
  }
  else {
    tmp.copy(buf, len, 0, tlen);
  }

  const signOffset = len + l.CHALLENGE_DATA + l.SEAL_PADDING;
  if (signKey) {
    warn('Buf:', buf.slice(0, signOffset));
    warn('Buf:', buf.slice(signOffset));
    const signBuf = Buffer.allocUnsafe(openBuf.length + signOffset);
    openBuf.copy(signBuf, 0, 0, openBuf.length);
    buf.copy(signBuf, openBuf.length, 0, signOffset);
    warn('Signlen!', signBuf.length);
    warn('Signthis!', signBuf);
    if (!crypto.sign(buf.slice(signOffset), signBuf, signKey)) {
      warn('Unable to sign CHALLENGE.');
      return null;
    }
    warn('Buf:', buf.slice(signOffset));
  }
  else {
    /* Zero fill the signature section. */
    buf.fill(0, signOffset);
  }

  return buf;
}

function unChallenge(buf, publicKey, secretKey) {
  const l = length;

  let len = l.PREFIX;
  const chal = {};

  chal.signatureBuffer = buf.slice(0, buf.length - l.SIGN_PADDING);
  chal.signature = buf.slice(buf.length - l.SIGN_PADDING);

  /* Check route length's validity. */
  if ((l.CHALLENGE_DATA + l.SEAL_PADDING + l.SIGN_PADDING) !== (buf.length - len)) {
    warn('Invalid length for CHALLENGE segment.');
    return null;
  }

  const m = Buffer.allocUnsafe(l.OPEN_DATA);

  if (!crypto.unseal(m, buf.slice(len, buf.length - l.SIGN_PADDING), publicKey, secretKey)) {
    warn('Invalid encryption for CHALLENGE.');
    return null;
  }

  /*
   * TODO
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
  */

  const hash = m.slice(0, l.HASH);
  if (!crypto.verifyHash(buf.slice(0, len), hash)) {
    warn('Bad hash!');
    return null;
  }

  let off = l.HASH;
  chal.id = m.readUInt32BE(off);
  off += l.ID;
  chal.time = mkTime(m.slice(off, l.TIMESTAMP));
  off += l.TIMESTAMP;
  chal.nonce = Buffer.allocUnsafeSlow(l.NONCE);
  m.copy(chal.nonce, 0, off, off + l.NONCE);
  off += l.NONCE;
  chal.key = Buffer.allocUnsafeSlow(l.PUBLIC_KEY);
  m.copy(chal.key, 0, off, off + l.PUBLIC_KEY);
  off += l.PUBLIC_KEY;
  chal.currency = m.readUInt32BE(off);
  off += l.CURRENCY;
  chal.rate = m.readUInt32BE(off);
  off += l.RATE;
  chal.maxStreams = m.readUInt32BE(off);
  off += l.STREAMS;
  chal.maxMessage = m.readUInt32BE(off);
  off += l.MESSAGE;

  return chal;
}

/*
 * TODO I think these can be removed...
function mkResponse(buf, timestamp, nonce) {
  if (buf.length !== length.ACCEPT_DATA) {
    return 0;
  }

  let offset = 0;
  buf.writeUInt32BE(timestamp.getHighBitsUnsigned(), offset);
  offset += length.TIMESTAMP/2;
  buf.writeUInt32BE(timestamp.getLowBitsUnsigned(), offset);
  offset += length.TIMESTAMP/2;
  nonce.copy(buf, offset, 0, length.NONCE);
  offset += length.NONCE;

  return offset;
}

function unResponse(out, buf) {
  if (buf.length !== length.ACCEPT_DATA) {
    return false;
  }

  let offset = 0;
  out.timestamp = Long.fromBytesBE(buf.slice(offset, offset + length.TIMESTAMP));
  offset += length.TIMESTAMP;
  out.nonce = buf.slice(offset, offset + length.NONCE);

  return true;
}
*/

function lenPing() {
  trace();

  const l = length;

  return l.PREFIX + l.BOX_PADDING + l.PING_DATA;
}

function mkPing(peerId, seq, selfNonce, peerPublicKey, selfSecretKey, rand, time, rtt, sent, recv) {
  trace();

  debug(arguments);

  const l = length;

  const bufLen = lenPing();
  const buf = Buffer.allocUnsafe(bufLen);

  let len = 0;

  /* Write unencrypted portion of data to the buffer. */

  let preLen = addPrefix(buf, !!peerPublicKey, control.PING, peerId, seq);
  if (!preLen) {
    warn('Invalid prefix length for PING.');
    return null;
  }

  len += preLen;

  /* Write to tmp. */
  const tmp = Buffer.allocUnsafe(l.PING_DATA);
  let tlen = 0;

  /* Write ping body. */
  rand.copy(tmp, tlen, 0, l.RANDOM);
  tlen += l.NONCE;
  warn(Buffer.from(time.toBytesBE()));
  Buffer.from(time.toBytesBE()).copy(tmp, tlen, 0, l.TIMESTAMP);
  tlen += l.TIMESTAMP;
  /*
  tmp.writeUInt32BE(time.getHighBitsUnsigned(), tlen);
  tlen += l.TIMESTAMP/2;
  buf.writeUInt32BE(time.getLowBitsUnsigned(), tlen);
  tlen += l.TIMESTAMP/2;
  */
  buf.writeUInt32BE(rtt, tlen);
  tlen += l.RTT;
  buf.writeUInt32BE(sent, tlen);
  tlen += l.SENT;
  buf.writeUInt32BE(recv, tlen);
  tlen += l.RECV;

  if (peerPublicKey) {
    if (!crypto.box(buf.slice(len), tmp.slice(0, tlen), selfNonce, peerPublicKey, selfSecretKey)) {
      warn('Could not box PING.');
      return null;
    }
  }
  else {
    tmp.copy(buf, len, 0, tlen);
  }

  return buf;
}

function unPing(buf, nonce, publicKey, secretKey) {
  const l = length;

  let len = l.PREFIX;
  const out = {};

  if ((l.PING_DATA + l.BOX_PADDING) !== (buf.length - len)) {
    warn('Invalid length for PING segment.');
    return null;
  }

  const m = Buffer.allocUnsafe(l.PING_DATA);

  if (!crypto.unbox(m, buf.slice(len), nonce, publicKey, secretKey)) {
    warn('Invalid encryption for PING.');
    return null;
  }

  let off = 0;
  out.random = Buffer.from(m.slice(off, off + l.RANDOM));
  off += l.RANDOM;
  out.time = Long.fromBytesBE(m.slice(off, off + l.TIMESTAMP));
  off += l.TIMESTAMP;
  out.rtt = m.readUInt32BE(off);
  off += l.RTT;
  out.sent = m.readUInt32BE(off);
  off += l.SENT;
  out.recv = m.readUInt32BE(off);
  off += l.RECV;

  return out;
}

/**
 * Golden ratio for exponential backoff.
 */
const RATIO = 1.61803398875;

module.exports = {
  version,
  timeout,
  length,
  offset,
  limit,
  control,
  reject,
  defaults,
  mkTimeNow,
  lenVarInt,
  serializeVarInt,
  parseVarInt,
  lenPrefix,
  lenOpen,
  addPrefix,
  unPrefix,
  mkReject,
  unReject,
  mkOpen,
  unOpen,
  mkChallenge,
  unChallenge,
  mkPing,
  unPing,
  RATIO,
};

