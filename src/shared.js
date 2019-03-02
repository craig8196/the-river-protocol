/**
 * @file Miscellaneous code to share between different modules.
 * @author Craig Jacobson
 */
/* Core */
/* Community */
const Long = require('long');
/* Custom */
'use strict';


/**
 * Create the current time.
 * @return {Long} Time in Unix epoch milliseconds.
 */
function mkTimeNow() {
  const timestamp = Date.now();
  return Long.fromNumber(timestamp, true);
}

module.exports = {
  mkTimeNow,
};

