

# The River Protocol (TRP)
The River Protocol (TRP, pronounced "trip", or written TRiP)
is a flexible communications protocol.
Fun, pretentious backronym could be: TCP Rest in Peace.
Note that TRIP (capital "i") refers also to the interface specification.
The River Interface is a generic API that allows the underlying implementation
to be hidden while preserving as many features and semantics as possible.


## Goals
A protocol designed to easily build custom protocols for niche applications
as found in IoT and other burgeoning arenas.
Security by default, transparent to user, to reduce vulnerabilities.
Persistent, robust connections.
Greater data flexibility so the networking behavior fits the problem space.
Event-based design for better application reactivity.
Real-time capabilities (disabled by default for better network performance).
Framework verbosity to provide information to applications for better
performance (e.g. User MTU for guaranteed single packet delivery).
Future-proof, a programming interface and protocol that can be used over
other mediums and a protocol that can scale up or down with the network.


## Why use TRiP?
Let's look at some existing communications protocols...

Note that every protocol suffers from packet attacks due to the insecure
nature of the internet and the Internet Protocol (IP).

TCP suffers from:
* No security by default
* Difficult to implement security
  (causes incorrect implementations or lack of security entirely)
* Slow handshake when doing security
  (one for the connection, one for encryption)
* Head-of-line blocking
  (degrades gaming experience in the browser)
* No unreliable send
* No unordered, reliable messaging
* No persistent connections if keep-alive fails
  (can you serialize connection details into a database to resume later?)
* Connection breaks if IPs change or NAT changes
  (this is unfortunate and can disrupt services)
* Dead connections kept alive by some load-balancer configurations
  (creates additional timeouts and error checking by TCP clients/servers)
* Heavy-weight solution when managing many connections to the same destination
  (usually to increase throughput)
* Requires another protocol to send messages or multiplex streams
  on the same connection
  (e.g. quirks and limitations of HTTP 1.1/2.0)

UDP suffers from:
* No security by default
* Unreliability
* Packet replay attacks
* Spoofing
* Difficulty in sending large messages/packets
* Connectionless

TRP suffers from:
* Protocol details handled in user process
  (some extra context switching or system calls)
* Needs another protocol on top
  (that is also part of the design)


## WARNINGS
* This code is experimental and may have flaws
* Currently in pre-release and will not follow semantic versioning
  until release v1.0.0
* This code is mostly intended as a proof-of-concept and reference
  implementation to document algorithms and outline pitfalls 
* Not written for CPU/memory performance
* The original author is not a security expert
* Based on UDP and has associated limitations
* If you're going to complain then detail the problem thoroughly
  and have a solution ready if possible 


## Contributing
See TODO list below or any TODOs in the project.
If you see something that needs improvement create a ticket.
TODO items are added in the moment of coding when an issue is thought of.


## TODO
* [x] Go back to state machine setup (much easier to navigate and reason about).
* [x] Should I just use ranges and a bitmap for window validation and packet replay protection?? Yes.
* [ ] 
* [ ] What is a TCP segement exactly??? Initial part of spec is ambiguous.
* [ ] Discuss mismatch between protocol future proofing (varints) and implementation requirement (4 or 8 octet uints? doubles?)
* [ ] Review for better info: https://github.com/facebookincubator/katran
* [ ] Review: https://blog.cloudflare.com/the-road-to-quic/
* [ ] Make sure that the bit counting is done according to size of currency?? or even currency/2... or off of currency, transmission rates, and RTT...
* [ ] Update the connect challenge to forward repsonse to another server.
* [ ] If sequence gets out of range, or too high, the connection should be reset.
* [ ] Ensure that all event emissions are documented and consitant.
* [ ] Determine invalid values for the source address in UDP packets
* [ ] Determine invalid values for the source port address in UDP packets (&lt; 1024?)
* [ ] Estimate minimum packet size for the protocol to work (maybe if OPEN works, then protocol works)
- [ ] Additional research on ICE
- [ ] Research possible PKI scheme to increase security
- [ ] Research possible custom DNS + CA/PKI combination
- [ ] Research Byzantine fault tolerance and if there is any applicability in this protocol
- [ ] Get the code and specification working.
- [ ] Test code.
- [ ] Finalize specs.
- [ ] Re-work code to be in C.
- [ ] Add comment/notes about benefit of using one file descriptor for many connections.


## Protocol Features
The following is detailed information on the protocol's features.


