/**
 * @file Logging functions for debugging.
 * @author Craig Jacobson
 */
/* Core */
/* Community */
/* Custom */


const debug = function(msg) {
  if (!msg) {
    msg = '';
  }
  const logLineDetails = (new Error().stack).split('at ')[3].trim();
  console.log('DEBUG', new Date().toUTCString(), logLineDetails, msg);
};

const trace = function(msg) {
  if (!msg) {
    msg = '';
  }
  const logLineDetails = (new Error().stack).split('at ')[3].trim();
  console.log('TRACE', new Date().toUTCString(), logLineDetails, msg);
};

module.exports = {
  debug,
  trace,
};

