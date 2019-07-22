/**
 * @file Stream management code.
 * @author Craig Jacobson.
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
/* Custom */
// None yet.

class State extends Enum {}
State.initEnum([
  'CREATE',
  'OPEN',
  'BACKPRESS',
  'CLOSE'
]);

class Stream extends EventEmitter {
}

module.exports = Stream;

