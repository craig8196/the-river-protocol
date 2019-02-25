

# TRP SPECIFICATION

The following is the protocol specification.


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
Timestamps are 8 bytes and are milliseconds since the Unix epoch.


## Packet Types
Leading bit of Control value is set if message is encrypted.
Bits that are not specified can be any value (zero is recommended though).
Control:
0 - Stream
1 - Open
2 - Reject
3 - Challenge
4 - Accept


### Stream
These are the most common packet types, so zero is used.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 4 | Sequence
| 16 | Encrypt
| Variable | REQUESTS+


### Open
If the address+port are already in use then reject as potentially malicious,
let a timeout cleanup the entry.
Otherwise, create a temporary entry for the client.
Floods of open connection requests should be met with increasingly reduced
timeouts;
if extreme cullings are taking place then errors will be emitted.
The packet is sealed with the servers public key, this helps ensure that the
correct server is being reached.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 48 | Encrypt
| 4 | ID for responses
| 2 | Version ID
| 24 | Nonce client
| 32 | Public key client


### Reject
Servers should reject invalid connections out of politeness.
Options for ignoring connections that may be malicious should be provided.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 4 | Sequence
| 16 | Encrypt
| 1 | Stream control byte (0xFF)
| 2 | Rejection type
| 24 | Random data

Rejection types are:
0 - Unknown/Other
1 - Whitelist
2 - Overloaded with requests/connections
3 - Invalid request
4 - Incompatible version
5 - No space
6 - User reject
7 - Server error


### Challenge
Challenge the connect request.
Return the server's nonce and public key.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 16 | Encrypt
| 2 | Max streams
| 2 | Initial currency
| 4 | ID for requests
| 24 | Nonce server
| 32 | Public key server


### Accept
Accept the server's challenge.
If the client does not respond then we close the connection.
The client cannot have lower limitations than the server.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 16 | Encrypt
| 2 | Max streams
| 2 | Initial currency
| 24 | Nonce again for confirmation


## Stream Protocol
The Stream Protocol is internal and is after decryption to prevent malicious
messages.
All design should protect against packet replay.
As a checksum and to save an extra byte, the upper two bits of the Stream
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

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 2 | Stream Id
| 4 | Sequence
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

