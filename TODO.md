
* Go back to state machine setup (much easier to navigate and reason about).
* Should I just use ranges and a bitmap for window validation and packet replay protection??
* If sequence gets out of range, or too high, the connection should be reset.
* Ensure that all event emissions are documented and consitant.
* Determine invalid values for the source address in UDP packets
* Determine invalid values for the source port address in UDP packets (&lt; 1024?)
* Estimate minimum packet size for the protocol to work (maybe if OPEN works, then protocol works)

