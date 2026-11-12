
The patches are in `patches/` (one file per module and version) and `patch-package` applies them on `npm install` (the `postinstall` script).

# Patch 1 (dht-relay)

dht-relay comes from serapath's fork [serapath/hyperdht-relay](https://github.com/serapath/hyperdht-relay) now. it already has the fix for the relay crashing when a peer disconnects (upstream #27, the `uint must be positive` error in the `destroy` message, the old patch guarded the alias for that) and the announce signing fix for `custodial: false`, so both are gone from the patch.

what the patch still does
- `lib/stream.js` gets a public `sendKeepAlive()` that calls `_sendKeepAlive()` (same as the open upstream PR #29, hyperswarm calls it on a duplicate connection)


# Patch 2 (oplog browser compatibility for hypercore consistent storage)

## Problem

The original `oplog` module used `fs.truncate` to resize its storage file. This works in Node.js but **fails in browser environments**, where filesystem APIs like `truncate()` are unavailable or unsupported. As a result, the module could not function correctly in browsers.

## Root Cause

- `this.storage.truncate(...)` is called directly in methods like `open()` and `_writeHeaderAndTruncate()`.
- In a browser context (such as with IndexedDB-backed storage), this API does not exist, leading to runtime errors or incorrect behavior.

## Solution

- Implemented a **"virtual truncation"** system to simulate truncation behavior when `storage.truncate` is missing.
- Introduced `_virtualSize` to track the intended file size.
- Modified read/write operations (`_readAll`, `_append`, `open`) to honor `_virtualSize`.
- Added helper methods:
  - `_truncate(size)` – Handles truncation logic for both Node and browser.
  - `_rebuildStorageAfterTruncate(size)` – Rewrites the storage up to the truncation point.
  - `_overwriteStorage(newData)` – Replaces full storage content.
  - `_clearRemainingData(fromOffset)` – Zeros out data beyond truncation limit.

## Code Change Summary

- Detect browser environment using `typeof window !== 'undefined'`.
- Replace direct calls to `storage.truncate(...)` with `_truncate(...)`.
- Apply `_virtualSize` everywhere needed to simulate correct behavior.
- Reset virtual state on `close()`.

## Example Before

```js
this.storage.truncate(size, err => {
  if (err) return reject(err)
  resolve()
})
```

## Example After

```js
this._truncate(size).then(resolve).catch(reject)
```




This patch allows `oplog` to run safely in both Node.js and browser environments without relying on unsupported filesystem operations.


# Patch 3 (blind-pairing)

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


