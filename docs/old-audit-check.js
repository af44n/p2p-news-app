// what happens to an old audit log when the new auditcore (real view, 17891e3) opens it? results in docs/autobase-checks.md
// run with: node docs/old-audit-check.js (inside the repo, the old auditcore comes from git)
// 1. the old auditcore writes 3 entires. on autobase 7 its own read() shows 0, its entries live in a plain js array in the
//    view, and autobase 7 calls open more than once, so apply pushes into another object than base.view
// 2. the new one on the same storage shows 0 (i think cuz autobase doesnt apply them again, didnt check that part)
// 3. the old entries are still in the devices input core
// 4. new entries show up fine

const path = require('path')
const os = require('os')
const fs = require('fs')
const Module = require('module')
const { execSync } = require('child_process')
const Corestore = require('corestore')
const new_auditcore = require('../lib/node_modules/auditcore')

const OLD_COMMIT = '17891e3^'
const results = []
main().then(on_done, on_error)

async function main () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'old-audit-check-'))
  const old_auditcore = load_old_auditcore()
  // 1.
  let store = new Corestore(dir)
  const old_log = old_auditcore.create_auditcore({ store: store.namespace('vault-audit') })
  await old_log.ready()
  for (let i = 0; i < 3; i++) await old_log.append({ type: 'put', data: { key: 'k' + i } })
  const old_entries = (await old_log.read()).length
  const old_written = old_log.base.local.length
  show(`1. the old auditcore (${OLD_COMMIT}) wrote ${old_written} entries into its input core, its own read() shows ${old_entries} on autobase 7`, old_written === 3 && old_entries === 0)
  const key = old_log.key
  await old_log.close()
  await store.close()
  // 2.
  store = new Corestore(dir)
  const new_log = new_auditcore.create_auditcore({ store: store.namespace('vault-audit'), bootstrap: key })
  await new_log.ready()
  const new_entries = (await new_log.read()).length
  show(`2. the new auditcore on the same storage shows ${new_entries} entries`, new_entries === 0)
  // 3. read the devices own input core directly, each block is an autobase node with the entry as its value
  const local = new_log.base.local
  const keys = []
  for (let i = 0; i < local.length; i++) {
    const block = await local.get(i)
    keys.push(JSON.parse(block.node.value).data.key)
  }
  show(`3. the old entries are still in the devices input core: length ${local.length}, keys ${keys.join(', ')}`, keys.join() === 'k0,k1,k2')
  // 4.
  await new_log.append({ type: 'put', data: { key: 'new' } })
  const now = await new_log.read()
  show(`4. a new entry shows up: ${now.length} entry, key ${now[0] && now[0].data.key}`, now.length === 1 && now[0].data.key === 'new')
  await new_log.close()
}

/***************************************
HELPERS
***************************************/
// loads the old auditcore source from git and runs it as a module that resolves requires from here (docs/)
function load_old_auditcore () {
  const source = execSync(`git show ${OLD_COMMIT}:lib/node_modules/auditcore/index.js`, { cwd: __dirname }).toString()
  const old = new Module(__filename, module)
  old.paths = module.paths
  old._compile(source, __filename)
  return old.exports
}

function show (text, ok) {
  results.push(ok)
  console.log(`${ok ? 'ok    ' : 'NOT ok'} ${text}`)
}

function on_done () { process.exit(results.every(ok => ok) ? 0 : 1) }
function on_error (err) {
  console.log('FAILED', err)
  process.exit(1)
}