### Versioning in Protocol
Versioning in the protocol itself is necessary to update and enhance cryptography.
With quantum computers threatening to break current standards the protocol
must be forward thinking -- just-in-case.


### Abstract Connection Oriented Design
The recommended architecture is client-server to reduce complexity.
Peer-to-peer can be done using lower level tools;
peer-to-peer is more complex, thus waranting the need for lower level tools.
If an IP changes then connections can resume based on their ID.
If packets don't match the connection, or exhibit anything abnormal,
then the packet is dropped.
Pings are used to validate the connection and be robust against IP changes
and help NAT traversal.
(TODO sequence numbers are used for packet replay protection)
Pings use a timestamp to prevent packet replay; pings are also used to
determine EMTU.
Connections are dropped if fowl play is detected.


### Security First
By default, each opened connection's data is encrypted after the initial
handshake.
The exception to encryption is when using Datagram Sockets.
Encryption can be disabled, but is not recommended.
AEAD constructions used where necessary to preserve integrity of unencrypted data.
Each connection uses asymmetric encryption that requires two sets of keys.
An initial public key is recommended for initiating a connection to protect
clients from malicious interference like spoofing the server before the server
can reply (man-in-the-middle type attacks).
The user is notified of IP and routing information on a connection
so whitelisting, routing/proxying, subprotocol verification can be done.
Some light research indicates that libsodium is high quality and reasonably future-proof.


### Message Oriented
While messages on a stream can be large and split for
transmission/re-transmission they are delivered to the application atomically.
This is where memory considerations of the application should be considered.
Guaranteed single packet delivery if size is
less-than-or-equal-to UMTU, cannot send at all if size is greater-than UMMU.


### Streams
The river was chosen because data is often sent in streams.
Each stream is...
* cheap and easy to create (optimistic creation, handshake is used to destroy)
* one-way communication (sorry, no auto-duplexing)
* typed according to orderedness and reliableness
* message oriented

Each stream sends messages in one of the following ways:
* Ordered/Reliable: Similar to WebSockets. TCP can easily be mimicked.
* Ordered/UnReliable: Similar to UDP, but only the latest is delivered; earlier messages are discarded.
* UnOrdered/Reliable: Similar to RUDP or message passing.
* UnOrdered/UnReliable: UDP, except security is added and partial messages not delivered.

Streaming large files can be done with Ordered/Reliable messaging to keep the
message sizes low.
Using the UMTU can increase transmission speed and is a consideration for
the protocol or application.


### Limits
The framework will be very easy to query for these limits.
The framework will report User Maximum Transmission Unit (UMTU)
and User Maximum Message Unit (UMMU) to user.
Note that servers may impose additional restrictions, these are just the defaults.
* Max open connections (no zeroeth ID): (2^32) - 1
* Max open streams per open connection:  (2^16) - 1
* Max messages per open ordered stream: (2^32) - 1
* Max outstanding fragments per open connection: (2^16) - 1
* Minimum UMTU: 576 - 20 - 8 - 1 - 4 - 4 - 16 - 1 - 2 - 4 - 2 - 2
* Starting UMTU: 1400 - 20 - 8 - 1 - 4 - 4 - 16 - 1 - 2 - 4 - 2 - 2
* Maximum message size: 256kB, it needs to fit nicely in memory.
* Min/Max ping: 15/300 seconds or longer. Zero for off (not recommended).


## Protocol Design Choices and Notes
Discussion of why some choices were made.


### Multi Interface Bindings
Disallowed since not all operating systems allow you to determine the interface
a packet was received on and Node.js doesn't support it.
Bind to a single interface and single port.
Keeps things simple and may segment your application design to be more manageable.
Since you can bind to "::" or "0.0.0.0" the receiver of messages
should allow for one or more return addresses.
Other implementations may allow multiple bindings.
Which begs the question, how does Node.js determine which interface to send 
messages on? Clearly one must be chosen for a send to take place.
Perhaps I need to do more research here.


### Connection IDs
Originally I was going to use a 16 octet UUID to identify traffic to an endpoint.
However, given that lookups must be performed on even spoofed messages
and the power of an attacker is greater than that of a server,
I think that even an 8 octet identifier is overkill.
Four octets give us the ability to easily extract the number
and easily check against a map;
with (2^31)-1 possible combinations (zero omitted, upper bit reserved)
there should be enough space for a single endpoint without making
it too easy to spoof connection IDs.
Attempts at spoofing of connection IDs should be expected.
Also, this utilizes less space in the packet.


