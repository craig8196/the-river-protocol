
# Implementation

# Language/Runtime
I chose Node.js for the first implementation.
Node has asynchronous behavior from the start.
Mocking up a protocol is hopefully easier using a higher level language.
Node also has reasonable performance for a scripting language.
Furthermore, abstraction for use over other mediums than UDP can be made available.
Finally, C wasn't used (yet) because this is still in the mocking stage and efficiency isn't yet being pushed.


# Security
Libsodium was chosen for its simplicity, performance, and compactness.
Unfortunately, I don't know how future proof libsodium or NaCL is right now.


# Buffers
Buffer.allocUnsafe is used for performance and should be used for short-term values.
However, Buffer.allocUnsafeSlow should be used for longer living values.


