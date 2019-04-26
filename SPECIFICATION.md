

# TRP SPECIFICATION

The following is the protocol specification.


## Definitions
**packet:** Raw data transmitted, not including return information.
**rinfo:** Return information.
**socket:** Interface to sending/receiving packet information.
**sender:** Context for sending to specific destination using a socket.
**router:** Basic packet validation and routing to connections.
**connection:** Individual connection between routers.
**stream:** Unidirectional messaging context.
**message:** Unit of data in a stream. Don't confuse with 'message' from dgram event.
**fragment:** Part of a message.
**client:** Simple wrapper for managing a single connection.
**server:** Simple wrapper for managing the classic server approach.


## Congestion Control
Even with low levels of data transmission there should be congestion control.
Different quantities of transmission may take different methods of control.

Packet loss transmission interval should be 1 second for regular loads and 500ms for smaller loads.
RTT is round trip time and only one packet should be sent for each RTT on light data loads.
RTT should be determined by ping/keep-alives.
RTT probably should be used to determine a timeout for send data.

For unreliable ordered data, the client should only send the last received per tick.
The server, if it receives multiple messages, it should deliver the latest complete messages and discard any earlier messages.

The client should report the last message index on the stream when requesting to close.
The server should not report currency if it needs client to slow, then client will use exponential backoff until the server is ready.
The ping will determine the connection liveness.

No matter the congestion control, pings should be immediate, but have a large gap between (30 seconds minimum).

On unordered unreliable pipes, the server should still report usage statistics every 10 seconds so packet drop rate can be determined.

Counts of total packets sent/received should be kept and exchanged on ping.
These can help determine the packet loss.
Counters should be reset on each ping? Or some reasonable interval.


## General Notes
* ENCRYPT_PADDING indicates that the following section is encrypted.
* Use exponential backoff up to 5 minutes (or similar) when resending (after 3 tries).
* Always assume breaking encrypted protocol is intended as malicious.
* After reasonable number of attempts, assume non-response as bad behavior.
* Malicious connections are terminated with reject.
* Malicious messages are dropped.
* Failed decryption indicates malicious intent.
* Currency is used to track the max number of outstanding packets for which need reliable sending.
* Streams are created on the fly. The cost of streams is incurred on tear-down.
* Re-typing a stream is an error and is considered malicious.
* Streams are unidirectional; client and server maintain separately indexed streams.
* Steps should be taken to prevent interference created by attaching encrypted data to a different packet type.
* Network endianness should be big endian, which is what is used when applicable.


## Timestamp
Timestamps are 8 octets and are milliseconds since the Unix epoch.


## Packet Types
Leading bit of Control value is set if message is encrypted.
Bits that are not specified must be zero and are reserved for future use.
The control value is added to the 5th octet of the nonce as part-of
packet replay protection.
Control:
0 - Stream
1 - Open
2 - Reject
3 - Challenge
4 - Accept
5 - Ping?


### Stream
These are the most common packet types, so zero is used.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 4 | Sequence
| 16 | Encrypt
| Variable | STREAM_REQUESTS+


### Open
If the address+port are already in use then reject as potentially malicious,
let a timeout cleanup the entry.
Otherwise, create a temporary entry for the client.
Floods of open connection requests should be met with increasingly reduced
timeouts;
if extreme cullings are taking place then errors will be emitted.
The packet is sealed with the servers public key, this helps ensure that the
correct server is being reached.
The ID for responses is done because the client may be juggling multiple
connections on the same port.
The timestamp is to help prevent packet replay, if the timestamp of the original
connection is significantly less than the current time, then we're experiencing
packet replay and they should be dropped without a second thought.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID (Zeros)
| 4 | Sequence
| 48 | Encrypt
| 4 | ID for responses
| 8 | Timestamp
| 2 | Version ID
| 2 | Initial currency
| 2 | Max streams
| 4 | Max message size
| 24 | Nonce client (Zeroes if unencrypted)
| 32 | Public key client (Zeroes if unencrypted)


