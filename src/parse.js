/**
 * @file Parsing utilities.
 * @author Craig Jacobson
 */
/* Core */
/* Community */
/* Custom */
'use strict';


// TODO yes, I know, I need to address the Int part if all numbers are actually positive

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

module.exports = {
  serializeVarInt,
  parseVarInt,
};

