# test/web.js

vault tests in a real browser, with the vault in its SharedWorker like in the app.

```
npm run relay
npm run test:web   # builds vault.bundle.js, serves this page on localhost:9970 and 9971
```

then open `http://localhost:9970/test/`, the results show on the page and in the console.

- the page is device a. it opens 2 ports into one vault worker, thats what 2 browser tabs do, so "2 tabs" in the checks means 2 ports
- device b is an iframe on `localhost:9971`, another origin, so it has its own storage like another device. it only does what device a asks it to with `postMessage`
- every run uses its own vault (`identity-test-<run>`), the vaults of older runs get deleted first

it checks: a seed makes a vault and shows the seed phrase once, tab 2 gets the vault tab 1 made, a value tab 1 puts is read by tab 2 and its audit entry has the bee length (`meta.views`), the user key is in the vault and the seed phrase isnt saved, both tabs share one news app and see each others posts, a wrong verification code is refused, device b pairs, posts (also a 40KB one) reach device b, and a value device b puts reaches device a
