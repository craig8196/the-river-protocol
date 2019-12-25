/**
 * @file Example usage of TRIP.
 */
const trip = require('./src/trip.js');
const { info, crit } = require('./src/util.js');
const { defaults } = require('./src/spec.js');


// Create server object.
// Server is started at end of script.
// Default port is 42443 when null is passed.
const server = trip.mkServer(null, { allowUnsafeOpen: true });

// Start server. Binds to underlying interface.
server.on('start', () => {
  info('Server starting up...');
});

// We can now successfully connect to the server.
server.on('listen', () => {
  info('Ready to accept connections.');

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
    stream.send('Take a round TRIP!');

    client.close();
  });

  // Server should be opening an echo stream.
  client.on('stream', (stream) => {
    info('Stream created from server.');

    stream.on('data', (data) => {
      info('Echo data: ' + data.toString('utf8'));
    });

    stream.on('close', () => {
      info('Close stream');
    });
  });

  // An error occurred, shut everything down.
  client.on('error', (err) => {
    crit('Client error: ' + String(err));
    server.stop();
    client.close();
  });

  // Closed, no data may be sent.
  client.on('close', () => {
    info('Client closed');
    server.stop();
  });

  // Now we tell to connect.
  client.open({ address: 'localhost', port: defaults.PORT });
});

// Screen incoming OPEN requests. Accept all for testing.
server.screen((binary, address) => {
  info('Screening: ' + binary.toString('hex') + '/' + String(address));
  return true;
});

// Client passed 'screen' and 'whitelist'.
server.on('accept', (client) => {
  // Automatically open stream for echoing.
  // We determine the stream ID, reliability, ordered
  const echoStream = client.mkStream(0, true, true);

  // New incoming stream.
  client.on('stream', (stream) => {
    info('Stream type: ' + String(stream.type));

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
    info('Incoming client closed connection');
  });

  // Log any errors the client causes.
  client.on('error', (err) => {
    crit('Incoming client had an error: ' + String(err));
  });
});

// Server has fully halted.
server.on('stop', () => {
  info('Stopped');
});

// Server has an error.
// We should check if the error is critical or not...
server.on('error', (err) => {
  crit('Server error: ' + String(err));
});

server.start();

