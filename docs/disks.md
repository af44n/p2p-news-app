# disks and packs, how they work and what is guaranteed

our multi device disk is `autodisk` and packs are named autodisks in the vault. this describes how they work today, what we pin and why, and which guarantees there are for what. it will change with bots, mnemonic recovery and true forks, so it gets updated with them. how autobase itself works is in [autobase.md](autobase.md), the checks behind the claims are linked and their results are in [autobase-checks.md](autobase-checks.md)

## a disk

- an autodisk is a real hyperdrive built from 2 autobase views, `db` (a hyperbee with the file list) and `blobs` (the file bytes). so every device that writes to it builds the same drive, with the same keys and hashes ([lib/node_modules/autodisk](../lib/node_modules/autodisk/autodisk.js))
- `const disk = autodisk({ store, bootstrap })`, without `bootstrap` it makes a new disk, with the autobase key of an existing one it joins it
- the id of a disk is its autobase key. the keys of the `db` and `blobs` views change whenever the indexers change, so they are never used as an id

## how a disk moves forward

- `disk.put(path, bytes)` appends `{ type: 'put', data: { path, content } }` to the devices own input core, and `apply` writes it into the drive on every device. `del` works the same
- every write makes the `db` view longer, thats the next version. the cores are append only, so every older version is still there, `disk.base.view.drive.checkout(length)` gives the files as they were at that length
- `add_writer(key)` adds another device, as an indexer by default. then the views get new keys with a prologue of the old data, the length keeps counting and old versions stay the same ([view-history-check.js](view-history-check.js))

## packs

- a pack is a name in the vault, `packs/<name> = { link, namespace }`. the link is `dat://<autobase key>` without a version, so the name always means the latest ([lib/node_modules/packs](../lib/node_modules/packs/packs.js))
- `create(name, folder)` copies a folder into a new disk, with `{ update: true }` into the existing one. only files with different bytes get written, files that arent in the folder anymore stay for now (deleting them comes with the loader `diff` + `sync`)
- `pin(name)` gives the link for whatever runs the code (`bot.json`, app deps). it waits till the signed `db` core caught up, then takes `dat://<length>.<fork>.<autobase key>.<hash>` from there, the hash is the tree hash of the signed `db` core at that length
- `remove(name)` deletes the disks cores from this device and the name from the vault. old view cores from before an indexer change arent tracked by autobase, so they stay on disk for now

## what is guaranteed

- **a pinned file list cant change.** the hash at the pinned length covers every block of the `db` core up to there, the indexers signed it together and nobody alone can truncate that core, so the fork stays 0 and no old block can be swapped ([fork-check.js](fork-check.js)). the old link still works after the indexers changed, on every device ([pin-check.js](pin-check.js))
- **the file bytes are pinned through the file list.** every entry in the list says where its bytes are in the `blobs` core, and that core is signed and append only the same way. so the bytes at those places cant change either. this is from the code, i didnt test it against an indexer that signs something wrong
- **only my devices can write.** writers are only added or removed inside `apply`, and only what a majority of the indexers signed counts as final ([indexer-offline-check.js](indexer-offline-check.js))
- **a wrong length or hash is caught.** the hash at any other length doesnt match the link ([pin-check.js](pin-check.js))

## what is not guaranteed, or not done yet

- **the latest isnt always signed.** a pack name means the newest files, including writes the indexers didnt sign yet. only pinned links are signed. with 2 devices `pin()` can even wait forever ([pin-hang-check.js](pin-hang-check.js))
- **nothing is encrypted.** anyone who knows the disk keys can read it
- **the link doesnt say which view.** it works cuz packs always pins the `db` view, and with a true fork 2 branches could have the same length. the new link format is a task in [#28](https://github.com/serapath/p2p-news-app/issues/28)
- **files are stored twice.** every `put` carries the whole file base64 encoded in the writers input core, and then again in `blobs`. fine for code, bad for big files
- **the whole disk gets loaded.** `disk-loader` reads every file into memory before running, the split into `uses` / `diff` / `sync` / `load` / `run` is a task in [#29](https://github.com/serapath/p2p-news-app/issues/29)
