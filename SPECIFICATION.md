

# TRiP SPECIFICATION
The following is the protocol specification.


## Definitions and Terms
**packet:** Raw data transmitted, not including IP or UDP header.
**rinfo:** Return information.  
**socket:** Interface to sending/receiving packet information.  
**sender:** Context for sending to specific destination using a socket.  
**router:** Basic packet validation and routing to connections.  
**connection:** Individual connection between routers.  
**stream:** Unidirectional messaging context.  
**message:** Atomic unit of data in a stream.  
         Don't confuse with 'message' from dgram event.  
**fragment:** Part of a message.  
**client:** The peer seeking to OPEN a connection.  
**server:** The peer receiving the OPEN request.  
**peer**: Client or server router able to create connections.  
**disconnect/closed**: Soft disconnect with proper notification.  
**terminate**: Hard disconnect without any notification.  


## Overview
TODO


## Congestion Control
Even with low levels of data transmission there should be congestion control.
Different quantities of transmission may take different methods of control.

**Retransmission:**
Packet loss retransmission interval should be 1 second for regular loads and 500ms for smaller loads.
Retransmission may be customized for real-time applications.
RTT + Estimated Response Time + Timing Variance could be a good alternative.

**Transmission rates:**
Controlled by currency.
If out-of-currency, for unreliable, earn at rate of currency per RTT.
If out-of-currency, for reliable, earn when data is confirmed for delivery.

**Rount-trip time (RTT) and transmission rates:**
RTT is round trip time and only one packet should be sent for each RTT on light data loads.
RTT should be determined by ping/keep-alives.
RTT probably should be used to determine a timeout for send data.

**Unreliable-ordered data:**
The client should only send the last received per tick.
The server, if receiving multiple messages, should deliver the latest complete messages and discard any earlier messages.

**Inc/dec transmission rates:**
The server may increase or decrease currency rates at any time.
The server may increase or decrease streams allowed at any time.
Zero indicates that the streams are blocked.
The client may increase or decrease, however, this could be considered a breach of custom protocol.

**Ping:**
The ping will determine the connection liveness.
No matter the congestion control, pings should be immediate,
but have a large gap between (30 seconds minimum).
Exponential backoff should be used when resending.
The peer should still report statistics (sent/received) every ping so packet drop rate can be determined.


## General Notes
* "Encrypt" indicates that the following section is encrypted.
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
* Network endianness is big endian, which is what is used where applicable.
* Compliant implementation should perform timeouts for cleanup to advance sequence counter thresholds.
* Implementations should allow for asynchronous behavior with proper interfaces.


## Timestamp
Timestamps are 8 octets and are milliseconds since the Unix epoch.


## Packets
Leading bit of Control value is set if message is encrypted.
Bits that are not specified must be zero and are reserved for future use.
The control value is added to the 5th octet of the nonce as part-of packet replay protection.

Control numbering starts at zero:
Stream
Reject
Open
Open Challenge
Open Accept
Ping
Renew
Renew Confirm
Disconnect
Disconnect Confirm


### Stream
These are the most common packet types, so zero is used.

| Octets | Field |
|:------ |:----- |
| 1 | Control = 0
| 4 | ID
| 4 | Sequence
| 16 | Encrypt
| Variable | STREAM_REQUESTS+


### Reject
Servers reject invalid connections.
Options for ignoring connections that may be malicious should be provided.
Considerations for DDoS Amplification should be taken into account.

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


### Open
If the address+port are already in use then reject as potentially malicious,
let a timeout cleanup the entry.
Otherwise, create a temporary entry for the client.
Floods of open connection requests should be met with increasing rejctions
and fewer accepted packets.
If extreme cullings are taking place then errors will be emitted.
The packet is sealed with the servers public key, this helps ensure that the
correct server is being reached.
The ID for responses is done because the client may be juggling multiple
connections on the same port.
The timestamp is to help prevent packet replay, if the timestamp of the original
connection is significantly less than the current time, then we're experiencing
packet replay and they should be dropped without a second thought.
The Version ID is listed outside the encrypted data so the correct encryption
scheme can be used.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 2 | Major Version ID
| 4 | ID (Zeros)
| 4 | Sequence
| 48 | Encrypt
| OPENING INFO |


### Challenge
Challenge the OPEN request.
Return the server's nonce and public key for the connection.
Same format as OPEN.
If the OPENING INFO has different keys on resubmissions then it is considered mailicious and the connection is terminated.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 2 | Major Version ID
| 4 | ID
| 4 | Sequence
| 48 | Encrypt
| OPENING INFO |


### OPENING INFO
| 4 | ID for future responses/requests
| 8 | Timestamp
| 2 | Max Currency
| 2 | Currency Rate
| 2 | Max Streams
| 4 | Max Message
| 24 | Nonce client (Zeroes if unencrypted)
| 32 | Public key client (Zeroes if unencrypted)


