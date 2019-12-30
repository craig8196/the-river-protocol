
/**
 * @file Test the parsing routines.
 */
const { serializeVarInt, parseVarInt } = require('./parse.js');

describe('parse', () => {
  test('is 0 serializable', () => {
    let n = 0;
    let buflen = 1;
    let buf = Buffer.allocUnsafe(buflen);
    buf.fill(0);
    let octets = serializeVarInt(n, buf, 0, buflen);
    expect(octets).toBeTruthy();
    expect(buf[0]).toEqual(0);

    let r = parseVarInt(buf, 0, buflen);
    expect(r.len).toEqual(n);
    expect(r.octets).toEqual(buflen);
  });
  test('is -1 not serializable', () => {
    let n = -1;
    let buflen = 1;
    let buf = Buffer.allocUnsafe(buflen);
    buf.fill(0);
    let octets = serializeVarInt(n, buf, 0, buflen);
    expect(octets).toBeFalsy();
    expect(buf[0]).toEqual(0);
  });
  test('is 1 serializable', () => {
    let n = 1;
    let buflen = 1;
    let buf = Buffer.allocUnsafe(buflen);
    buf.fill(0);
    let octets = serializeVarInt(n, buf, 0, buflen);
    expect(octets).toBeTruthy();
    expect(buf[0]).toEqual(1);

    let r = parseVarInt(buf, 0, buflen);
    expect(r.len).toEqual(n);
    expect(r.octets).toEqual(buflen);
  });
  test('is 128 serializable', () => {
    let n = 128;
    let buflen = 1;
    let buf = Buffer.allocUnsafe(buflen);
    buf.fill(0);
    let octets = serializeVarInt(n, buf, 0, buflen);
    expect(octets).toBeFalsy();
    expect(buf[0]).toEqual(0);
  });
  test('is 128 serializable now', () => {
    let n = 128;
    let buflen = 2;
    let buf = Buffer.allocUnsafe(buflen);
    buf.fill(0);
    let octets = serializeVarInt(n, buf, 0, buflen);
    expect(octets).toBeTruthy();
    expect(buf[0]).toEqual(0x80);
    expect(buf[1]).toEqual(0x01);

    let r = parseVarInt(buf, 0, buflen);
    expect(r.len).toEqual(n);
    expect(r.octets).toEqual(buflen);
    r = parseVarInt(buf, 0, buflen - 1);
    expect(r.len).toEqual(-1);
  });
  test('is 65535 serializable', () => {
    let n = 65535;
    let buflen = 3;
    let buf = Buffer.allocUnsafe(buflen);
    buf.fill(0);
    let octets = serializeVarInt(n, buf, 0, buflen);
    expect(octets).toBeTruthy();
    expect(buf[0]).toEqual(0xFF);
    expect(buf[1]).toEqual(0xFF);
    expect(buf[2]).toEqual(0x03);

    let r = parseVarInt(buf, 0, buflen);
    expect(r.len).toEqual(n);
    expect(r.octets).toEqual(buflen);
  });
});

