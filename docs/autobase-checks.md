# autobase checks, what they show and what they mean

u said every test should be a file with resutls and what they mean, so we build up a common understanding and basim and others can build on it. so here are all the checks behind what i told u in the worklog-43 44 and 45 threads. each script prints `ok` or `NOT ok` per claim with the values it saw, and exits with 1 if something isnt ok.. the comments at the top of each script explian the claim and where in the autobase / hypercore code it comes from.

all run on the versions we had then (autobase 6.5.13, hypercore 10.38.2, corestore 6.18.4, rerun on the latest ones since, see below), ran mutliple times same result each time, **plain autobase** means a small list view, not our vault code. **ours** means our real modules. **code** means i only read it in the code, no script.

**rerun on the latest modules (autobase 7, hypercore 11, corestore 7) on 17 nov:** `vault-bee-check` (ported), `pinning-check` (ported 18 nov), `fork-check`, `view-history-check`, `pin-check`, `indexer-offline-check`, `pin-hang-check` and `old-audit-check` (ported 19 nov), `empty-block-check` (node and bare) and `master-core-check` pass, so every check runs on 7 now. where 7 differs it says so in the section

## fork is always 0

`node docs/fork-check.js` 

- the fork is part of what the indexers sign (`treeSignable(manifestHash, treeHash, length, fork)` in hypercore `lib/caps.js`). the same signture verifies for fork 0 and fails if only the fork is changed to 1. so u were right, about that
- the number itself comes from the core tho,, a normal single writer core truncates, goes to fork 1 and signs that fine
- the signed core of an autobase view has no keypair (2 signers quorum 2), so truncatng it gives `SESSION_NOT_WRITABLE`, and autobase only ever appends to it
- when autobase reorders only the in memory view forks (went to 1 and 2), the signed view and system cores stayed 0

on autobase 7 its the same for whats signed. the view is one hypercore now, its own state only has the signed blocks and stays on fork 0, the signature fails for fork 1 too. `base.view` is autobase's session over it, that one forks on every reorder and differently on each device (a 2, b 3), thats the fork i saw in the pinning check. truncating the session from code that has `base.view` works, the signed part stays as it is

so always 0, just that the "never" comes from nobody being able to truncate the signed core, not from a 0 in the code. autobase 7 has a real fork feature (`host.fork(indexers, system)`), that one isnt in this check (the recovery checks in the latest modules repo used it)

## what happens to the view and system cores over time

`node docs/view-history-check.js` 

- when b becomes an indexer the view and system cores get new keys, but the lenght doesnt start at 0. the new view core starts with a prologue of length 4 (it was at 3), the system core with 15 (it was at 8), and the hash at the old lengths is the same on the new cores. on autobase 7 the same, the view prologue is 3 (it was at 3) and the system 12 (it was at 7)
- the prologue is `{ hash, length }`, and the hash is the tree hash of the data at that length. its not the old key; (a core key is the hash of its manifest, so its not the old manifest either). nothing in the new core points to the old key
- `getIndexedInfo(length)` and `system.checkout(length)` work exactly where system block `length - 1` is the `info` entry (autobase writes a few member entries and then one info entry on every flush), everwhere else they throw. i didnt find a field pointing back to the previous info entry, but jumping back to the last info entry always works
- someone with their own keypair can make a core with another cores prologue, copy its first 3 blocks and append their own. new key, same hash at 3. so a prologue only proves "my start is that data", not "im the real continuaton", only the autobase key and its indexers say that

## pin() links after an indexer change

`bare docs/pin-check.js` (ours, packs + autodisk + autobee, 2 devices)

- a pins a pack alone (`dat://2.0.<autobase key>.<hash>`), then b becomes an indexer and the db view gets a new key with a prologue of length 4 (on autobase 7 of length 2, the pinned length)
- the old link still works on a and on b, (b never saw the old view key). open the disk by the autobase key from the link, take its current signed db core, the hash at length 2 matches the link, checkout(2) runs the old code, latest runs the new code
- the hash at another length doesnt match the link

so u dont have to go through old manfiests to find the length, a new view core keeps the old history. what this doesnt cover is that the link doesnt say which view (fine as long as packs only pins the db view) and true forks with 2 branches at the same length. both go into the dat:// links task

## allowPatch

**code**, no script yet. when hypercore checks a multisig signature it uses `generateUpgrade` + `verifyUpgrade` (`_verifyMulti` in hypercore `lib/verifier.js`), so an indexer that signed a longer length still counts, the patch proves the checked length is the start of what it signed. autobase does the same when it colects signatures, it also takes a checkpoint thats longer than the length its signing (`getSignatures` in autobase `lib/signer.js`)

