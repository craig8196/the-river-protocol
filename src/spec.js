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
 */
const version = 0;

/**
 * Default timeout values in milliseconds.
 */
const timeouts = {
  PING_MIN:     15 * 1000,
  PING_REC:     20 * 1000,
  PING_MAX:     60 * 60 * 1000,
  OPEN_TIMEOUT_REC: 20,
};

/**
 * Lengths of certain fields in octets.
 */
const lengths = {
  CONTROL: 1,
  ID: 4,
  SEQUENCE: 4,

  TIMESTAMP: 8,
  VERSION: 2,

  NONCE: crypto.NONCE_BYTES,
  PUBLIC_KEY: crypto.PUBLIC_KEY_BYTES,
  SECRET_KEY: crypto.SECRET_KEY_BYTES,
  BOX_PADDING: crypto.BOX_MAC_BYTES,
  SEAL_PADDING: crypto.SEAL_BYTES,

  UUID: 16,
  STREAM: 2,
  CURRENCY: 2,
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
};
/* Use these values for determining our own payload size.
 */
lengths.UDP_MTU_DATA_MIN = lengths.UDP_MTU_MIN - lengths.IP_HEADER - lengths.UDP_HEADER;
lengths.UDP_MTU_DATA_REC = lengths.UDP_MTU_REC - lengths.IP_HEADER - lengths.UDP_HEADER;
lengths.UDP_MTU_DATA_MAX = lengths.UDP_MTU_MAX - lengths.IP_HEADER - lengths.UDP_HEADER;

/**
 * Control values to identify different messages.
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
 */
const reject = {
  UNKNOWN:   0x00,
  WHITELIST: 0x01,
  OVERLOAD:  0x02,
  INVALID:   0x03,
  VERSION:   0x04,
  USER:      0x05,
  ERROR:     0x06,
};

Object.freeze(timeouts);
Object.freeze(lengths);
Object.freeze(control);
Object.freeze(reject);
module.exports = {
  version,
  timeouts,
  lengths,
  control,
  reject,
};

