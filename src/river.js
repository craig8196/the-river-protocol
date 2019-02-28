/**
 * @file Connection creation code.
 * @author Craig Jacobson
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
/* Custom */
const { StreamManager } = require('./stream.js');
const spec = require('./spec.js');
const crypto = require('./crypto.js');
const util = require('./util.js');
'use strict';


const control = spec.control;
const lengths = spec.lengths;

class Trans extends Enum {}
Trans.initEnum([
  // River events.
  'START',// Start on river was called.
  'STOP',// Stop on river was called.

  // Socket events.
  'BIND',// Successful bind/listening on socket.
  'CLOSE',// Close socket was received.
  'ERROR',// Error on socket.

  // Filtered socket messages.
  'MESSAGE',
  'OPEN',
  'REJECT',
  '',
  'DISCONNECT',
]);

/**
 * Utility function to convert from a protocol spec to a Trans value.
 */
function transFromControl(c) {
  switch (c) {
    case control.MESSAGE: return Trans.MESSAGE;
    case control.OPEN: return Trans.OPEN;
    case control.ACK: return Trans.ACK;
    case control.CONFIRM: return Trans.CONFIRM;
    case control.DISCONNECT: return Trans.DISCONNECT;
  }
  throw new Error('Impossible control value: ' + c);
}

// TODO There seems to be a way to genericize this timeout handling code...
/**
 * The current timeout is used up to three times before we exponentially
 * backoff.
 */
function handleOpenTimeout(river, message) {
  if (3 <= river.openTimeoutCount) {
    const prevTimeout = river.openTimeoutMs;
    river.openTimeoutMs = river.openTimeoutMs * 2;
    river.emit('timeout', prevTimeout, river.openTimeoutMs);
    if (river.openTimeoutMs > spec.timeouts.OPEN_MAX) {
      river.openTimeoutMs = spec.timeouts.OPEN_MAX;
    }
  }

  river.socket.send(message);
  river.openTimeoutCount++;
  river.openTimeout = setTimeout(handleOpenTimeout, river.openTimeoutMs, river, message);
}

function handleDisconnectTimeout(river, message) {
  if (3 <= river.disconnectTimeoutCount) {
    river.openTimeoutCount = 0;
    river.disconnectTimeoutMs = river.disconnectTimeoutMs * 2;
    if (river.disconnectTimeoutMs > spec.timeouts.DISCONNECT_MAX) {
      river.openTimeoutMs = spec.timeouts.OPEN_MAX;
    }
  }

  river.socket.send(message);
  river.disconnectTimeoutCount++;
  river.disconnectTimeout = setTimeout(handleDisconnectTimeout, river.disconnectTimeoutMs, river, message);
}

/**
 * Valid message checker.
 */
function isValidMessage(message) {
  // TODO
  return message.length;
}

/**
 * Process the message thought to be an ACK.
 * @return {bool} True if this is a valid message; false otherwise.
 */
function processAck(river, msg, validate) {
  const c = msg[0];
  if (control.ACK !== c) {
    return false;
  }

  const serverKey = Buffer.allocUnsafe(lengths.KEY);
  msg.copy(serverKey, 0, 1 + lengths.NONCE, lengths.KEY);

  if (validate) {
    if (!river.serverKey.equals(serverKey)) {
      return false;
    }
  }

  const nonce = msg.slice(1, 1 + lengths.NONCE);
  const encrypt = msg.slice(1 + lengths.NONCE + lengths.KEY);
  const decrypt = Buffer.allocUnsafe(lengths.ACK_DECRYPT);

  if (!crypt.unbox(decrypt, encrypt, nonce, serverKey, river.secretKey)) {
    return false;
  }

  let maxCurrency = decrypt.readUInt16BE(0);
  let maxStreams = decrypt.readUInt16BE(2);
  if (0 === maxCurrency) {
    maxCurrency = 255;
  }
  if (0 === maxStreams) {
    maxStreams = 1;
  }

  const uuid = Buffer.allocUnsafe(lengths.UUID);
  decrypt.copy(uuid, 0, 4, 4 + lengths.UUID);

  const serverNonce = Buffer.allocUnsafe(lengths.NONCE);
  decrypt.copy(serverNonce, 0, 4 + lengths.UUID, 4 + lengths.UUID + lengths.NONCE);

  if (validate) {
    if (river.maxCurrency === maxCurrency
        && river.maxStreams === maxStreams
        && river.serverNonce.equals(serverNonce)
        && river.serverKey.equals(serverKey)
        && river.id.equals(uuid))
    {
      return true;
    }
    else {
      return false;
    }
  }
  else {
    river.maxCurrency = maxCurrency;
    river.maxStreams = maxStreams;

    river.id = uuid;
    river.serverNonce = serverNonce;
    river.serverKey = serverKey;

    return true;
  }
}

/**
 * Unwrap and process each message.
 */
function processMessages(/* river, msg */) {
  return false;
}


