# packs & tasks vs datashell

So basim built `packs` (named drives) and `tasks` (bots that run from drives) in his flamingo-node fork, and the plan is to bring both into datashell. Before changing anything i went through his code and ours function by function, to see what we already have, what we can reuse and what's actually new.

## comparison:

- **packs** = a name pointing at one exact version of a drive, e.g. `flamingo-node -> dat://<length>.<fork>.<id>.<hash>`. you can fill a pack from a folder, from another drive, or by running a generator file. it's just data, nothing runs.
- **tasks** (the `bot` command) = a pack that also has a `bot.json` saying which code to run, e.g. `{ "entry": "dat://…/main.js" }`. you can start it in the background, stop it, check if it's running. only one run at a time.

On our side we don't have "packs" or "bots" by name, but a lot of the pieces exist already, just built for apps:
- `datastructure-manager` creates and opens drives by name
- `register_app` keeps a name -> drive keys record in the vault (`apps/<id>`)
- `datashell.js` already loads app code and runs it
- `device_apps/<device>/<app>` is already a per device status record that syncs to all devices

## packs

### open / close
basim reads `~/.flamingo/pkgs.json` and only opens the corestore once a drive is actually touched, so read only commands like `cli pkg` still work while a bot holds the lock.
we open one corestore straight away in `identity()` (`./storage-identity-browser-peer` on cli, `identity-browser-peer` in the browser) and never close it. so the lazy open is new for us.

### list / get / find / info
his names and links come from `pkgs.json`, `find(link)` gives the name for a drive id and `info()` just prints it.
we already do the same kind of thing for apps with `list_apps()` / `get_app(id)`, which read `apps/` records from `vault_bee`. so packs can just be `packs/<name>` records in the vault. `find()` doesn't exist on our side but it's tiny.

### source (specifiers)
this parses what you type: `./folder`, `./file` (runs as a generator), `dat://…`, a pack name or a drive id, plus `/file?options` at the end.
we have nothing like it, closest is `datashell.js` picking the sys/app url from args or the url hash. can mostly be copied over.

### open_drive
opens a drive by its id, checks the hash and gives a read only checkout at that exact length.
our `ds_manager.init(name, key)` and `create_peer_structure()` open autobase/autodrive by key too, but always the latest version and without any hash check. so the pinning part is new.

### load
loads a generator or entry file straight from the drive with `bare-module`'s Loader. only a fixed list of modules can be required and `import()` is blocked.
ours is `loadcli()`, which reads a file and runs it with `vault, document, require` (the full `require`, no whitelist), and `loadweb()`, which fetches a url and runs it with `vault, document`. same idea, his is just safer. we could load apps from a drive like this later.

### create
makes a new hyperdrive under `pkg/<name>/<random>`, fills it (copy a folder, copy a drive or run a generator) and registers the name.
for us `ds_manager.init_all(STRUCTURES)` creates the drives, and for a new user `p2p-news-app` appends `blog-init`, runs `create_default_profile()` (basically a hard coded generator) and calls `register_app()`. so the ds_manager + register flow can be reused, generators are new.

### update
moves the name to the newest version after something gets written.
we store keys and not versions, so we always read the latest anyway. only needed if we keep pinned links.

### remove
deletes one drive from disk plus its names.
we can't delete a single drive. `reset_all_data()` wipes everything, and the "Reset Data" button in `websys-ui` only deletes the vault records, the cores stay on disk. `core.purge()` works on our version though (see `docs/version-check.js`).

### import / export
copies a drive to or from a normal folder with `mirror-drive` + `localdrive`, keeping file modes and empty folders.
we don't have this at all. it can be copied, but `localdrive` isn't installed here yet.

### reference / drive_link
parse and build `dat://length.fork.id.hash`, where the id is z-base-32 (`drive.id`).
we pass keys around as hex (`ds_manager.get_key()`) and never store a version. same keys, just written differently, so we'd have to pick one format.

## tasks (bots)

### open / list / get
bot names come from `~/.flamingo/bots.json`. for us these would just be `bots/<name>` records in the vault, same as apps.

### info / busy
running or stopped comes from a `run/<name>.pid` file plus checking if that pid is still alive, so it only knows about this one machine.
we have `device_apps/<device>/<app>` = `joined` / `pairing` / `available`, which syncs to every device. `paired_devices/<device>.last_online` is only updated on login (`ping_liveness`) and when a writer request gets processed, so it's not a live heartbeat. the per device record can be reused, but "running on which device" is new.

### create
either runs `<pack>/generate` into a fresh drive and the cli writes `bot.json` (the bot also gets saved as a pack with the same name), or takes a drive that already has a `bot.json`. it refuses if another bot already uses that drive id.
nothing like this on our side. his clash check only looks at this machine, for us it has to work across the whole identity.

### start
opens the bot drive writable, checks the pinned code, runs `entry(drive, { stopped, log })`, writes the pid file and moves the name to the newest version on every append.
closest we have is `boot()` in `datashell.js`, which loads the app and calls `app(app_vault, app_doc)`. but an app gets the vault, not a drive, and there's no stop signal. so it's new, only the loading part overlaps.

### end
sends SIGTERM to the pid and waits for it to exit.
we only have "Exit App", which on cli goes back to the system menu and on web reloads the page. new.

### remove
deletes the bot drive and its names, and refuses while it's running. new for us.

### --run (in cli.js)
starts the bot as a background daemon with `bare-daemon` and logs to `run/<name>.log`.
our cli is just one interactive process (`bare lib/run.js`), so this is new too.

## main differences 

1. **versions.** we're on corestore 6 / hypercore 10 because it works in the browser, basim is on corestore 7 / hyperdrive 13. i ran his `scripts/docs.js` against our versions: 4 of 20 tests pass as is, and all 21 pass after porting two calls, `store.storage.getAuth()` and his `purge()`, which both only exist in corestore 7. `docs/version-check.js` shows the same thing from our side. so versions aren't really the blocker i guess.
2. **hyperdrive vs autodrive.** his packs are plain hyperdrives (one writer). serapath wants packs to be autodrives so every device can write. but our autodrive builds its file view per device, so the same files get a different key and hash on each device, and a `dat://…<hash>` link made on device A won't check out on device B. it also has no `entry()`, so his loader and `mirror-drive` can't use it directly (only through `base.view.drive`). this is the main open question.
3. **registry.** his names live in json files on one machine. ours would live in `vault_bee` so all devices see them, which also means other devices can `watch()` them for changes, like `watch_subscriptions()` in p2p-news-app does.
4. **code loading.** on cli we hand apps the real `require`, his loader only allows a short list of modules and reads every file from the pinned drive. his way is what we want if code comes from other people's drives.


## what to reuse vs what is new

reuse:
- `datastructure-manager` + `autodrive` for the drives
- `vault_put` / `vault_get` / `watch` for the pack and bot names instead of json files
- `device_apps/` style records for "which device runs which bot"
- the `writer_requests` flow (device asks, owner device approves) as the base for handing a bot over to another device
- `remove_device()` for kicking the old device out of a bot drive

take from basim:
- specifiers (`source()`), generators, `bot.json`
- the `bare-module` loader with the module whitelist
- folder import/export with `mirror-drive`
- pinned links, once we know how they work with autodrive

new:
- assigning a bot to exactly one device, and only that device can start it
- safe hand off: stop on the old device, finish syncing, then start on the new one
- per drive delete (`core.purge()`)
- one process owning the corestore, with the cli talking to it, because of the lock


--- 