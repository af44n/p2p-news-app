# vault records for packs & bots (draft)

This is a follow up to `docs/datashell-packs-bots.md`. there i compared basim's packs/tasks with our code, this one is a proposal for how packs and bots could actually live in the vault, and how a bot moves from one device to another without ever running on two at once. nothing is implemented yet, it's just so we can agree on it first.

## what the vault already has

just so it's clear what this builds on, `vault_bee` already keeps these records and they sync to all paired devices:

- `apps/<app_id>`: the app record with its structure keys (`register_app()`)
- `device_apps/<device>/<app_id>`: `{ status: 'joined' | 'pairing' | 'available' }` per device
- `paired_devices/<device>`: name, writer keys, `last_online`, `removed`
- `writer_requests/<app_id>`: a device asks for write access, the owner device processes it

`<device>` everywhere is the device's `vault_bee` writer key in hex, so i guess use the same thing for bots.

## packs

```js
await vault.vault_put('packs/flamingo-node', {
  link: 'dat://<length>.<fork>.<id>.<hash>',
  created_at: Date.now()
})
```

that's basically `pkgs.json`, just one record per name. listing is a read stream over `packs/`, same as `list_apps()` does for `apps/`. since the packs to be autodrives, `link` might change, but the record itself stays the same.

## bots

```js
await vault.vault_put('bots/my-wallet', {
  drive: 'dat://<length>.<fork>.<id>.<hash>', // the bot's own drive, has bot.json + its data
  device: '<vault_bee writer of the device that may run it>',
  epoch: 1, // goes up by one every time the bot moves
  length: 0 // drive length when it was handed over, the new device waits
})
```

the code to run isn't in the record, it's already in `bot.json` inside the drive, so no need to keep it twice.

the important field is `device`. only that device is allowed to start the bot. every other device can see it, its data syncs to them, but they never run it

### status

```js
await vault.vault_put('bot_status/my-wallet', { device: '<writer>', state: 'running', since: Date.now() })
```

only the owner device writes this, so the browser (or any other device) can show if it's running and where. i kept it separate from `bots/<name>` because it changes a lot and the ownership record should only change on a hand off. one thing to keep in mind, every `vault_put` also adds an entry to the vault audit log, so we shouldn't write status on a timer, only when it actually starts or stops.

### creating a bot

before writing `bots/<name>` we go through all `bots/` records and refuse if any of them already uses the same drive id. basim already does this check, but only on one machine, here it covers every device in the identity.

the new bot gets `device` = the device that created it and `epoch: 1`.

## moving a bot to another device

say the bot runs on device A and we want it on device B.

1. B asks for it, e.g. `bot_requests/my-wallet` = `{ from: '<B>' }`. same idea as `writer_requests`, B never just takes it.
2. A sees the request (watching `bot_requests/` like `start_writer_watcher()` watches `writer_requests/`) and the user confirms on A.
3. A stops the bot and waits until it has fully stopped.
4. A writes `bots/my-wallet` with `device: '<B>'`, `epoch: 2` and `length` = the bot drive's length right now.
5. B sees the new record. it only starts the bot if `device` is its own key and its copy of the drive has reached `length`, so it never starts with old data.

what makes this safe is that **only the current owner ever changes `device`**. B can ask, but it can't write the ownership itself.

so its safe because

- A crashes after stopping but before writing: the bot is still assigned to A and just isn't running. A starts it again when it comes back.
- A writes the hand off but goes offline before it syncs: A already stopped, and B doesn't see the new record, so B doesn't start. nothing runs until the record syncs, but it never runs twice.

so the worst case is the bot being stopped for a while, never two copies running

### writing to the bot drive

as the bot drive will be an autodrive, A also has to add B as a writer before the hand off and remove itself after (`add_writer()` / `remove_writer()` in `datastructure-manager`, like `remove_device()` does for app structures).

##  if owner is gone

if A is lost, it can't hand anything off, and B can't take the bot by itself

the only way out i see is with our future mnemonic recovery

also, when the old device does come back, it has to check the record before doing anything and stop the bot if `device` isn't itself anymore.

## things this needs that we don't have

- device type: if its cli or browser, though i think, i have implemented this for connection type so thats a quick fix
- a watcher on `bots/` and `bot_requests/` on every cli device
- the mnemonic override for the lost device case
- one process per device that owns the corestore and runs the bots, because of the lock
