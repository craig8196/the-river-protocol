/**
 * @file Wrappers for different socket types to make sockets generic.
 * @author Craig Jacobson
 */
/* Core */
const dgram = require('dgram');
/* Community */
const isIp = require('is-ip');
const isValidPath = require('is-valid-path');
/* Custom */
'use strict';


class SocketInterface {
  constructor() {
  }

  on() {
    throw new Error('on unimplemented');
  }

  off() {
    throw new Error('off unimplemented');
  }

  bind() {
    throw new Error('bind unimplemented');
  }

  mkSender() {
    throw new Error('mkSender unimplemented');
  }
}

class SenderInterface {
  constructor() {
  }

  send(msg, cb) {
    cb(new Error('send unimplemented, message not delivered: ' + String(msg)));
  }
}

class UdpSender extends SenderInterface {
  constructor(socket, port, address) {
    super();

    this.socket = socket;
    this.port = port;
    this.address = address;
  }

  send(msg, cb) {
    this.socket.send(msg, this.port, this.address, cb);
  }
}

class UdpSocket extends SocketInterface {
  constructor(udpType, port, address) {
    super();

    this.udpType = udpType;
    this.socket = dgram.createSocket(udpType);
    this.port = port;
    this.address = address;
  }

  on() {
    this.socket.on.apply(this.socket, arguments);
  }
  
  off() {
    this.socket.off.apply(this.socket, arguments);
  }
  
  bind(cb) {
    this.socket.bind({ exclusive: true, port: this.port, address: this.address }, cb);
  }

  mkSender(dest) {
    return new UdpSender(this.socket, dest.port, dest.address);
  }
}

/**
 * Creates a socket using for the protocol.
 * @param {Object} options - Optional.
 * @param {number} options.port - Optional. The port to bind to, random if not specified.
 * @param {string} options.address - Optional. The address to bind to, all if not specified.
 * @return A new socket wrapper ready to be used by the framework.
 */
function mkSocket(options) {
  let socket_type = 'udp4';

  if (!options) {
    options = {};
  }

  if (options.address) {
    if ('localhost' === options.address) {
      options.address = undefined;
      socket_type = 'udp4';
    }
    else if (isIp.v4(options.address)) {
      socket_type = 'udp4';
    }
    else if (isIp.v6(options.address)) {
      socket_type = 'udp6';
    }
    else if (isValidPath(options.address)) {
      socket_type = 'local';
    }
    else {
      throw new Error('Invalid address: ' + options.address);
    }
  }
  else {
    options.address = undefined;
  }

  if (options.port) {
    if (!(Number.isInteger(options.port) && options.port <= 65535 && options.port >= 1)) {
      throw new Error('Invalid port: ' + options.port);
    }
  }


  if (socket_type !== 'local') {
    return new UdpSocket(socket_type, options.port, options.address);
  }
  else {
    throw new Error('UDS support not available yet.');
  }
}

module.exports = {
  SocketInterface,
  SenderInterface,
  mkSocket,
};

