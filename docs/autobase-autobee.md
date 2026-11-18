# autobase and autobee, how they agree on one view

serapath asked how autobase and holepunch's autobee differ in how every device ends up with the same view. **read only** (autobase 7.28.2 in our node_modules, autobee 2.13.6 from npm, 13 nov), nothing tested yet.

## the same in both
- every writer (device) appends to its own hypercore, `apply` turns all of them into the view, the same way on every device
- writers are added and removed in `apply` (`host.addWriter` / `host.removeWriter`), indexers count more than plain writers

## autobase
- the indexers sign the view cores together. a view core's manifest has one signer per indexer and a quorum of a majority, `(n >> 1) + 1` (`_createManifest` in `lib/store.js`)
- what a majority signed is final for everyone, only the part after the signed length can still be reordered
- new indexers make a new manifest, so the view gets a new key (the signers are part of it)

## autobee
- no signing by a group. its views report `signedLength = length` "for autobase compat" (`index.js`), a writer core has one signer, the writer itself
- every writer applies on its own and stamps the head it vouches for into its own oplog. a peer fast-forwards onto the heads of writers it trusts, `isTrusted` / `mostRecentTrusted` are options the app gives (README, Fast-forward)
- order comes from the writers weight (indexer 2, plain writer 1, `lib/apply-calls.js`), then a timestamp, then the key (`cmp` in `lib/topo.js`)
- `witness` in autobee is not about finality, its the proof of a writers weight (an approval from a writer that has at least that weight, `lib/witness.js`)
- a new batch is only applied without an undo when it links every current head (`isLinkingAll(node, this.system.heads)` in `prepareBatch`), else its sorted in and can undo and reorder what was there (read)

## finality in autobee (tested)
`docs/autobee-finality-check.js`, autobee 2.13.6 with corestore 7.16.1 in a separate folder, 3 indexers (weight 2 each), ran twice with the same result
- c goes offline and writes z. then a writes x and b writes y after it, so b has seen x. 2 of 3 writers (4 of 6 weight) link x
- when c comes back, a and c both have `start z x y` (b wasnt printed). x moved behind z (same weight, z has the earlier timestamp)
- so a majority, by writers or by weight, is not final in autobee. any writer that hasnt seen x yet can still bring something that goes before it
- from the code its final once every writer links it, after that nobody can write something next to it anymore (read, not tested). so 4 of 5 isnt final either, 5 of 5 is
- in autobase a majority of indexers signing it is enough, everything after a signed length can still move but not before it (read, `docs/indexer-offline-check.js` showed it on autobase 6)

## so
- autobase says whats final with signatures of a majority of indexers
- autobee says whats right by who u trust. its only final for everyone once every writer has seen it, so one writer thats offline for long keeps everything after its last write open
- in both, every device key counts on its own. if 3 persons edit and one has 5 devices, that person outweighs the others in autobase (5 of 7 indexers sign), and in autobee all 7 devices have to have seen something before its final. so a structure shared by persons would count one indexer (or weight) per person, not per device. thats a proposal, not checked
- still open, if something in between (serapaths `autocore` idea) would fit us better than both
