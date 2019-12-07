/**
 * @file Parsing utilities.
 * @author Craig Jacobson
 */
/* Core */
/* Community */
/* Custom */
'use strict';

function parseVarLength(msg, off, maxOctets) {
  let len = 0;
  let octet = 0;
  let plus = 0;
  do {
    octet = msg[off + plus];
    len <<= 7;
    len += octet & 0x7F;
    ++plus;
    --maxOctets;
  } while ((octet & 0x80) && maxOctets);

  if (octet & 0x80) {
    return { routeLength: -1, routeLengthOctets: plus };
  }

  return { routeLength: len, routeLengthOctets: plus };
}

module.exports = {
  parseVarLength,
};

