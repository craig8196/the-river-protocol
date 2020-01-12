/**
 * @file Logging functions for debugging.
 * @author Craig Jacobson
 */
/* Core */
const process = require('process');
/* Community */
const { Enum } = require('enumify');
/* Custom */
'use strict';


class Level extends Enum {}
Level.initEnum([
  'DEBUG',
  'INFO',
  'WARN',
  'CRIT',
]);

const LOGON = true;
const LEVEL = Level.DEBUG;
const TRACEON = LOGON;

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

function getLine1(errStack) {
  try {
    return errStack.stack.split('at ')[1].trim();
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
    if (typeof arg === 'string') {
      msg += arg;
    }
    else if (arg instanceof Buffer) {
      msg += arg.toString('hex');
    }
    else if (arg && ((arg.stack && arg.message) || (arg instanceof Error))) {
      msg += getLine1(arg) + ' -> ' + String(arg);
    }
    else {
      msg += JSON.stringify(arg);
    }
  }

  return msg;
}

function trace() {
  if (LOGON && TRACEON) {
    console.log('TRACE', getDate(), getLine(new Error()), normalize(arguments));
  }
}

function debug() {
  if (LOGON && LEVEL <= Level.DEBUG) {
    console.log('DEBUG', getDate(), getLine(new Error()), normalize(arguments));
  }
}

function info() {
  if (LOGON && LEVEL <= Level.INFO) {
    console.log('INFO_', getDate(), getLine(new Error()), normalize(arguments));
  }
}

function warn() {
  if (LOGON && LEVEL <= Level.WARN) {
    console.log('WARN!', getDate(), getLine(new Error()), normalize(arguments));
  }
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

