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

## so
- autobase says whats final with signatures of a majority of indexers
- autobee says whats right by who u trust, there is no "final" for everyone
- in both, every device key counts on its own. if 3 persons edit and one has 5 devices, that person outweighs the others, so a structure shared by persons would count one indexer (or weight) per person, not per device. thats a proposal, not checked
