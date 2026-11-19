// vault tests in a real browser, the vault runs in its SharedWorker (lib/vault-worker.js) like in the app
// run with: npm run relay, then npm run test:web and open http://datashell.localhost:9970/test/ (chrome, firefox, safari)
// this page only runs the tests. every tab of a device is an iframe that gives this page a port into its vault worker,
// device a on box1.datashell.localhost, device b on box2.datashell.localhost (another origin, so its own storage, like another device).
// this page drives both vaults with daemon.connect, closing a tab is removing its iframe. results go to the page and the console
// every run uses its own vault folder (identity-test-<run>) and worker, a tab deletes the folders of older runs first
const daemon = require('../lib/node_modules/daemon')
const serve_webrtc = require('../lib/node_modules/webrtc-bridge/page')
const { make_tx } = require('../lib/node_modules/iframe-runtime')

const [role, run] = location.hash.slice(1).split(':')
// each device is its own subdomain of localhost, so its own origin and storage, but its one server
const A = 'http://box1.datashell.localhost:9970'
const B = 'http://box2.datashell.localhost:9970'
const state = { failed: 0, checks: 0 }

if (role === 'tab') serve_tab(run)
else run_tests(Date.now().toString(36)).then(done, fail)

async function run_tests (run) {
  const tab1 = await open_tab(A, run)
  const tab2 = await open_tab(A, run)
  // seed
  let words = []
  await tab1.authenticate({ username: 'ali', on_seed_phrase: mnemonic => { words = mnemonic.split(' ') } })
  const user = await tab1.user
  check('a seed makes a vault and shows a 24 word seed phrase once', words.length === 24 && user.username === 'ali', words.length)
  // 2 tabs, 1 vault
  check('tab 2 gets the vault tab 1 made, without logging in again', (await tab2.user).username === 'ali')
  await tab1.vault_put('test/hello', { from: 'tab 1' })
  check('a value tab 1 puts is read by tab 2', (await tab2.vault_get('test/hello'))?.from === 'tab 1')
  // the put and its audit entry are one append, so the entry has the bee length right after the put (meta.views.bee)
  const logged = (await tab1.get_vault_audit().read()).findLast(entry => entry.data.params?.key === 'test/hello')
  const length = logged?.meta.views?.bee || 1
  const bee = tab1.get_vault_bee()
  const [at, before] = [await bee.checkout(length).get('test/hello'), await bee.checkout(length - 1).get('test/hello')]
  check('the audit entry of a put has the bee length, the bee has the value at that length and not one before', logged?.meta.views && at?.value.from === 'tab 1' && before === null, JSON.stringify(logged?.meta))
  const key = await tab1.vault_get('user/public_key')
  check('the user key is in the vault, the seed phrase isnt', key?.length === 64 && !Object.keys(localStorage).some(k => /seed/.test(k)))
  // the news app runs once in the worker and both tabs use it
  const app_id = 'ali:p2p-news-app'
  const news1 = (await tab1.open_app(app_id, 'ali')).news_app()
  await news1.init_blog({ username: 'ali' })
  await news1.create_post('hello from a', 'web test')
  await news1.create_post('big post from a', 'x'.repeat(40 * 1024)) // more than one 16KB data channel piece over webrtc
  const news2 = (await tab2.open_app(app_id, 'ali')).news_app()
  await news2.init_blog({ username: 'ali' })
  check('both tabs share one news app (same blog key)', await news1.get_autobase_key() === await news2.get_autobase_key())
  check('a post from tab 1 shows in tab 2', (await news2.get_my_posts()).some(post => post.title === 'hello from a'))
  // device b pairs through the relay
  const invite = await tab1.create_vault_invite()
  const asked = new Promise(resolve => tab1.setup_vault_pairing({ invite: invite.invite, username: 'ali', on_verification_needed: resolve, on_paired () {} }))
  const b = await open_tab(B, run)
  const ready = new Promise(resolve => b.on_vault_ready(resolve))
  const code = await new Promise(resolve => b.authenticate({ username: 'pairing-user', invite_code: invite.invite_code, on_verification_code: resolve }))
  await asked // b's request reached a, like the verify field showing up in the ui
  const wrong = code === '000000' ? '111111' : '000000'
  check('a wrong verification code is refused', await tab1.verify_vault_pairing(wrong).then(() => false, () => true))
  await tab1.verify_vault_pairing(code)
  await ready
  // a freshly paired device used to write before it was a writer and throw Not writable
  const wrote = await b.vault_put('test/from-b', { device: 'b' }).then(() => true, err => err.message)
  check('device b can write right after pairing', wrote === true, wrote)
  const [app] = await wait_for(b, async () => { const apps = await b.list_apps(); return apps?.length && apps })
  b.session_set_joined_app(app.id)
  b.complete_authentication()
  const news_b = (await b.open_app(app.id, 'ali')).news_app()
  await news_b.init_blog({ username: 'ali' })
  const seen = await wait_for(news_b, async () => { const list = await news_b.get_my_posts(); return list.length >= 2 && list.map(post => post.title) })
  check('device b pairs and gets the posts of device a', seen.length > 0)
  check('a post from device a shows on device b', seen.some(title => title === 'hello from a'), seen.join())
  check('a 40KB post reaches device b too (its webrtc messages go in pieces)', seen.some(title => title === 'big post from a'), seen.join())
  const from_b = await wait_for(tab2, () => tab2.vault_get('test/from-b'))
  check('device b is a writer too, a value it puts reaches device a', from_b?.device === 'b')
  // tab 1 does the webrtc for device a. when it closes, its connections close, tab 2 takes over and the devices connect again
  tab1.close_tab()
  await news2.create_post('after tab 1 closed', 'web test')
  const later = await wait_for(news_b, async () => (await news_b.get_my_posts()).some(post => post.title === 'after tab 1 closed'))
  check('after the webrtc tab of device a closed, a post from its other tab still reaches device b', later)
}

