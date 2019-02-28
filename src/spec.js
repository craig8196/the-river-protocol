/**
 * @file Specification values, masks, lengths, etc.
 */
/* Core */
/* Community */
const { Enum } = require('enumify');
const Long = require('long');
/* Custom */
const crypto = require('./crypto.js');
'use strict';


class Trans extends Enum {}
Trans.initEnum([
  // Confluence events
  'START',// Start on client was called
  'STOP',// Stop on client was called

  // Socket events
  'PACKET',// Received a message
  'BIND',// Successful bind/listening on socket
  'CLOSE',// Close socket was received
  'ERROR',// Error on socket

  // Filtered socket messages
  'STREAM',
  'OPEN',
  'REJECT',
  'CHALLENGE',
  'ACCEPT',
  'GARBAGE',
]);

/**
 * Default timeout values.
 */
const timeouts = {
  OPEN: 1,
  OPEN_MAX: 300000,
};

/**
 * Lengths of certain fields in octets.
 */
const lengths = {
  CONTROL: 1,
  NONCE: crypto.NONCE_BYTES,
  PUBLIC_KEY: crypto.PUBLIC_KEY_BYTES,
  SECRET_KEY: crypto.SECRET_KEY_BYTES,
  BOX_PADDING: crypto.BOX_MAC_BYTES,
  SEAL_PADDING: crypto.SEAL_BYTES,
  UUID: 16,
  STREAM: 2,
  CURRENCY: 2,
  /* See article on NodeJS and UDP MTU, and RFC on maximum IP header size. */
  /* Recommended MTU is 576 for IPv4, 60 octet max for IP header size,
   * 8 octet UDP header size.
   */
  IP_HEADER: 60,
  UDP_HEADER: 8,
  MTU_MIN: 68,// Very, small. Our protocol doesn't work with link layers with this restriction.
  MTU_REC: 576,
  MTU_MAX: 1200,
  UINT64: 8,
};
// OPEN
lengths.OPEN_DECRYPT = 0
  + lengths.ID
  + lengths.VERSION
  + lengths.NONCE
  + lengths.PUBLIC_KEY;
lengths.OPEN_ENCRYPT = 0
  + lengths.OPEN_DECRYPT
  + lengths.SEAL_PADDING;
lengths.OPEN_MIN = 0
  + lengths.CONTROL
  + lengths.OPEN_DECRYPT;
lengths.OPEN_MAX = 0
  + lengths.CONTROL
  + lengths.OPEN_ENCRYPT;
// CHALLENGE
lengths.ACK_DECRYPT = 0
  + lengths.CURRENCY
  + lengths.STREAM
  + lengths.UUID
  + lengths.NONCE;
lengths.ACK_ENCRYPT = 0
  + lengths.EPADDING
  + lengths.ACK_DECRYPT;
lengths.ACK = 0
  + lengths.CONTROL
  + lengths.NONCE
  + lengths.KEY
  + lengths.ACK_ENCRYPT;
lengths.MIN_MESSAGE = 17;

/**
 * Control values to identify different messages.
 */
const control = {
  MASK:      0x7F,
  ENCRYPTED: 0x80,

  PACKET:    0x00,
  OPEN:      0x01,
  REJECT:    0x02,
  CHALLENGE: 0x03,
  ACCEPT:    0x04,
};

control.unStream = (out) => {
  return false;
};

control.unOpen = (out, pkt, tmpbuf, publicKey, secretKey) => {
  // Decrypt, if needed
  let buf = pkt.slice(lengths.CONTROL);
  if (pkt[0] & control.ENCRYPTED) {
    if (!tmpbuf) {
      tmpbuf = Buffer.allocUnsafe(lengths.OPEN_DECRYPT);
    }
    if (!crypto.unseal(tmpbuf, buf, publicKey, secretKey)) {
      return false;
    }
    buf = tmpbuf;
  }

  // Unpack
  let offset = 0;
  const id = buf.readUInt32BE(offset);
  offset += lengths.ID;
  const timestamp = Long.fromBytesBE(buf.slice(offset, offset + lengths.UINT64), true);
  offset += lengths.UINT64;
  const version = buf.readUInt16BE(offset);
  offset += lengths.VERSION;
  const nonce = Buffer.allocUnsafe(lengths.NONCE);
  buf.copy(nonce, 0, offset, offset + lengths.NONCE);
  offset += lengths.NONCE;
  const clientPublicKey = Buffer.allocUnsafe(lengths.PUBLIC_KEY);
  buf.copy(clientPublicKey, 0, offset, offset + lengths.PUBLIC_KEY);

  out.id = id;
  out.timestamp = timestamp;
  out.version = version;
  out.nonce = nonce;
  out.publicKey = clientPublicKey;

  return true;
};


control.unReject = (out) => {
  return false;
};

control.unChallenge = (out) => {
  return false;
};

control.unAccept = (out) => {
  return false;
};

