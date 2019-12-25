/**
 * @file Logging functions for debugging.
 * @author Craig Jacobson
 */
/* Core */
const process = require('process');
/* Community */
/* Custom */
'use strict';

function getLine(errStack) {
  try {
    return errStack.stack.split('at ')[2].trim();
  }
  catch (err) {
    return 'no details';
  }
}

const trace = function(msg) {
  if (!msg) {
    msg = '';
  }
  console.log('TRACE', new Date().toUTCString(), getLine(new Error()), msg);
};

const debug = function(msg) {
  if (!msg) {
    msg = '';
  }
  console.log('DEBUG', new Date().toUTCString(), getLine(new Error()), msg);
};

const info = function(msg) {
  if (!msg) {
    msg = '';
  }
  console.log('INFO_', new Date().toUTCString(), getLine(new Error()), msg);
};

const warn = function(msg) {
  if (!msg) {
    msg = '';
  }
  console.log('WARN!', new Date().toUTCString(), getLine(new Error()), msg);
};

const crit = function(msg) {
  if (!msg) {
    msg = '';
  }
  console.log('CRIT!', new Date().toUTCString(), getLine(new Error()), msg);
  process.exit(1);
};

module.exports = {
  trace,
  debug,
  info,
  warn,
  crit,
};

