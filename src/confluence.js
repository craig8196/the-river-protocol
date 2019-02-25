/**
 * @file Confluence creation.
 * @author Craig Jacobson
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
/* Custom */
const crypto = require('./crypto.js');
const { control, lengths } = require('./spec.js');
const River = require('./river.js');


class Trans extends Enum {}
Trans.initEnum([
  // Client events
  'START',// Start on client was called
  'STOP',// Stop on client was called

  // Socket events
  'BIND',// Successful bind/listening on socket
  'CLOSE',// Close socket was received
  'ERROR',// Error on socket

  // Filtered socket messages
  'PACKET',
  'OPEN',
  'REJECT',
  'CHALLENGE',
  'ACCEPT',
  'GARBAGE',
]);

/**
 * @return {Trans} The transition to take.
 */
function controlToTransition(c) {
  switch (c & control.MASK) {
    case control.PACKET: return Trans.PACKET;
    case control.OPEN: return Trans.OPEN;
    case control.REJECT: return Trans.REJECT;
    case control.CHALLENGE: return Trans.CHALLENGE;
    case control.ACCEPT: return Trans.ACCEPT;
    default: return Trans.GARBAGE;
  }
}

class State extends Enum {}
State.initEnum({
  CREATE: {
    enter(con) {
      con.map = new Map();

      function handleError(error) {
        con.state.transition(Trans.ERROR, con, error);
      }

      /**
       * Do preliminary screening and pass messages along as needed.
       */
      function handleMessage(message) {
        let reportErr = true;

        if (message.length >= lengths.PACKET_MIN) {
          const c = message[0];

          if (control.isValid(c, message.length, con.isServer, con.allowUnsafeConnect, con.allowUnsafeMessage)) {
            if (c & control.ENCRYPTED) {
              message.encrypted = true;
            }
            else {
              message.encrypted = false;
            }
            con.transition(controlToTransition(message[0]), con, message);
            reportErr = false;
          }
        }

        if (reportErr) {
          const l = message.length;
          const c = l ? message[0] : 'undefined';
          let err = new Error('Invalid message received: length [' + l + '], control [' + c + ']');
          con.emit('error', err);
        }
      }

      function handleListening() {
        con.state.transition(Trans.BIND, con);
      }

      function handleClose() {
        con.state.transition(Trans.CLOSE, con);
      }

      // Save the event handlers
      con.handleError = handleError;
      con.handleMessage = handleMessage;
      con.handleListening = handleListening;
      con.handleClose = handleClose;

      const socket = con.socket;
      socket.on('error', handleError);
      socket.on('message', handleMessage);
      socket.on('listening', handleListening);
      socket.on('close', handleClose);
    },

    exit(/* con */) {
    },

    transition(transType, con) {
      switch (transType) {
        case Trans.START:
          con.state = State.START;
          break;
        case Trans.STOP:
          con.state = State.END;
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            con.emit('error', err);
          }
          break;
      }
    }
  },

  START: {
    enter(con) {
      con.emit('start');
      con.socket.bind();
    },

    exit(/* con */) {
    },

    transition(transType, con) {
      switch (transType) {
        case Trans.BIND:
          con.state = State.LISTENING;
          break;
        case Trans.CLOSE:
          {
            let err = new Error('Socket closed when expecting socket bind.');
            con.emit('error', err);
            con.state = State.END;
          }
          break;
        case Trans.STOP:
          con.state = State.END;
          break;
        case Trans.ERROR:
          {
            let err = new Error('Unable to bind to socket.');
            con.emit('error', err);
            con.state = State.END;
          }
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            con.emit('error', err);
          }
          break;
      }
    }
  },

  LISTENING: {
    enter(con) {
      const socket = con.socket;
      con.emit('listening', { port: socket.port, address: socket.address });
    },

    exit(/* con */) {
    },

    transition(transType, con, msg) {
      switch (transType) {
        case Trans.PACKET:
        case Trans.REJECT:
        case Trans.CHALLENGE:
        case Trans.ACCEPT:
          {
            let offset = lengths.CONTROL;
            const id = msg.readUInt32BE(offset);
            const river = con.getId(id);

            if (river) {
              offset += lengths.ID;
              const buf = msg.slice(offset);
              buf.encrypted = msg.encrypted;
              river.transition(transType, river, buf);
            }
            else {
              let err = new Error('Packet for non-existent connection: ' + id);
              con.emit('error', err);
            }
          }
          break;
        case Trans.OPEN:
          {
            const info = {};
            if (control.unOpen(info, msg)) {
              // TODO OPEN a new connection/river
            }
            else {
              let err = new Error('Invalid OPEN request');
              con.emit('error', err);
            }
          }
          break;
        case Trans.CLOSE:
          con.isSocketClosed = true;
          con.state = State.STOP;
          break;
        case Trans.STOP:
          con.state = State.DISCONNECT;
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            con.emit('error', err);
          }
          break;
      }
    }
  },

  DISCONNECT: {
    enter(con) {
      function signalDisconnect (river/* , id, map */) {
        river.close();
      }

      function handleDisconnectTimeout(con) {
        delete con.disconnectTimeout;
        con.state = State.STOP;
      }

      if (con.isSocketClosed) {
        con.state = State.STOP;
      }
      else {
        con.map.forEach(signalDisconnect);
        con.disconnectTimeoutMs = 5000;
        con.disonnectTimeout = setTimeout(handleDisconnectTimeout, con.disconnectTimeoutMs, con);
      }
    },

    exit(con) {
      function forceDisconnect (river/* , id, map */) {
        river.hardClose();
      }

      if (con.disconnectTimeout) {
        clearTimeout(con.disconnectTimeout);
        delete con.disconnectTimeout;
      }

      con.map.forEach(forceDisconnect);
    },

    transition(transType, con) {
      switch (transType) {
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            con.emit('error', err);
          }
          break;
      }
    }
  },

  STOP: {
    enter(con) {
      if (!con.isSocketClosed) {
        con.socket.close();
      }
      else {
        con.state = State.END;
      }
    },

    exit(/* con */) {
    },

    transition(transType, con) {
      switch (transType) {
        case Trans.CLOSE:
          con.state = State.END;
          break;
        default:
          {
            let err = new Error('Invalid transition attempt: ' + String(transType));
            con.emit('error', err);
          }
          break;
      }
    }
  },

  END: {
    enter(con) {
      // Remove listeners
      const socket = con.socket;
      if (con.handleError) {
        socket.off('error', con.handleError);
      }
      if (con.handleMessage) {
        socket.off('message', con.handleMessage);
      }
      if (con.handleListening) {
        socket.off('listening', con.handleListening);
      }
      if (con.handleClose) {
        socket.off('close', con.handleClose);
      }

      // Free resources
      con.map = null;
      con.socket = null;

      con.emit('end');
    },

    exit(/* con */) {
    },

    transition(transType, con) {
      let err = new Error('Invalid transition attempt: ' + String(transType));
      con.emit('error', err);
    }
  },
});

