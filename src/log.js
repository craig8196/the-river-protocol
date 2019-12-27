/**
 * @file Logging functions for debugging.
 * @author Craig Jacobson
 */
/* Core */
const process = require('process');
/* Community */
/* Custom */
'use strict';

function getDate() {
  return new Date().toUTCString();
}

function getLine(errStack) {
  try {
    return errStack.stack.split('at ')[2].trim();
  }
  catch (err) {
    return 'no details';
  }
}

function normalize(args) {
  let msg = '';

  for (let i = 0; i < args.length; ++i) {
    if (i) {
      msg += ' ';
    }

    const arg = args[i];
    if (!arg) {
      msg += '';
    }
    else if (typeof arg === 'string') {
      msg += arg;
    }
    else if ((arg.stack && arg.message) || (arg instanceof Error)) {
      msg += getLine(arg) + ' -> ' + String(arg);
    }
    else {
      msg += JSON.stringify(arg);
    }
  }

  return msg;
}

function trace() {
  console.log('TRACE', getDate(), getLine(new Error()), normalize(arguments));
}

function debug() {
  console.log('DEBUG', getDate(), getLine(new Error()), normalize(arguments));
}

function info() {
  console.log('INFO_', getDate(), getLine(new Error()), normalize(arguments));
}

function warn() {
  console.log('WARN!', getDate(), getLine(new Error()), normalize(arguments));
}

function crit() {
  console.log('CRIT!', getDate(), getLine(new Error()), normalize(arguments));
  process.exit(1);
}

module.exports = {
  trace,
  debug,
  info,
  warn,
  crit,
};

