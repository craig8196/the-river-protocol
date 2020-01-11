/**
 * @file Test the cryptography library for basic encryption/decryption.
 */
const crypto = require('./crypto.js');
'use strict';


describe('crypto id', () => {
  test('is id', () => {
    const id = crypto.mkId();
    const maxValue = Math.pow(2, 32) - 1;
    expect(typeof id === 'number').toBeTruthy();
    expect(id <= maxValue).toBeTruthy();
  });
});


describe('crypto nonce', () => {
  test('is nonce', () => {
    let nonce = crypto.mkNonce();
    expect(nonce.length).toEqual(crypto.NONCE_BYTES);
  });
});

describe('crypto seal', () => {
  test('is sealed', () => {
    let { publicKey, secretKey } = crypto.mkKeyPair();
    let text = 'Hello world!';
    let m1 = Buffer.from(text, 'utf8');
    let e1 = Buffer.alloc(m1.length + crypto.SEAL_MAC_BYTES);

    expect(crypto.seal(e1, m1, publicKey)).toBeTruthy();

    let m2 = Buffer.alloc(m1.length);
    expect(crypto.unseal(m2, e1, publicKey, secretKey)).toBeTruthy();

    expect(m1).toEqual(m2);
  });
});

describe('crypto box', () => {
  test('is boxed', () => {
    let { publicKey, secretKey } = crypto.mkKeyPair();
    let nonce = crypto.mkNonce();

    let server = crypto.mkKeyPair();
    let serverNonce = crypto.mkNonce();

    let text = 'The quick brown fox ran over the turtle.';

    let m1 = Buffer.from(text, 'utf8');
    let e1 = Buffer.alloc(m1.length + crypto.BOX_MAC_BYTES);
    let m2 = Buffer.alloc(m1.length);

    expect(crypto.box(e1, m1, nonce, server.publicKey, secretKey)).toBeTruthy();
    expect(crypto.unbox(m2, e1, nonce, publicKey, server.secretKey)).toBeTruthy();
    expect(m1).toEqual(m2);

    e1.fill(0);
    m2.fill(0);
    expect(crypto.box(e1, m1, serverNonce, publicKey, server.secretKey));
    expect(crypto.unbox(m2, e1, serverNonce, server.publicKey, secretKey));
    expect(m1).toEqual(m2);
  });

  test('cannot unbox', () => {
    let alice = crypto.mkKeyPair();
    alice.nonce = crypto.mkNonce();

    let bob = crypto.mkKeyPair();
    bob.nonce = crypto.mkNonce();
    
    let chuck = crypto.mkKeyPair();
    chuck.nonce = crypto.mkNonce();

    let text = 'The quick brown fox ran over the turtle.';

    let m1 = Buffer.from(text, 'utf8');
    let e1 = Buffer.alloc(m1.length + crypto.BOX_MAC_BYTES);
    let m2 = Buffer.alloc(m1.length);

    expect(crypto.box(e1, m1, chuck.nonce, bob.publicKey, chuck.secretKey)).toBeTruthy();
    expect(!crypto.unbox(m2, e1, chuck.nonce, alice.publicKey, bob.secretKey)).toBeTruthy();
    expect(!crypto.unbox(m2, e1, alice.nonce, chuck.publicKey, bob.secretKey)).toBeTruthy();
    expect(!crypto.unbox(m2, e1, bob.nonce, chuck.publicKey, bob.secretKey)).toBeTruthy();
    expect(crypto.unbox(m2, e1, chuck.nonce, chuck.publicKey, bob.secretKey)).toBeTruthy();
  });
});

describe('crypto hash', () => {
  test('can hash and unhash', () => {
    const r1 = crypto.mkNonce();
    const r2 = crypto.mkNonce();
    expect(r1.compare(r2) !== 0).toBeTruthy();

    const hash1 = crypto.mkHash(r1);
    expect(r1.compare(hash1) !== 0).toBeTruthy();

    const hash2 = crypto.mkHash(r2);
    expect(r2.compare(hash2) !== 0).toBeTruthy();

    expect(hash1.compare(hash2) !== 0).toBeTruthy();

    expect(!crypto.verifyHash(r1, hash2)).toBeTruthy();
    expect(!crypto.verifyHash(r2, hash1)).toBeTruthy();
    expect(crypto.verifyHash(r1, hash1)).toBeTruthy();
    expect(crypto.verifyHash(r2, hash2)).toBeTruthy();
  });
});

describe('crypto sign', () => {
  test('can sign', () => {
    const text = 'knock tock';
    const m = Buffer.from(text, 'utf8');
    const k = crypto.mkSignPair();
    const sig = Buffer.allocUnsafe(crypto.SIGN_MAC_BYTES);

    expect(crypto.sign(sig, m, k.secretKey)).toBeTruthy();
    expect(crypto.unsign(sig, m, k.publicKey)).toBeTruthy();
  });
});