## 2 indexers and one of them offline

`node docs/indexer-offline-check.js` 

- a and b are indexers and thats signed (view core with 2 signers, quorum 2), then b goes offline
- a adds c as an indexer. c already thinks its an indexer and can write, a has 11 entries in its view, but the signed length stays at 1 and the signed indexer list at 2 for the whole 10 secnods
- when b is back, c becomes the 3rd signed indexer and signing goes on (17 of 18)

on autobase 7 the same, only that c.isIndexer stays false while b is away (it only turns true once c is in the indexers autobase applied, `_setLocalIndexer` in autobase index.js), c can still write, and the signed view length was 0 there instead of 1

so with 2 indexers adding a 3rd needs both of them,, and if one is gone for good the one left cant fix it alone. also good to know for recovery, `isIndexer` and `writable` on a device dont mean its signed yet. autobase 6.5.13 has no optimistic writes

## newest entries stay unsigned with 2 devices (pin() hang)

`bare docs/pin-hang-check.js` (ours, autodisk, 2 devices)

- b becomes an indexer, both write 4 times, then it waits like `pin()` does for 30 seconds without writing anything else. the signed db core stays at 4 of 9, so `pin()` would still be wating

the cause is our own wait, `pin()` waits till the signed length reaches the current length, and on autobase 6 the newest entry only got signed once something newer came in (acking more didnt help, checked 19 oct)

on autobase 7 the same check gets everything signed within 3 to 5 seconds without more writes (9 of 9, also when a writes last), so its flipped and says `ok` when `pin()` would finish. not explained yet, in `pin-check` a writing small files alone sometimes got nothing new signed for 40s, with a and b taking turns it was signed right away

## old audit logs after the auditcore change

`node docs/old-audit-check.js` (ours, the old auditcore is loaded from git, the commit before `17891e3`)

- the old auditcore writes 3 entries, the new one opens the same storgae and shows 0, new entries show up fine
- the 3 old entries are still there, in the devices own input core

on autobase 7 the new auditcore shows 0 too and the 3 entries are still in the input core. the old auditcore cant even show its own entries there, they were a plain js array in the view, and autobase 7 calls `open` more than once (for `base.view` and for apply, `index.js:205` and `lib/apply-state.js:440`), so apply pushes into another object than `base.view`. checked with a small script, open ran 3 times

thats what i meant with, "old local vaults lose their old log entries". i think its cuz autobase already applied those entries once and doesnt run apply again for them, nothing is released, so no migration

## the vault bee is the same on every device

`node docs/vault-bee-check.js` (ours, autobee, 2 devices)

- both write at the same time, then both have the same bee key, length, signed hash and values, and the bee is a view autobase knows about. remove_writer still works
- with the autobee from before `77fa37d` the same check fails, diffrent keys and lengths (7 and 9) with the same values, thats the bug from the worklog-43 thread
- ported to autobase 7 (views are hypercores with `signedLength` now) and the vault base (the bee + the audit log in one autobase), all 5 still ok
## reading back an empty block on bare

`bare docs/empty-block-check.js` and `node docs/empty-block-check.js` (corestore 6 + random-access-file 4.1.2, the bug basim found)

- on node it works. on bare reading back an empty block throws `process is not defined`, and after that the store doesnt even close, bare just exits
- random-access-file uses the global `process.nextTick` for empty reads and bare has no global `process`. 4.1.2 is the latest and its github master still has it, so `package.json#overrides` cant fix it without a fork
- our code does `const process = require('bare-process')`, but thats only a local variable in that file, so it doesnt help random-access-file. tried it, with that and also with `local-storage-shim` loaded first like `lib/run.js` does, `globalThis.process` is still `undefined` and the empty block still throws. nothing in the repo or node_modules sets the global (only tried the start of the cli, not the whole thing)
- 2 ways to fix it, both tried on bare
  - `require('bare-process/global')` at the start of the cli (`lib/run.js`), thats just `global.process = require('bare-process')`. then the empty block reads back fine, no patch needed, and basim can do the same in his entry. but then `process` is a global for all code, also app code, not sure thats ok with the caps idea
  - or patch random-access-file, that one line changed to `queueMicrotask(() => readEmpty(req))`, then all 3 steps pass on bare too (tried it on a copy) and nothing becomes global
- neither is in the repo yet, so this check fails on bare till one of them is. which one do u prefer?