### Keep Alive
NATs require a 2 minute minimum timeout, however, in practice the timeouts
tend to be shorter.
It is recommended that keep alives should be a minimum of 15 seconds.
Any shorter and the keep-alives may significantly interfere with the network.
Initially, 30 seconds will be used, but should be a configurable option.
The following recommends 15-20 seconds:
https://tools.ietf.org/html/rfc5245


### MTU
Hopefully a PLPMTUD implementation can be had, but to start we'll use the
recommended default MTU.
The first ping will start the PLPMTUD algorithm.
The recommended `search_low` for MTU discovery is 1024.
The recommended `eff_pmtu` is 1400.
The recommended Ethernet probe size is 1500.
The following is a list of MTUs:
1500 - Ethernet.
1492 - PPPoE environments. DSL.
1472 - Maximum for pinging. Otherwise fragmentation occurs.
1468 - DHCP environments.
1436 - PPTP environments or VPN.
1400 - AOl DSL.
 576 - Dial-up.

Default effective MTU (`EMTU_S`):
This does not account for the IP header or UDP header.
IPv4: 576 (absolute low is 68)
IPv6: 1280
https://tools.ietf.org/html/rfc1122

Packetization Layer Path MTU Discovery (PLPMTUD):
Robust methodology for discovering the MTU on a path. Not suseptible to ICMP 
black holes and ICMP support.
https://tools.ietf.org/html/rfc4821


## Abbreviation Map
EMTU: Effective MTU
ICE: Interactive Connectivity Establishment
ICMP: Internet Control Message Protocol
PLPMTUD: Packetization Layer Path MTU Discovery
MMS: Maximum Message Size
MTU: Maximum Transmission Unit
NAT: Network Address Translation
RTT: Round Trip Time
SCTP: Stream Control Transmission Protocol
TCP: Transmission Control Protocol
UDP: User Datagram Protocol
UMMS: User MMS
UMTU: User MTU


## Node.js
Node.js was chosen for the mockup in this repository.
Node.js has asynchronous behavior.
The implementation in this repository is intended to allow for adjusting and
fine-tuning the design and chosen algorithms.


### Dependencies
See package.json for extra or dev dependencies.

Native:
* dgram: For sending data fast and independent of order.

Community:
* enumify: For creating enums used in state-machines.
* long: For timestamps and uint64 type values.
* sodium-native: For security. Seems to have the best interface and support.
* is-ip: For determining if a string is ipv4 or ipv6.
* is-valid-path: For determining if a string is local to the machine.


### Buffers
The `Buffer.allocUnsafe` method is used for performance and should be used for short-term values;
it slices peices of memory from ~4k sized slabs for speed.
However, `Buffer.allocUnsafeSlow` should be used for longer lived values.
While speed isn't the goal using a languages library correctly is still important.


## C Implementation Notes
Outline expectations of the C implementation.


### Interface
The River Interface must be implemented in a generic way.
To/from destinations can be specified using UTF8 strings.
This allows the library to choose the correct internal details accordingly.
Added need on the programmer to pass along parseable strings.


### ABI
The compiled shared object should be forward and backward compatible
taking version and implementation changes into account.
Struct sizes and details should not be made available to the users;
using handles (pointers) to reference needed resources.
Library methods will allocate the needed resources.
For embedded libraries an additional header can be made available that
makes common structs globally available for handling one connection at a time.


### Space
Will use of libsodium and chosen data-structures be embedded device friendly?


### Dependencies
* libc
* OS provided UDP socket interface
* libcares: For DNS resolution, optional for direct IP and custom builds.
* libsodium: For security. Demonstrates efficient and easy-to-use encryption.


## References | Sources
1. UDP RFC: https://tools.ietf.org/html/rfc768
1. UDP Usage Guidelines RFC: https://tools.ietf.org/html/rfc8085
1. TCP RFC: https://tools.ietf.org/html/rfc793
1. SCTP RFC: https://tools.ietf.org/html/rfc4960
1. Requirements for Internet Hosts: https://tools.ietf.org/html/rfc1122
1. https://nodejs.org/api/dgram.html
1. https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/
1. https://github.com/nodejs/node-v0.x-archive/issues/1623
1. Libsodium Security Assessment: https://www.privateinternetaccess.com/blog/wp-content/uploads/2017/08/libsodium.pdf


