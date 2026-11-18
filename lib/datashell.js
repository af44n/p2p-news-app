// Datashell code
// Loads identity module and executes app code with identity vault

const daemon = require('daemon')

module.exports = { create_app_vault } // the vault worker (vault-worker.js) uses it too

if (typeof WorkerGlobalScope === 'undefined') { // in the vault worker this file only gives create_app_vault
  (globalThis.open
    ? boot(loadweb, inputweb('system.bundle.js', 'bundle.js'))
    : boot(loadcli, inputcli(__dirname + '/clisys-ui.js', __dirname + '/cliapp-ui.js'))
  ).catch(onerror)
}

function onerror (error) {
  console.error('[datashell] Loader error:', error)
}

function inputcli (sysurl, appurl) {
  const process = require('bare-process')
  const env = process.env
  const args1 = [sysurl, appurl, ...process.argv.slice(2)]
  const args2 = [sysurl, appurl]
  const arg = args1.length ? args1 : args2
  return { env, arg }
}

function inputweb (sysurl, appurl) {
  const env = Object.fromEntries(new URLSearchParams(location.search).entries())
  const args1 = location.hash.slice(1).split('#').filter(x => x)
  const args2 = document.currentScript.src.split('#').slice(1).filter(x => x)
  const args3 = [sysurl, appurl]
  const arg = args1.length ? args1 : args2.length ? args2 : args3
  return { env, arg }
}

async function loadcli (href) {
  // Use eval to avoid browserify trying to bundle bare-fs
  const fs = eval('require')('bare-fs')
  const src = fs.readFileSync(href)
  const async_function = (async () => {}).constructor
  const fn = new async_function('vault, document, require', src)
  return function (vault, doc) { return fn(vault, doc, require) }
}

// cli apps run from an autodisk: the app file and everything it requires is copied into it first
async function loadcli_drive (href, vault) {
  const req = eval('require') // keeps browserify from bundling these bare only modules
  const builtins = { 'bare-process': req('bare-process') }
  const drive = req('autodisk')({ store: vault.store.namespace('app-code') })
  const file = await req('code-to-disk')({ drive, file: href, builtins })
  const app = await req('disk-loader')({ drive, file, builtins })
  await drive.close()
  return app
}

async function loadweb (href) {
  const url = new URL(href, location)
  const response = await fetch(url, { cache: 'no-cache' })
  const src = await response.text()
  const async_function = (async () => {}).constructor
  return new async_function('vault, document', src)
}

async function boot (load, input) {
  const is_web = !!globalThis.open
  // on web the vault runs in a worker (opfs storage only works there), eval keeps browserify from bundling identity
  const vault = is_web ? await open_vault_worker(input) : eval('require')('identity')(input)
  const [sysurl, appurl] = input.arg
  const sys_doc = is_web ? make_document(create_shadow()) : undefined
  const app_doc = is_web ? make_document(create_shadow()) : undefined
  const system = await load(sysurl)

  do {
  await system(vault, sys_doc)
  const uservault = await vault.user
    // Keep a state object attached to the user so the app can remember things across menu switches
    if (!uservault.app_state) uservault.app_state = {} 
  if (!appurl) break
  const app = is_web ? await load(appurl) : await loadcli_drive(appurl, vault)
  // Wrap vault for the app — auto-namespace so app never sees its APP_ID
    const app_instance_id = vault.session_get_joined_app() || 'p2p-news-app'
  const profile_name = app_instance_id.includes(':') ? app_instance_id.split(':')[0] : uservault.username
  const app_vault = is_web ? await vault.open_app(app_instance_id, profile_name) : await create_app_vault(uservault, app_instance_id, profile_name)
  if (is_web) app(app_vault, app_doc)
  else await app(app_vault, app_doc)
} while (!is_web)
}

