// run with: bare lib/app-vault-test.js
// checks what an app gets from datashell. create_app_vault is taken from lib/datashell.js as it is
// (datashell.js starts the whole cli when required, so the function is read from its source)
// and run on a real seeded cli vault in a temp folder
const fs = require('bare-fs')
const os = require('bare-os')
const path = require('bare-path')
const process = require('bare-process')

const APP_ID = 'lupay:p2p-news-app'
// everything the news app uses (p2p-news-app, p2p-news-app-content, cliapp-ui, webapp-ui)
const APP_GETS = [
  'username', 'store', 'app_state',
  'create_ds_manager', 'set_ds_manager', 'set_events_drive', 'get_raw_data',
  'vault_put', 'vault_get', 'vault_del', 'vault_watch',
  'register_app', 'get_app', 'get_app_audit', 'load_app_audit',
  'start_writer_watcher', 'request_writer_access', 'wait_for_writer_access', 'log_bootstrap_device',
  'get_app_status', 'network'
]
let failed = 0
main().then(done)

async function main () {
  const create_app_vault = load_create_app_vault()
  // storage and the seed phrase file are relative to the folder the cli runs in
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'app-vault-test-')))
  require('local-storage-shim')
  const vault = require('identity')({ env: {}, arg: [] })
  await vault.authenticate({ username: 'lupay' })
  const user = await vault.user
  user.app_state = {} // datashell does the same before it makes the app vault
  const app = await create_app_vault(user, APP_ID, 'lupay')

  const keys = Object.keys(app)
  const extra = keys.filter(key => !APP_GETS.includes(key))
  check('1. the app only gets what it uses', extra.length === 0 && keys.length === APP_GETS.length, extra.length ? `also gets ${extra.length}: ${extra.join(', ')}` : `${keys.length} keys`)
  const admin = ['remove_device', 'create_vault_invite', 'verify_vault_pairing', 'get_vault_bee', 'get_swarm', 'list_apps']
  check('2. no device, pairing or raw vault functions', admin.every(name => !(name in app)), admin.filter(name => name in app).join(', '))

  await app.vault_put('note', { text: 'hi' })
  const stored = await user.vault_get(`${APP_ID}/note`)
  check('3. vault_put still writes under the app prefix', stored?.text === 'hi')

  const watcher = app.vault_watch('note')
  const changed = watcher[Symbol.asyncIterator]().next()
  await app.vault_put('note', { text: 'changed' })
  check('4. vault_watch still sees a change of the apps own key', await within(changed, 5000))
  await watcher.close?.()

  check('5. app_state is the same object as on the user vault', app.app_state === user.app_state)
  check('6. the app gets its own namespaced store, not the root store', app.store !== user.store)
}

function load_create_app_vault () {
  const src = fs.readFileSync(path.join(__dirname, 'datashell.js'), 'utf8')
  const fn = src.match(/async function create_app_vault [\s\S]*?\n}\n/)[0]
  return new Function(`${fn}\nreturn create_app_vault`)() // eslint-disable-line no-new-func
}

function within (promise, ms) {
  return Promise.race([promise.then(() => true), new Promise(resolve => setTimeout(resolve, ms, false))])
}

function check (name, ok, note = '') {
  console.log(`${ok ? 'ok' : 'not ok'} ${name}${note ? `  (${note})` : ''}`)
  if (!ok) failed++
}

function done () {
  console.log(failed ? `${failed} failed` : 'all good')
  process.exit(failed ? 1 : 0)
}
