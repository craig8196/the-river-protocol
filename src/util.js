/**
 * @file Miscellaneous utilities.
 * @author Craig Jacobson
 */
/* Core */
/* Community */
const { uuidv4 } = require('uuid');
/* Custom */
'use strict';


function createEmptyConnectionId() {
  let id = Buffer.alloc(CONNECTION_ID_LENGTH, 0);
  return id;
}

function createConnectionId() {
  let id = Buffer.alloc(CONNECTION_ID_LENGTH);
  uuidv4(null, id, 0);
  return id;
}

module.exports = { createEmptyConnectionId, createConnectionId };

