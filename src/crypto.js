/**
 * @file Wraps encryption library so future changes, if needed, are easier.
 * @author Craig Jacobson
 *
 * NaCL uses libsodium under the hood.
 */
/* Core */
/* Community */
const sodium = require('sodium-native');
/* Custom */
'use strict';


/**
 * Create a random identifier.
 * @return A value that can fit in an UInt32 space.
 */
function mkId(buf) {
  if (!buf) {
    buf = Buffer.allocUnsafe(4);
  }

  sodium.randombytes_buf(buf)

  return buf.readUInt32LE(0);
}

const NONCE_BYTES = sodium.crypto_secretbox_NONCEBYTES;

/**
 * Create nonsense to aid in encryption. Must be known to both parties.
 * @return {Buffer} Nonsense array.
 */
function mkNonce(buf) {
  if (!buf) {
    buf = Buffer.allocUnsafe(sodium.crypto_secretbox_NONCEBYTES);
  }
  else if (buf.length < sodium.crypto_secretbox_NONCEBYTES) {
    return null;
  }

  sodium.randombytes_buf(buf);

  return buf;
}

const PUBLIC_KEY_BYTES = sodium.crypto_box_PUBLICKEYBYTES;

/**
 * Create keys for asymetric encryption. Only expose your public key.
 * @return {Object} Has publicKey {Buffer} and secretKey {Buffer}.
 */
function mkKeyPair(publicKey, secretKey) {
  if (!publicKey) {
    publicKey = Buffer.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES);
  }
  else if (publicKey.length < sodium.crypto_box_PUBLICKEYBYTES) {
    return null;
  }

  if (!secretKey) {
    secretKey = Buffer.allocUnsafe(sodium.crypto_box_SECRETKEYBYTES);
  }
  else if (secretKey.length < sodium.crypto_box_SECRETKEYBYTES) {
    return null;
  }

  sodium.crypto_box_keypair(publicKey, secretKey);

  return {
    publicKey,
    secretKey,
  };
}

const BOX_MAC_BYTES = sodium.crypto_box_MACBYTES;

/**
 * Encrypt a message for a specific person.
 * @param {Buffer} emessage - Encrypted message output buffer.
 * @param {Buffer} message - Message to encrypt.
 * @param {Buffer} nonce - Random nonce variable, must be same as when decrypted.
 * @param {Buffer} publicKey - Public key of the decrypting party.
 * @param {Buffer} secretKey - Secret key of the encrypting party.
 * @return {Buffer} Encrypted message.
 */
function box(emessage, message, nonce, publicKey, secretKey) {
  try {
    sodium.crypto_box_easy(emessage, message, nonce, publicKey, secretKey);
    return true;
  }
  catch (err) {
    return false;
  }
}

/**
 * Decrypt a message from a specific person.
 * @param {Buffer} emessage - Encrypted message.
 * @param {Buffer} nonce - Random nonce variable, must be same as when encrypted.
 * @param {Buffer} publicKey - Public key of the encrypting party.
 * @param {Buffer} secretKey - Secret key of the decrypting party.
 * @return {Buffer} Decrypted message.
 */
function unbox(message, emessage, nonce, publicKey, secretKey) {
  return sodium.crypto_box_open_easy(message, emessage, nonce, publicKey, secretKey);
}

const SEAL_MAC_BYTES = sodium.crypto_box_SEALBYTES;

function seal(emessage, message, publicKey) {
  try {
    sodium.crypto_box_seal(emessage, message, publicKey);
    return true;
  }
  catch (err) {
    return false;
  }
}

function unseal(message, emessage, publicKey, secretKey) {
  return sodium.crypto_box_seal_open(message, emessage, publicKey, secretKey);
}

module.exports = {
  mkId,
  mkNonce,
  mkKeyPair,
  box,
  unbox,
  seal,
  unseal,
  NONCE_BYTES,
  PUBLIC_KEY_BYTES,
  BOX_MAC_BYTES,
  SEAL_MAC_BYTES,
};

