

# TRiP PROTOCOL SPECIFICATION
The details. Onwaaaard!


## Definitions and Terms
**packet:** Raw data transmitted, including IP, UDP, and other headers.
**segment**: Raw data once non-TRiP headers are stripped.
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
**peer:** The other end of the connection.
**notify:** Notification to disconnect.
**disconnect:** Disconnect without any further waiting.  
**kill:** Hard disconnect without sending anything further.


## Overview
The River Protocol (TRiP) is intended to be a flexible protocol that allows
for the easy building of custom protocols.
TRiP is designed to be abstracted with security by default.
TRiP is designed to allow for different types of communication.
Hopefully you find TRiP useful for your application.
Enjoy!


## Dependencies
Code for version 0 is dependent on NaCl or libsodium for encryption.
Code implementing TRiP over UDP based communication is dependent on appropriate OS interfaces.


## VarInts and Serialization
Variable length integers are denoted as "V" in the octets column.
Variable length fields the length is listed first followed by data, denoted "VD".
Note that the allowed length of a field may depend on implementation.
Note that the allowed length may be limited by packet size.
Use variable integral type encoding which are little endian.
See https://developers.google.com/protocol-buffers/docs/encoding


## Transmission Profiles
Transmission profiles are sets of default settings according to use-case.
By specifying good defaults programmers are less prone to errors or
choosing ineffective, sub-optimal settings.
TODO specify different profiles here...


## Congestion Control
Even with low levels of data transmission there should be congestion control.
Different quantities of transmission may take different methods of control.
TODO reference correct parts of rfc8085

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


## User ID
The ID field in an OPEN request is discarded.
However, it could be used to map to a specific login key.


## Sequence Numbers
The sequence numbers may start at any value before to 2^30.
However, whatever is chosen by the connecting party must be used for a time
before resetting.
Resetting the sequence numbers also resets nonce and keys to prevent
obscure attacks with packet replay.
TODO TCP recommends random initial sequence number to avoid stail packets...
TODO does this apply?
TODO can an issue arise if a connection on the same ports is opened/closed in quick succession??
TODO what is the MSL (Max Segment Lifetime)?
TODO are segments unique to TCP?
TODO I'm thinking that use of encryption may eliminate need for random sequence numbers...


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
Open
Challenge
Response
Forward
Ping
Renew
Renew Confirm
Disconnect Notice
Disconnect Notice Confirm
Disconnect
Disconnect Confirm
Reject


### PREFIX
Prefixed to every transmission.
| Octets | Field |
|:------ |:----- |
| 1 | Control
| 4 | ID
| 4 | Sequence


### Stream
These are the most common packet types, so zero is used.

| Octets | Field |
|:------ |:----- |
| PRE | PREFIX
| 16 | Encrypt
| VD | STREAM+


### Reject
Servers reject invalid connections.
Options for ignoring connections that may be malicious should be provided.
Considerations for DDoS Amplification should be taken into account.

| Octets | Field |
|:------ |:----- |
| PRE | PREFIX
| 48 | Encrypt
| 8 | Timestamp
| 2 | Rejection type
| VD | Message (UTF-8 string)

Rejection types are:
0 - Unknown/Other
1 - Busy
2 - Incompatible version
3 - Unsafe connections not allowed
4 - Invalid request
5 - Violation of protocol
6 - User reject
7 - Server error


### OPEN
If the address+port are already in use then reject as potentially malicious,
let a timeout cleanup the entry.
Otherwise, create a temporary entry for the client.
Floods of open connection requests should be met with increasing rejections
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
TODO add SIGNATURE
TODO remove encrypted OPEN feature??? Signatures should be valid enough, right?

| Octets | Field |
|:------ |:----- |
| PRE | PREFIX
| 2 | Major Version ID
| VD | Routing Information (Binary)
| OPENING INFO |


