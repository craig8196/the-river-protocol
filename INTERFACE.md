
# Interface
The "I" in TRIP is for: interface.
Interfaces are important since they hide specific behavior.
The point of The River Interface is to allow for the rich features offered by
The River Protocol but offered by others or designed differently under the hood.
Essentially allowing you to change the library, but not the code.


## Socket
Sockets are used for two way communication.
The socket handles specific packetization details to be handled.


## Sender
Created by sockets from return info to allow packets to be sent to another
router.


## Router
The router.
This structure manages sending and receiving data.
Routing packets to the correct connections and providing basic protection from attacks.

Information tracked:
File descriptors and communication packet channels.
Performs cleanup of stail connections.
Serializes/deserializes connections where applicable.
This tracks the file descriptors, performs cleanup, serializes

The router takes one or more sockets for communication.
The router will try to perform a bind to the sockets.


## Connection
We have a specific connection to an application somewhere else.
Unlike a TCP connection, this doesn't establish a channel for sending data.


## Stream
This allows data to be sent.
Created optimistically.
Each stream is NOT fully duplexed.
Streams are ONE-WAY communication.
Streams may be any combination of reliable/unreliable and ordered/unordered.

