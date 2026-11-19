// with 2 indexers and one ofline, can the one left add a 3rd device and keep going?
// plain autobase 7, 3 devices, results in docs/autobase-checks.md
// run with: node docs/indexer-offline-check.js
// 1. a + b are signed indexers, then b goes offline
// 2. a adds c, c can write, but nothing gets signed while b is away (on autobase 7 c.isIndexer stays false till then)
// 3. b comes back, c becomes the 3rd signed indexer and signing goes on

const path = require('path')
const os = require('os')
const fs = require('fs')
const Corestore = require('corestore')
const Autobase = require('autobase')
const b4a = require('b4a')

const results = []
main().then(on_done, on_error)

async function main () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indexer-offline-check-'))
  const store_a = new Corestore(path.join(dir, 'a'))
  const store_b = new Corestore(path.join(dir, 'b'))
  const store_c = new Corestore(path.join(dir, 'c'))
  const a = make_base(store_a, null)
  await a.ready()
  const b = make_base(store_b, a.key)
  await b.ready()
  let streams_ab = connect(store_a, store_b)
  await a.append({ add: hex(b.local.key) })
  await wait_for(() => b.isIndexer, [a, b])
  await a.append('x')
  await wait_two_signed_indexers(a, b)
  // 1.
  const before = await signed_state(a)
  show(`1. a + b are indexers and signed: ${before.indexers} signed indexers, the view core has ${signed_core(a).manifest.signers.length} signers with quorum ${signed_core(a).manifest.quorum}, signed view length ${before.length}`, before.indexers === 2)
  for (const stream of streams_ab) stream.destroy()
  // 2. b is offline, a adds c and both keep writing for 10 seconds
  const c = make_base(store_c, a.key)
  await c.ready()
  const streams_ac = connect(store_a, store_c)
  await a.append({ add: hex(c.local.key) })
  await keep_going([a, c], 100)
  const c_wrote = await c.append('from c').then(() => true, () => false)
  const during = await signed_state(a)
  show(`2. b offline for 10s: c.isIndexer is ${c.isIndexer}, c could write (${c_wrote}), a has ${a.view.length} entries in its view, but signed is still ${during.length} with ${during.indexers} signed indexers`, during.length === before.length && during.indexers === 2)
  // 3. b comes back
  streams_ab = connect(store_a, store_b)
  await keep_going([a, b, c], 60)
  const after = await signed_state(a)
  show(`3. b is back: ${after.indexers} signed indexers, signed view length ${after.length} of ${a.view.length}`, after.indexers === 3 && after.length > during.length)
  for (const stream of [...streams_ab, ...streams_ac]) stream.destroy()
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

// on autobase 7 the view is the signed core itself, its manifest lists the indexers that sign it
function signed_core (base) { return base.view }

// what is signed right now: the signed view length and how many indexers the signed system state lists
async function signed_state (base) {
  const info = await base.system.getIndexedInfo()
  return { length: base.view.signedLength, indexers: info.indexers.length }
}

// b only counts once its addition is signed and the view core is signed by both, before that a can still sign alone
async function wait_two_signed_indexers (a, b) {
  for (let i = 0; i < 300; i++) {
    await a.update()
    await b.update()
    const state = await signed_state(a)
    if (state.indexers === 2 && signed_core(a).manifest.signers.length === 2 && signed_core(b).manifest.signers.length === 2) return
    if (i % 10 === 9) await a.append('tick')
    await sleep(100)
  }
  throw new Error('b never became a signed indexer')
}

// keeps updating and writing small ticks, so acks and signatures get every chance to go out
async function keep_going (bases, rounds) {
  for (let i = 0; i < rounds; i++) {
    for (const base of bases) await base.update()
    if (i % 10 === 9) await bases[0].append('tick')
    await sleep(100)
  }
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

function show (text, ok) {
  results.push(ok)
  console.log(`${ok ? 'ok    ' : 'NOT ok'} ${text}`)
}

function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function hex (buffer) { return b4a.toString(buffer, 'hex') }
function on_done () { process.exit(results.every(ok => ok) ? 0 : 1) }
function on_error (err) {
  console.log('FAILED', err)
  process.exit(1)
}
