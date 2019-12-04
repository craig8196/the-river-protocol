/**
 * @file Logging functions for debugging.
 * @author Craig Jacobson
 */
/* Core */
/* Community */
/* Custom */


const trace = function(msg) {
  if (!msg) {
    msg = '';
  }
  const logLineDetails = (new Error().stack).split('at ')[3].trim();
  console.log('TRACE', new Date().toUTCString(), logLineDetails, msg);
};

module.exports = {
  trace,
};

