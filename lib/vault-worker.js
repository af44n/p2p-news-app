// the browser vault runs here, the datashell process of the browser, like basims daemon on the cli. it owns the
// opfs storage (rocksdb-native-opfs) and every tab of this site talks to it through its own port (daemon module).
// a SharedWorker where the browser has one, so all tabs share one vault, else a dedicated worker that only one tab
// runs at a time (datashell.js waits for a lock). either way a tab sends its port with a 'tab' message
// these have to be set before the requires: a worker has no window / open / alert / reload / setImmediate, and which-runtime reads global.process
globalThis.process = globalThis.process || process
globalThis.window = globalThis // identity checks typeof window (a removed device alerts the user)
globalThis.open = function () {} // identity and identity-networking check globalThis.open for "web"
globalThis.alert = text => send_to_tabs('alert', text) // a removed device tells the user, the tabs show it
self.location.reload = restart_all_tabs // and reloads after wiping itself
globalThis.setImmediate = globalThis.setImmediate || ((fn, ...args) => setTimeout(fn, 0, ...args)) // hypercore 11 uses it, browsers dont have it
const identity = require('identity')
const daemon = require('daemon')
const webrtc = require('webrtc-bridge')
const blog_app = require('p2p-news-app')
const { create_app_vault } = require('./datashell')

const state = { vault: null, tabs: new Map(), apps: new Map() } // tabs: port -> send
self.addEventListener('connect', on_connect) // SharedWorker
self.addEventListener('message', on_tab) // dedicated worker

function on_connect (event) {
  event.ports[0].addEventListener('message', on_tab)
  event.ports[0].start()
}

// the tab message brings the port, the pages localStorage and the boot input
function on_tab (event) {
  if (event.data?.type === 'tab') add_tab(event.ports[0], event.data.data)
}

function add_tab (port, { storage, input, tab }) {
  if (!state.vault) state.vault = open_vault(storage, input) // the first tab starts the vault, the others use it
  webrtc.use_page(port) // the first tab that is still open does the webrtc connections
  state.tabs.set(port, daemon.serve(port, state.vault))
  navigator.locks.request(`datashell-tab-${tab}`, () => close_tab(port)) // the tab holds this lock while it lives
}

function close_tab (port) {
  state.tabs.delete(port)
  webrtc.drop_page(port) // its webrtc connections are gone with it
  for (const other of state.tabs.keys()) webrtc.use_page(other)
}

function open_vault (storage, input) {
  globalThis.localStorage = make_storage(storage)
  const vault = identity(input)
  share_login(vault)
  vault.open_app = open_app
  const reset_all_data = vault.reset_all_data
  vault.reset_all_data = reset_and_restart
  return vault
  async function reset_and_restart () {
    await reset_all_data()
    restart_all_tabs() // the tab that asked reloads with the others, the worker is gone before any of them comes back
  }
}

// every tab runs the system ui, so every tab logs in. the vault only does it once, a later tab waits for the
// running login and if the vault is already ready, its on_vault_ready callback runs right away.
// a seed never emits vault_ready (it resolves the user right away), so a resolved user counts as ready too
function share_login (vault) {
  const login = { running: null, ready: null }
  const authenticate = vault.authenticate
  const on_vault_ready = vault.on_vault_ready
  on_vault_ready(data => { login.ready = data })
  vault.user.then(user => { login.ready = login.ready || { username: user.username } }, () => {})
  vault.authenticate = data => (login.running = login.running || authenticate(data))
  vault.on_vault_ready = cb => login.ready ? cb(login.ready) : on_vault_ready(cb)
}

// same as datashell boot does on cli, plus the news app, which needs the live structures so it runs here too.
// a profile and its news app are opened once and every tab gets the same one
function open_app (app_instance_id, profile_name) {
  if (!state.apps.has(app_instance_id)) state.apps.set(app_instance_id, make_app(app_instance_id, profile_name))
  return state.apps.get(app_instance_id)
}

async function make_app (app_instance_id, profile_name) {
  const uservault = await state.vault.user
  if (!uservault.app_state) uservault.app_state = {}
  const app_vault = await create_app_vault(uservault, app_instance_id, profile_name)
  let news = null
  app_vault.news_app = () => (news = news || share_init(blog_app(app_vault)))
  return app_vault
}

// every tab starts the news app (webapp-ui calls init_blog), it only starts once and later tabs get the same result
function share_init (news) {
  const init_blog = news.init_blog
  let started = null
  news.init_blog = options => (started = started || init_blog(options))
  return news
}

// after a reset or a removed device wiped the storage every tab reloads, and the worker stops right away
// so a reloaded tab never gets this one again, it starts a fresh one
function restart_all_tabs () {
  send_to_tabs('reload')
  self.close()
}

function send_to_tabs (type, data) { for (const send of state.tabs.values()) send(type, data) }

/***************************************
MAKE STORAGE
a worker has no localStorage, so this one starts with the first tabs values and sends every write back to the tabs
***************************************/
function make_storage (data) {
  const api = { getItem, setItem, removeItem, clear }
  return new Proxy(data, { get: get_item, set: set_item })
  function get_item (target, key) { return key in api ? api[key] : target[key] }
  function set_item (target, key, value) { setItem(key, value); return true }
  function getItem (key) { return key in data ? data[key] : null }
  function setItem (key, value) { data[key] = String(value); send_storage(key, data[key]) }
  function removeItem (key) { delete data[key]; send_storage(key, null) }
  function clear () { for (const key in data) delete data[key]; send_storage(null, null) }
}

function send_storage (key, value) { send_to_tabs('storage', { key, value }) }
