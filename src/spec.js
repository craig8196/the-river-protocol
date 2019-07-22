/**
 * @file Specification values.
 * @author Craig Jacobson
 */
/* Core */
/* Community */
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
const timeouts = {
  PING_MIN:         15 * 1000,
  PING_REC:         20 * 1000,
  PING_MAX:         60 * 60 * 1000,
  DEFAULT_GRACE:    500,
  /* Round-trip Time */
  RTT:              500,
};

/**
 * Lengths of certain fields in octets.
 * @namespace
 */
const lengths = {
  CONTROL: 1,
  ID: 4,
  SEQUENCE: 4,

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
  STREAMS: 4,
  MESSAGES: 4,
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
lengths.UDP_MTU_DATA_MIN = lengths.UDP_MTU_MIN - lengths.IP_HEADER - lengths.UDP_HEADER;
lengths.UDP_MTU_DATA_REC = lengths.UDP_MTU_REC - lengths.IP_HEADER - lengths.UDP_HEADER;
lengths.UDP_MTU_DATA_MAX = lengths.UDP_MTU_MAX - lengths.IP_HEADER - lengths.UDP_HEADER;
/* Required prefix of every packet. */
lengths.PREFIX = lengths.CONTROL + lengths.ID + lengths.SEQUENCE;
/* OPEN packet lengths. */
lengths.OPEN_DATA = lengths.ID + lengths.TIMESTAMP + lengths.VERSION
                    + lengths.NONCE + lengths.PUBLIC_KEY;
lengths.OPEN_DECRYPT = lengths.PREFIX + lengths.OPEN_DATA;
lengths.OPEN_ENCRYPT = lengths.OPEN_DECRYPT + lengths.SEAL_PADDING;
/* REJECT packet lengths. */
lengths.REJECT_DATA = lengths.TIMESTAMP + lengths.REJECT_CODE + 1;
lengths.REJECT_DECRYPT = lengths.PREFIX + lengths.REJECT_DATA;
lengths.REJECT_ENCRYPT = lengths.REJECT_DECRYPT + lengths.SEAL_PADDING;

/**
 * Default limits.
 * @namespace
 */
const limits = {
  STREAMS: 1,
  CURRENCY: 256,
  MESSAGES: 65535,
};

/**
 * Control values to identify different messages.
 * @namespace
 */
const control = {
  MASK:      0x7F,
  ENCRYPTED: 0x80,
  BYTE_MASK: 0x0FF,

  STREAM:    0x00,
  OPEN:      0x01,
  REJECT:    0x02,
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

Object.freeze(timeouts);
Object.freeze(lengths);
Object.freeze(limits);
Object.freeze(control);
Object.freeze(reject);
module.exports = {
  version,
  timeouts,
  lengths,
  limits,
  control,
  reject,
};

