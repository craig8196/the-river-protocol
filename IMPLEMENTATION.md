

# Implementation
Notes about the implementation in this repository.


## Primary Goal
Correctness and reference implementation.
Performance is a non-goal.


## Language/Runtime
Node.js was chosen for the first implementation.
Node has asynchronous behavior from the start.
Mocking up a protocol is hopefully easier using a higher level language.
Node also has reasonable performance for a scripting language.
Furthermore, abstraction for use over other mediums than UDP can be made available.
Finally, C wasn't used (yet) because this is still in the mocking stage, efficiency and portability isn't yet being pushed.


## Security
Libsodium (an implementation of NaCL) was chosen for its simplicity, performance, and compactness.
Some light research indicates that these methods of encryption are quality and reasonably future-proof.


## Buffers
The `Buffer.allocUnsafe` method is used for performance and should be used for short-term values;
it slices peices of memory from ~4k sized slabs for speed.
However, `Buffer.allocUnsafeSlow` should be used for longer lived values.
While speed isn't the goal using a languages library correctly is still important.


