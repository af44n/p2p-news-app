
The patches are in `patches/` (one file per module and version) and `patch-package` applies them on `npm install` (the `postinstall` script).

# Patch 1 (blind-pairing)

## Problem

The problem is that blind-pairing uses RTT value from the rawstream and uses it find the closest channel. THe rawstream object does provide the object in nodejs when using RAWUDP streams but this RTT value isn't available in the Browser Websocket. This is proven via logging this objetc and using checks to identity. The problem is that when this conditional check is ran:
```javascript

       // In browser rtt is undefined

        const { rtt } = ch._mux.stream.rawStream
        if (rtt < closest) channel = ch

```
, `undefined` would always return false. This means it will never choose any channel and would silently fail.

## Root Cause

The root cause appears to be because of browsers using dht-relay and Websockets. Which don't have this `rtt` value property. This doc will be updated after more researching.


## Solution

- a channel without an `rtt` (a relayed stream) counts as `rtt` 0

## Code Change Summary

- `const rtt = ch._mux.stream.rawStream?.rtt ?? 0`, and `closest` is updated now so it really picks the closest channel

## Example Before

```js
        const { rtt } = ch._mux.stream.rawStream

        if (rtt < closest) channel = ch
```

## Example After

```js
        const rtt = ch._mux.stream.rawStream?.rtt ?? 0 // a relayed stream (dht-relay in browsers) has no rtt
        if (rtt < closest) {
          closest = rtt
          channel = ch
        }
```
Find the whole code in [patches/blind-pairing+2.3.1.patch](../patches/blind-pairing+2.3.1.patch) (it also fixes `const closest` to `let closest`, the old code never updated it)



This patch allows `blind-pairing` to be successfully completed along both browser and node/bare environments.


