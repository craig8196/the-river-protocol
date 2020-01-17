/**
 * @file Stream management code.
 * @author Craig Jacobson.
 */
/* Core */
const stream = require('stream');
/* Community */
/* Custom */
const { trace } = require('./log.js');
// None yet.
'use strict';


class WritableStream extends stream.Writable {

  constructor(conn, options) {
    super({
      highWaterMark: conn._maxMessage,
    });

    trace();

    this._conn = conn;
    this._id = options.id;
    this._reliable = options.reliable;
    this._ordered = options.ordered;
    this._autoChunk = options.autoChunk;
    this._realTime = options.realTime;
  }

  /**
   * Called internally by stream.Writable.
   * @private
   * @param {Buffer} chunk - The binary chunk to send as a message.
   */
  _write(chunk, encoding, callback) {
    trace();

    if (chunk instanceof Buffer) {
      if (!this._conn._streamSend(this._id, chunk, callback)) {
        callback(new Error('Connection invalid.'));
      }
    }
    else {
      callback(new Error('Not an instance of Buffer.'));
    }
  }

  /**
   * Close resources. Wrap up loose ends.
   */
  _final(callback) {
    this._conn._streamClose(this._id);
    callback();
  }

  /**
   * Check if the given chunk is short enough.
   */
  validLength(chunk) {
    if (chunk.length <= this._conn.umtu) {
      return true;
    }

    return false;
  }
}

class ReadableStream extends stream.Readable {

  constructor(conn, options) {
    super({
      highWaterMark: conn._maxMessage,
    });

    trace();

    this._conn = conn;
    this._id = options.id;
    this._reliable = options.reliable;
    this._ordered = options.ordered;
  }

  /**
   * Called when consumer is ready for data.
   * Note that stream.push() is used to push data to the user.
   * If this function ever returns false, then backpressure should be flagged.
   * Once the consumer is ready for data the _read function is called again.
   */
  _read(/* size */) {
    this._conn._streamReady(this._id);
  }
}

module.exports = {
  WritableStream,
  ReadableStream,
};

