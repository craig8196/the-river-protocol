/**
 * @file Specification values.
 * @author Craig Jacobson
 */
/* Core */
/* Community */
const { Enum } = require('enumify');
/* Custom */
const crypto = require('./crypto.js');
'use strict';


class Trans extends Enum {}
Trans.initEnum([
  // Router/Connection events
  'START',// Start on client was called
  'STOP',// Stop on client was called

  // Socket events
  'PACKET',// Received a message
  'BIND',// Successful bind/listening on socket
  'CLOSE',// Close socket was received
  'ERROR',// Error on socket

  // Filtered messages
  'STREAM',
  'OPEN',
  'REJECT',
  'CHALLENGE',
  'ACCEPT',
  'PING',
  'GARBAGE',
]);

/**
 * Default timeout values in milliseconds.
 */
const timeouts = {
  PING_MIN:     15 * 1000,
  PING_REC:     20 * 1000,
  PING_MAX:     60 * 60 * 1000,
};

/**
 * Lengths of certain fields in octets.
 */
const lengths = {
  CONTROL: 1,
  ID: 4,
  SEQUENCE: 4,

  NONCE: crypto.NONCE_BYTES,
  PUBLIC_KEY: crypto.PUBLIC_KEY_BYTES,
  SECRET_KEY: crypto.SECRET_KEY_BYTES,
  BOX_PADDING: crypto.BOX_MAC_BYTES,
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
  UINT64: 8,
};

/**
 * Control values to identify different messages.
 */
const control = {
  MASK:      0x7F,
  ENCRYPTED: 0x80,

  PACKET:    0x00,
  OPEN:      0x01,
  REJECT:    0x02,
  CHALLENGE: 0x03,
  ACCEPT:    0x04,
  PING:      0x05,
};

module.exports = {
  Trans,
  timeouts,
  lengths,
  control,
};

