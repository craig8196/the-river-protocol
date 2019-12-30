/**
 * @file Miscellaneous code to share between different modules.
 * @author Craig Jacobson
 */
/* Core */
/* Community */
const Long = require('long');
/* Custom */
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

/**
 * Lengths of certain fields in octets.
 * @namespace
 */
const length = {
  CONTROL: 1,
  ID: 4,
  SEQUENCE: 4,

  HASH: crypto.HASH_BYTES,

  TIMESTAMP: 8,
  VERSION: 2,

  REJECT_CODE: 1,

  NONCE: crypto.NONCE_BYTES,
  PUBLIC_KEY: crypto.PUBLIC_KEY_BYTES,
  SECRET_KEY: crypto.SECRET_KEY_BYTES,
  BOX_PADDING: crypto.BOX_MAC_BYTES,
  SEAL_PADDING: crypto.SEAL_MAC_BYTES,

  UUID: 16,
  CURRENCY: 4,
  RATE: 4,
  STREAMS: 4,
  MESSAGE: 4,
  RTT: 4,
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
/* Required prefix of every packet. */
length.PREFIX = length.CONTROL + length.ID + length.SEQUENCE;
/* OPEN packet length. */
length.OPEN_DATA = length.ID + length.TIMESTAMP + length.VERSION
                    + length.NONCE + length.PUBLIC_KEY;
length.OPEN_DECRYPT = length.PREFIX + length.OPEN_DATA;
length.OPEN_ENCRYPT = length.OPEN_DECRYPT + length.SEAL_PADDING;
/* REJECT packet length. */
length.REJECT_DATA = length.TIMESTAMP + length.REJECT_CODE + 1;
length.REJECT_DECRYPT = length.PREFIX + length.REJECT_DATA;
length.REJECT_ENCRYPT = length.REJECT_DECRYPT + length.SEAL_PADDING;

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

/**
 * Control values to identify different messages.
 * @namespace
 */
const control = {
  MASK:      0x7F,
  ENCRYPTED: 0x080,
  BYTE_MASK: 0x0FF,

  STREAM:    0x00,
  REJECT:    0x02,
  OPEN:      0x01,
  CHALLENGE: 0x03,
  ACCEPT:    0x04,
  PING:      0x05,
};

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

/**
 * Default values.
 * @namespace
 */
const defaults = {
  PORT: 42443, /* Encrypted connection. */
  PORT_ANY: 42442, /* Encrypted connection without encrypted OPEN. */
  PORT_MEH: 42080, /* Unencrypted connection. Meh. */
};

/**
 * Create the current time.
 * @return {Long} Time in Unix epoch milliseconds.
 */
function mkTimeNow() {
  const timestamp = Date.now();
  return Long.fromNumber(timestamp, true);
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
    return { len: -1, octets };
  }

  return { len, octets };
}

Object.freeze(timeout);
Object.freeze(length);
Object.freeze(offset);
Object.freeze(limit);
Object.freeze(control);
Object.freeze(reject);
Object.freeze(defaults);
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
};

