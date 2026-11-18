# the datashell process, basims cli and our browser vault

serapath wants the way apps use the datashell process to be the same in the browser and in basims backend. this compares the two as they are now and proposes how to make them the same. **proposal**, nothing changed yet, basim and i need to agree first so we dont build it twice.

## basims cli (flamingo-node `scripts/`, commit `c7c9d9a`, 16 nov)

- `runtime(root)` is the api in one process, `{ pkg, cap, bot }`, each with named actions (`pkg.list`, `pkg.create`, `bot.run` ...)
- `daemon.js` is one process per storage root. it owns the storage, runs the bots, listens on a unix socket (`ds.sock`, pid in `ds.pid`), and exits when no command is connected and no bot runs
- `remote(root)` is the same api over the socket, it starts the daemon if its not up
- messages are one json per line, `{ id, kind, action, args }`, the answer `{ id, result }` or `{ id, error }`, and `{ id, line }` for what a running bot prints

## our browser vault (`lib/vault-worker.js`, see `lib/README.md`)

- the vault worker is the process (a SharedWorker, or a dedicated worker without one). it owns the opfs storage and every tab talks to it over its own port
- the api is the whole identity object. `daemon` (was `remote`) sends `{ ref, path, args }` calls in our `{ head, refs, type, data, meta }` format and gives the page live stand ins for objects that stay in the worker (the vault bee, watchers), and callbacks the worker can await (`on_seed_phrase`)
- on the cli there is no process yet, `lib/datashell.js` opens identity in the same process as the command

## what is different

- shape, basim has a few namespaces with plain actions, ours is one big object with live objects in it
- messages, `{ id, kind, action, args }` vs our `{ head, refs, type, data, meta }`
- streams, basim streams a bots output as `line` messages, we stream `watch()` through a stand in iterator
- callbacks, basim has none, our pairing and seeding need them (the worker waits for the user)

## proposal

1. one api shape for both, namespaces with named actions: basims `pkg`, `cap`, `bot`, and ours as `vault` (`put`, `get`, `del`, `watch`), `pair`, `apps`. live objects only where an action needs them (`watch` streams like his `line`)
2. one message format, our `{ head, refs, type, data, meta }`, `type` = `kind.action`, `data` = args, the answer points back with `refs.cause`. his socket.js stays (one json per line), only the fields change
3. on the cli the vault runs inside his daemon as one more namespace, in the browser the vault worker serves the same namespaces, so an app gets the same api from `daemon` on both
4. callbacks become actions the other side answers (e.g. the daemon asks `seed.confirm` and the command answers), so the format stays plain json

questions for basim: is the `kind.action` type ok with u, and should the vault namespace live in runtime.js or in a module the daemon loads?
