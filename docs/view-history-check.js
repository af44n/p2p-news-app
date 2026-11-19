// what happens to the view and system cores over time (questions from the worklog-45 review)
// plain autobase 7, a alone then a + b as indexers, results in docs/autobase-checks.md
// run with: node docs/view-history-check.js
// 1. new indexer = new view / system key, but the length keeps going from a prologue and old hashes stay the same
// 2. the prologue is { hash, length } of the data, not the old key or manifest
// 3. getIndexedInfo(length) and system.checkout(length) only work where block length - 1 is the `info` entry
// 4. anyone can copy another cores prologue, so a prologue doesnt prove its the real continuaton

const path = require('path')
const os = require('os')
const fs = require('fs')
const Corestore = require('corestore')
const Autobase = require('autobase')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const INFO_KEY = '0000' + b4a.toString(b4a.from('info'), 'hex')
const results = []
main().then(on_done, on_error)

async function main () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'view-history-check-'))
  const store_a = new Corestore(path.join(dir, 'a'))
  const store_b = new Corestore(path.join(dir, 'b'))
  const a = make_base(store_a, null)
  await a.ready()
  for (let i = 0; i < 3; i++) await a.append('a' + i)
  await wait_signed([a], 3)
  // on autobase 7 base.view and base.core (the system) get the new key in place, so keep copies of the old keys
  const before = { view: { key: b4a.from(a.view.key) }, system: { key: b4a.from(a.core.key) } }
  const lengths = { view: a.view.signedLength, system: a.core.signedLength }
  const hashes = { view: hex(await a.view.treeHash(lengths.view)), system: hex(await a.core.treeHash(lengths.system)) }
  // b joins and becomes an indexer, so the view and system get new keys
  const b = make_base(store_b, a.key)
  await b.ready()
  const streams = connect(store_a, store_b)
  await a.append({ add: hex(b.local.key) })
  await wait_for(() => b.isIndexer, [a, b])
  await a.append('a3')
  await wait_signed([a, b], 5)
  const after = { view: a.view, system: a.core }
  console.log(`a alone: view core ${short(before.view.key)} length ${lengths.view}, system core ${short(before.system.key)} length ${lengths.system}`)
  console.log(`b became an indexer: view core ${short(after.view.key)} length ${after.view.signedLength}, system core ${short(after.system.key)} length ${after.system.signedLength}`)
  // 1.
  for (const name of ['view', 'system']) {
    const core = after[name]
    const prologue = core.manifest.prologue
    const same_hash = hex(await core.treeHash(lengths[name])) === hashes[name]
    show(`1. ${name}: new key ${!b4a.equals(before[name].key, core.key)}, it starts with a prologue of length ${prologue && prologue.length} instead of 0, the hash at the old length ${lengths[name]} is the same: ${same_hash}`, !b4a.equals(before[name].key, core.key) && prologue && prologue.length > 0 && same_hash)
  }
  // 2.
  const prologue = after.view.manifest.prologue
  const is_data_hash = hex(prologue.hash) === hex(await after.view.treeHash(prologue.length))
  // a core key is the hash of its manifest (Hypercore.key in hypercore index.js), so this also checks the old manifest
  const is_old_key = hex(prologue.hash) === hex(before.view.key)
  show(`2. the view prologue hash is the tree hash of the data at its length: ${is_data_hash}, is the old core key (= old manifest hash): ${is_old_key}`, is_data_hash && !is_old_key)
  // 3.
  const system = after.system
  const rows = { info: [], checkout: [], block: [] }
  let matches = true
  // length 1 is only the hyperbee header (block 0), so start at 2
  for (let length = 2; length < system.signedLength; length++) {
    // autobase writes the info entry under the key 0x00 0x00 'info' (DIGEST sub encoding in autobase lib/system.js),
    // the member entries in between start with 0x01
    const is_info = await a.system.db.getBySeq(length - 1).then(node => hex(node.key) === INFO_KEY)
    const info_works = await a.system.getIndexedInfo(length).then(() => true, () => false)
    const checkout_works = await a.system.checkout(length).then(close_and_true, () => false)
    rows.block.push(is_info ? 'i' : '.')
    rows.info.push(info_works ? 'y' : 'x')
    rows.checkout.push(checkout_works ? 'y' : 'x')
    if (info_works !== is_info || checkout_works !== is_info) matches = false
  }
  console.log(`   system lengths 2..${system.signedLength - 1} (i = block length - 1 is the info entry, y = works, x = throws)`)
  console.log(`   info entry at block length - 1: ${rows.block.join(' ')}`)
  console.log(`   getIndexedInfo(length):        ${rows.info.join(' ')}`)
  console.log(`   system.checkout(length):       ${rows.checkout.join(' ')}`)
  show(`3. getIndexedInfo and system.checkout work exactly at the lengths where block length - 1 is the info entry: ${matches}`, matches)
  const last_info = rows.block.lastIndexOf('i') + 2 // rows start at length 2
  const jump = await a.system.getIndexedInfo(last_info).then(info => info.views.length, () => null)
  show(`   jumping back from the latest length to the last info entry (length ${last_info}) works and lists ${jump} view(s)`, jump !== null)
  // 4. someone else makes a core with the original's prologue, copies its 3 blocks and appends their own
  const original = store_a.get({ name: 'original' })
  await original.ready()
  await original.append(['one', 'two', 'three'])
  const someone = crypto.keyPair()
  const copy = store_b.get({ manifest: { version: 1, signers: [{ publicKey: someone.publicKey }], prologue: { hash: await original.treeHash(3), length: 3 } }, keyPair: someone })
  await copy.ready()
  await copy.core.copyPrologue(original.state)
  await copy.append('four, written by someone else')
  const same_start = hex(await copy.treeHash(3)) === hex(await original.treeHash(3))
  show(`4. a core with someone elses keypair and the original's prologue: key ${short(copy.key)} vs ${short(original.key)}, length ${copy.length}, same hash at 3: ${same_start}, block 0 is '${b4a.toString(await copy.get(0))}'`, same_start && !b4a.equals(copy.key, original.key) && copy.length === 4)
  for (const stream of streams) stream.destroy()
}

