// CLI system UI that handles authentication and system-level management
// `vault` is provided as a parameter by datashell 

const process = require('bare-process')


const existing_username = vault.session_get_username()
const joined_app = vault.session_get_joined_app()
const pending_invite = vault.session_get_pending_invite()

// Figure out where we are in the login process 
if (vault.get_vault_bee && vault.get_vault_bee()) {
  // We are fully logged in (like relaunching the app)
  await run_system_menu()
} else if (pending_invite) {
  // if pairing was cut off - resume
  await resume_pair_mode(pending_invite)
} else if (existing_username && joined_app) {
  // if we picked app wait for it to get ready
  await wait_for_vault_ready(existing_username)
  await run_system_menu()
} else if (existing_username) {
  // if we haven't picked our profile
  await auth_and_pick_app(existing_username)
} else {
  // Completely fresh start
  await show_auth_menu()
}

/***************************************
AUTH MENU
like browser Seed / Pair / Load / Reset buttons
***************************************/
async function show_auth_menu () {
  while (true) {
    console.log('\n=== System Authentication ===')
    console.log('1. Seed   (create new account)')
    console.log('2. Pair   (join with invite code)')
    console.log('3. Load   (restore from mnemonic)')
    console.log('4. Reset All Data')
    console.log('\nChoice: ')
    const choice = await read_line()
    if (choice === '1') { await handle_seed(); return }
    if (choice === '2') { await handle_pair(); return }
    if (choice === '3') { console.log('Load from mnemonic is not implemented yet.'); continue }
    if (choice === '4') { await handle_reset(); continue }
    else console.log('Invalid choice.')
  }
}

/***************************************
SEED MODE
***************************************/
async function handle_seed () {
  console.log('\nYour Name: ')
  const username = await read_line()
  if (!username) { console.log('Name required.'); return show_auth_menu() }
  vault.session_set_username(username)
  vault.session_set_joined_app(username + ':p2p-news-app')
  await wait_for_vault_ready(username)
  await run_system_menu()
}

/***************************************
PAIR MODE
***************************************/
async function handle_pair () {
  console.log('\nPaste invite code: ')
  const invite_code = await read_line()
  if (!invite_code) { console.log('Cancelled.'); return show_auth_menu() }
  try {
    const decoded = Buffer.from(invite_code, 'base64')
    if (decoded.length < 32) { console.log('Invite code too short. Copy the full code.'); return show_auth_menu() }
  } catch (err) { console.log('Invalid invite code format.'); return show_auth_menu() }
  vault.session_set_pending_invite(invite_code)
  await resume_pair_mode(invite_code)
}

/***************************************
RESUME PAIR MODE
***************************************/
async function resume_pair_mode (invite_code) {
  console.log('\nPairing... connecting to network.')
  await new Promise(function (resolve, reject) {
    vault.on_vault_ready(async function (auth_data) {
      try {
        if (auth_data?.username && auth_data.username !== 'pairing-user') {
          vault.session_set_username(auth_data.username)
        }
        console.log('\nVault paired! Discovering apps...')
        await pick_app_after_pairing()
        resolve()
      } catch (err) { reject(err) }
    })
    vault.authenticate({
      username: 'pairing-user',
      invite_code,
      on_verification_code: function (code) {
        console.log('\nVerification Code: ' + code)
        console.log('Show this code to the inviting device and wait for it to verify.')
      }
    })
    vault.user.catch(function (err) {
      console.error('\nPairing failed: ' + err.message)
      vault.session_clear()
      reject(err)
    })
  })
  await run_system_menu()
}

/***************************************
WAIT FOR VAULT READY (seed / auto-login)
registers on_vault_ready before calling authenticate
***************************************/
async function wait_for_vault_ready (username) {
  await new Promise(function (resolve, reject) {
    vault.on_vault_ready(async function (auth_data) {
      try {
        if (auth_data?.username && auth_data.username !== 'pairing-user') {
          vault.session_set_username(auth_data.username)
        }
        resolve()
      } catch (err) { reject(err) }
    })
    vault.authenticate({ username, defer_resolve: true })
  })
}

