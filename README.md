
# The River Protocol (TRP)
The River Protocol (TRP, pronounced "trip") is a way to send data faster and in larger quantities
while managing how it is sent more sanely.
TCP Currently suffers from certain problems, including:
* Difficult to implement security
* Slow handshake when doing security (one for the connection, one for encryption)
* Head-of-line blocking
* No unreliable send
* No unordered, reliable messaging
* Persistent connections that can be hibernated
* Heavy-weight when managing many connections to the same destination
* Requires another protocol to send multiple messages/streams on the same connection

**WARNINGS:**
* This code is experimental and may have flaws.
* I know state machines can be ugly, but it's how I kept my sanity.
* Currently in pre-release and will not follow semantic versioning until release v1.0.0.
* This author is not a security expert.
* Constructive criticism is welcome (if you're gonna complain, have a solution ready).


## Goals
- [ ] Get the code and specification working.
- [ ] Test code.
- [ ] Finalize specs.
- [ ] Re-work code to be in C.


## Features
**Connectionless Design:**
The over-arching architecture is client-server to reduce complexity.
Peer-to-peer can be done using lower level tools.
If an IP changes then connections can resume based on their ID.
If packets don't match the connection, or exhibit anything abnormal,
then the packet is dropped.
Pings are used to validate the connection and be robust against IP changes
and help NAT traversal.
Pings use a timestamp to prevent packet replay; pings are also used to
determine EMTU.
Connections are dropped if fowl play is detected.


**Security First:**
By default, each opened connection's data is encrypted after the initial
handshake.
The exception to encryption is when using Datagram Sockets.
Encryption can be disabled, but is not recommended.
Each connection uses asymmetric encryption that requires two sets of keys.
An initial public key is recommended for initiating a connection to protect
clients from malicious interference like spoofing the server before the server
can reply.
The user is notified of IP changes on a connection so whitelisting can be done.


**Streams:**
The river was chosen because data is often sent in streams.
Each stream is...
* cheap and easy to create (optimistic creation, handshake is used to destroy)
* a one-way communication (sorry, no auto-duplexing)
* typed according to orderedness and reliableness
* message oriented
Messages can be fragmented.
The framework will report User Maximum Transmission Unit (UMTU)
and User Maximum Message Unit (UMMS) to user.
Guaranteed single packet delivery if size is
less-than-or-equal-to MTU, cannot send at all if size is greater-than MMU.

Each stream sends messages in one of the following ways:
* Ordered/Reliable: Similar to WebSockets. TCP can easily be mimicked.
* Ordered/UnReliable: Similar to UDP, but only the latest is delivered; earlier messages are discarded.
* UnOrdered/Reliable: Similar to RUDP or message passing.
* UnOrdered/UnReliable: UDP, except security is added.


**Limits:**
Note that servers may impose additional restrictions, these are just the defaults.
* Max open connections (no zeroeth ID): (2**32) - 1
* Max open streams per open connection:  (2**16) - 1
* Max messages per open ordered stream: (2**32) - 1
* Max outstanding fragments per open connection: (2**16) - 1
* Minimum UMTU: 576 - 60 - 8 - 1 - 4 - 16
* Maximum message size: 255 * UMTU
* Min/Max ping: 15/300 seconds.


## Design Choices
**Multi Interface Bindings:**
Disallowed since not all operating systems allow you to determine the interface
a packet was received on and Node.js doesn't support it.
Bind to a single interface and single port.
Keeps things simple and may segment your application design to be more manageable.
Since you can bind to "::" or "0.0.0.0" the receiver of messages
should allow for one or more return addresses.
Which begs the question, how does Node.js determine which interface to send 
messages on? Clearly one must be chosen for a send to take place.


**Connection IDs:**
Originally I was going to use a 16 octet UUID to identify traffic to an endpoint.
However, given that lookups must be performed on even spoofed messages and
the power of an attacker is greater than that of a server,
I think that even an 8 octet identifier is overkill.
Four octets give us the ability to easily extract the number
and easily check against a map;
with (2**32)-1 possible combinations (zero omitted) there should
be enough space for a single endpoint without making
it too easy to spoof connection IDs.
Attempts at spoofing of connection IDs should be expected.
Also, this utilizes less space in the packet.


**Keep Alive:**
NATs require a 2 minute minimum timeout, however, in practice the timeouts
tend to be shorter.
It is recommended that keep alives should be a minimum of 15 seconds.
Any shorter and the keep-alives may significantly interfere with the network.
Initially, 30 seconds will be used, but should be a configurable option.
The following recommends 15-20 seconds:
https://tools.ietf.org/html/rfc5245


**MTU:**
Hopefully a PLPMTUD implementation can be had, but to start we'll use the
recommended default MTU.
The first ping will start the PLPMTUD algorithm.
The recommended search_low for MTU discovery is 1024.
The recommended eff_pmtu is 1400.
The recommended Ethernet probe size is 1500.
The following is a list of MTUs:
1500 - Ethernet.
1492 - PPPoE environments. DSL.
1472 - Maximum for pinging. Otherwise fragmentation occurs.
1468 - DHCP environments.
1436 - PPTP environments or VPN.
1400 - AOl DSL.
576 - Dial-up.

Default effective MTU (EMTU_S):
This does not account for the IP header or UDP header.
IPv4: 576 (absolute low is 68)
IPv6: 1280
https://tools.ietf.org/html/rfc1122

Packetization Layer Path MTU Discovery (PLPMTUD):
Robust methodology for discovering the MTU on a path. Not suseptible to ICMP 
black holes and ICMP support.
https://tools.ietf.org/html/rfc4821


## TODO
Additional research on ICE.


## Abbreviation Map
EMTU: Effective MTU
ICE: Interactive Connectivity Establishment
ICMP: Internet Control Message Protocol
PLPMTUD: Packetization Layer Path MTU Discovery
MMS: Maximum message size.
MTU: Maximum Transmission Unit
NAT: Network Address Translation
TCP: Transmission Control Protocol
UDP: User Datagram Protocol
UMMS: User MMS
UMTU: User MTU


## Dependencies/Technologies
* sodium-native: For security. Seems to have the best interface and support.
* is-ip: To test if IP is IPv4 or IPv6
* is-valid-path: To test if a string represents a valid path. This is for implementing over Unix Domain Sockets.
* enumify: To correctly setup enumerations. Useful for state machines.
* dgram: For sending data fast and independent of order.
* net-ping: For detecting/determining MTU? Not used yet.


## Sources
1. https://tools.ietf.org/html/rfc768
1. https://tools.ietf.org/html/rfc8085
1. https://tools.ietf.org/html/rfc793
1. https://tools.ietf.org/html/rfc4960
1. https://nodejs.org/api/dgram.html
1. https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/
1. https://github.com/nodejs/node-v0.x-archive/issues/1623



