
const trip = require('./src/trip.js');

const PORT = 42000;

// Create server object.
// Server is started at end of script.
// TODO create a default port number for the protocol
const server = trip.mkServer(PORT, { allowUnsafeOpen: true });

// Start server. Binds to underlying interface.
server.on('start', () => {
  console.log('Server starting up...');
});

// We can now successfully connect to the server.
server.on('listen', () => {
  console.log('Ready to accept connections.');

  // Create client. In theory a client could be opened on the server's
  // Router object, but we don't do that yet.
  // Choose any open port by passing null.
  const client = trip.mkClient(null);

  // Connect call at bottom of this block.

  // Successful connection.
  client.on('connect', () => {
    // Since the server specifies limitations in advance we can create a
    // stream and let the framework handle details, like flow control.
    const stream = client.mkStream(0, true, true);

    // By default the framework should convert the string to UTF-8.
    stream.send('Hello, world!');
    stream.send('Take a round TRiP!');

    client.close();
  });

  // Server should be opening an echo stream.
  client.on('stream', (stream) => {
    console.log('Stream created from server.');

    stream.on('data', (data) => {
      // TODO convert to utf-8 and display.
      console.log('Echo data: ' + String(data));
    });

    stream.on('close', () => {
      console.log('Close stream');
    });
  });

  // An error occurred, shut everything down.
  client.on('error', (err) => {
    console.warn('Client error: ' + String(err));
    server.stop();
    client.close();
  });

  // Closed, no data may be sent.
  client.on('close', () => {
    console.log('Client closed');
    server.stop();
  });

  // Now we tell to connect.
  client.connect({ address: 'localhost', port: PORT });
});

// Screen incoming OPEN requests. Accept all for testing.
// TODO make it so values returned get stored on client object
server.on('screen', (binary) => {
  console.log('Screening: ' + String(binary));
  return true;
});

// Whitelist connection on the given IP. Accept all for testing.
// TODO make it so values returned get stored on client object
server.on('whitelist', (ip) => {
  console.log('Whitelist: ' + String(ip));
  return true;
});

// Client passed 'screen' and 'whitelist'.
server.on('accept', (client) => {
  // Automatically open stream for echoing.
  // We determine the stream ID, reliability, ordered
  const echoStream = client.mkStream(0, true, true);

  // New incoming stream.
  client.on('stream', (stream) => {
    console.log('Stream type: ' + String(stream.type));

    // Setup echo stream behavior.
    stream.on('data', (data) => {
      echoStream.send(data);
    });
    stream.on('close', () => {
      echoStream.close();
    });
  });

  // Log when client leaves close event.
  client.on('close', () => {
    console.log('Incoming client closed connection');
  });

  // Log any errors the client causes.
  client.on('error', (err) => {
    console.log('Incoming client had an error: ' + String(err));
  });
});

// Server has fully halted.
server.on('stop', () => {
  console.log('Stopped');
});

// Server has an error.
// We should check if the error is critical or not...
server.on('error', (err) => {
  console.log('Server error: ' + String(err));
});

server.start();


//// The following was to test some binding behavior.
//const keys = trip.mkKeyPair();
//console.log(keys);
//try {
//  const s0 = trip.mkSocket();
//  const s1 = trip.mkSocket({ address: 'localhost' });
//  const s2 = trip.mkSocket({ address: 'localhost', port: 9000 });
//  const s3 = trip.mkSocket({ address: '0.0.0.0', port: 3000 });
//  function cb(data) {
//    console.log(this.address());
//  }
//  s0.bind(cb.bind(s0));
//  s1.bind(cb.bind(s1));
//  s2.bind(cb.bind(s2));
//  s3.bind(cb.bind(s3));
//}
//catch (err) {
//  console.error(err);
//}



// The following is to test timestamp generation.
//const Long = require('long');
//
//const timestamp = Date.now();
//console.log(String(timestamp));
//const l = Long.fromNumber(timestamp, true);
//const n = Long.fromString(String(timestamp), true);
//console.log(l.toString());
//console.log(n.toString());
//const buf = Buffer.allocUnsafe(8);
//buf.writeUInt32BE(l.getHighBitsUnsigned(), 0);
//buf.writeUInt32BE(l.getLowBitsUnsigned(), 4);
//console.log(buf);
//const t = Long.fromBytesBE(buf, true);
//console.log(t.toString());

