/**
 * @file Test the trip library initialization.
 */
const EventEmitter = require('events');
const spec = require('./spec.js');
const tripFactory = require('./trip.js');

let trip = null;
let State = spec.ClientState;

beforeAll(() => {
  let tripPromise = tripFactory.instantiate();
  tripPromise.then((tripLocal) => {
    trip = tripLocal;
  });
  return tripPromise;
});




describe('client', () => {
  test('is connecting', () => {
    class TestConnect extends EventEmitter {
      constructor(state) {
        super();
        this.state = state;
        this.step = 0;
      }
      created(client) {
        // #1
        this.client = client;
        expect(this.state).toEqual(client.state);
        this.state = State.BIND;
        this.keys = client.crypt.createKeys();
        this.nonce = client.crypt.createNonce();
        this.uuid = utils.createConnectionId();
      }
      bind() {
        // #2
        let client = this.client;
        expect(this.state).toEqual(client.state);
        this.emit('listening');
        this.state = State.CONNECTION_OPEN;
      }
      send(message, cb) {
        let msg = Buffer.from(message);
        switch (this.state) {
          case State.CONNECTION_OPEN:
            // #3
            expect(msg[0]).toEqual(spec.P_CONNECTION_OPEN_REQUEST[0]);
            expect(msg.length).toEqual(1 + 32);
            this.state = State.NONCE_INIT;
            let limits = Buffer.alloc(4, 0);
            limits.writeUint16BE(16, 0);
            limits.writeUint16BE(16, 2);
            let ids = [ this.uuid, this.keys.publicKey ];
            let edata = this.client.crypt.encryptSealed(Buffer.from(ids), this.publicKey);
            let response = Buffer.from([ spec.P_CONNECTION_OPEN_RESPONSE, limits, edata]);
            this.emit('message', response);
            break;
          case State.NONCE_INIT;
            // #4
            expect(msg[0]).toEqual(spec.P_NONCE_INIT_REQUEST[0]);
            expect(msg.length).toEqual(1 + 32);
            this.state = State.CONNECTED;
            break;
          default:
            break;
        }
        this.step++;
        //cb(null);
      }
    }

    let test = new TestConnect(State.CREATE);
    let client = trip.createClient(test);
    test.created(client);
    client.start();
  });
});


