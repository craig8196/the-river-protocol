
const dgram = require('dgram');
const isIp = require('is-ip');
const isValidPath = require('is-valid-path');


// TODO create a way for IPC using the same methodologies.
class UdsSocketWrapper {
  constructor(address) {
  }
}

class UdpSocketWrapper {
  constructor(options) {
    this.udp = dgram.createSocket('udp4');
    this.bindAddress = options.address;
    this.bindPort = options.port;
    this.sendAddress = options.sendAddress;
    this.sendPort = options.sendPort;

    this.udp.on('listening', this.doListening.bind(this));
  }

  doListening(args) {
    this.emit('listening', args);
  }

  on() {
    this.udp.on.apply(this.udp, arguments);
  }
  
  bind(cb) {
    if (this.bindAddress) {
      this.udp.bind(this.bindPort, this.bindAddress);
    }
    else {
      this.udp.bind(this.bindPort, cb);
    }
  }

  send(msg, cb) {
    this.udp.send(msg, this.sendPort, this.sendAddress, cb);
  }
}

/**
 * Creates
 * @function
 * @param {SocketType} socket_type - Required. Specify what type of connection this is for.
 * @param {Object} options - Required
 * @param {string} options.port - The port to bind to, random if not specified.
 * @param {string} options.address - The address to bind to, random if not specified.
 * @return
 */
function createClientSocket(options) {
  options.exclusive = true;
  return new UdpSocketWrapper('udp4', options);
  /*
  let socket_type = 'local';
  let sanitized_options = {
    'exclusive': true,
  };

  if (options.port) {
    if (!(Number.isInteger(options.port) && options.port <= 65535 && options.port >= 1)) {
      throw new Error('Invalid port value: ' + options.port);
    }
    sanitized_options.port = options.port;
  }

  if (options.address) {
    if (isIp.v4(options.address)) {
      socket_type = 'udp4';
    }
    else if (isIp.v6(options.address)) {
      socket_type = 'udp6';
    }
    else if (isValidPath(options.address)) {
      socket_type = 'local';
    }
    else {
      throw new Error('Invalid IP address: ' + options.address);
    }
    sanitized_options.address = options.address;
  }
  else {
    sanitized_options.address = 
  }

  if (socket_type !== 'local') {
    return new UdpSocketWrapper(socket_type, sanitized_options);
  }
  else {
    return new UdsSocketWrapper(sanitized_options.address);
  }
  */
}

function createServerSocket(socketType, options) {
}

module.exports = {
  createClientSocket,
  createServerSocket,
};