/***************************************
HELPERS
***************************************/
function make_base (store, key) {
  return new Autobase(store, key, { valueEncoding: 'json', open: open_view, apply, ackInterval: 50, ackThreshold: 0 })
}

function open_view (store) { return store.get('log', { valueEncoding: 'json' }) }

async function apply (nodes, view, host) {
  for (const node of nodes) {
    if (node.value.add) await host.addWriter(b4a.from(node.value.add, 'hex'), { indexer: true })
    else await view.append(node.value)
  }
}

async function close_and_true (system) {
  await system.close()
  return true
}

function connect (store_a, store_b) {
  const stream_a = store_a.replicate(true)
  const stream_b = store_b.replicate(false)
  stream_a.pipe(stream_b).pipe(stream_a)
  return [stream_a, stream_b]
}

async function wait_for (done, bases) {
  for (let i = 0; i < 300; i++) {
    for (const base of bases) await base.update()
    if (done()) return
    await sleep(100)
  }
  throw new Error('timed out')
}

// with 2 indexers the newest entries only get signed once more entries come in, so it keeps writing small ticks
async function wait_signed (bases, length) {
  for (let i = 0; i < 400; i++) {
    for (const base of bases) await base.update()
    if (bases.every(base => base.view.signedLength >= length)) return
    if (i % 10 === 9) await bases[0].append('tick')
    await sleep(100)
  }
  throw new Error('not signed')
}

function show (text, ok) {
  results.push(ok)
  console.log(`${ok ? 'ok    ' : 'NOT ok'} ${text}`)
}

function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function hex (buffer) { return b4a.toString(buffer, 'hex') }
function short (buffer) { return hex(buffer).slice(0, 8) }
function on_done () { process.exit(results.every(ok => ok) ? 0 : 1) }
function on_error (err) {
  console.log('FAILED', err)
  process.exit(1)
}
