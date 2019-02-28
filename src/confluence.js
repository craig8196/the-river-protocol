/**
 * @file Confluence manages each connection.
 * @author Craig Jacobson
 */
/* Core */
const EventEmitter = require('events');
/* Community */
const { Enum } = require('enumify');
/* Custom */
const crypto = require('./crypto.js');
const { Trans, control, lengths } = require('./spec.js');
const River = require('./river.js');


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
      function handleMessage(message, rinfo) {
        const eventData = { message: message, rinfo: rinfo };
        con.state.transition(Trans.PACKET, con, eventData);
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
          con.state = State.LISTEN;
          break;
        case Trans.CLOSE:
          {
            let err = new Error('Socket closed when expecting socket bind');
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

  LISTEN: {
    enter(con) {
      const socket = con.socket;
      con.emit('listen', { port: socket.port, address: socket.address });
    },

    exit(/* con */) {
    },

    transition(transType, con, msg, rinfo) {
      switch (transType) {
        case Trans.PACKET:
          break;
          /*
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
            */
          }
          break;
        case Trans.OPEN:
          {
            const info = {};
            if (control.unOpen(info, msg)) {
              if (!con.hasConnection(rinfo, info.id)) {
                const id = con.newId();
                const sender = con.socket.mkSender(rinfo);
                const river = new River(id, sender);

                function keep() {
                  river.challenge();
                }

                function kill() {
                  river.reject();
                }

                con.emit('connect', river, keep, kill);
              }
              else {
                // TODO reject
              }
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

/**
 * Confluence is a junction or meeting of rivers, thus managing 
 * multiple connections.
 * Block OPEN requests if needed.
 * Filter and drop non-protocol adhereing dgrams.
 * Check and update messages.
 * Validate incoming messages.
 * Decrypt and unwrap incoming messages.
 * Forward message data to the correct connection.
 * Wrap and encrypt outgoing messages accordingly.
 */
class Confluence extends EventEmitter {
  constructor(socket, options) {
    super();

    this.socket = socket;

    this.allowIncoming = options.allowIncoming;
    this.allowUnsafeOpen = options.allowUnsafeOpen;
    this.allowUnsafePacket = options.allowUnsafePacket;

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

  newId() {
    let id = crypto.mkId();
    let count = 1;
    const maxTry = 30;
    while (id === 0 || con.hasId(id)) {
      if (maxTry === count) {
        return 0;
      }
      id = crypto.mkId();
      ++count;
    }
    return id;
  }

  hasId(id) {
    return this.map.has(id);
  }

  getId(id) {
    const river = this.map.get(id);
    if (river) {
      return river;
    }
    else {
      // TODO return the prepared river object
      // TODO create default/dummy rejection river objects for different situations
      return null;
    }
  }

  setId(id, river) {
    if (river) {
      this.map.set(id, river);
    }
    else {
      // TODO create a new river context rather than error dummy?
      this.map.delete(id);
    }
  }

  start() {
    this.state.transition(Trans.START, this);
  }

  stop() {
    this.state.transition(Trans.STOP, this);
  }

  createRiver(info, rinfo) {
  }

  /**
   * Attempts to create a new connection over the socket.
   * @param {Object} dest - The destination description.
   * @param {number} dest.port - Required. The destination port.
   * @param {string} dest.address - Required. The destination address.
   * @return A promise that will either return a connection or an error.
   */
  mkConnection(dest, publicKey, options) {
    // Internally the connection is called a river, but these details don't
    // need to be known to the user
    const con = this;

    const promise = new Promise((resolve, reject) => {
      const id = con.newId();
      if (id) {
        dest.socket = con.socket;
        try {
          const sender = con.socket.mkSender(dest);
          const river = new River(id, sender);
          river.setOpenPublicKey(publicKey);
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
        catch (err) {
          reject(err);
        }
      }
    });
    return promise;
  }
}

module.exports = Confluence;

