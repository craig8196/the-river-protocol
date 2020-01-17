/**
 * @file Example usage of TRIP.
 */
const trip = require('./src/trip.js');
const { info, crit } = require('./src/log.js');
const { defaults } = require('./src/protocol.js');

const openKeys = trip.mkKeyPair();
const signKeys = trip.mkSignPair();

// Create server object.
// Server is started at end of script.
// Default port is 42443 when null is passed.
const server = trip.mkServer(null, { openKeys, signKeys });

// Start server. Binds to underlying interface.
server.on('start', () => {
  info('Server starting up...');
});

// We can now successfully connect to the server.
server.on('listen', () => {
  info('Ready to accept connections.');

  // Create client. In theory a client could be opened on the server's
  // Router object, but we want to simulate a client connection.
  // Choose any open port by passing null or leaving blank.
  const client = trip.mkClient();

  // Connect call at bottom of this block.

  // Successful connection.
  client.on('connect', () => {
    // Since the server specifies limitations in advance we can create a
    // stream and let the framework handle details, like flow control.
    const stream = client.mkStream(0, true, true);

    // By default the framework should convert the string to UTF-8.
    stream.send('Hello, world!');
    stream.send('Take a round TRIP!');
    stream.end(null);

    setTimeout(function closeConnection() {
      client.close();
    }, 1);
  });

  // Server should be opening an echo stream.
  client.on('stream', (stream) => {
    info('Stream created from server.');

    info(stream.id);

    stream.on('data', (data) => {
      info('Echo data: ' + data.toString('utf8'));
    });

    stream.on('close', () => {
      info('Close stream');
    });
  });

  // An error occurred, shut everything down.
  client.on('error', (err) => {
    crit('Client error: ', err);
    server.stop();
    client.close();
  });

  // Closed, no data may be sent.
  client.on('close', () => {
    info('Client closed');
    server.stop();
  });

  // Now we tell to connect.
  // TODO we shouldn't have to specify the default port...
  const destination = { address: 'localhost', port: defaults.PORT };
  const options = { openKey: openKeys.publicKey, unsignKey: signKeys.publicKey };
  client.open(destination, options);
  // TODO should this be formatted as:
  // client.open(mkConnection(dest, options));
  // ???
});

// Screen incoming OPEN requests. Accept all for testing.
server.screen((id, routing, sigBuf, sig, address) => {
  info('Screening id:', id);
  info('Screening routing info:', routing);
  info('Screening signature:', sig);
  info('Screening address:', address);
  return true;
});

// Client passed 'screen'.
// Note that 'client' in this context is a connection.
// The other 'client' in this script is both a router and connection.
server.on('accept', (client) => {
  // Automatically open stream for echoing.
  // We determine the stream ID, reliability, ordered
  const echoStream = client.mkStream(0, true, true);

  // New incoming stream.
  client.on('stream', (stream) => {
    info('Stream type: ', String(stream.type));

    // Setup echo stream behavior.
    stream.on('data', (data) => {
      echoStream.send(data);
    });
    stream.on('error', (err) => {
      warn('Server stream error:', err);
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
    crit('Incoming client had an error: ', err);
  });
});

// Server has fully halted.
server.on('stop', () => {
  info('Stopped');
});

// Server has an error.
// We should check if the error is critical or not...
server.on('error', (err) => {
  crit('Server error: ', err);
});

server.start();

