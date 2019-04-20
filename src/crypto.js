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
 * Create a random identifier that fits in UInt32 space.
 * @param {Buffer} buf - Optional. Buffer to store random bytes until they are read.
 * @return {Number} Random number.
 */
function mkId(buf) {
  if (!buf || buf.length < 4) {
    buf = Buffer.allocUnsafe(4);
  }

  sodium.randombytes_buf(buf);

  return buf.readUInt32LE(0);
}

const NONCE_BYTES = sodium.crypto_secretbox_NONCEBYTES;

/**
 * Create nonsense to aid in encryption. Must be known to both parties.
 * @param {Buffer} buf - Optional. Recycled buffer to fill.
 * @return {Buffer} Nonsense.
 */
function mkNonce(buf) {
  if (!buf || buf.length < NONCE_BYTES) {
    buf = Buffer.allocUnsafeSlow(NONCE_BYTES);
  }

  sodium.randombytes_buf(buf);

  return buf;
}

const PUBLIC_KEY_BYTES = sodium.crypto_box_PUBLICKEYBYTES;
const SECRET_KEY_BYTES = sodium.crypto_box_SECRETKEYBYTES;

/**
 * Create keys for asymetric encryption. Only expose your public key.
 * @param {Buffer} publicKey - Optional. Recycled buffer to fill.
 * @param {Buffer} secretKey - Optional. Recycled buffer to fill.
 * @return {Object} Has publicKey {Buffer} and secretKey {Buffer}.
 */
function mkKeyPair(publicKey, secretKey) {
  if (!publicKey || publicKey.length < PUBLIC_KEY_BYTES) {
    publicKey = Buffer.allocUnsafeSlow(PUBLIC_KEY_BYTES);
  }

  if (!secretKey || secretKey.length < SECRET_KEY_BYTES) {
    secretKey = Buffer.allocUnsafeSlow(SECRET_KEY_BYTES);
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
 * @param {Buffer} emessage - Output. Encrypted message output buffer.
 * @param {Buffer} message - Message to encrypt.
 * @param {Buffer} nonce - Random nonce variable, must be same as when decrypted.
 * @param {Buffer} publicKey - Public key of the decrypting party.
 * @param {Buffer} secretKey - Secret key of the encrypting party.
 * @return {Bool} True on success; false otherwise.
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
 * @param {Buffer} message - Output. Decrypted message.
 * @param {Buffer} emessage - Message to decrypt.
 * @param {Buffer} nonce - Random nonce variable, must be same as when encrypted.
 * @param {Buffer} publicKey - Public key of the encrypting party.
 * @param {Buffer} secretKey - Secret key of the decrypting party.
 * @return {Bool} True on success; false otherwise.
 */
function unbox(message, emessage, nonce, publicKey, secretKey) {
  return sodium.crypto_box_open_easy(message, emessage, nonce, publicKey, secretKey);
}

const SEAL_MAC_BYTES = sodium.crypto_box_SEALBYTES;

/**
 * Encrypt the message.
 * @param {Buffer} emessage - Output. Encrypted message.
 * @param {Buffer} message - Message to encrypt.
 * @param {Buffer} publicKey - Key to use to encrypt.
 * @return {Bool} True on success; false otherwise.
 */
function seal(emessage, message, publicKey) {
  try {
    sodium.crypto_box_seal(emessage, message, publicKey);
    return true;
  }
  catch (err) {
    return false;
  }
}

/**
 * Decrypt the message.
 * @param {Buffer} emessage - Output. Encrypted message.
 * @param {Buffer} message - Message to encrypt.
 * @param {Buffer} publicKey - Key used to encrypt.
 * @param {Buffer} secretKey - Key to use to decrypt.
 * @return {Bool} True on success; false otherwise.
 */
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

