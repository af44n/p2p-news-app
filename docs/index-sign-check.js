// when do indexedLength and signedLength move forward, and is the order up to indexedLength really final? plain autobase 7,
// 2 indexers. both are lengths of the system core. results in docs/autobase-checks.md
// run with: node docs/index-sign-check.js
// indexedLength is this device's own view of how far the order is final (autobase lib/apply-state.js _indexUpdates),
// signedLength is how far a quorum of indexers signed the system core, and autobase only signs up to indexedLength
// (maybeSigned in lib/apply-state.js)
// 1. on every sample, on both devices, signedLength <= indexedLength <= length
// 2. indexedLength and signedLength never go down
// 3. with b offline, nothing a writes alone gets indexed (2 indexers, a needs b to link its writes)
// 4. after a reorder, the system core up to every indexedLength seen before is still the same (same hash),
//    while the part above it, that both wrote offline, did change on at least one device (so the check can see a change)

const path = require('path')
const os = require('os')
const fs = require('fs')
const Corestore = require('corestore')
const Autobase = require('autobase')
const b4a = require('b4a')

const results = []
const seen = { a: [], b: [] } // every sample: { indexed, signed, length, hash at indexed }
let dir = null
main().then(on_done, on_error)

async function main () {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-sign-check-'))
  const store_a = new Corestore(path.join(dir, 'a'))
  const store_b = new Corestore(path.join(dir, 'b'))
  const a = make_base(store_a, null)
  await a.ready()
  const b = make_base(store_b, a.key)
  await b.ready()
  let streams = connect(store_a, store_b)
  await a.append({ add: hex(b.local.key) })
  await wait_for(() => b.isIndexer, { a, b })
  // both write while connected
  for (let i = 0; i < 5; i++) await Promise.all([a.append('a' + i), b.append('b' + i)])
  await wait_for(() => all_signed(a) && all_signed(b), { a, b })
  // b goes offline, a writes alone
  for (const stream of streams) stream.destroy()
  const before_alone = a.length // what b could still have linked before it left
  for (let i = 0; i < 5; i++) await a.append('alone' + i)
  for (let i = 0; i < 20; i++) { await a.update(); await sample({ a, b }); await sleep(100) }
  show(`3. b offline, a wrote 5 alone: a's system length went ${before_alone} -> ${a.length}, its indexedLength (${a.indexedLength}) didnt pass ${before_alone}, none of a's own writes got indexed`, a.indexedLength <= before_alone && a.length > before_alone)
  // b writes offline too, so after reconnecting autobase has to reorder
  for (let i = 0; i < 5; i++) await b.append('b-off' + i)
  await sample({ a, b })
  const tail = { a: await tail_of(a), b: await tail_of(b) } // the part above indexedLength before reconnecting
  streams = connect(store_a, store_b)
  await wait_for(() => all_signed(a) && all_signed(b) && a.view.length === 20 && b.view.length === 20, { a, b })
  for (const stream of streams) stream.destroy()
  // 1 and 2 over all samples
  for (const name of ['a', 'b']) {
    const list = seen[name]
    const ordered = list.every(s => s.signed <= s.indexed && s.indexed <= s.length)
    const up = list.every((s, i) => i === 0 || (s.indexed >= list[i - 1].indexed && s.signed >= list[i - 1].signed))
    show(`1. ${name}: signedLength <= indexedLength <= length on all ${list.length} samples`, ordered)
    show(`2. ${name}: indexedLength (${list[0].indexed} -> ${list.at(-1).indexed}) and signedLength (${list[0].signed} -> ${list.at(-1).signed}) never went down`, up)
  }
  // 4. the order up to every indexedLength seen stayed, the offline tail moved
  for (const [name, base] of [['a', a], ['b', b]]) {
    let same = true
    for (const s of seen[name]) if (s.indexed && hex(await base.core.treeHash(s.indexed)) !== s.hash) same = false
    show(`4. ${name}: the system core at every indexedLength seen before still has the same hash`, same)
  }
  const moved = [await changed(a, tail.a), await changed(b, tail.b)]
  show(`4. the part both wrote offline (above indexedLength) changed after the reorder: a ${moved[0]}, b ${moved[1]}`, moved[0] || moved[1])
}

/***************************************
HELPERS
***************************************/
function make_base (store, key) {
  return new Autobase(store, key, { valueEncoding: 'json', open: store => store.get('log', { valueEncoding: 'json' }), apply, ackInterval: 50, ackThreshold: 0 })
}

async function apply (nodes, view, host) {
  for (const node of nodes) {
    if (node.value.add) await host.addWriter(b4a.from(node.value.add, 'hex'), { indexer: true })
    else await view.append(node.value)
  }
}

// the view is fully signed. the system core itself always has a short unsigned end, the acks that get things signed are
// system blocks too
function all_signed (base) { return base.view.length > 0 && base.view.signedLength === base.view.length }

async function sample (bases) {
  for (const [name, base] of Object.entries(bases)) {
    const indexed = base.indexedLength
    const hash = indexed ? hex(await base.core.treeHash(indexed)) : null
    seen[name].push({ indexed, signed: base.signedLength, length: base.length, hash })
  }
}

// the length and hash of the system core before reconnecting, where it is longer than its indexedLength
async function tail_of (base) {
  return { length: base.length, indexed: base.indexedLength, hash: hex(await base.core.treeHash(base.length)) }
}

// the system core has that length now and a different hash there, so the unindexed part moved
async function changed (base, tail) {
  if (tail.length <= tail.indexed) return false
  return hex(await base.core.treeHash(tail.length)) !== tail.hash
}

function connect (store_a, store_b) {
  const stream_a = store_a.replicate(true)
  const stream_b = store_b.replicate(false)
  stream_a.pipe(stream_b).pipe(stream_a)
  return [stream_a, stream_b]
}

// like the other checks: update() both and take a sample every 100ms till done
async function wait_for (done, bases) {
  for (let i = 0; i < 300; i++) {
    for (const base of Object.values(bases)) await base.update()
    await sample(bases)
    if (done()) return
    await sleep(100)
  }
  throw new Error('timed out: ' + Object.entries(bases).map(([n, b]) => `${n} indexed ${b.indexedLength} signed ${b.signedLength} length ${b.length} view ${b.view.signedLength}/${b.view.length}`).join(' | '))
}

function show (text, ok) {
  results.push(ok)
  console.log(`${ok ? 'ok    ' : 'NOT ok'} ${text}`)
}

function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function hex (buffer) { return b4a.toString(buffer, 'hex') }
function cleanup () { if (dir) fs.rmSync(dir, { recursive: true, force: true }) }
function on_done () {
  cleanup()
  process.exit(results.every(ok => ok) ? 0 : 1)
}
function on_error (err) {
  cleanup()
  console.log('FAILED', err)
  process.exit(1)
}