### Challenge
Challenge the OPEN request.
Return the server's nonce and public key for the connection.
Same format as OPEN.
If the OPENING INFO has different keys on resubmissions then it is considered malicious and the connection is terminated.
TODO add SIGNATURE

| Octets | Field |
|:------ |:----- |
| PRE | PREFIX
| OPENING INFO |


### OPENING INFO
SECURITY: The signature of the OPEN segment is zero for public servers.
SECURITY: The signature of the OPEN segment MUST sign entire packet for private servers.
SECURITY: The signature of the CHALLENGE segment SHOULD be checked.
SECURITY: The signature of the CHALLENGE segment MUST also sign the OPEN segment.
SECURITY: The signature of the CHALLENGE segment MUST be done for public servers.
| Octets | Field |
|:------ |:----- |
| 48 | Encrypt Padding
| 4 | Receiver ID for future responses/requests
| 8 | Timestamp
| 24 | Nonce client (Zeroes if unencrypted)
| 32 | Public key client (Zeroes if unencrypted)
| 2 | Sender Max Currency
| 2 | Sender Currency Rate
| 2 | Sender Max Streams
| 4 | Sender Max Message
| S | SIGNATURE (OUTSIDE ENCRYPTION) |

TODO should this be a part of it???
| 1 | Allowed stream types, cannot be zero.


### Forward
TODO should this be re-labeled "redirect"??
Forwarding instructions.
Should only be used with encryption.
| Octets | Field |
|:------ |:----- |
| PRE | PREFIX
| 4 | ID (Zeros or ANY)
| 4 | Sequence
| 48 | Encryption.
| 2 | Major Version ID
| VD | LOCATIONS+
TODO.


### Response
TODO should a ping just be returned and make pinging the connector's responsibility???
TODO currently proceeding to use PING as the response and see if any issues arrive.
Accept the server's CHALLENGE request.
If the client does not respond with this then the connection is closed.
The client cannot have lower limitations than the server.

| Octets | Field |
|:------ |:----- |
| PRE | PREFIX
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
| PRE | PREFIX
| 16 | Encrypt
| 24 | Random
| 8 | Timestamp
| 4 | RTT
| 4 | Sent Count
| 4 | Received Count


### Renew
Reset the sequence and get new keys.

| Octets | Field |
|:------ |:----- |
| PRE | PREFIX
| 16 | Encrypt
| 4 | Non-zero New Sequence
| 24 | New Nonce
| 32 | New Key


### Renew Confirm
Confirm that the reset has taken place.

| Octets | Field |
|:------ |:----- |
| PRE | PREFIX
| 16 | Encrypt
| 4 | Non-zero Old Sequence
| 24 | Old Nonce
| 32 | Old Key

### Disconnect Notify
TODO soft notice

### Disconnect Notify Confirm
TODO soft notice

### Disconnect
Disconnect and nicely terminate connection.
Every stream by compliant peer should be closed prior.
After reasonable threshold, resend if not confirmed until confirmed, rejected, or timeout.

| Octets | Field |
|:------ |:----- |
| PRE | PREFIX
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
| PRE | PREFIX
| 16 | Encrypt
| 8 | Timestamp
| 24 | Nonce


### STREAM
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
| V | Stream Id
| V | Sequence
| V | Fragment
| V | Fragment Total
| VD | Payload


### Data Validate Received

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| V | Stream Id
| V | Sequence
| V | Fragment


### Data Received

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| V | Stream Id
| V | Sequence
| V | Fragment


### Backpressure

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 1 | Start/stop
| 8 | Timestamp
| V | Stream Id


### Backpressure Confirm

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| 1 | Start/stop
| 8 | Timestamp
| V | Stream Id


### Close

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| V | Stream Id
| V | Final sequence value


### Close Confirm

| Octets | Field |
|:------ |:----- |
| 1 | Stream Control
| V | Stream Id
| V | Final sequence value


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
Address how TRiP handles known attacks.


