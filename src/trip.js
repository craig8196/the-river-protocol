/**
 * @file Combines all resources into one module.
 * @author Craig Jacobson
 */
/* Core */
/* Community */
/* Custom */
const { createClientSocket, createServerSocket } = require('./connect.js');
const { createClient } = require('./client.js');
const { createServer } = require('./server.js');
'use strict';


module.exports = {
  createClientSocket,
  createServerSocket,
  createClient,
  createServer,
};

