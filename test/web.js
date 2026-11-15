// vault tests in a real browser, the vault runs in its SharedWorker (lib/vault-worker.js) like in the app
// run with: npm run relay, then npm run test:web and open http://localhost:9970/test/ (chrome, firefox, safari)
// this page is device a and opens 2 tabs into one vault (2 ports, like 2 browser tabs). device b is an iframe
// on localhost:9971, another origin so its own storage, like another device. results go to the page and the console
// every run uses its own vault folder (identity-test-<run>) and worker, the folders of older runs get deleted first
const remote = require('../lib/node_modules/remote')
const serve_webrtc = require('../lib/node_modules/webrtc-bridge/page')

const [role, run] = location.hash.slice(1).split(':')
const state = { failed: 0, checks: 0 }

if (role === 'b') device_b(run).catch(fail)
else device_a(Date.now().toString(36)).then(done, fail)

async function device_a (run) {
  await delete_old_runs()
  const tab1 = open_tab(run)
  const tab2 = open_tab(run)
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
  // device b pairs through the relay, then sees the post
  const invite = await tab1.create_vault_invite()
  const asked = new Promise(resolve => tab1.setup_vault_pairing({ invite: invite.invite, username: 'ali', on_verification_needed: resolve, on_paired () {} }))
  const b = open_device_b(run)
  const code = await wait_message(b, 'code', 60000, () => b.post({ type: 'pair', invite_code: invite.invite_code }))
  await asked // b's request reached a, like the verify field showing up in the ui
  const wrong = code === '000000' ? '111111' : '000000'
  check('a wrong verification code is refused', await tab1.verify_vault_pairing(wrong).then(() => false, () => true))
  await tab1.verify_vault_pairing(code)
  const seen = await wait_message(b, 'posts', 90000)
  check('device b pairs with the invite and the verification code', !!seen)
  check('a post from device a shows on device b', seen.some(title => title === 'hello from a'), seen.join())
  check('a 40KB post reaches device b too (its webrtc messages go in pieces)', seen.some(title => title === 'big post from a'), seen.join())
  const from_b = await wait_for(() => tab2.vault_get('test/from-b'), 60000).catch(() => null)
  check('device b is a writer too, a value it puts reaches device a', from_b?.device === 'b')
}

// device b only does what device a asks it to and answers with postMessage
async function device_b (run) {
  const tab = open_tab(run)
  const { invite_code } = await new Promise(resolve => addEventListener('message', e => e.data.type === 'pair' && resolve(e.data), { once: true }))
  tab.on_vault_ready(on_ready)
  tab.authenticate({ username: 'pairing-user', invite_code, on_verification_code: code => parent.postMessage({ type: 'code', data: code }, '*') })
  async function on_ready () {
    const [app] = await wait_for(async () => { const apps = await tab.list_apps(); return apps?.length && apps }, 60000)
    tab.session_set_joined_app(app.id)
    tab.complete_authentication()
    const news = (await tab.open_app(app.id, 'ali')).news_app()
    await news.init_blog({ username: 'ali' })
    const posts = await wait_for(async () => { const list = await news.get_my_posts(); return list.length >= 2 && list }, 60000)
    await tab.vault_put('test/from-b', { device: 'b' })
    parent.postMessage({ type: 'posts', data: posts.map(post => post.title) }, '*')
  }
}

/***************************************
HELPERS
***************************************/
// a tab of the app talks to the worker over its own port, like open_vault_worker in lib/datashell.js
function open_tab (run) {
  const { port1, port2 } = new MessageChannel()
  const tab = Math.random().toString(36).slice(2)
  port1.postMessage({ type: 'start', data: { storage: {}, input: { name: `test-${run}` }, tab } })
  navigator.locks.request(`datashell-tab-${tab}`, () => {
    new SharedWorker('/vault.bundle.js', { name: `test-${run}` }).port.postMessage({ type: 'tab' }, [port2])
    return new Promise(() => {}) // held while the page lives
  })
  serve_webrtc(port1)
  return remote(port1)
}

function open_device_b (run) {
  const frame = document.createElement('iframe')
  frame.src = `http://localhost:9971/test/#b:${run}`
  document.body.append(frame)
  return { post: msg => frame.contentWindow.postMessage(msg, '*') }
}

// sends (again every 2s, the iframe may still be loading) till the answer of that type comes back
function wait_message (b, type, ms, send = () => {}) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(send, 2000)
    send()
    addEventListener('message', function on_message (e) {
      if (e.data?.type !== type) return
      clearInterval(timer)
      removeEventListener('message', on_message)
      resolve(e.data.data)
    })
    setTimeout(() => { clearInterval(timer); reject(new Error(`no ${type} from device b in ${ms}ms`)) }, ms)
  })
}

async function wait_for (fn, ms) {
  for (const until = Date.now() + ms; Date.now() < until;) {
    const value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('timed out')
}

// folders of older runs, a folder still open in another tab is locked and stays
async function delete_old_runs () {
  const root = await navigator.storage.getDirectory()
  for await (const name of root.keys()) {
    if (name.startsWith('identity-test-')) await root.removeEntry(name, { recursive: true }).catch(() => {})
  }
}

function check (name, ok, info = '') {
  state.checks++
  if (!ok) state.failed++
  print(`${ok ? 'ok' : 'NOT ok'} ${name}${ok || info === '' ? '' : ` (${info})`}`)
}

function done () { print(`${state.checks - state.failed}/${state.checks} ok`) }

function fail (err) { print(`NOT ok ${role === 'b' ? 'device b' : 'test'} crashed: ${err.message}`) }

function print (line) {
  console.log(line)
  document.querySelector('.results').textContent += line + '\n'
}
