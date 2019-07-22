/**
 * @file Test the cryptography library for basic encryption/decryption.
 */
const crypto = require('./crypto.js');


describe('crypto', () => {
  test('is id', () => {
    const id = crypto.mkId();
    const maxValue = Math.pow(2, 32) - 1;
    expect(typeof id === 'number').toBeTruthy();
    expect(id <= maxValue).toBeTruthy();
  });

  test('is nonce', () => {
    let nonce = crypto.mkNonce();
    expect(nonce.length).toEqual(crypto.NONCE_BYTES);
  });

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