/***************************************
AUTH AND PICK APP
for existing_username but no joined_app
like browser show_app_selection path
***************************************/
async function auth_and_pick_app (username) {
  await new Promise(function (resolve, reject) {
    vault.on_vault_ready(async function (auth_data) {
      try {
        if (auth_data?.username && auth_data.username !== 'pairing-user') {
          vault.session_set_username(auth_data.username)
        }
        await show_app_selection()
        resolve()
      } catch (err) { reject(err) }
    })
    vault.authenticate({ username, defer_resolve: true })
  })
  await run_system_menu()
}

/***************************************
APP SELECTION
***************************************/
async function show_app_selection () {
  console.log('\n=== Select Profile ===')
  const vault_bee = vault.get_vault_bee()
  await vault_bee.update()
  const apps = await vault.list_apps()
  if (apps && apps.length > 0) {
    apps.forEach(function (app, i) { console.log('  ' + (i + 1) + '. ' + app.id) })
    console.log('  ' + (apps.length + 1) + '. Create new profile')
    console.log('\nChoice: ')
    const choice = await read_line()
    const idx = parseInt(choice.trim()) - 1
    if (idx >= 0 && idx < apps.length) {
      vault.session_set_joined_app(apps[idx].id)
      console.log('Profile selected: ' + apps[idx].id)
      return
    }
  }
  console.log('\nProfile name: ')
  const profile_name = await read_line()
  const app_id = (profile_name || vault.session_get_username()) + ':p2p-news-app'
  vault.session_set_joined_app(app_id)
  console.log('Profile: ' + app_id)
}

/***************************************
PICK APP AFTER PAIRING
***************************************/
async function pick_app_after_pairing () {
  const vault_bee = vault.get_vault_bee()
  await vault_bee.update()
  let apps = await vault.list_apps()
  if (!apps || apps.length === 0) {
    console.log('Waiting for apps to sync from vault...')
    for await (const _ of vault_bee.watch({ gte: 'apps/', lt: 'apps0' })) {
      apps = await vault.list_apps()
      if (apps && apps.length > 0) break
    }
  }
  console.log('\nApps found:')
  apps.forEach(function (app, i) { console.log('  ' + (i + 1) + '. ' + app.id) })
  console.log('\nEnter number to join: ')
  const choice = await read_line()
  const idx = parseInt(choice.trim()) - 1
  const app = apps[idx] || apps[0]
  vault.session_set_joined_app(app.id)
  console.log('Joined: ' + app.id)
}

/***************************************
SYSTEM MENU
***************************************/
async function run_system_menu () {
  while (true) {
    const joined = vault.session_get_joined_app()
    const username = vault.session_get_username()
    console.log('\n=== System Menu [' + username + ':' + joined + '] ===')
    console.log('1. Launch App')
    console.log('2. Devices')
    console.log('3. Create Invite Code')
    console.log('4. Vault Log')
    console.log('5. Reset All Data')
    console.log('6. Exit')
    console.log('\nChoice: ')
    const choice = await read_line()
    if (choice === '1') return launch_app()
    if (choice === '2') await manage_devices()
    else if (choice === '3') await create_invite_flow()
    else if (choice === '4') await view_vault_log()
    else if (choice === '5') await handle_reset()
    else if (choice === '6') { console.log('Goodbye!'); process.exit(0) }
    else console.log('Invalid choice.')
  }
}

function launch_app () {
  const joined = vault.session_get_joined_app()
  if (!joined) vault.session_set_joined_app(vault.session_get_username() + ':p2p-news-app')
  vault.complete_authentication()
  console.log('\nLaunching app...')
}

/***************************************
DEVICES
***************************************/
async function manage_devices () {
  const devices = await vault.get_paired_devices()
  if (!devices.length) { console.log('No paired devices yet.'); return }
  const vb = vault.get_vault_bee()
  const own = vb?.base?.local ? vb.base.local.key.toString('hex') : null
  console.log('\n=== Paired Devices ===')
  devices.forEach(function (d, i) {
    const is_self = own && d.vault_bee_writer === own
    const last = d.last_online ? new Date(d.last_online).toLocaleString() : 'Never'
    const flags = (is_self ? ' (This Device)' : '') + (d.removed ? ' [REMOVED]' : '')
    console.log('\n  ' + (i + 1) + '. ' + (d.name || '?') + flags)
    console.log('     Last online: ' + last)
    console.log('     Key: ' + (d.vault_bee_writer || 'N/A'))
  })
  console.log('\nOptions: enter number to manage, 0 to go back: ')
  const choice = await read_line()
  const idx = parseInt(choice.trim()) - 1
  if (idx < 0 || idx >= devices.length) return
  await manage_one_device(devices[idx])
}

