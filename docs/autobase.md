# autobase, how it works and what to watch out for

a short description of autobase 6.5.13 (what we used till november, we're on autobase 7 now and this hasnt been checked against it yet), so we can refine it over time. everything here is from the autobase / hypercore code or from the checks in this folder, the results of those are in [autobase-checks.md](autobase-checks.md). the vault bee, the audit log and every disk are autobases, how our disks use it is in [disks.md](disks.md).

## how it works

- **every device writes only to its own core**, its input core (`base.local`). an entry also says which entries the device had already seen (its "heads"), so all entries together form a graph of what came after what
- **every device puts that graph in the same order** (the linearizer in `lib/linearizer.js`) and runs the same `apply(nodes, view, host)` on it. so every device builds the same views, without anyone sending the result around
- **writers and indexers are entries too**. `host.addWriter(key, { indexer })` and `host.removeWriter(key)` only happen inside `apply`, so every device agrees on who can write at which point
- **indexers sign**. a view is a real hypercore whose manifest has the indexers as signers and a quorum of more than half of them (`quorum = floor(n / 2) + 1`, `_createManifest` in `lib/store.js`). nobody has its keypair, so no single device can write or truncate it, only the indexers together can sign new blocks onto it. [fork-check.js](fork-check.js)
- **final order, then signed**. up to `indexedLength` the order never changes anymore, above it the order can still change when new entries come in, then autobase undoes the view in memory and runs `apply` again. a length is only signed once more than half of the indexers wrote a checkpoint covering it (`getSignableLength` in `lib/signer.js`), thats `signedLength`. the signed core itself is only ever appended to, so its fork stays 0. [fork-check.js](fork-check.js)
- **the system core** is a hyperbee autobase keeps next to the views. it has the writers, indexers, heads and for every view `{ key, length }`. on every flush it writes a few member entries and then one `info` entry. [view-history-check.js](view-history-check.js)
- **new indexers, new keys**. when the indexers change, every view and the system core get a new core (new key), which starts with a `prologue = { hash, length }` of the old data. the length keeps counting and the hash at old lengths stays the same. only the autobase key never changes. [view-history-check.js](view-history-check.js)

<details><summary>eli5</summary>

everyone in a group keeps their own diary. each entry says "i wrote this after reading these entries of the others". everybody reads all diaries, sorts the entries the same way and copies them into one shared notebook. that notebook can only be stamped as final when more than half of the stampers (indexers) agree, and nobody has a pen that can erase a stamped page. when someone new joins the stampers, they start a new notebook, but the first page says "this continues the old one up to page 4, which looked exactly like this"

</details>

## what pins what

- one view at a length is fixed by the autobase key + that length + the hash there. the hash is checked on whatever core the view has right now, even if the link was made before the indexers changed. [pin-check.js](pin-check.js)
- the system core at a length says the key + length of every view, so autobase key + system length + system hash pins all views at once. [pinning-check.js](pinning-check.js)
- views use `allowPatch: true`. that sounds scary but it only means a signature for a longer length also counts for a shorter one, with an upgrade proof that the shorter one is the start of the longer one (`_verifyMulti` in hypercore `lib/verifier.js`). it cant swap old blocks
- reading what the system said at an old length (`system.getIndexedInfo(length)`) only works where the `info` entry was written, so jump back to the last one. [view-history-check.js](view-history-check.js)

<details><summary>eli5</summary>

a pinned link is like "page 2 of the notebook of group X, and page 2 looks exactly like this". even if the group started a new notebook since then, page 2 is still in it and still looks the same, so the link still works

</details>

## what to watch out for

- **`apply` must only use what `open` made.** reordering only works if every data structure `apply` touches comes from the `store` passed to `open` (autobase README). our audit log kept entries in a plain array and got them twice after a reorder, the vault bee had its own core per device. both are views now. [auditcore test](../lib/node_modules/auditcore/auditcore.test.js), [vault-bee-check.js](vault-bee-check.js)
- **changing the views doesnt replay old entries.** after we made the audit log a real view, old vaults showed 0 old entries. they are still in the input cores, but the new view only gets what is written after. [old-audit-check.js](old-audit-check.js)
- **2 indexers need both.** with 2 indexers both have to sign, so if one is offline nothing new gets signed, and even adding a 3rd device has to wait for it. the newest entries can also stay unsigned while both are online, till more entries come in (thats why `pin()` can hang). [indexer-offline-check.js](indexer-offline-check.js), [pin-hang-check.js](pin-hang-check.js)
- **unsigned state looks real.** a device can already think its an indexer and write before that is signed. act on signed state (`signedLength`), not on what a device thinks right now. [indexer-offline-check.js](indexer-offline-check.js)
- **view keys are not ids.** they change every time the indexers change, only the autobase key stays. store and share the autobase key
- **a prologue proves the start, not who continues.** anyone can make a core with another cores prologue and continue it with their own key. only the autobase key and its indexers say which continuation is the real one. [view-history-check.js](view-history-check.js)
- **not encrypted.** autobase can take an `encryptionKey`, we dont pass one yet, so anyone who gets the keys can read the vault
- **autobase 7 is different.** it has optimistic writes (a new device can write before being added), a real fork feature (`host.fork`) and atomic writes of several views. it needs the new rocksdb storage, so we cant use it in browsers yet