class State extends Enum {}
State.initEnum({
  CREATE: {
    enter(/* river */) {
    },

    exit(/* river */) {
    },

    transition(transType, river) {
      switch (transType) {
        case Trans.START:
          river.state = State.START;
          break;
        case Trans.STOP:
          river.state = State.END;
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            river.emit('error', err);
          }
          break;
      }
    }
  },
  START: {
    enter(river) {
      river.emit('start');

      river.listenToError = true;
      river.listenToMessage = true;
      river.listenToBind = true;
      river.listenToClose = true;

      function handleError(error) {
        if (river.listenToError) {
          river.state.transition(Trans.ERROR, river, error);
        }
      }

      /**
       * Do preliminary screening and pass messages along as needed.
       */
      function handleMessage(message) {
        if (river.listenToMessage) {
          if (message.length >= lengths.MIN_MESSAGE && control.isValidControl(message[0])) {
            const c = message[0];
            river.state.transition(transFromControl(c), river, message);
          }
          else {
            const l = message.length;
            const c = l > 0 ? message[0] : 'undefined';
            let err = new Error('Invalid message received: length [' + l + '], control [' + c + ']');
            river.emit('error', err);
          }
        }
      }

      function handleListening() {
        if (river.listenToBind) {
          river.state.transition(Trans.BIND, river, null);
        }
      }

      function handleClose() {
        if (river.listenToClose) {
          river.state.transition(Trans.CLOSE, river, null);
        }
      }

      const socket = river.socket;
      socket.on('error', handleError);
      socket.on('message', handleMessage);
      socket.on('listening', handleListening);
      socket.on('close', handleClose);
      socket.bind();
    },

    exit(river) {
      river.listenToBind = false;
    },

    transition(transType, river) {
      switch (transType) {
        case Trans.BIND:
          river.state = State.BIND;
          break;
        case Trans.CLOSE:
          {
            let err = new Error('Socket closed when expecting socket bind.');
            river.emit('error', err);
            river.state = State.END;
          }
          break;
        case Trans.STOP:
          river.state = State.END;
          break;
        case Trans.ERROR:
          {
            let err = new Error('Unable to bind to socket.');
            river.emit('error', err);
            river.state = State.END;
          }
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            river.emit('error', err);
          }
          break;
      }
    }
  },
  BIND: {
    enter(river) {
      const socket = river.socket;
      river.emit('bind', { port: socket.port, address: socket.address });

      const keys = crypt.mkKeyPair();
      river.publicKey = keys.publicKey;
      river.secretKey = keys.secretKey;
      river.nonce = crypt.mkNonce();


      let message = Buffer.allocUnsafe(lengths.OPEN);
      message[0] = control.OPEN;
      river.publicKey.copy(message, 1);

      river.openTimeoutCount = 0;
      river.openTimeoutMs = spec.timeouts.OPEN;

      handleOpenTimeout(river, message);
    },

    exit(river) {
      if (river.openTimeout) {
        clearTimeout(river.openTimeout);
      }
    },

    transition(transType, river, msg) {
      switch (transType) {
        case Trans.ACK:
          if (processAck(river, msg)) {
            river.state = State.OPEN;
          }
          else {
            let err = new Error('Invalid ACK message... discarding');
            river.emit('error', err);
          }
          break;
        case Trans.CLOSE:
          river.state = State.END;
          break;
        case Trans.STOP:
          river.state = State.UNBIND;
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            river.emit('error', err);
          }
          break;
      }
    }
  },
  OPEN: {
    enter(river) {
      const message = Buffer.allocUnsafe(lengths.CONFIRM);
      message[0] = control.CONFIRM;
      river.id.copy(message, 1, 0, lengths.UUID);
      const nonce = crypt.mkNonce();
      nonce.copy(message, 1 + lengths.UUID, 0, lengths.NONCE);
      const encrypt = Buffer.allocUnsafe(lengths.CONFIRM_ENCRYPT);
      crypt.box(encrypt, river.nonce, nonce, river.serverKey, river.secretKey);
      encrypt.copy(message, 1 + lengths.UUID + lengths.NONCE, 0, lengths.CONFIRM_ENCRYPT);

      river.confirmMessage = message;
      river.socket.send(message);
    },

    exit(river) {
      if (river.confirmMessage) {
        river.confirmMessage = null;
      }
    },

    transition(transType, river, msg) {
      switch (transType) {
        case Trans.MESSAGE:
          if (isValidMessage(msg)) {
            river.state = State.CONNECTED;
            river.state.transition(transType, river, msg);
          }
          else {
            let err = new Error('Invalid message received... discarding');
            river.emit('error', err);
          }
          break;
        case Trans.STOP:
          river.state = State.DISCONNECT;
          break;
        case Trans.CLOSE:
          {
            let err = new Error('Unexpected socket close');
            river.emit('error', err);
            river.state = State.END;
          }
          break;
        case Trans.ACK:
          if (processAck(river, msg, true)) {
            river.socket.send(river.confirmMessage);
          }
          else {
            /* How do we know we're connected to the correct server? Because they have our key. */
            let err = new Error('Invalid or conflicting ACK message... discarding');
            river.emit('error', err);
          }
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            river.emit('error', err);
          }
          break;
      }
    }
  },
  CONNECTED: {
    enter(river) {
      river.emit('connected');
      river.streams = new StreamManager(river);
    },

    exit(river) {
      river.streams.destroy();
    },

    transition(transType, river, msg) {
      switch (transType) {
        case Trans.MESSAGE:
          if (!processMessages(river, msg)) {
            let err = new Error('Breach of protocol... disconnecting');
            river.emit('error', err);
            river.state = State.UNBIND;
          }
          /* else: successful processing */
          break;
        case Trans.STOP:
          river.state = State.DISCONNECT;
          break;
        case Trans.CLOSE:
          {
            let err = new Error('Unexpected socket close');
            river.emit('error', err);
            river.state = State.END;
          }
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            river.emit('error', err);
          }
          break;
      }
    }
  },
  DISCONNECT: {
    enter(river) {
      const message = Buffer.allocUnsafe(lengths.DISCONNECT);
      message[0] = control.DISCONNECT;
      const id = river.id;
      id.copy(message, 1, 0, lengths.UUID);

      const decrypt = Buffer.allocUnsafe(lengths.DISCONNECT_DECRYPT);
      const timestamp = util.now();
      timestamp.copy(decrypt, 1 + lengths.UUID, 0, lengths.TIMESTAMP);
      const nonce = river.nonce;
      nonce.copy(decrypt, 1 + lengths.UUID + lengths.TIMESTAMP, 0, lengths.NONCE);

      const encrypt = Buffer.allocUnsafe(lengths.DISCONNECT_ENCRYPT);
      crypt.box(encrypt, decrypt, nonce, river.serverKey, river.secretKey);

      encrypt.copy(message, 1 + lengths.UUID, 0, lengths.DISCONNECT_ENCRYPT);

      river.disconnectTimeoutCount = 0;
      river.disconnectMessage = message;
      handleDisconnectTimeout(river, message);
    },

    exit(river) {
      river.disconnectMessage = null;
      if (river.disconnectTimeout) {
        clearTimeout(river.disconnectTimeout);
      }
      river.emit('disconnect');
    },

    transition(transType, river, msg) {
      switch (transType) {
        case Trans.MESSAGE:
          if (!processMessages(river, msg)) {
            let err = new Error('Breach of protocol... disconnecting');
            river.emit('error', err);
            river.state = State.UNBIND;
          }
          /* else: successful processing */
          break;
        case Trans.DISCONNECT:
          river.state = State.UNBIND;
          break;
        case Trans.STOP:
          river.state = State.DISCONNECT;
          break;
        case Trans.CLOSE:
          {
            let err = new Error('Unexpected socket close');
            river.emit('error', err);
            river.state = State.END;
          }
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            river.emit('error', err);
          }
          break;
      }
    }
  },
  UNBIND: {
    enter(river) {
      river.socket.close();
    },

    exit(/* river */) {
    },

    transition(transType, river) {
      switch (transType) {
        case Trans.CLOSE:
          river.state = State.END;
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            river.emit('error', err);
          }
          break;
      }
    }
  },
  END: {
    enter(river) {
      river.emit('end');
    },

    exit(/* river */) {
    },

    transition(transType, river) {
      /* What is the proper behavior? Do nothing? */
      let err = new Error('Invalid transition attempt: ' + String(transType));
      river.emit('error', err);
    }
  },
});


