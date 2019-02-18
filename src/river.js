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
const crypt = require('./crypt.js');
const util = require('./util.js');
'use strict';


const control = spec.control;
const lengths = spec.lengths;

class Trans extends Enum {}
Trans.initEnum([
  // Client events.
  'START',// Start on client was called.
  'STOP',// Stop on client was called.

  // Socket events.
  'BIND',// Successful bind/listening on socket.
  'CLOSE',// Close socket was received.
  'ERROR',// Error on socket.

  // Filtered socket messages.
  'MESSAGE',
  'OPEN',
  'ACK',
  'CONFIRM',
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
function handleOpenTimeout(client, message) {
  if (3 <= client.openTimeoutCount) {
    const prevTimeout = client.openTimeoutMs;
    client.openTimeoutMs = client.openTimeoutMs * 2;
    client.emit('timeout', prevTimeout, client.openTimeoutMs);
    if (client.openTimeoutMs > spec.timeouts.OPEN_MAX) {
      client.openTimeoutMs = spec.timeouts.OPEN_MAX;
    }
  }

  client.socket.send(message);
  client.openTimeoutCount++;
  client.openTimeout = setTimeout(handleOpenTimeout, client.openTimeoutMs, client, message);
}

function handleDisconnectTimeout(client, message) {
  if (3 <= client.disconnectTimeoutCount) {
    client.openTimeoutCount = 0;
    client.disconnectTimeoutMs = client.disconnectTimeoutMs * 2;
    if (client.disconnectTimeoutMs > spec.timeouts.DISCONNECT_MAX) {
      client.openTimeoutMs = spec.timeouts.OPEN_MAX;
    }
  }

  client.socket.send(message);
  client.disconnectTimeoutCount++;
  client.disconnectTimeout = setTimeout(handleDisconnectTimeout, client.disconnectTimeoutMs, client, message);
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
function processAck(client, msg, validate) {
  const c = msg[0];
  if (control.ACK !== c) {
    return false;
  }

  const serverKey = Buffer.allocUnsafe(lengths.KEY);
  msg.copy(serverKey, 0, 1 + lengths.NONCE, lengths.KEY);

  if (validate) {
    if (!client.serverKey.equals(serverKey)) {
      return false;
    }
  }

  const nonce = msg.slice(1, 1 + lengths.NONCE);
  const encrypt = msg.slice(1 + lengths.NONCE + lengths.KEY);
  const decrypt = Buffer.allocUnsafe(lengths.ACK_DECRYPT);

  if (!crypt.unbox(decrypt, encrypt, nonce, serverKey, client.secretKey)) {
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
    if (client.maxCurrency === maxCurrency
        && client.maxStreams === maxStreams
        && client.serverNonce.equals(serverNonce)
        && client.serverKey.equals(serverKey)
        && client.id.equals(uuid))
    {
      return true;
    }
    else {
      return false;
    }
  }
  else {
    client.maxCurrency = maxCurrency;
    client.maxStreams = maxStreams;

    client.id = uuid;
    client.serverNonce = serverNonce;
    client.serverKey = serverKey;

    return true;
  }
}

/**
 * Unwrap and process each message.
 */
function processMessages(/* client, msg */) {
  return false;
}


class State extends Enum {}
State.initEnum({
  CREATE: {
    enter(/* client */) {
    },

    exit(/* client */) {
    },

    transition(transType, client) {
      switch (transType) {
        case Trans.START:
          client.state = State.START;
          break;
        case Trans.STOP:
          client.state = State.END;
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            client.emit('error', err);
          }
          break;
      }
    }
  },
  START: {
    enter(client) {
      client.emit('start');

      client.listenToError = true;
      client.listenToMessage = true;
      client.listenToBind = true;
      client.listenToClose = true;

      function handleError(error) {
        if (client.listenToError) {
          client.state.transition(Trans.ERROR, client, error);
        }
      }

      /**
       * Do preliminary screening and pass messages along as needed.
       */
      function handleMessage(message) {
        if (client.listenToMessage) {
          if (message.length >= lengths.MIN_MESSAGE && control.isValidControl(message[0])) {
            const c = message[0];
            client.state.transition(transFromControl(c), client, message);
          }
          else {
            const l = message.length;
            const c = l > 0 ? message[0] : 'undefined';
            let err = new Error('Invalid message received: length [' + l + '], control [' + c + ']');
            client.emit('error', err);
          }
        }
      }

      function handleListening() {
        if (client.listenToBind) {
          client.state.transition(Trans.BIND, client, null);
        }
      }

      function handleClose() {
        if (client.listenToClose) {
          client.state.transition(Trans.CLOSE, client, null);
        }
      }

      const socket = client.socket;
      socket.on('error', handleError);
      socket.on('message', handleMessage);
      socket.on('listening', handleListening);
      socket.on('close', handleClose);
      socket.bind();
    },

    exit(client) {
      client.listenToBind = false;
    },

    transition(transType, client) {
      switch (transType) {
        case Trans.BIND:
          client.state = State.BIND;
          break;
        case Trans.CLOSE:
          {
            let err = new Error('Socket closed when expecting socket bind.');
            client.emit('error', err);
            client.state = State.END;
          }
          break;
        case Trans.STOP:
          client.state = State.END;
          break;
        case Trans.ERROR:
          {
            let err = new Error('Unable to bind to socket.');
            client.emit('error', err);
            client.state = State.END;
          }
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            client.emit('error', err);
          }
          break;
      }
    }
  },
  BIND: {
    enter(client) {
      const socket = client.socket;
      client.emit('bind', { port: socket.port, address: socket.address });

      const keys = crypt.mkKeyPair();
      client.publicKey = keys.publicKey;
      client.secretKey = keys.secretKey;
      client.nonce = crypt.mkNonce();


      let message = Buffer.allocUnsafe(lengths.OPEN);
      message[0] = control.OPEN;
      client.publicKey.copy(message, 1);

      client.openTimeoutCount = 0;
      client.openTimeoutMs = spec.timeouts.OPEN;

      handleOpenTimeout(client, message);
    },

    exit(client) {
      if (client.openTimeout) {
        clearTimeout(client.openTimeout);
      }
    },

    transition(transType, client, msg) {
      switch (transType) {
        case Trans.ACK:
          if (processAck(client, msg)) {
            client.state = State.OPEN;
          }
          else {
            let err = new Error('Invalid ACK message... discarding');
            client.emit('error', err);
          }
          break;
        case Trans.CLOSE:
          client.state = State.END;
          break;
        case Trans.STOP:
          client.state = State.UNBIND;
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            client.emit('error', err);
          }
          break;
      }
    }
  },
  OPEN: {
    enter(client) {
      const message = Buffer.allocUnsafe(lengths.CONFIRM);
      message[0] = control.CONFIRM;
      client.id.copy(message, 1, 0, lengths.UUID);
      const nonce = crypt.mkNonce();
      nonce.copy(message, 1 + lengths.UUID, 0, lengths.NONCE);
      const encrypt = Buffer.allocUnsafe(lengths.CONFIRM_ENCRYPT);
      crypt.box(encrypt, client.nonce, nonce, client.serverKey, client.secretKey);
      encrypt.copy(message, 1 + lengths.UUID + lengths.NONCE, 0, lengths.CONFIRM_ENCRYPT);

      client.confirmMessage = message;
      client.socket.send(message);
    },

    exit(client) {
      if (client.confirmMessage) {
        client.confirmMessage = null;
      }
    },

    transition(transType, client, msg) {
      switch (transType) {
        case Trans.MESSAGE:
          if (isValidMessage(msg)) {
            client.state = State.CONNECTED;
            client.state.transition(transType, client, msg);
          }
          else {
            let err = new Error('Invalid message received... discarding');
            client.emit('error', err);
          }
          break;
        case Trans.STOP:
          client.state = State.DISCONNECT;
          break;
        case Trans.CLOSE:
          {
            let err = new Error('Unexpected socket close');
            client.emit('error', err);
            client.state = State.END;
          }
          break;
        case Trans.ACK:
          if (processAck(client, msg, true)) {
            client.socket.send(client.confirmMessage);
          }
          else {
            /* How do we know we're connected to the correct server? Because they have our key. */
            let err = new Error('Invalid or conflicting ACK message... discarding');
            client.emit('error', err);
          }
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            client.emit('error', err);
          }
          break;
      }
    }
  },
  CONNECTED: {
    enter(client) {
      client.emit('connected');
      client.streams = new StreamManager(client);
    },

    exit(client) {
      client.streams.destroy();
    },

    transition(transType, client, msg) {
      switch (transType) {
        case Trans.MESSAGE:
          if (!processMessages(client, msg)) {
            let err = new Error('Breach of protocol... disconnecting');
            client.emit('error', err);
            client.state = State.UNBIND;
          }
          /* else: successful processing */
          break;
        case Trans.STOP:
          client.state = State.DISCONNECT;
          break;
        case Trans.CLOSE:
          {
            let err = new Error('Unexpected socket close');
            client.emit('error', err);
            client.state = State.END;
          }
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            client.emit('error', err);
          }
          break;
      }
    }
  },
  DISCONNECT: {
    enter(client) {
      const message = Buffer.allocUnsafe(lengths.DISCONNECT);
      message[0] = control.DISCONNECT;
      const id = client.id;
      id.copy(message, 1, 0, lengths.UUID);

      const decrypt = Buffer.allocUnsafe(lengths.DISCONNECT_DECRYPT);
      const timestamp = util.now();
      timestamp.copy(decrypt, 1 + lengths.UUID, 0, lengths.TIMESTAMP);
      const nonce = client.nonce;
      nonce.copy(decrypt, 1 + lengths.UUID + lengths.TIMESTAMP, 0, lengths.NONCE);

      const encrypt = Buffer.allocUnsafe(lengths.DISCONNECT_ENCRYPT);
      crypt.box(encrypt, decrypt, nonce, client.serverKey, client.secretKey);

      encrypt.copy(message, 1 + lengths.UUID, 0, lengths.DISCONNECT_ENCRYPT);

      client.disconnectTimeoutCount = 0;
      client.disconnectMessage = message;
      handleDisconnectTimeout(client, message);
    },

    exit(client) {
      client.disconnectMessage = null;
      if (client.disconnectTimeout) {
        clearTimeout(client.disconnectTimeout);
      }
      client.emit('disconnect');
    },

    transition(transType, client, msg) {
      switch (transType) {
        case Trans.MESSAGE:
          if (!processMessages(client, msg)) {
            let err = new Error('Breach of protocol... disconnecting');
            client.emit('error', err);
            client.state = State.UNBIND;
          }
          /* else: successful processing */
          break;
        case Trans.DISCONNECT:
          client.state = State.UNBIND;
          break;
        case Trans.STOP:
          client.state = State.DISCONNECT;
          break;
        case Trans.CLOSE:
          {
            let err = new Error('Unexpected socket close');
            client.emit('error', err);
            client.state = State.END;
          }
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            client.emit('error', err);
          }
          break;
      }
    }
  },
  UNBIND: {
    enter(client) {
      client.socket.close();
    },

    exit(/* client */) {
    },

    transition(transType, client) {
      switch (transType) {
        case Trans.CLOSE:
          client.state = State.END;
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            client.emit('error', err);
          }
          break;
      }
    }
  },
  END: {
    enter(client) {
      client.emit('end');
    },

    exit(/* client */) {
    },

    transition(transType, client) {
      /* What is the proper behavior? Do nothing? */
      let err = new Error('Invalid transition attempt: ' + String(transType));
      client.emit('error', err);
    }
  },
});


class Client extends EventEmitter {
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

function createClient(socket) {
  return new Client(socket);
}

module.exports = {
  createClient,
};