### Accept
Accept the server's CHALLENGE request.
If the client does not respond with this then the connection is closed.
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
Ping peer connection.
Ping applies at the connection level, hence a ping control flag.
Both should be sending pings around the same time.
Pings are sent in response to pings until the ping requisite is satisfied.
Exponential backoff up to ping interval.
For network robustness a client/server can pause a connection, however, the
default is for the client/server to terminate.
Try to re-resolve original connection information (maybe IP address changed).
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
| 4 | Sent Count
| 4 | Received Count


### Renew
Reset the sequence and get new keys.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 4 | Sequence
| 16 | Encrypt
| 4 | Non-zero New Sequence
| 24 | New Nonce
| 32 | New Key


### Renew Confirm
Confirm that the reset has taken place.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 4 | Sequence
| 16 | Encrypt
| 4 | Non-zero Old Sequence
| 24 | Old Nonce
| 32 | Old Key


### Disconnect
Disconnect and nicely terminate connection.
Every stream by compliant peer should be closed prior.
After reasonable threshold, resend if not confirmed until confirmed, rejected, or timeout.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 4 | Sequence
| 16 | Encrypt
| 8 | Timestamp
| 24 | Nonce


### Disconnect Confirm
Confirm that connection is disconnected.
Every stream by compliant peer should be closed prior to acknowledgement.
The ID should not be immediately reused.
If no ID is found the peer should respond with reject if DDoS amplification is not detected.

| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 4 | Sequence
| 16 | Encrypt
| 8 | Timestamp
| 24 | Nonce


## Stream Protocol
The Stream Protocol is internal and is parsed after decryption.
As a checksum and to save an extra octet, the upper two bits of the Stream Control value are used to store the stream type, when applicable.
Streams are optimistic, so they are opened with data being sent.
Streams must be controled and closed using Stream Control.
Any violation of protocol will be considered malicious and the connection will be terminated.

Control numbering starts at zero:
Data
Data Validate Received
Data Received
Backpressure
Backpressure Confirm
Close
Close Confirm


### Data
Note that all numeric fields (stream id, sequence, fragment, total) are listed as being one octet long; really the uppermost bit indicates continuation.
Thus, numbers can be unlimited, in theory. In practice, 4 octets should not be exceeded for performance reasons and a conforming server should discard and disconnect if this limit is exceeded for security reasons, however, allowing infinite sizes is within the standard (for unique use-cases and future compatibility).
Limits are specified by the users of the protocol and going outside them breaks the standard, the connections are terminated by conforming implementations.
The maximum message size until unlimited amounts are implemented is UMTU * 127.
Note that default limits are set to be reasonable values for modern clients/servers.

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 1+ | Stream Id
| 1+ | Sequence
| 1+ | Fragment
| 1+ | Fragment Total
| 2 | Payload Length
| V | Payload


### Data Validate Received

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 1+ | Stream Id
| 1+ | Sequence
| 1+ | Fragment


### Data Received

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 1+ | Stream Id
| 1+ | Sequence
| 1+ | Fragment


### Backpressure

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 1 | Start/stop
| 8 | Timestamp
| 1+ | Stream Id


### Backpressure Confirm

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 1 | Start/stop
| 8 | Timestamp
| 1+ | Stream Id


### Close

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 1+ | Stream Id
| 1+ | Final sequence value


### Close Confirm

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 1+ | Stream Id
| 1+ | Final sequence value


### Reconfigure

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 2 | Max Currency
| 2 | Currency Rate
| 2 | Max Streams
| 4 | Max Message


### Reconfigure Confirm
| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 2 | Max Currency
| 2 | Currency Rate
| 2 | Max Streams
| 4 | Max Message


## Attack Mitigation
Here we outline attack vectors and how they are overcome or mitigated.
TODO - add additional details and analysis.

### DDoS
No known server-side solution.
ISP, Firewall, and intermediate network devices may have ways of mitigating.
Incoming traffic can be increasingly dropped and only established connections can be handled.

### DDoS Amplification
**Problem:**
Creating IP packets with the return IP address and port set to the network to DDoS.
**Solution:**
No known perfect solution.
**TRiP:**
Fixed by having known public key that is kept secret for OPEN connection.
No perfect fix for public servers with unencryped OPEN or known public key.
Mitigated by limiting OPEN packets and dropping invalid requests.

### Packet Replay
Sequences, nonce, control, timestamps.

### Man-in-the-Middle
No known perfect solution.
Fixed by using public key known in advance for OPEN connection.

### Man-in-the-Middle Through Packet Injection
While this is tricky and unlikely due to timing there are ways of mitigating.
Fixed by using public key known in advance for OPEN connection.
Mitigated by timing.

### Packet Injection
Disrupting services through IP/UDP packet fabrication.
Established connections


