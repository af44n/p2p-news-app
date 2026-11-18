# the vault worker

in the browser the vault (identity, its corestore and the apps structures) runs in a worker, the datashell process of the browser, like basims daemon on the cli. all tabs of the site share it, so it logs in once and every profile and its news app run once.

- `lib/vault-worker.js` runs in the worker. a SharedWorker where the browser has one, else a dedicated worker that only one tab runs at a time (the other tabs wait for a lock in `datashell.js`). every tab sends it a port, the first tab starts the vault, later tabs use the same one (`daemon.serve`). the worker has no localStorage, so it starts with the first tabs values and sends every write back to the tabs. a reset or a removed device reloads every tab and stops the worker
- `lib/datashell.js` (`open_vault_worker`) is the page side. `daemon.up()` starts the worker or connects to it, does the webrtc for it (`webrtc-bridge`) and gives the vault stand in
- `lib/build-vault.js` builds `vault.bundle.js` with browserify. it swaps what the browser cant run: `fs`, `device-file` and rocksdb-natives binding go to rocksdb-native-opfs, `path` to path-browserify, `get-webrtc` to webrtc-bridge. browserify 17 doesnt read package.json "exports", so those requires get the file node resolves, and libsodium.js goes in unparsed (browserify cant parse it)

## the news app runs in the worker

before, the page did `blog_app(uservault)` and the news app ran in the page. now its structures live in the worker (the corestore is there), and they cant be copied to a page, so `open_app()` in the worker starts the news app there and the page calls `uservault.news_app()` to get a stand in for it. every tab gets the same news app, it starts once

## npm scripts

- `npm run build:vault` builds `vault.bundle.js`
- `npm run web` and `npm run build` build it too now, before the other bundles
- `npm run test:web` builds it and serves `test/web.js` (see `test/README.md`)