### Encryption Attack
**Problem:**
Current encryption methods are found to be vulnerable or broken.
**Solution:**
Use another method of encryption.
Update software.
**TRiP:**
Apply new methods of encryption and incrementing the version counter.
Software will need to be updated.
Attacks can proceed against outdated software.
Reject incorrect version numbers to help prevent exposing the vulnerability.
Reject incorrect version numbers to signal that a party must update.


### DDoS Attack
**Problem:**
Sending too many packets
**Solution:**
No known server-side solution.
Mitigated through ISP, Firewall, or intermediate network devices.
**TRiP:**
Rate limit OPEN connections.
Encrypted communications helps drop erroneous segments.


### DDoS Reflection/Amplification Attack
**Problem:**
Create IP packets with the return IP address and port set to the network to DDoS.
Amplified if the response is larger than the request.
**Solution:**
No known perfect solution.
Mitigated by having smaller responses than the request.
**TRiP:**
Mitigated by having known public key for OPEN connection.
Nature of encryption-by-default should help mitigate.
Size of OPEN packet is larger than CHALLENGE, so it won't amplify.
Rate limiting REJECT segments.
Temporarily tracking "sender" can reduce reject messages or OPEN accepts.
No perfect fix for public servers with unencrypted OPEN.
Mitigated by encrypting communication; if decryption fails the segment is dropped.


### Packet Replay
**Problem:**
Packet is captured and resent potentially multiple times.
**Solution:**
Mitigated with sequence numbers and timestamps.
Encryption can ensure that tampering cannot occur, but does not prevent replay.
**TRiP:**
Use a combination of control, sequences, timestamps, encryption, nonces.
OPEN messages can be replayed with no damage or success.
If a connection is already OPENed then the packet is dropped.

If an encrypted STREAM packet is replayed after a stream is closed, data
could be injected if that packet didn't originally arrive at the destination.
Old information would get injected to a newly created stream.
Shrinking the sequence window upon a stream will mitigate this scenario.
The sequence window must be shrunken to the last sequence number given to the stream.

Replay a previously unreceived PING packet in a low-flow application could be an issue.
Timestamps are sent with each PING.
The response PING replies with the same timestamp.
PINGs with mismatched timestamps should be discarded as an attempt at packet replay.


### Man-in-the-Middle
**Problem:**
Intercept communications, effectively controlling what is sent.
**Solution:**
No known perfect solution.
No solution to flow control, packet corruption, or packet injection.
Mitigate packet source validation with encryption and signatures.
Mitigate spoofing of packets with encryption.
**TRiP:**
Signatures used in OPEN handshake.
Encrypted OPEN to prevent spoofing.
Validity of connection maintained with continued encryption.
Mitigate with signatures.


### Packet Injection
**Problem:**
IP/UDP allows any source address and port to be set.
Servers reading the packets will believe they were sent from the specified source address.
Clients may connect to incorrect servers.
**Solution:**
No known solution.
Mitigated by difficulty of timing.
Mitigated with encryption and signatures.
**TRiP:**
No mitigation when signatures and encryption are not used.
Drop packets that don't make sense.
Rate limit reject messages.
Ignore unsigned REJECT messages.
Ignore unsigned CHALLENGE messages.
Ignore unsigned FORWARD messages if using unencrypted OPEN.
Disallow changing destination IP:PORT during OPEN handshake.
Established connections use encryption.
OPEN message can be encrypted.

Even when using encrypted OPEN segments there is a possibility of connecting to the wrong server
if the attacker has the OPEN key.
Let's assume the server can redirect or connect you to a different server using
FORWARD or acting as a proxy.
If the attacker knows the OPEN key,
then they can forge a packet with different routing information.
The server will be able to decrypt, and sign a different FORWARD or CHALLENGE packet.
If the CHALLENGE packet is accepted by the client,
then they are connected to the incorrect server.
This does rely on chance or the ability to block packets.
Will prevent by signing at least the route in the OPEN request.

