# moving bots between devices & recovery (draft)

folow up to `docs/datashell-vault-records.md`. so u wanted the exact steps for moving a bot from one device to another without it ever running twice, plus all the edge cases and recovery. im using the flamingo lightning wallet as the example, cuz if 2 copies of a lightning node run with the same channels u can lose all the funds. so if it works for that it works for everything basically.

nothing here is implmented yet. i did test some stuff on plain autobase 6.5.13 (what we're on) with a few small scripts, i marked those **tested**. rest is just proposal.

## what we know already

- **tested**: pairing makes every device an indexer of the vault (`vault_bee.add_writer()` defaults to `is_indexer = true`). an entry only gets signed (indexed) when a majortiy of indexers signed it, so with 2 devices u need both
- **tested**: 2 devices, cut one off. the other can still write and see its own stuff, but nothing new gets signed. i also had it call `removeWriter()` on the lost one, that didnt get signed either lol. when the lost one came back everything got signed, includng its own removal
- **tested**: 3 devices, one cut off. the 2 left signed everything and removed the third one without it
- **tested**: a stolen device that never sees its removal can keep writing, and a subscriber connected to it sees those entries. after everyone reconnects: if the removal came first, all its entries got dropped. if the stolen device wrote first, one of its entries ended up signed for good
- autobase readme: "the linearizing algorithm is able to define a point at which the ordering of the graph below will never change" (`indexedLength`). above that point entries can still be reordered, which matches what i saw
- autobase readme also says reodering only works if everything apply touches comes from the `store` passed to `open`.
- `apply` gets `node.from.key` for every entry, so it knows which device wrote it
- basims bots only know about one machnie: running or not comes from `run/<name>.pid` and stopping is a `SIGTERM` to that pid. the code a bot runs is pinned (`bot.json` entry has to be a pinned `dat://…/main.js`) but its own drive opens live and writable

## the rules (proposal)

1. **the box is state, moves are commands.** `bots/by-disk/<id> = { pin, box }` says which device runs it. changing that only happens through commands apended to a command log view (defined in `open`), like u said
2. **apply checks who sent a command.** `node.from.key` has to be a device thats allowed to send that command, if not apply just skips it
3. **only act on signed state.** a device only starts or hands off a bot if the commands are below `indexedLength`. unsigned stuff can still move around or dissapear, saw that happen in the stolen device test
4. **lease.** the box only keeps the bot running while it hears from the other devices. no ping for `T` and it stops the bot itself
5. **dont start without checking first.** after a restart or wakeup a device doesnt just start the bot, it has to hear from the others first and see signed state that says its still the box

## normal move from A to B

1. user picks B from whatever device, that device appends `{ type: 'move', data: { disk, to: B } }`. any paired device can do this
2. A sees the move once its signed, stops the bot, waits untill it really stopped, and appends `{ type: 'moved', data: { disk, box: B, pin } }`. `pin` is `<length>.<fork>.<hash>` of the bot disk where it stopped. apply only accepts `moved` from the current box
3. A also removes itself as a writer of the bot disk & adds B
4. B sees the signed `moved` with itself as box, waits till copy of the disk has exactly that pin (length + hash), then starts

if A is offline the move just waits for it. it never runs twice, because B only starts after A said where it stopped, and A only says that after it stopped.

api could look like this (names not decided, i tried to keep it close to basim's cli):

```js
const wallet = await vault.bots.create('wallet', 'flamingo-node/main.js') // cli bot +wallet flamingo-node/main.js
await vault.bots.start('wallet') // cli bot wallet --run, only works on the box
await vault.bots.move('wallet', device_b) // cli bot wallet --move=<device>, works from any device
await vault.bots.end('wallet') // cli bot wallet --end
vault.bots.on('state', on_bot_state) // { name, box, running, last_ping }
function on_bot_state (state) { show_bot(state) }
```

and the apply part:

```js
// view.log is the command log, view.state is the bee with bots/by-disk/<id>
async function apply (nodes, view, host) {
  for (const node of nodes) {
    const from = b4a.toString(node.from.key, 'hex')
    if (!await is_allowed({ view, command: node.value, from })) continue // device isnt allowed to send this, skip
    await view.log.append(node.value) // moves only go here, all devices read them from the log
    if (node.value.type === 'moved') await view.state.put(`bots/by-disk/${node.value.data.disk}`, { pin: node.value.data.pin, box: node.value.data.box })
  }
}

// any of my devices can ask for a move, only the current box can say it moved
async function is_allowed ({ view, command, from }) {
  if (command.type === 'move') return true
  const bot = await view.state.get(`bots/by-disk/${command.data.disk}`)
  return command.type === 'moved' && bot?.value.box === from
}
```

## technical situations

um, so i went through the edge cases, thought about possibilites:

### 1. the box process is gone
crash, dead battery, power cut, shut down, whatever.
- what happens: bot dies with it, so nothing is running
- what we do: nothing really, theres nothing to stop. other devices just stop getting pings and can show "B unreachable". when it restarts rule 5 kicks in
- left: if its gone forever thats situation 6

### 2. the box runs but cant reach any other device
wifi down, vpn issues, lost somewhere but still on, or stolen and offline.
- what happens: it has no way to know if everyone else is down or if its the one thats cut off
- what we do: lease. if theres no ping for `T` it stops itself. another device can only take over after `T` + some margin, and only with a signed takeover command (rule 3) which needs a majority. so with 2 devices nobody can take over, bot just stays down till they see each other again. with 3, the 2 that can still see each other can take over
- left: picking `T`. small `T` means every wifi drop stops the bot, big `T` means a long wait after a real crash. for lightning a few minutes down is obv way better than running twice

### 3. the box is frozen
laptop sleep or hibernate.
- what happens: the process just stops and contiues later. after waking it can do something before any timer notices how much time passed
- what we do: stop the bot before sleeping, see the sleep part below. on wake rule 5
- left: forced sleeps that skip the lock, and which clock we measure `T` with. if its a clock that doesnt count sleep, the lease would never expire during a long sleep. havent tested that

### 4. the box comes back with old state
was offline for days, back/found again.
- what happens: its copy of the vault is old, it still thinks its the box
- what we do: rule 5, it starts nothing until it heard from the others and saw signed state that its still the box. if there was a signed takeover meanwhile it sees that and stays stopped
- left: data from anyone is signed so nobody can fake it, but they can give old data. "heard from the others" has to mean a majority of my own devices

### 5. the box is in someone elses hands and online
stolen.
- what happens: hmm, i think can still reach my other devices since it has the keys and they look each other up by them (not tested), so it keeps getting pings and the lease never runs out. and like i tested above, it can keep writing till its removal is signed
- what we do: user marks it stolen from one of the other devices. that device appends a revoke command, my devices stop replying to its pings so the lease runs out, and it gets kicked as a writer
- left: not sure tbh but if the thief runs modified code, theres nothing technical stopping a copy of the bot running with the keys on that device. for the wallet that means u gotta move the the funds to a device thats still yours. also with 2 devices the removal only gets signed if the stolen one reconnects (situation 6)

### 6. nobody is left to sign
2 devices, one dead for good
- what happens: the one thats left still works locally but nothing new gets signed and it cant kick the lost one
- what we do: needs something from outside, recovery perhaps
- left: this is the main hard case

### 7. two commands at the same time
user moves the bot from two devices at the same time, or moves it right while a device is getting removed.
- what happens: autobase puts them in some order, and once its signed every device has the same order
- what we do: rule 3 again, nothing happens before its signed, and apply decides based on the state at that spot in the order. if a `moved` comes from a device thats not the box anymore it just gets skipped
- left: nothing i can think of, but should be tested once the command log exists

### **These are all the edge cases I could think of, perhaps i'll add more as we go.**
## laptop sleep
already explained on discord;
i checked bares `suspend` (bare 1.34.1):
- i think its meant for mobile, the app that embeds bare calls `Bare.suspend()` when it goes to the background. on the cli nothing calls it, pausing the process (`SIGTSTP`, `SIGSTOP`/`SIGCONT`) fired no event
- `Bare.suspend()` doesnt stop anything by itself, timers kept running. it emits `suspend`, the app stops its own work, then `idle` and bare keeps the process alive. `Bare.resume()` lets it go again



### proposal

- recovery is obv not implemented yet, so that
- a new device can be added without the invite dance if its request is signed with the mnemonic key. ur idea uses optimistic writes for that, but those are in autobase 7 (`optimistic: true` + `host.ackWriter()`), our 6.5.13 doesnt have them. on 6.5.13 the new device could just send its key signed with the mnemonic key, then any of my devices thats online checks the signatrue and adds it. needs one of them online tho
- for situation 6, maybe the mnemonic could also give an indexer key thats added as indexer right from the start. then its 2 devices + mnemonic = 3 indexers, so the device thats left plus one restored from the mnemonic are a majority and can sign the lost ones removal. kinda hacky but yeah
- moving bots belongs here too: after a recovery the bot is moved with a signed takeover command like in situation 2, never just started

## open questions

1. u agreed on the lease, but we never picked the actual `T` and margin. also which clock to measure them with
2. with 2 devices a lost box means the bot stays down until recovery. is that fine, or should wallet bots need 3 devices?
3. mnemonic as an extra indexer - mentioned this as a hacky idea, would love ur thoughts on this.
4. should the ui show unsigned entries as "not confirmed yet"? with 2 devices our own posts are unsigned while the other one is off, so thats a bit weird too. 
5. sleep on macos, windows, mobile and the browser
6. what we do when B never gets the data A pinned


overall a lot of things to take care of, lets see how it goes. 