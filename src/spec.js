/**
 * @file Specification values, masks, lengths, etc.
 */
/* Core */
/* Community */
/* Custom */
const crypto = require('./crypto.js');
'use strict';


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
  EPADDING: crypto.BOX_MAC_BYTES,
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
  MASK:      0x07,
  ENCRYPTED: 0x80,

  PACKET:    0x00,
  OPEN:      0x01,
  REJECT:    0x02,
  CHALLENGE: 0x03,
  ACCEPT:    0x04,
};

control.isValidControl = (c) => {
  let valid = false;

  switch (c & control.MASK) {
    case control.PACKET:
      valid = true;
      break;
    case control.OPEN:
      valid = true;
      break;
    case control.REJECT:
      valid = true;
      break;
    case control.CHALLENGE:
      valid = true;
      break;
    case control.ACCEPT:
      valid = true;
      break;
    default:
      break;
  }

  return valid;
};

control.isValidPacket = (c, len, isServer, allowUnsafeConnect, allowUnsafeMessage) => {
  let valid = false;
  const encrypted = c & control.ENCRYPTED;

  switch (c & control.MASK) {
    case control.PACKET:
      valid = ((len >= lengths.PACKET_MIN))
              && (encrypted || (!encrypted && allowUnsafeMessage));
      break;
    case control.OPEN:
      valid = ((encrypted && len === lengths.OPEN_ENCRYPT)
              || (!encrypted && len === lengths.OPEN_DECRYPT))
              && isServer
              && (encrypted || (!encrypted && allowUnsafeConnect));
      break;
    case control.REJECT:
      valid = ((encrypted && len === lengths.REJECT_ENCRYPT)
              || (!encrypted && len === lengths.REJECT_DECRYPT))
              && (encrypted || (!encrypted && allowUnsafeMessage));
      break;
    case control.CHALLENGE:
      valid = ((encrypted && len === lengths.CHALLENGE_ENCRYPT)
              || (!encrypted && len === lengths.CHALLENGE_DECRYPT))
              && (encrypted || (!encrypted && allowUnsafeMessage));
      break;
    case control.ACCEPT:
      valid = ((encrypted && len === lengths.ACCEPT_ENCRYPT)
              || (!encrypted && len === lengths.ACCEPT_DECRYPT))
              && isServer
              && (encrypted || (!encrypted && allowUnsafeMessage));
      break;
    default:
      break;
  }

  return valid;
};

function isOpen(buf) {
  return (buf.length === lengths.OPEN
          && isValidControl(buf[0]));
}

function mkOpen(bufout, key) {
  bufout[0] = control.OPEN;
  key.copy(bufout, 1, 0, lengths.KEY);
}

function unOpen(out, pkt, publicKey, secretKey) {
  // Decrypt, if needed
  let buf = pkt.slice(lengths.CONTROL);
  if (pkt[0] & control.ENCRYPTED) {
    let tmpbuf = Buffer.allocUnsafe(lengths.OPEN_DECRYPT);
    if (!crypto.unseal(tmpbuf, buf, publicKey, secretKey)) {
      return false;
    }
    buf = tmpbuf;
  }

  // Unpack
  let offset = 0;
  const id = Buffer.readUInt32BE(offset);
  offset += lengths.ID;
  const version = Buffer.readUInt16BE(offset);
  offset += lengths.VERSION;
  const nonce = Buffer.allocUnsafe(lengths.NONCE);
  buf.copy(nonce, 0, offset, offset + lengths.NONCE);
  offset += lengths.NONCE;
  const publicKey = Buffer.allocUnsafe(lengths.PUBLIC_KEY);
  buf.copy(publicKey, 0, offset, offset + lengths.PUBLIC_KEY);

  out.id = id;
  out.version = version;
  out.nonce = nonce;
  out.publicKey = publicKey;

  return true;
}

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
  timeouts,
  lengths,
  control,
};

