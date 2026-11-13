// is the vault bee the same on every device now that its a real autobase view (77fa37d)? results in docs/autobase-checks.md
// run with: node docs/vault-bee-check.js (fails with the autobee from before 77fa37d, different keys)
// 1. b becomes a writer
// 2. after writting at the same time both have the same bee key, length, signed hash and values
// 3. a watch on the other device fires when the key changes
// 4. remove_writer still works

const path = require('path')
const os = require('os')
const fs = require('fs')
const Corestore = require('corestore')
const b4a = require('b4a')
const { create_automap } = require('../lib/node_modules/automap')

const WATCHED = 'lupay:p2p-news-app/subscribed_peers'
const results = []
const state = { fired: 0 }
main().then(on_done, on_error)

async function main () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-bee-check-'))
  const a = create_automap({ store: new Corestore(path.join(dir, 'a')).namespace('vault-bee') })
  await a.ready()
  const b = create_automap({ store: new Corestore(path.join(dir, 'b')).namespace('vault-bee'), bootstrap: a.key })
  await b.ready()
  const stream_a = a.replicate(true)
  const stream_b = b.replicate(false)
  stream_a.pipe(stream_b).pipe(stream_a)
  count_changes(b.watch({ gte: WATCHED, lte: WATCHED }))
  // 1.
  await a.put('one', 'from a')
  await a.add_writer(b.base.local.key)
  await settle([a, b], () => b.writable)
  show(`1. b becomes a writer: ${b.writable}`, b.writable)
  // 2.
  await Promise.all([a.put('same', 'a'), b.put('same', 'b'), a.put('two', 'from a'), b.put('three', 'from b')])
  await a.put(WATCHED, ['peer1'])
  await settle([a, b], () => all_signed_and_synced(a, b))
  const same_values = JSON.stringify(await values(a)) === JSON.stringify(await values(b))
  const same_hash = b4a.equals(await signed_hash(a), await signed_hash(b))
  console.log(`   a: bee key ${short(a.core.key)} length ${a.core.length} signed ${signed_core(a).length}`)
  console.log(`   b: bee key ${short(b.core.key)} length ${b.core.length} signed ${signed_core(b).length}`)
  show(`2. after writing at the same time: same bee key ${b4a.equals(a.core.key, b.core.key)}, same length ${a.core.length === b.core.length}, same signed hash ${same_hash}, same values ${same_values}`, b4a.equals(a.core.key, b.core.key) && a.core.length === b.core.length && same_hash && same_values)
  const is_view = !!a.base._viewStore.getByKey(a.core.key)
  show(`   the bee is a view autobase knows about: ${is_view}`, is_view)
  // 3.
  show(`3. the watch on b fired ${state.fired} time(s) when a changed ${WATCHED}`, state.fired >= 1)
  // 4.
  await a.remove_writer(b.base.local.key)
  await settle([a, b], () => !b.writable)
  show(`4. remove_writer still removes b: b writable ${b.writable}`, !b.writable)
}

/***************************************
HELPERS
***************************************/
async function count_changes (watcher) {
  for await (const change of watcher) if (change) state.fired++
}

async function all_signed_and_synced (a, b) {
  const has_all = (await b.get(WATCHED)) && (await a.get('three'))
  return has_all && signed_core(a).length === a.core.length && signed_core(b).length === b.core.length && a.core.length === b.core.length
}

async function values (bee) {
  const out = {}
  for await (const { key, value } of bee.create_read_stream()) out[key] = value
  return out
}

// the real hypercore behind the bee view, it only ever holds signed blocks
// (the old autobee from before 77fa37d has a plain core there, so then its just that core)
function signed_core (bee) { return bee.core.getBackingCore ? bee.core.getBackingCore().session : bee.core }
function signed_hash (bee) { return signed_core(bee).treeHash(signed_core(bee).length) }

async function settle (bees, done) {
  for (let i = 0; i < 150; i++) {
    for (const bee of bees) await bee.update()
    if (await done()) return
    await sleep(100)
  }
}

function show (text, ok) {
  results.push(!!ok)
  console.log(`${ok ? 'ok    ' : 'NOT ok'} ${text}`)
}

function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function short (buffer) { return b4a.toString(buffer, 'hex').slice(0, 8) }
function on_done () { process.exit(results.every(ok => ok) ? 0 : 1) }
function on_error (err) {
  console.log('FAILED', err)
  process.exit(1)
}