async function manage_one_device (dev) {
  const vb = vault.get_vault_bee()
  const own = vb?.base?.local ? vb.base.local.key.toString('hex') : null
  const is_self = own && dev.vault_bee_writer === own
  console.log('\nDevice: ' + (dev.name || '?') + (is_self ? ' (This Device)' : ''))
  console.log('1. Rename')
  if (!is_self && !dev.removed) console.log('2. Remove')
  console.log('0. Back')
  console.log('\nChoice: ')
  const choice = await read_line()
  if (choice === '1') {
    console.log('New name: ')
    const new_name = await read_line()
    if (!new_name) return
    await vault.vault_put('paired_devices/' + dev.vault_bee_writer, { ...dev, name: new_name })
    console.log('Renamed to: ' + new_name)
  } else if (choice === '2' && !is_self && !dev.removed) {
    console.log('Type "yes" to confirm removal: ')
    const conf = await read_line()
    if (conf !== 'yes') { console.log('Cancelled.'); return }
    await vault.remove_device(dev)
    console.log('Device removed.')
  }
}

/***************************************
INVITE / PAIRING
***************************************/
async function create_invite_flow () {
  console.log('\nGenerating invite code...')
  const result = await vault.create_vault_invite()
  console.log('\n--- Invite Code ---')
  console.log(result.invite_code)
  console.log('-------------------')
  console.log('Share this with the other device. Waiting for connection...')
  console.log('(The other device will show a 6-digit verification code)\n')
  await vault.setup_vault_pairing({
    invite: result.invite,
    username: vault.session_get_username(),
    on_verification_needed: function () {
      console.log('\nEnter 6-digit verification code from other device: ')
    },
    on_paired: handle_paired
  })
  const code = await read_line()
  if (!code || code.length !== 6) { console.log('Invalid code. Cancelling.'); await vault.cancel_vault_invite(); return }
  const pairing_result = await vault.verify_vault_pairing(code)
  if (pairing_result?.multiple_attempts) console.log('Note: ' + pairing_result.total_attempts + ' device(s) attempted to pair.')
  console.log('Pairing verified!')
}

async function handle_paired (result) {
  if (!result?.vault_bee_writer) return
  const devs = await vault.get_paired_devices()
  await vault.vault_put('paired_devices/' + result.vault_bee_writer, {
    name: 'Device ' + (devs.length + 1),
    added_date: new Date().toLocaleString(),
    vault_bee_writer: result.vault_bee_writer,
    vault_audit_writer: result.vault_audit_writer
  })
  console.log('New device added to vault.')
}


/***************************************
VAULT LOG
mirrors load_vault_audit in websys-ui.js
***************************************/
async function view_vault_log () {
  const audit = vault.get_vault_audit()
  if (!audit) { console.log('Vault log not available.'); return }
  await audit.ready()
  await audit.update()
  const entries = await audit.read()
  if (!entries?.length) { console.log('No vault log entries yet.'); return }
  const devs = await vault.get_paired_devices()
  console.log('\n=== Vault Log (' + entries.length + ' entries) ===')
  entries.slice(-20).reverse().forEach(function (e) {
    const dev = devs.find(function (d) { return d.vault_audit_writer === e.data?.device_id })
    const dev_name = dev ? dev.name : (e.data?.device_id || '')
    const ts = e.data?.timestamp ? new Date(e.data.timestamp).toLocaleString() : ''
    console.log('  ' + (e.type || '?') + (dev_name ? ' [' + dev_name + ']' : '') + (ts ? ' — ' + ts : ''))
  })
}

async function handle_reset () {
  console.log('Type "yes" to delete all data: ')
  const conf = await read_line()
  if (conf !== 'yes') { console.log('Cancelled.'); return }
  await vault.reset_all_data()
  console.log('All data reset.')
  process.exit(0)
}

/***************************************
HELPERS
***************************************/
function read_line () {
  return new Promise(collect_input)
  function collect_input (resolve) {
    const chunks = []
    process.stdin.on('data', on_data)
    function on_data (chunk) {
      chunks.push(chunk)
      if (chunk.includes('\n')) {
        process.stdin.removeAllListeners('data')
        resolve(Buffer.concat(chunks).toString().trim())
      }
    }
  }
}