/***************************************
APP VAULT WRAPPER
Provides a namespaced vault so the app is sandboxed.
The app only gets the functions listed here and its own namespaced corestore,
not the root store, the vault bee or the pairing and device functions.

Structure:
  root_store (identity)
  ├── namespace('vault')             → system vault (one autobase, the bee + the audit log as views)
  └── namespace(app_id)              → appstore (what app receives)
      └── app creates its own structures here
***************************************/
async function create_app_vault (vault, app_instance_id, profile_name) {
  const appstore = vault.store.namespace(app_instance_id)
  await appstore.ready()
  return {
    username: profile_name || vault.username,
    store: appstore,
    app_state: vault.app_state,
    // the app hands its structures to the vault, so the vault can add and remove their writers
    create_ds_manager: vault.create_ds_manager,
    set_ds_manager: vault.set_ds_manager,
    set_events_drive: vault.set_events_drive,
    get_raw_data: vault.get_raw_data,
    // Auto-namespaced data operations
    vault_put: (key, value) => vault.vault_put(`${app_instance_id}/${key}`, value),
    vault_get: (key) => vault.vault_get(`${app_instance_id}/${key}`),
    vault_del: (key) => vault.vault_del(`${app_instance_id}/${key}`),
    vault_watch: (key) => vault.get_vault_bee().watch({ gte: `${app_instance_id}/${key}`, lte: `${app_instance_id}/${key}` }),
    // Auto-scoped app operations
    register_app: (config) => vault.register_app(app_instance_id, config),
    get_app: () => vault.get_app(app_instance_id),
    get_app_audit: () => vault.get_app_audit(app_instance_id),
    load_app_audit: (key) => vault.load_app_audit(app_instance_id, key),
    start_writer_watcher: () => vault.start_writer_watcher(app_instance_id),
    request_writer_access: () => vault.request_writer_access(app_instance_id),
    wait_for_writer_access: () => vault.wait_for_writer_access(app_instance_id),
    log_bootstrap_device: () => vault.log_bootstrap_device(app_instance_id),
    get_app_status: () => vault.get_app_status(app_instance_id),
    network: (options = {}) => vault.network({ ...options, app_id: app_instance_id })
  }
}

/***************************************
VAULT WORKER
the vault runs in vault.bundle.js (lib/vault-worker.js), the page gets a stand in for it.
the session values stay in the page, they are read right away (not async) and live in localStorage
***************************************/
async function open_vault_worker (input) {
  const state = { joined_app: '' } // the joined app lives in the vault, the page keeps a copy so the uis can read it right away
  const local = {
    session_get_username: () => localStorage.getItem('username'),
    session_set_username: v => localStorage.setItem('username', v),
    session_get_joined_app: () => state.joined_app,
    session_set_joined_app,
    load_last_app,
    session_get_pending_invite: () => localStorage.getItem('pending_invite_code') || null,
    session_set_pending_invite: v => localStorage.setItem('pending_invite_code', v),
    session_clear_pending_invite: () => localStorage.removeItem('pending_invite_code'),
    session_clear: () => localStorage.clear()
  }
  const vault = await daemon.up({ input, local, on_wait })
  return vault
  function session_set_joined_app (app_id) {
    state.joined_app = app_id
    vault.save_joined_app(app_id)
  }
  async function load_last_app () {
    state.joined_app = await vault.read_last_app()
    return state.joined_app
  }
  // no SharedWorker and another tab has the vault, the note goes away once that tab closes
  function on_wait () {
    const note = document.createElement('div')
    note.textContent = 'datashell is open in another tab, this tab continues once that one is closed'
    document.body.prepend(note)
    return () => note.remove()
  }
}

/***************************************
SHADOW DOM HELPERS
***************************************/
function create_shadow () {
  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  document.body.appendChild(el)
  return shadow
}

function make_document (shadow) {
  return {
    body: shadow,
    createElement: document.createElement.bind(document),
    createTextNode: document.createTextNode.bind(document),
    querySelector: shadow.querySelector.bind(shadow),
    querySelectorAll: shadow.querySelectorAll.bind(shadow),
    addEventListener: shadow.addEventListener.bind(shadow)
  }
}
