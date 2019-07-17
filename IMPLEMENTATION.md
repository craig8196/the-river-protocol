

# Implementation
A few notes of the implementation in this repository.


## Primary Goal
Correctness and reference implementation.
Performance is a non-goal.


## Language/Runtime
I chose Node.js for the first implementation.
Node has asynchronous behavior from the start.
Mocking up a protocol is hopefully easier using a higher level language.
Node also has reasonable performance for a scripting language.
Furthermore, abstraction for use over other mediums than UDP can be made available.
Finally, C wasn't used (yet) because this is still in the mocking stage and efficiency isn't yet being pushed.


## Security
Libsodium was chosen for its simplicity, performance, and compactness.
Unfortunately, I don't know how future proof libsodium or NaCL is right now.
Some light research indicates that these methods of encryption are quality.


## Buffers
Buffer.allocUnsafe is used for performance and should be used for short-term values;
it slices peices of memory from ~4k sized slabs for speed.
However, Buffer.allocUnsafeSlow should be used for longer lived values.
Yes, I know that speed isn't my goal, but I found this interesting and thought:
"Why not?"


