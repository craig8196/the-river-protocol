/**
 * @file Connection management code.
 * @author Craig Jacobson
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
/* Custom */
const crypto = require('./crypto.js');
const { trace, debug, info, warn, crit } = require('./log.js');
const p = require('./protocol.js');
const { SenderInterface } = require('./socket.js');
const { version, timeout, length, limit, control/*, reject*/ } = p;
'use strict';


class Event extends Enum {}
Event.initEnum([
  'OPEN',
  'CHALLENGE',
  'OPEN_RECV',
  'CHALLENGE_RECV',
  'PING_RECV',

  'OPEN_TIMEOUT',
  'OPEN_ERROR',
  'CHALLENGE_TIMEOUT',
  'CHALLENGE_ERROR',
  'FORWARD_RECV',
  'PING_TIMEOUT',
  'PING_ERROR',
  'PING_READY',
  'PING_LATE',
  'RENEW_RECV',
  'RENEW_TIMEOUT',
  'RENEW_ERROR',
  'STREAM_RECV',
  'REJECT_RECV',
  'NOTIFY_RECV',
  'NOTIFY_TIMEOUT',
  'NOTIFY_ERROR',
  'DISCONNECT_RECV',
  'DISCONNECT_TIMEOUT',
  'DISCONNECT_ERROR',
  'KILL',
]);

