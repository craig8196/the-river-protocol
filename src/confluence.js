/**
 * @file Confluence creation.
 * @author Craig Jacobson
 */
/* Core */
/* Community */
/* Custom */


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
  'MESSAGE',
  'OPEN',
]);

class State extends Enum {}
State.initEnum({
  CREATE: {
    enter(client) {
      con.map = new Map();
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

      function handleError(error) {
        con.state.transition(Trans.ERROR, con, error);
      }

      /**
       * Do preliminary screening and pass messages along as needed.
       */
      function handleMessage(message) {
        // TODO parse out protocol and identifier
        if (message.length >= lengths.MIN_MESSAGE && control.isValidControl(message[0])) {
          const c = message[0];
          con.state.transition(transFromControl(c), con, message);
        }
        else {
          const l = message.length;
          const c = l > 0 ? message[0] : 'undefined';
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
      socket.bind();
    },

    exit(con) {
    },

    transition(transType, con) {
      switch (transType) {
        case Trans.BIND:
          con.state = State.BIND;
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

  RUNNING: {
    enter(con) {
      const socket = con.socket;
      con.emit('running', { port: socket.port, address: socket.address });
    },

    exit(/* con */) {
    },

    transition(transType, con, msg) {
      switch (transType) {
        case Trans.CLOSE:
          this.isSocketClosed = true;
          con.state = State.UNBIND;
          break;
        case Trans.STOP:
          con.state = State.STOP;
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

  STOP: {
    enter(con) {
      // TODO nice stops on all rivers
    },

    exit(con) {
      // TODO hard stops on all rivers
    },

    transition(transType, con) {
      // TODO
    }
  },

  UNBIND: {
    enter(con) {
      if (!con.isSocketClosed) {
        con.socket.close();
      }
      else {
        con.state = State.END;
      }
    },

    exit(con) {
      const socket = con.socket;
      socket.off('error', con.handleError);
      socket.off('message', con.handleMessage);
      socket.off('listening', con.handleListening);
      socket.off('close', con.handleClose);
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
  constructor(socket) {
    super();

    this.socket = socket;

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

module.exports = {
  Confluence,
};