control.unPack = (out, con, pkt, rinfo) => {
  let t = Trans.GARBAGE;

  const len = pkt.length;
  if (!len) {
    return t;
  }

  const c = pkt[0];
  const encrypted = c & control.ENCRYPTED;

  switch (c & control.MASK) {
    case control.STREAM:
      if (((len >= lengths.PACKET_MIN))
          && (encrypted || (!encrypted && con.allowUnsafePacket)))
      {
        if (control.unStream()) {
          t = Trans.STREAM;
        }
      }
      break;
    case control.OPEN:
      if (((encrypted && len === lengths.OPEN_ENCRYPT)
          || (!encrypted && len === lengths.OPEN_DECRYPT))
          && con.allowIncoming
          && (encrypted || (!encrypted && con.allowUnsafeConnect)))
      {
        if (control.unOpen()) {
          t = Trans.OPEN;
        }
      }
      break;
    case control.REJECT:
      if (((encrypted && len === lengths.REJECT_ENCRYPT)
          || (!encrypted && len === lengths.REJECT_DECRYPT))
          && (encrypted || (!encrypted && con.allowUnsafePacket)))
      {
        if (control.unReject()) {
          t = Trans.REJECT;
        }
      }
      break;
    case control.CHALLENGE:
      if (((encrypted && len === lengths.CHALLENGE_ENCRYPT)
          || (!encrypted && len === lengths.CHALLENGE_DECRYPT))
          && (encrypted || (!encrypted && con.allowUnsafePacket)))
      {
        if (control.unChallenge()) {
          t = Trans.CHALLENGE;
        }
      }
      break;
    case control.ACCEPT:
      if (((encrypted && len === lengths.ACCEPT_ENCRYPT)
          || (!encrypted && len === lengths.ACCEPT_DECRYPT))
          && con.allowIncoming
          && (encrypted || (!encrypted && con.allowUnsafePacket)))
      {
        if (control.unAccept()) {
          t = Trans.ACCEPT;
        }
      }
      break;
    default:
      break;
  }

  return t;
};

/*
function isAck(buf) {
  return (buf.length === lengths.ACK
          && buf[0] === control.ACK
          && unAck({}, buf));
}

function mkAck(outbuf, key, publicKey, secretKey, maxCurrency, maxStreams, uuid, nonce) {
  outbuf[0] = control.ACK;
  const tmpNonce = crypto.mkNonce();
  tmpNonce.copy(outbuf, lengths.CONTROL, 0, lengths.NONCE);
  key.copy(outbuf, lengths.CONTROL + lengths.NONCE, 0, lengths.KEY);
  const decrypt = Buffer.allocUnsafe(lengths.ACK_DECRYPT);
  const encrypt = Buffer.allocUnsafe(lengths.ACK_ENCRYPT);

  decrypt.writeUInt16BE(maxCurrency, 0);
  decrypt.writeUInt16BE(maxStreams, lengths.CURRENCY);
  uuid.copy(decrypt, lengths.CURRENCY + lengths.STREAM, 0, lengths.UUID);
  nonce.copy(decrypt, lengths.CURRENCY + lengths.STREAM + lengths.UUID, 0, lengths.NONCE);
  crypto.box(encrypt, decrypt, tmpNonce, publicKey, secretKey);
  encrypt.copy(outbuf, lengths.CONTROL + lengths.NONCE + lengths.KEY, 0, lengths.ACK_ENCRYPT);
}

function unAck(out, buf, secretKey) {
  const c = buf[0];
  if (control.ACK !== c) {
    return false;
  }

  let i = lengths.CONTROL;
  const tmpNonce = buf.slice(i, i + lengths.NONCE);
  const serverKey = Buffer.allocUnsafe(lengths.KEY);
  i += lengths.NONCE;
  buf.copy(serverKey, 0, i, i + lengths.KEY);
  i += lengths.KEY;

  const encrypt = buf.slice(i, i + lengths.ACK_ENCRYPT);
  const decrypt = Buffer.allocUnsafe(lengths.ACK_DECRYPT);
  if (!crypto.unbox(decrypt, encrypt, tmpNonce, serverKey, secretKey)) {
    return false;
  }

  i = 0;
  let maxCurrency = decrypt.readUInt16BE(i);
  i += lengths.CURRENCY;
  let maxStreams = decrypt.readUInt16BE(i);
  i += lengths.STREAM;
  const uuid = Buffer.allocUnsafe(lengths.UUID);
  decrypt.copy(uuid, 0, i, i + lengths.UUID);
  i += lengths.UUID;
  const nonce = Buffer.allocUnsafe(lengths.NONCE);
  decrypt.copy(nonce, 0, i, i + lengths.NONCE);
  i += lengths.NONCE;

  out.serverKey = serverKey;
  out.maxCurrency = maxCurrency;
  out.maxStreams = maxStreams;
  out.uuid = uuid;
  out.nonce = nonce;
  return true;
}

function isConfirm(buf) {
  return (buf.length === lengths.CONFIRM
          && buf[0] === control.CONFIRM
          && unConfirm({}, buf));
}

function mkConfirm(outbuf, uuid, publicKey, secretKey, nonce) {
  outbuf[0] = control.CONFIRM;
  let i = lengths.CONTROL;
  uuid.copy(outbuf, i, 0, lengths.UUID);
  i += lengths.UUID;
  const tmpNonce = crypto.mkNonce();
  tmpNonce.copy(outbuf, i, 0, lengths.NONCE);
  i += lengths.NONCE;

  const encrypt = Buffer.allocUnsafe(lengths.CONFIRM_ENCRYPT);
  crypto.box(encrypt, nonce, tmpNonce, publicKey, secretKey);
  encrypt.copy(outbuf, i, 0, lengths.CONFIRM_ENCRYPT);
}

function unConfirm(out, buf) {
  const c = buf[0];
  if (control.CONFIRM !== c) {
    return false;
  }

  let i = lengths.CONTROL;
  const uuid = buf.slice(i, i + lengths.UUID);
  i += lengths.UUID;
  const tmpNonce = buf.slice(i, i + lenghts.NONCE);
  i += lengths.NONCE;
  const encrypt = buf.slice(i, i + lengths.CONFIRM_ENCRYPT);
  const nonce = Buffer.allocUnsafe(lengths.NONCE);

  if (!crypto.unbox(nonce, encrypt, tmpNonce, publicKey, secretKey)) {
    return false;
  }

  out.uuid = uuid;
  out.nonce = nonce;
  return true;
}
*/

module.exports = {
  Trans,
  timeouts,
  lengths,
  control,
};

