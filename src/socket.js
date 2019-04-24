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
const { lengths } = require('./spec.js');
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

  close() {
    throw new Error('close unimplemented');
  }

  isClosed() {
    throw new Error('isClosed unimplemented');
  }

  mkKey(/* rinfo */) {
    throw new Error('mkKey unimplemented');
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

/**
 * Wrapper that abstracts the sending process so underlying details don't
 * need to be known by the protocol.
 */
class UdpSender extends SenderInterface {
  constructor(socket, port, address) {
    super();

    this.udpSocket = socket;
    this.udpPort = port;
    this.udpAddress = address;
  }

  get socket() {
    return this.udpSocket;
  }

  get address() {
    return String(this.udpAddress) + ':' + String(this.udpPort);
  }

  /**
   * Send the buffer as a packet to the destination.
   * @param {Buffer|[Buffer]} msg - The buffer/buffers that comprise the packet.
   * @param {Function} cb - Called when the data was sent so the buffer can be reused.
   */
  send(msg, cb) {
    this.socket.send(msg, this.udpPort, this.udpAddress, cb);
  }
}

/**
 * Wrapper around the UDP socket to normalize socket use so this protocol
 * can be extended to communicate over other mediums.
 */
class UdpSocket extends SocketInterface {
  constructor(udpType, port, address) {
    super();

    this._udpType = udpType;
    this._socket = dgram.createSocket(udpType);
    this._port = port;
    this._address = address;
    this._isClosed = false;
  }

  /**
   * Forward event listening to the underlying socket.
   */
  on() {
    this._socket.on.apply(this._socket, arguments);
  }
  
  /**
   * Remove event listening from the underlying socket.
   */
  off() {
    this._socket.off.apply(this._socket, arguments);
  }

  /**
   * Min: The minimum guaranteed to work MTU.
   * Rec: The recomended MTU to start using.
   * Max: The maximum MTU possible. For different sockets this may be unlimited,
   *      but it should be limited to 65,535 to prevent unreasonable memory 
   *      consumption or block other streams or connections indefinitely.
   * @return {[number, number, number]} Min, Recommended, Max MTU sizes.
   */
  get mtu() {
    return [lengths.UDP_MTU_DATA_MIN, lengths.UDP_MTU_DATA_REC, lengths.UDP_MTU_DATA_MAX];
  }

  /**
   * Get the underlying socket object.
   */
  get socket() {
    return this._socket;
  }

  get port() {
    return this._port;
  }

  get address() {
    return this._address;
  }

  /**
   * Get the address.
   * @return {string} Address in the format 'address:port'.
   */
  get fullAddress() {
    const addr = this._socket.address();
    return addr.address + ':' + String(addr.port);
  }
  
  /**
   * Generic bind call. This is so other socket types with different binding
   * can be used.
   * @param {Function} cb - The callback indicating success or failure.
   */
  bind(cb) {
    this._socket.bind({ exclusive: true, port: this._port, address: this._address }, cb);
  }

  /**
   * Close the underlying socket.
   */
  close() {
    this._isClosed = true;
    this._socket.close();
  }

  isClosed() {
    return this._isClosed;
  }

  mkKey(rinfo) {
    return String(rinfo.address) + ':' + String(rinfo.port);
  }

  /**
   * Since different sockets support different sending options this is a generic
   * way to pass through the specific options.
   * @param {Object} options - Location to send data.
   * @param {number} options.port - Required. The destination port.
   * @param {string} options.address - Required. The destination address.
   * @return {SenderInterface} The interface used to send data.
   */
  mkSender(options) {
    return new UdpSender(this._socket, options.port, options.address);
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