### Reject
Servers reject invalid connections.
Options for ignoring connections that may be malicious should be provided.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID (Zero invalid)
| 4 | Sequence
| 48 | Encrypt
| 8 | Timestamp
| 2 | Rejection type
| 1+ | Message (Null terminated UTF-8 string, just null terminating byte if none)

Rejection types are:
0 - Unknown/Other
1 - Busy
2 - Incompatible version
3 - Unsafe connections not allowed
4 - Invalid request
5 - Violation of protocol
6 - User reject
7 - Server error


### Challenge
Challenge the OPEN request.
Return the server's nonce and public key for the connection.
Same format as OPEN.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 4 | Sequence
| 48 | Encrypt
| 4 | ID for requests
| 8 | Timestamp
| 2 | Version
| 4 | Initial currency
| 4 | Max streams
| 4 | Max message size
| 24 | Nonce server
| 32 | Public key server


### Accept
Accept the server's CHALLENGE request.
If the client does not respond then we close the connection.
The client cannot have lower limitations than the server.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 4 | Sequence
| 16 | Encrypt
| 8 | Timestamp
| 24 | Nonce of server again for confirmation


### Ping
Ping applies at the connection level, thus it is at its own level.
Ping other connection.
Try to re-resolve original connection information (maybe IP address changed).
Maybe port changed and wait for max amount of time until ping should have been
received before terminating connection.
Notify user if server is just un-reachable.
If valid reject found, then terminate connection.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 4 | Sequence
| 16 | Encrypt
| 8 | Timestamp
| 4 | RTT
| 24 | Nonce again for use as a key


## Stream Protocol
The Stream Protocol is internal and is after decryption to prevent malicious
messages.
All design should protect against packet replay.
As a checksum and to save an extra octet, the upper two bits of the Stream
Control value are used to store the stream type, when applicable.

0 - Ping
1 - Ping Response
2 - Data
3 - Data Validate
4 - Data Received
5 - Backpressure
6 - Backpressure Confirm
7 - Kill
8 - Kill Challenge
9 - Kill Accept
10 - Disconnect
11 - Disconnect Challenge
12 - Disconnect Accept


### Ping
Used to determine MTU as well as keep-alive.
The timestamp must be greater than the previous timestamp from the previous ping.
The returned response must have the same token and the senders timestamp.

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 8 | Timestamp
| 24 | Random value
| Variable | Padding


### Ping Response

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 8 | Timestamp
| 24 | Random value


### Data
Note that all numeric fields (stream id, sequence, fragment, total) are
listed as being one octet long; really the uppermost bit indicates continuation.
Thus, numbers can be unlimited, in theory. In practice, 4 octets should not
be exceeded for performance reasons and a conforming server should discard
and disconnect if this limit is exceeded for security reasons, however, 
allowing infinite sizes is within the standard (for unique use-cases and
future compatibility).
Limits are specified by the users of the protocol and going outside them breaks
the standard, the connections are dropped by conforming implementations.
The maximum message size until unlimited amounts are implemented is UMTU * 127.
Note that default limits are set to be reasonable values for modern
clients/servers.
| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 1 | Stream Id
| 1 | Sequence
| 1 | Fragment
| 1 | Fragment Total
| 2 | Payload Length
| V | Payload


### Data Validate

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 2 | Stream Id
| 4 | Sequence
| 1 | Fragment


### Data Received

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 2 | Stream Id
| 4 | Sequence
| 1 | Fragment


### Backpressure

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 1 | Start/stop
| 8 | Timestamp
| 2 | Stream Id


### Backpressure Confirm

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 1 | Start/stop
| 8 | Timestamp
| 2 | Stream Id


### Kill

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 8 | Timestamp
| 2 | Stream Id
| 4 | Final sequence value


### Kill Challenge

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 8 | Timestamp
| 2 | Stream Id
| 4 | Final sequence value


### Kill Accept

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 8 | Timestamp
| 2 | Stream Id
| 4 | Final sequence value


### Disconnect

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 8 | Timestamp
| 24 | Random token


### Disconnect Challenge

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 8 | Timestamp
| 24 | Random token


### Disconnect Accept

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 8 | Timestamp
| 24 | Random token

