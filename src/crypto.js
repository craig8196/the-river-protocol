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
const log = require('./log.js');
'use strict';


/**
 * Create a random identifier that fits in UInt32 space.
 * @return {Number} Random number.
 */
function mkId() {
  return sodium.randombytes_random();
  /*
  if (!buf || buf.length < 4) {
    buf = Buffer.allocUnsafe(4);
  }

  sodium.randombytes_buf(buf);

  return buf.readUInt32LE(0);
  */
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

  return { publicKey, secretKey };
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
    log.warn('Failed to box message:', err);
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
    log.warn('Failed to seal message:', err);
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

const NO_NONCE = Buffer.allocUnsafeSlow(NONCE_BYTES).fill(0);
const NO_KEY = Buffer.allocUnsafeSlow(PUBLIC_KEY_BYTES).fill(0);


// TODO yeah, probably should use crypto_sign for this task...
// crypto_sign_detached...
const HLEN = sodium.crypto_generichash_BYTES_MIN;
const KLEN = sodium.crypto_generichash_KEYBYTES_MIN;
const HASH_BYTES = HLEN + KLEN;

/**
 * Hash the data and store hash and anything necessary to validate in mac.
 * @param {Buffer} message - What to hash.
 * @return {Buffer} Message hash data needed to validate the message.
 */
function mkHash(message) {
  const hash = Buffer.allocUnsafe(HASH_BYTES);
  const h = hash.slice(0, HLEN);
  const k = hash.slice(HLEN);
  h.fill(0);
  sodium.randombytes_buf(k);
  sodium.crypto_generichash(h, message, k);
  return hash;
}

/**
 * Verify that hashing the message results in the same hash.
 * @param {Buffer} message - Message to validate.
 * @param {Buffer} hash - The hash to validate against. Must be HASH_BYTES long.
 * @return {boolean} True on success; false otherwise.
 */
function verifyHash(message, hash) {
  const test = Buffer.allocUnsafe(HLEN);
  test.fill(0);
  const h = hash.slice(0, HLEN);
  const k = hash.slice(HLEN);
  sodium.crypto_generichash(test, message, k);
  return 0 === test.compare(h);
}

const SEED_BYTES = sodium.crypto_sign_SEEDBYTES;
const SIGN_MAC_BYTES = sodium.crypto_sign_BYTES;
const SIGN_PUBLIC_BYTES = sodium.crypto_sign_PUBLICKEYBYTES;
const SIGN_SECRET_BYTES = sodium.crypto_sign_SECRETKEYBYTES;

/**
 * Create a key pair for signing messages.
 * @return {Object} Has publicKey {Buffer} and secretKey {Buffer}.
 */
function mkSignPair(seed) {
  const publicKey = Buffer.allocUnsafeSlow(SIGN_PUBLIC_BYTES);
  const secretKey = Buffer.allocUnsafeSlow(SIGN_SECRET_BYTES);
  if (!seed || seed.length !== SEED_BYTES) {
    sodium.crypto_sign_keypair(publicKey, secretKey);
  }
  else {
    sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed);
  }
  return { publicKey, secretKey };
}

/**
 * Sign the message.
 * @param {Buffer} signature - Where to put the signature.
 * @param {Buffer} message - What to sign.
 * @param {Buffer} secretKey - What to sign with.
 * @return {Buffer} Signature.
 */
function sign(signature, message, secretKey) {
  try {
    sodium.crypto_sign_detached(signature, message, secretKey);
    return true;
  }
  catch (err) {
    log.warn('Failed to sign message:', err);
    return false;
  }
}

/**
 * Verify the message was signed by other party.
 * @return True on successfully verifying signature; false otherwise.
 */
function unsign(signature, message, publicKey) {
  return sodium.crypto_sign_verify_detached(signature, message, publicKey);
}

module.exports = {
  mkId,

  NO_NONCE,
  NONCE_BYTES,
  mkNonce,

  NO_KEY,
  PUBLIC_KEY_BYTES,
  mkKeyPair,

  BOX_MAC_BYTES,
  box,
  unbox,

  SEAL_MAC_BYTES,
  seal,
  unseal,

  HASH_BYTES,
  mkHash,
  verifyHash,

  SIGN_MAC_BYTES,
  SEED_BYTES,
  SIGN_PUBLIC_BYTES,
  mkSignPair,
  sign,
  unsign,
};

