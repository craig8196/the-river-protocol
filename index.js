#!/usr/local/bin/nodejs

const tripFactory = require('./src/trip.js');


const PORT = 20000;

tripFactory.instantiate((trip) => {
  console.log('HERE');
  const serverOptions = { port: PORT, address: ['0.0.0.0'] };
  const server = trip.createServer(trip.createServerSocket(serverOptions));
  const clientOptions = { port: PORT, address: 'localhost' };
  const client = trip.createClient(trip.createClientSocket(clientOptions));

  /*
  client.on('error', (error) => {
    console.log(error);
  });
  client.on('start', () => {
    console.log('Client start.');
  });
  client.on('bind', () => {
    console.log('Client bind.');
  });
  client.on('connect', () => {
    console.log('Client connected.');
  });
  client.on('mtu', (mtu) => {
    console.log('Client mtu: ' + mtu);
  });
  client.on('stream', (stream) => {
    console.log('Client stream connect.');
  });
  client.on('message', (stream, message) => {
    console.log('Client stream message.');
  });
  client.on('unstream', (stream) => {
    console.log('Client stream disconnect.');
  });
  client.on('disconnect', () => {
    console.log('Client disconnected.');
  });
  client.on('unbind', () => {
    console.log('Client unbind.');
  });
  client.on('stop', () => {
    console.log('Client stopped.');
  });

  server.on('error', (error) => {
    console.log(error);
  });
  server.on('start', () => {
    console.log('Server is starting.');
  });
  server.on('bind', () => {
    console.log('Server bind.');
  });
  server.on('mtu', (mtu) => {
    console.log('Server mtu: ' + mtu);
  });
  server.on('accept', (client) => {
    client.on('stream', (stream) => {
      stream.data = 'your data here';
      console.log('Server - stream connect.');
    });
    client.on('message', (stream, message) => {
      console.log('Server - stream message.');
    });
    client.on('unstream', (stream, code) => {
      console.log('Server - stream disconnect.');
    });
    client.on('destroy', (code) => {
      switch (code) {
        case trip.STREAM_OK:
          console.log('Server - client disconnect.');
          break;
        case trip.STREAM_NOPING:
          console.log('Server - client noping.');
          break;
        default:
          console.log('Server - client ... how did you get here?');
          break;
      }
    });
  });
  server.on('reject', (client) => {
    console.log('Server rejecting client: ' + client);
  });
  server.on('unbind', () => {
    console.log('Server unbind.');
  });
  server.on('stop', () => {
    console.log('Server has stopped.');
  });

  client.start();
  server.start();
  */
});

