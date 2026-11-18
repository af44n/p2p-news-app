# test/web.js

vault tests in a real browser, with the vault in its SharedWorker like in the app.

```
npm run relay
npm run test:web   # builds vault.bundle.js, serves this page on port 9970
```

then open `http://datashell.localhost:9970/test/`, the results show on the page and in the console.

- the page only runs the tests. every tab of a device is an iframe on that devices origin, it gives the page a port into its vault worker and the page drives that vault with `daemon.connect`. device a is `box1.datashell.localhost` with 2 tab iframes that share one vault worker, like 2 browser tabs, device b is `box2.datashell.localhost`. every subdomain is its own origin with its own storage, like another device, but its all one server. the page itself is on `datashell.localhost`, so the iframes are the same site and the browser doesnt treat their storage as third party
- closing a tab is removing its iframe, the worker sees it close like a closed browser tab
- every run uses its own vault (`identity-test-<run>`), a tab deletes the vaults of older runs first

it checks: a seed makes a vault and shows the seed phrase once, tab 2 gets the vault tab 1 made, a value tab 1 puts is read by tab 2 and its audit entry has the bee length (`meta.views`), the user key is in the vault and the seed phrase isnt saved, both tabs share one news app and see each others posts, a wrong verification code is refused, device b pairs and can write right away (it used to throw Not writable), posts (also a 40KB one) reach device b, a value device b puts reaches device a, and after device a's webrtc tab closes a post from its other tab still reaches device b