class Confluence extends EventEmitter {
  constructor(socket, options) {
    super();

    this.socket = socket;

    this.isServer = options.isServer;
    this.allowUnsafeConnect = options.allowUnsafeConnect;
    this.allowUnsafeMessage = options.allowUnsafeMessage;

    this._state = State.CREATE;
    this._state.enter(this);
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

  hasId(id) {
    return this.map.has(id);
  }

  getId(id) {
    return this.map.get(id);
  }

  setId(id, river) {
    if (river) {
      this.map.set(id, river);
    }
    else {
      this.map.delete(id);
    }
  }

  start() {
    this.state.transition(Trans.START, this);
  }

  stop() {
    this.state.transition(Trans.STOP, this);
  }

  openConnection(dest) {
    // Internally the connection is called a river, but these details don't
    // need to be known to the user
    const con = this;

    const promise = new Promise((resolve, reject) => {
      let id = crypto.mkId();
      let count = 1;
      const maxTry = 30;
      while (id === 0 || con.hasId(id)) {
        if (count === maxTry) {
          reject(new Error('Unable to create a unique id.'));
          break;
        }
        id = crypto.mkId();
        ++count;
      }

      if (id !== 0 && !con.hasId(id)) {
        dest.socket = con.socket;
        const river = new River(id, dest);
        con.setId(id, river);
        river.on('connected', () => {
          resolve(river);
        });
        river.on('error', (err) => {
          con.setId(id, null);
          reject(err);
        });
        river.open();
      }
    });
    return promise;
  }
}

module.exports = Confluence;

