/**
 * @file Connection management code.
 * @author Craig Jacobson
 *
 * TODO use allocUnsafeSlow for longer lived values
 * TODO move spec specific things to spec file
 * TODO rename spec.js to protocol.js???
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
/* Custom */
const crypto = require('./crypto.js');
const { trace, info, warn, crit } = require('./log.js');
const p = require('./protocol.js');
const { SenderInterface } = require('./socket.js');
const { version, timeout, length, limit, control/*, reject*/ } = p;
'use strict';


class Event extends Enum {}
Event.initEnum([
  'OPEN',
  'OPEN_RECV',
  'OPEN_TIMEOUT',
  'OPEN_ERROR',
  'CHALLENGE_RECV',
  'CHALLENGE_TIMEOUT',
  'CHALLENGE_ERROR',
  'PING',
  'PING_TIMEOUT',
  'PING_ERROR',
  'STREAM_RECV',
  'REJECT_RECV',
  'DISCONNECT',
]);

class State extends Enum {}
State.initEnum({
  'START': {
    enter() {
    },

    transition(e, data) {
      switch (e) {
        case Event.OPEN:
          return State.OPEN;
        case Event.OPEN_RECV:
          this._setPeer(data);
          return State.CHALLENGE;
        default:
          this.emit('error', new Error('Expected OPEN* events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'OPEN': {
    enter() {
      if (!this._selfKeys && this._allowUnsafePacket) {
        this._selfKeys = crypto.mkKeyPair();
        this._selfNonce = crypto.mkNonce();
      }
      this._startOpenAlgorithm();
    },

    transition(e) {
      switch (e) {
        case Event.OPEN_TIMEOUT:
          return State.ERROR;
        case Event.CHALLENGE_RECV:
          return State.PING;
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
      this._stopOpenAlgorithm();
    },
  },

  'CHALLENGE': {
    enter() {
      this._startChallengeAlgorithm();
    },

    transition(e, data) {
      switch (e) {
        case Event.PING:
          this._setPeerPing(data);
          this._sendPing();
          return State.READY;
        case Event.OPEN_RECV:
          /* Update the peer data incase peer changed certain parameters. */
          this._setPeer(data);
          return State.CHALLENGE;
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
      this._stopChallengeAlgorithm();
    },
  },

  'PING': {
    enter() {
      this._startPingAlgorithm();
    },

    transition(e) {
      switch (e) {
        case Event.PING:
          return State.READY_PING;
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
      this._stopPingAlgorithm();
    },
  },

  'READY': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'DISCONNECT_SOFT': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'DISCONNECT_HARD': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'DISCONNECT_ERROR': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'END': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'ERROR': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected TODO events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },
});

// TODO make sure that streams obey pipe semantics
// TODO add mkStream method on connection
// TODO add hasStream method to determine if an ID is taken
// TODO add getStreamId for random, or next, stream ID
class Connection extends EventEmitter {

  /**
   * Construct Connection object from valid socket and options.
   * @private
   * @param {SenderInterface} sender - Required. For communication.
   * @param {object} options - Required. See mkConnection for details.
   */
  constructor(id, sender, options) {
    super();

    trace();

    // TODO move all settings to mkConnection

    this._id = id;
    this._sender = sender;
    this._streams = new Map();

    /*
    // TODO verify how these need to be organized
    this.data = null;

    this.buffers = [];
    this.bufferKeep = 0;

    this.minmtu = length.UDP_MTU_DATA_MIN;
    this.effmtu = length.UDP_MTU_DATA_REC;
    this.maxmtu = length.UDP_MTU_DATA_MAX;

    this.sequenceWindow = length.WINDOW;

    this.rttTotal = timeouts.RTT;
    this.rttCount = 1;

    this._peerMinSeq = -1;
    this._peerMidSeq = -1;
    this._peerMaxSeq = -1;
    */

    this._allowUnsafePacket = options.allowUnsafePacket;
    this._openKey = options.openKey;
    this._peerKey = null;
    this._selfKeys = options.keys;
    this._peerNonce = null;
    this._selfNonce = options.nonce;

    // TODO implement bitmap
    this._peerSequenceMap = {};

    this._rttMs = timeout.RTT;

    // TODO make sure these are checked on making
    this._maxCurrency = limit.CURRENCY;
    this._regenCurrency = limit.CURRENCY_REGEN;
    this._maxStreams = limit.STREAMS;
    this._maxMessage = limit.MESSAGE;

    this._curCurrency = this._maxCurrency;
    this._curStreams = this._maxStreams;

    this._sequence = 0;

    this._timestamp = p.mkTimeNow();

    // TODO determine better default timeout?
    this._openMaxTimeout = 60000; /* 1 minute */
    this._challengeMaxTimeout = 15000; /* 15 seconds */
    this._pingMaxTimeout = 20000; /* 20 seconds */

    this._internalState = State.START;
    this._internalState.enter();

    // TODO
    //this._flagPeerSequence(0);
  }

  /**
   * Get the internal state.
   * @private
   * @return {State}
   */
  get _state() {
    return this._internalState;
  }

  /**
   * Set the internal state with appropriate events emitted as needed.
   * @private
   * @param {State} newState - The state to setup with. No-op if same state.
   */
  set _state(newState) {
    if (this._internalState !== newState) {
      this._internalState.exit.call(this);
      this._internalState = newState;
      this._internalState.enter.call(this);
    }
    else {
      /* Transitioning to same state doesn't change anything. */
    }
  }

  /**
   * Perform the transition and change states as needed.
   * @private
   */
  _transition(eventType, eventData) {
    info('State:', this._internalState.name, '|Transition:', eventType.name);

    this._state = this._state.transition.call(this, eventType, eventData);
  }

  /**
   * @private
   * @return The next sequence number.
   */
  get _sequence() {
    return this._internalSequence++;
  }

  /**
   * Set the sequence. Usually when initializing.
   * @private
   */
  set _sequence(val) {
    this._internalSequence = val;
  }

  /**
   * @private
   */
  _checkSequence(seq) {
    trace();

    if (seq in this._peerSequenceMap) {
      return false;
    }

    return true;
  }

  /**
   * @private
   */
  _flagSequence(seq) {
    trace();

    // TODO implement functionality
    this._peerSequenceMap[seq] = true;
    // this._peerSequenceMap.add(seq);
  }
  
  /**
   * Set the peer data.
   * @private
   * TODO validate for malicious changes, can be recalled...
   */
  _setPeer(data) {
    trace();

    this._peerId = data.id;
    this._peerKey = data.key;
    this._peerNonce = data.nonce;
    this._peerTimestamp = data.timestamp;
    this._peerVersion = data.version;
    this._peerMaxCurrency = data.maxCurrency;
    this._peerMaxStreams = data.maxStreams;
    this._peerMaxMessage = data.maxMessage;
  }

  /**
   * Set the peer data from a ping.
   * @private
   */
  _setPeerPing(/*data*/) {
    trace();

    //TODO
  }

  /**
   * Start the open connection handshake.
   * @private
   */
  _startRetryAlgorithm(handleName, actionCb, timeoutCb, errorCb, rttMs, maxTimeMs) {
    trace();

    const conn = this;

    function _retry(counter, timeoutMs, totalTimeMs) {
      trace('Retry args [counter, timeoutMs, totalTimesMs', arguments);

      totalTimeMs += timeoutMs;
      if (totalTimeMs > maxTimeMs) {
        timeoutCb();
        return;
      }

      counter++;

      if (counter === 3) {
        counter = 0;
        timeoutMs *= p.RATIO;
      }

      if (actionCb()) {
        if (!timeoutMs) {
          timeoutMs = rttMs;
        }

        conn[handleName] =
          setTimeout(_retry, timeoutMs, counter, timeoutMs, totalTimeMs);
      }
      else {
        errorCb();
      }
    }

    _retry(0, 0, 0);
  }

  /**
   * Stop the open connection.
   */
  _stopRetryAlgorithm(handleName) {
    trace();

    if (handleName in this) {
      clearTimeout(this[handleName]);
    }
  }

  /**
   * Start the open connection handshake.
   * @private
   */
  _startOpenAlgorithm() {
    trace();

    const conn = this;
    const handle = '_timeoutOpenHandle';

    function actionCb() {
      return conn._sendOpen();
    }

    function timeoutCb() {
      warn('OPEN message timed out.');
      conn._transition(Event.OPEN_TIMEOUT);
    }

    function errorCb() {
      warn('Unable to create/send OPEN message.');
      conn._stopOpenAlgorithm();
      conn._transition(Event.OPEN_ERROR);
    }

    const rtt = this._rttMs;
    const limit = this._openMaxTimeout;

    this._startRetryAlgorithm(handle, actionCb, timeoutCb, errorCb, rtt, limit);
  }

  /**
   * Stop the open connection.
   * @private
   */
  _stopOpenAlgorithm() {
    trace();

    this._stopRetryAlgorithm('_timeoutOpenHandle');
  }

  /**
   * Start the connection challenge.
   * @private
   */
  _startChallengeAlgorithm() {
    trace();

    const conn = this;
    const handle = '_timeoutChallengeHandle';

    function actionCb() {
      return conn._sendChallenge();
    }

    function timeoutCb() {
      warn('CHALLENGE message timed out.');
      conn._transition(Event.CHALLENGE_TIMEOUT);
    }

    function errorCb() {
      warn('Unable to create/send CHALLENGE message.');
      conn._stopChallengeAlgorithm();
      conn._transition(Event.CHALLENGE_ERROR);
    }

    const rtt = this._rttMs;
    const limit = this._challengeMaxTimeout;

    this._startRetryAlgorithm(handle, actionCb, timeoutCb, errorCb, rtt, limit);
  }

  /**
   * Stop the connection challenge.
   * @private
   */
  _stopChallengeAlgorithm() {
    trace();

    this._stopRetryAlgorithm('_timeoutChallengeHandle');
  }

  /**
   * Start the ping.
   * @private
   */
  _startPingAlgorithm() {
    trace();

    const conn = this;
    const handle = '_timeoutPingHandle';

    function actionCb() {
      return conn._sendPing();
    }

    function timeoutCb() {
      warn('PING message timed out.');
      conn._transition(Event.PING_TIMEOUT);
    }

    function errorCb() {
      warn('Unable to create/send PING message.');
      conn._stopPingAlgorithm();
      conn._transition(Event.PING_ERROR);
    }

    const rtt = this._rttMs;
    const limit = this._pingMaxTimeout;

    this._startRetryAlgorithm(handle, actionCb, timeoutCb, errorCb, rtt, limit);
  }

  /**
   * Stop the ping.
   * @private
   */
  _stopPingAlgorithm() {
    trace();

    this._stopRetryAlgorithm('_timeoutPingHandle');
  }

  /**
   * Send any data.
   * @private
   */
  _sendData() {
    //TODO
  }

  /**
   * Create and send the open packet.
   * @private
   */
  _sendOpen() {
    trace();

    const buf = p.mkOpen(
      this._openKey,
      version,
      null,
      this._id,
      this._timestamp,
      this._selfNonce,
      this._selfKeys.publicKey,
      this._maxCurrency,
      this._regenCurrency,
      this._maxStreams,
      this._maxMessage,
    );

    if (!buf) {
      return false;
    }

    this._sender.send(buf);

    return true;
  }

  /**
   * Create and send the challenge packet.
   * @private.
   */
  _sendChallenge() {
    trace();

    const buf = p.mkChallenge(
      this._peerId,
      this._sequence,
      this._peerKey,
      this._id,
      this._timestamp,
      this._selfNonce,
      this._selfKeys.publicKey,
      this._maxCurrency,
      this._regenCurrency,
      this._maxStreams,
      this._maxMessage,
    );

    if (!buf) {
      return false;
    }

    this._sender.send(buf);

    return true;
  }

  /**
   * Send a ping.
   * @private
   */
  _sendPing() {
    trace();

    const buf = p.mkPing(
      //TODO
    );

    if (!buf) {
      return false;
    }

    this._sender.send(buf);

    return true;
  }

  /**
   * Send a request to renew sequence numbers, nonce, and keys.
   * @private
   */
  _sendRenew() {
    // TODO
  }

  /**
   * Send a request to renew sequence numbers, nonce, and keys.
   * @private
   */
  _sendNotify() {
    // TODO
  }

  /**
   * Notify disconnect.
   * @private
   */
  _sendNotifyConfirm() {
    // TODO
  }

  /**
   * Send a request to renew sequence numbers, nonce, and keys.
   * @private
   */
  _sendDisconnect() {
    // TODO
  }

  /**
   * Confirm disconnect.
   * @private
   */
  _sendDisconnectConfirm() {
    // TODO
  }

  /**
   * Send reject message.
   * @private
   */
  _sendReject() {
    // TODO
  }

  /**
   * Any value less than or equal to is guaranteed single packet delivery.
   * @return {number} The user MTU.
   */
  get umtu() {
    if (this.encrypted) {
      return this.effmtu - length.PREFIX - length.BOX_PADDING - length.STREAM_DATA;
    }
    else {
      return this.effmtu - length.PREFIX - length.STREAM_DATA;
    }
  }

  /**
   * This is the maximum message unit/size, in bytes, for a stream.
   * @return {number} The user MMU.
   */
  get ummu() {
    return this.umtu * length.MAX_FRAGMENT;
  }

  /**
   * Open this connection. The handshake process will begin.
   */
  open() {
    this._transition(Event.OPEN);
  }

  /**
   * Close this connection. Peer and streams will be notified.
   */
  close() {
    this._transition(Event.NOTIFY);
  }

  /**
   * Kill the connection. The connection object will be kept for a time.
   */
  kill() {
    this._transition(Event.KILL);
  }

  /**
   * Update the sender. Useful if you are using DDNS.
   */
  setSender(sender) {
    this._sender = sender;
  }

  /**
   * Handle open message data. Unpacked by router.
   */
  handleOpen(pre, open) {
    if (!this._checkSequence(pre.seq)) {
      /* Sequence already seen. May be a replay attack. */
      return;
    }
    this._transition(Event.OPEN_RECV, open);
    this._flagSequence(pre.seq);
  }

  /**
   * Handle the incoming raw data.
   */
  handleSegment(pre, seg) {
    if (!this._checkSequence(pre.seq)) {
      /* Sequence already seen. May be a replay attack. */
      return;
    }

    switch (pre.control) {
      case control.CHALLENGE:
        {
          let data = this.unChallenge(
            seg.slice(),
            this._selfKeys.publicKey,
            this._selfKeys.secretKey
          );
          if (!data) {
            /* Invalid payload/decryption. */
            return;
          }
          this._transition(Event.CHALLENGE_RECV, data);
        }
        break;
      default:
        crit('Unimplemented segment.');
        break;
    }

    this._flagSequence(pre.seq);
  }
}

/**
 * Create a Connection.
 * @param {number} id - Required. Positive ID value.
 * @param {SenderInterface} sender - Required. Valid socket sender type.
 * @param {object} [options] - Options object.
 * @param {Buffer} [options.openKey] - Valid binary key.
 * @param {boolean} [options.allowUnsafePacket=false] - Allow unencrypted traffic.
 * @param {object} keys - Valid keys from crypto.
 * @param {Buffer} nonce - Valid nonce from crypto.
 * @return {Connection}
 */
function mkConnection(id, sender, options) {
  if (!id) {
    throw new Error('Invalid ID.');
  }

  if (!(sender instanceof SenderInterface)) {
    throw new Error('Invalid sender type.');
  }

  if (!options) {
    options = {};
  }

  options.openKey =
    'openKey' in options ? options.openKey : null;
  options.allowUnsafePacket =
    'allowUnsafePacket' in options ? (!!options.allowUnsafePacket) : false;

  if (!options.allowUnsafePacket) {
    options.keys = crypto.mkKeyPair();
    options.nonce = crypto.mkNonce();
  }
  else {
    options.keys = null;
    options.nonce = null;
  }

  return new Connection(id, sender, options);
}

module.exports = {
  mkConnection,
};