class State extends Enum {}
State.initEnum({
  'START': {
    enter() {
    },

    transition(e) {
      switch (e) {
        case Event.OPEN:
          return State.OPEN;
        case Event.CHALLENGE:
          return State.CHALLENGE;
        default:
          this.emit('error', new Error('Expected START events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'OPEN': {
    enter() {
      this._isPinger = true;
      if (!this._selfKeys && this._allowUnsafeSegment) {
        this._selfKeys = crypto.mkKeyPair();
        this._selfNonce = crypto.mkNonce();
      }
      this._startOpenAlgorithm();
    },

    transition(e, data) {
      switch (e) {
        case Event.OPEN_TIMEOUT:
          return State.ERROR;
        case Event.CHALLENGE_RECV:
          this._setPeer(data);
          return State.PING;
        default:
          this.emit('error', new Error('Expected OPEN events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
      this._stopOpenAlgorithm();
    },
  },

  'CHALLENGE': {
    enter() {
      //this._startChallengeAlgorithm();
    },

    transition(e, data) {
      switch (e) {
        case Event.PING_RECV:
          if (this._processPeerPing(data)) {
            this._sendPing();
            return State.READY;
          }

          return State.CHALLENGE;
        case Event.OPEN_RECV:
          /* Update the peer data incase peer changed certain parameters. */
          this._setPeer(data);
          if (!this._sendChallenge(data)) {
            return State.ERROR;
          }
          return State.CHALLENGE;
        default:
          this.emit('error', new Error('Expected CHALLENGE events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
      //this._stopChallengeAlgorithm();
    },
  },

  'PING': {
    enter() {
      this._generatePingRand();
      this._startPingAlgorithm();
    },

    transition(e, data) {
      switch (e) {
        case Event.PING_RECV:
          if (this._processPeerPing(data)) {
            return State.READY_PING;
          }
          return State.PING;
        default:
          this.emit('error', new Error('Expected PING events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
      this._stopPingAlgorithm();
    },
  },

  'READY': {
    enter() {
      this._setEstablished();
      this._startReadyAlgorithm();
    },

    transition(e, data) {
      switch (e) {
        case Event.PING_RECV:
          if (this._processPeerPing(data)) {
            this._sendPing();
            this._stopReadyAlgorithm();
            this._startReadyAlgorithm();
          }
          return State.READY;
        default:
          this.emit('error', new Error('Expected READY events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
      this._stopReadyAlgorithm();
    },
  },

  'READY_PING': {
    enter() {
      this._setEstablished();
      this._startReadyPingAlgorithm();
    },

    transition(e) {
      switch (e) {
        case Event.PING_READY:
          return State.PING;
        default:
          this.emit('error', new Error('Expected READY_PING events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
      this._stopReadyPingAlgorithm();
    },
  },

  'NOTIFY': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected NOTIFY events. Found: ' + String(e.name)));
          return State.ERROR;
      }
    },

    exit() {
    },
  },

  'DISCONNECT': {
    enter() {
    },

    transition(e) {
      switch (e) {
        default:
          this.emit('error', new Error('Expected DISCONNECT events. Found: ' + String(e.name)));
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
          this.emit('error', new Error('Expected DISCONNECT_ERROR events. Found: ' + String(e.name)));
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
          this.emit('error', new Error('Expected END events. Found: ' + String(e.name)));
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
          this.emit('error', new Error('Expected ERROR events. Found: ' + String(e.name)));
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
    */

    /* Router configuration. */
    this._allowUnsafeSegment = options.allowUnsafeSegment;
    this._allowUnsafeSign = options.allowUnsafeSign;

    /* Self variables. */
    this._selfKeys = options.keys;
    this._selfNonce = options.nonce;

    /* Peer variables. */
    this._openKey = options.openKey;
    this._signKey = options.signKey;
    this._unsignKey = options.unsignKey;
    this._verifyCb = null;//TODO
    this._peerKey = null;
    this._peerNonce = null;
    // TODO implement bitmap
    this._peerSequenceMap = {};
    this._peerSent = 0;
    this._peerRecv = 0;

    /* Estimated RTT. */
    this._rttMs = timeout.RTT;

    // TODO make sure these are checked on making
    /* Self limits. */
    this._maxCurrency = limit.CURRENCY;
    this._regenCurrency = limit.CURRENCY_REGEN;
    this._maxStreams = limit.STREAMS;
    this._maxMessage = limit.MESSAGE;

    this._curCurrency = this._maxCurrency;
    this._curStreams = this._maxStreams;

    this._sequence = 0;

    this._isEstablished = false;

    this._time = p.mkTimeNow();

    /* Ping variables. */
    this._isPinger = false;
    this._pingRandom = null;
    this._pingTime = null;

    this._sentCount = 0;
    this._recvCount = 0;


    // TODO determine better default timeout?
    this._openMaxTimeout = 60000; /* 1 minute */
    this._challengeMaxTimeout = 15000; /* 15 seconds */
    this._pingMaxTimeout = 5000; /* TODO 20 seconds */

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
   * Flag that the connection has been established.
   * @private
   */
  _setEstablished() {
    this._isEstablished = true;
  }

  /**
   * Check that the sequence value is in range and not received yet.
   * @private
   */
  _checkSequence(seq) {
    trace();

    /* TODO
    if (seq in this._peerSequenceMap) {
      return false;
    }
    */

    return seq >= 0;
  }

  /**
   * Flag that a sequence number has been seen.
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
    this._peerTime = data.time;
    this._peerVersion = data.version;
    this._peerMaxCurrency = data.maxCurrency;
    this._peerMaxStreams = data.maxStreams;
    this._peerMaxMessage = data.maxMessage;
  }

  /**
   * Generate a new ping random ID value.
   */
  _generatePingRand() {
    trace();

    this._pingRandom = crypto.mkNonce();
    this._pingTime = p.mkTimeNow();
  }

  /**
   * Set the peer data from a ping.
   * @private
   * @return True on success; false if bad ping.
   */
  _processPeerPing(data) {
    trace();

    if (this._isPinger) {
      /* If we are pinging we send the random data. */
      if (!data.time.equals(this._pingTime)) {
        return false;
      }

      if (!data.random.equals(this._pingRandom)) {
        return false;
      }

      this._peerSent = data.sent;
      this._peerRecv = data.recv;

      return true;
    }
    else {
      /* If we are returning the ping we just copy the random data. */
      this._pingRandom = data.random;
      this._pingTime = data.time;
      this._peerSent = data.sent;
      this._peerRecv = data.recv;

      return true;
    }
  }

  /**
   * Start the open connection handshake.
   * @private
   */
  _startRetryAlgorithm(handleName, actionCb, timeoutCb, errorCb, rttMs, maxTimeMs) {
    trace();

    const conn = this;

    function _retry(counter, timeoutMs, totalTimeMs) {
      trace('Retry args for', handleName, '[counter, timeoutMs, totalTimesMs', arguments);

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
   * Start the ready algorithm, which involves waiting for a ping.
   * @private
   */
  _startReadyAlgorithm() {
    trace();

    const conn = this;
    const handle = '_timeoutReadyHandle';

    function actionCb() {
      return true;
    }

    function timeoutCb() {
      warn('READY, waiting on PING, timed out.');
      conn._transition(Event.PING_LATE);
    }

    function errorCb() {
      /* Not possible if actionCb always returns true. */
      crit('Not possible to error out on ready algorithm.');
    }

    const rtt = this._pingMaxTimeout * 2;
    const limit = this._pingMaxTimeout * 2;

    this._startRetryAlgorithm(handle, actionCb, timeoutCb, errorCb, rtt, limit);
  }

  /**
   * Stop the ready algorithm.
   * @private
   */
  _stopReadyAlgorithm() {
    trace();

    this._stopRetryAlgorithm('_timeoutReadyHandle');
  }

  /**
   * Start the ready ping algorithm.
   * @private
   */
  _startReadyPingAlgorithm() {
    trace();

    const conn = this;
    const handle = '_timeoutReadyPingHandle';

    function actionCb() {
      return true;
    }

    function timeoutCb() {
      debug('READY PING timed out, time to send ping.');
      conn._transition(Event.PING_READY);
    }

    function errorCb() {
      crit('Not possible to error out on ready ping algorithm.');
    }

    const rtt = this._pingMaxTimeout;
    const limit = this._pingMaxTimeout - 1;

    this._startRetryAlgorithm(handle, actionCb, timeoutCb, errorCb, rtt, limit);
  }

  /**
   * Stop the ready ping algorithm.
   * @private
   */
  _stopReadyPingAlgorithm() {
    trace();

    this._stopRetryAlgorithm('_timeoutReadyPingHandle');
  }

  /**
   * Send any data.
   * @private
   */
  _sendData() {
    //TODO
  }

  /**
   * Create and send the open segment.
   * @private
   */
  _sendOpen() {
    trace();

    if (!this._openBufferSave) {
      const buf = p.mkOpen(
        this._openKey,
        version,
        null,
        this._id,
        this._time,
        this._selfNonce,
        this._selfKeys.publicKey,
        this._maxCurrency,
        this._regenCurrency,
        this._maxStreams,
        this._maxMessage,
        this._signKey,
      );

      if (!buf) {
        crit('Failed to make OPEN!');
        return false;
      }

      this._openBufferSave = buf;
      this._sender.send(buf);
    }
    else {
      this._sender.send(this._openBufferSave);
    }

    return true;
  }

  /**
   * Create and send the challenge segment.
   * @private.
   */
  _sendChallenge(open) {
    trace();

    const buf = p.mkChallenge(
      this._peerId,
      this._sequence,
      this._peerKey,
      this._id,
      this._time,
      this._selfNonce,
      this._selfKeys.publicKey,
      this._maxCurrency,
      this._regenCurrency,
      this._maxStreams,
      this._maxMessage,
      open.segment,
      this._signKey,
    );

    if (!buf) {
      crit('Failed to make CHALLENGE!');
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
      this._peerId,
      this._sequence,
      this._selfNonce,
      this._peerKey,
      this._selfKeys.secretKey,
      this._pingRandom,
      this._pingTime,
      this._rttMs,
      this._sentCount,
      this._recvCount,
    );

    if (!buf) {
      crit('Failed to make PING!');
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
   * Signal that this connection will be challenging any OPEN segments.
   */
  challenge() {
    this._transition(Event.CHALLENGE);
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
    trace();
    
    if (this._isEstablished) {
      /* Assuming packet replay. */
      return;
    }

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
    trace();

    if (!this._checkSequence(pre.seq)) {
      /* Sequence already seen. May be a replay attack. */
      return;
    }

    switch (pre.control) {
      case control.CHALLENGE:
        {
          if (this._isEstablished) {
            /* Assuming packet replay. */
            return;
          }

          // TODO test the sequence value
          let data = p.unChallenge(
            seg,
            this._selfKeys.publicKey,
            this._selfKeys.secretKey,
          );

          if (!this._openBufferSave) {
            /* Nothing was sent...? */
            warn('Received CHALLENGE but no saved open buffer.');
            return;
          }

          const openLen = this._openBufferSave.length;
          const chalLen = data.signatureBuffer.length;
          const signBuf = Buffer.allocUnsafe(openLen + chalLen);
          this._openBufferSave.copy(signBuf, 0, 0, openLen);
          data.signatureBuffer.copy(signBuf, openLen, 0, chalLen);
          warn('UnSignlen!', signBuf.length);
          warn('UnSignthis!', signBuf);

          debug('CHALLENGE data:', data);

          if (this._unsignKey) {
            if (!crypto.unsign(data.signature, signBuf, this._unsignKey)) {
              warn('Unable to verify CHALLENGE signature.');
              return;
            }
          }
          else if (this._verifyCb) {
            if (!this._verifyCb(data.signature, signBuf)) {
              warn('User unable to verify CHALLENGE signature.');
              return;
            }
          }
          else if (!this._allowUnsafeSign) {
            return;
          }

          if (!data) {
            /* Invalid payload/decryption. */
            return;
          }

          this._transition(Event.CHALLENGE_RECV, data);
        }
        break;
      case control.PING:
        {
          let data = p.unPing(
            seg,
            this._peerNonce,
            this._peerKey,
            this._selfKeys.secretKey,
          );

          debug('PING data:', data);

          if (!data) {
            /* Invalid payload/decryption. */
            return;
          }

          this._transition(Event.PING_RECV, data);
        }
        break;
      default:
        crit('Unimplemented segment:', pre);
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
 * @param {Buffer} [options.signKey] - Valid message signing key.
 * @param {Buffer} [options.unsignKey] - Valid message unsigning key to validate server.
 * @param {boolean} [options.allowUnsafeSegment=false] - Allow unencrypted traffic.
 * @param {boolean} [options.allowUnsafeSign=false] - Allow ignoring server's signature.
 * @param {object} keys - Valid keys from crypto. Auto-generated.
 * @param {Buffer} nonce - Valid nonce from crypto. Auto-generated.
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
  options.signKey =
    'signKey' in options ? options.signKey : null;
  options.unsignKey =
    'unsignKey' in options ? options.unsignKey : null;
  options.allowUnsafeSegment =
    'allowUnsafeSegment' in options ? (!!options.allowUnsafeSegment) : false;
  options.allowUnsafeSign =
    'allowUnsafeSign' in options ? (!!options.allowUnsafeSign) : false;
  warn(options.unsignKey);

  if (!options.unsignKey && !options.allowUnsafeSign) {
    throw new Error(
      'Incompatible settings. ' +
      'Either set options.allowUnsafeSign=true or specify options.unsignKey'
    );
  }

  if (!options.allowUnsafeSegment) {
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