/***************************************
HELPERS
***************************************/
// a tab is an iframe on the devices origin, it gives a port into the vault worker of that origin to this page,
// like open_vault_worker in lib/datashell.js does for its own page
async function open_tab (origin, run) {
  const frame = document.createElement('iframe')
  frame.src = `${origin}/test/#tab:${run}`
  await new Promise(resolve => { frame.onload = resolve; document.body.append(frame) })
  const { port1, port2 } = new MessageChannel()
  const tab = Math.random().toString(36).slice(2)
  const tx = make_tx('page')
  frame.contentWindow.postMessage(tx({ to: 'vault', type: 'tab', data: { storage: {}, input: { name: `test-${run}` }, tab } }), '*', [port2])
  serve_webrtc(port1)
  return daemon.connect(port1, { close_tab: () => frame.remove() }, tx)
}

// in the tab iframe. it holds the tab lock while it lives, so the worker sees the tab close when the iframe is removed
function serve_tab (run) {
  delete_old_runs(run)
  addEventListener('message', e => {
    if (e.data?.type !== 'tab') return
    navigator.locks.request(`datashell-tab-${e.data.data.tab}`, () => {
      new SharedWorker('/vault.bundle.js', { name: `test-${run}` }).port.postMessage(e.data, [e.ports[0]])
      return new Promise(() => {})
    })
  })
}

// checks fn() again on every update of source (a vault or a news app), gives its first value that isnt empty
function wait_for (source, fn) {
  return new Promise((resolve, reject) => {
    let done = false
    const check = () => done || Promise.resolve(fn()).then(value => { if (value && !done) { done = true; resolve(value) } }, reject)
    source.on_update(check) // stays subscribed, theres no off, done makes later updates do nothing
    check()
  })
}

// folders of older runs, a folder still open in another tab is locked and stays
async function delete_old_runs (run) {
  const root = await navigator.storage.getDirectory()
  for await (const name of root.keys()) {
    if (name.startsWith('identity-test-') && name !== `identity-test-${run}`) await root.removeEntry(name, { recursive: true }).catch(() => {})
  }
}

function check (name, ok, info = '') {
  state.checks++
  if (!ok) state.failed++
  print(`${ok ? 'ok' : 'NOT ok'} ${name}${ok || info === '' ? '' : ` (${info})`}`)
}

function done () { print(`${state.checks - state.failed}/${state.checks} ok`) }

function fail (err) { print(`NOT ok test crashed: ${err.message}`) }

function print (line) {
  console.log(line)
  document.querySelector('.results').textContent += line + '\n'
}