class River extends EventEmitter {
  constructor(id, sender) {
    super();

    this.id = id;
    this.sender = sender;
    this._state = State.CREATE;
  }

  get state() {
    return this._state;
  }

  set state(s) {
    if (s === this._state) {
      let err = new Error('Transitioning to same state: ' + String(s));
      this.emit('error', err);
    }
    this._state.exit(this);
    this._state = s;
    this._state.enter(this);
  }

  open() {
    this.state.transition(Trans.OPEN, this);
  }
}

/*
class River extends EventEmitter {
  constructor(socket) {
    super();

    this.socket = socket;

    this._state = State.CREATE;
    this._state.enter(this);

    this._publicKey = null;
    this._secretKey = null;
    this._nonce = null;
    this._serverNonce = null;
    this._serverKey = null;
    this._connectionId = null;
  }

  get state() {
    return this._state;
  }

  set state(s) {
    if (s === this._state) {
      let err = new Error('Transitioning to same state: ' + String(s));
      this.emit('error', err);
    }
    this._state.exit(this);
    this._state = s;
    this._state.enter(this);
  }

  start() {
    this.state.transition(Trans.START, this);
  }

  stop() {
    this.state.transition(Trans.STOP, this);
  }

  openStream() {
    // TODO Return promise.
    return this.streams.openStream();
  }
}
*/

module.exports = {
  River,
};

