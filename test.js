
const trip = require('./src/trip.js');

const serverSocket = trip.mkSocket({ port: 42000 });
const server = trip.mkServer(serverSocket, { allowUnsafeOpen: true });

server.on('start', () => {
  console.log('Server starting up...');
});

server.on('listen', () => {
  console.log('Ready to accept connections.');

  const clientSocket = trip.mkSocket();
  const client = trip.mkClient(clientSocket);

  client.on('connect', () => {
    server.stop();
    client.close();
  });

  client.on('error', (err) => {
    console.warn('Client error: ' + String(err));
    server.stop();
    client.close();
  });

  client.connect({ address: 'localhost', port: 42000 });
});

server.on('stop', () => {
  console.log('Stopped');
});

server.on('error', (err) => {
  console.log('Server error: ' + String(err));
});

server.start();


/*
const keys = trip.mkKeyPair();
console.log(keys);
try {
  const s0 = trip.mkSocket();
  const s1 = trip.mkSocket({ address: 'localhost' });
  const s2 = trip.mkSocket({ address: 'localhost', port: 9000 });
  const s3 = trip.mkSocket({ address: '0.0.0.0', port: 3000 });
  function cb(data) {
    console.log(this.address());
  }
  s0.bind(cb.bind(s0));
  s1.bind(cb.bind(s1));
  s2.bind(cb.bind(s2));
  s3.bind(cb.bind(s3));
}
catch (err) {
  console.error(err);
}



const Long = require('long');

const timestamp = Date.now();
console.log(String(timestamp));
const l = Long.fromNumber(timestamp, true);
const n = Long.fromString(String(timestamp), true);
console.log(l.toString());
console.log(n.toString());
const buf = Buffer.allocUnsafe(8);
buf.writeUInt32BE(l.getHighBitsUnsigned(), 0);
buf.writeUInt32BE(l.getLowBitsUnsigned(), 4);
console.log(buf);
const t = Long.fromBytesBE(buf, true);
console.log(t.toString());
*/

