# what pins what in autobase (research)

alright, u asked if the autobase system view really locks down every view, and if pinned links need their own hash over all views. so i went through the autobase code and tested it on autobase 6.5.13 (what we use) with 2 devices. the script is `docs/pinning-check.js` i ran it multiple times, same result each time

its  plain autobase with a simple list view, not our vault code. things marked **tested** are from the script, **code** means i tried understaing it from the autobase/hypercore code, rest is proposal.

## what the system view stores

- **tested + code**: per view only `{ key, length }`. in `autobase/lib/messages.js` its a 32 byte key and a length, no hash and no fork
- the system view is a hyperbee, and every time autobase flushes it writes an `info` entry with the list of views
- **tested**: the system core at an old length still tells which key and length a view had back then
- also: `system.getIndexedInfo(length)` only works at a length where an `info` entry was just written. at a random length it throws `Out of bounds` 
## fork always stays 0

- **code**: autobase only ever appends signed blocks to the real core of a view (`flush()` in `lib/core.js`). when it reorders, it undoes stuff only on the in memory view (`truncate()` there does `fork++` on that, not on the real core), and on a reset it uses a batch checkout, it never truncates the real core
- **tested**: both devices write at the same time, autobase reorders (the in memory view fork went up to 6), but the signed core stayed on fork 0 on both devices. same hash at length 13 on both, and the hash at an old length never changed. the system core is fork 0 too, same hash on both
- so yea u were right its always 0, its just not hard coded anywhere. it stays 0 cuz the signed core only gets appended to. a fork would need the indexers themselves to sign something else (a bug or someone malicious), didnt test that

## a view key changes, its content doesnt

- **code**: a view key is the hash of its manifest, and the manifest has the indexers (as signers) plus a `prologue = { hash, length }` of the view so far (`deriveKey` in `lib/store.js`, `getPrologue` in `lib/core.js`). hypercore only accepts the start of that core if it matches the prologue hash (`lib/verifier.js`)
- **tested**: when b became an indexer the view key changed (every run). the new core starts with a prologue of the old data (length 4 or 5, wherever the view was when the indexers changed), its hash at length 3 is the same as on the old core, and b got the same new key. the old core is still on a with the same hash too
- so key + length of a view is only stable until the indexers change. the autobase key never changes

## what pins what

- one view: key + length (fork 0) fixes the content. the hash at that length cant change unless the indexers sign a fork
- `allowPatch: true` (views use it) sounded scary but its fine. **code**: if an indexer signed a longer length than the one being checked, its signature still counts, the patch is an upgrade proof that the checked length is the start of what it signed. append only, it cant swap old blocks
- all views at once: the system core at a length says the key + length of every view. so like u said, autobase key + system length + system hash pins all views indirectly
- our pinned disk link today (packs `pin()`) is `dat://<length>.0.<autobase key>.<hash>` with the length and hash of the disk's db view (the file list). the file bytes are in the blobs view, at the places the file list points to. the blobs view is a view like any other so the same fork 0 thing applies and they are pinned indirectly too  
**tested** in packs: after an update the old pinned version still runs the old code
- it should also keep working when the indexers change, cuz the new core carries the old part 

## so do we need our own hash over all views?

i think no:
- for a disk the link we have works 
- if something needs several views pinned together (like a bot disk + its command log), we could pin the system core instead: `<system length>.0.<autobase key>.<system hash>`, and to open it read the system info at that length to get every view key + length. not built. one thing im not sure about is the `info` thing above, if every signed system length is a place where `info` was written. maybe something to ask on keet

what do u think?

## found while testing: newest entries stay unsigned with 2 devices

- **tested** (plain autobase): with 2 indexers the newest 1 or 2 entries stay unsigned until more entries come in. i waited some time without writing, nothin got signed
- **tested** (our autodisk, 2 devices, both write 4 times): the wait in packs `pin()` was still waiting after 30 seconds, even with multipel runs (signed 4 to 6 of 9). with 1 device it finishes right away
- so `pin()` can hang with 2 devices. dont know much tbh, its so complex, i guess its a new task. its also why the script above keeps writing small `tick` entries while it waits

## pinning, short user stories

what we agreed: a name always means the latest, a pin only lives where code runs.
- i make a pack and later update it with new files, the name still points to the same disk and now shows the new files
- a bot runs pinned code, its `bot.json` has the pinned link. i update the pack, the bot keeps running the old version until its pin is moved on purpose (**tested** that the old pin still runs the old code, the bot part is proposal)
- an app lists its dependencies as pinned links, same as bots (proposal)
- moving a bot: the pin is where its disk was when the old box stopped (proposal, check `docs/datashell-bot-migration.md`)

## rerun on autobase 7 (18 nov)

`node docs/pinning-check.js` on autobase 7.28.2, ran twice, same result
- the system view still stores only key + length per view, and at an old length it still names the old view key at its old length. so the system core at a length still pins every view
- when b becomes an indexer the view gets a new key, the new core starts with the old data as its prologue, and the hash at 3 is the same
- whats new on 7: the fork number is different on each device and goes up with every reorder (a 6, b 2 in one run), but the hash at every signed length is the same on both. so a link has to pin length + hash, never the fork number
- not checked: what all indexers together could still rewrite. they hold every signing key, so i think they could sign a different history after a length, and only someone who kept the old hash at that length would see it. thats what a hash in the audit entry would add
