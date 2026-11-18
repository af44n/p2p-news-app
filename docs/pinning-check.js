// checks what pins what in autobase, for docs/autobase-pinning.md. ran on 6.5.13 first, now on autobase 7 (views are the signed cores, signedLength)
// plain autobase, 1 then 2 devices, a view that is just a list of entries

const path = require('path')
const os = require('os')
const fs = require('fs')
const Corestore = require('corestore')
const Autobase = require('autobase')
const b4a = require('b4a')

const offline = process.argv[2] === 'offline'
main().then(() => process.exit(0), on_error)

async function main () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinning-check-'))
  const store_a = new Corestore(path.join(dir, 'a'))
  const store_b = new Corestore(path.join(dir, 'b'))
  const a = make_base(store_a, null)
  await a.ready()
  for (let i = 0; i < 3; i++) await a.append('a' + i)
  await wait_signed([a], 3)
  const first = await a.system.getIndexedInfo()
  console.log(`1. the system view stores per view only: ${Object.keys(first.views[0]).join(', ')}`)
  const view_1 = signed_core(a)
  const key_1 = b4a.from(view_1.key) // on autobase 7 base.view gets the new key in place, so keep a copy
  const hash_3 = hex(await view_1.treeHash(3))
  const system_length_1 = a.core.signedLength
  console.log(`2. one device: view ${short(view_1.key)} signed length ${view_1.signedLength} fork ${view_1.fork}, hash at 3 ${short(hash_3)}`)
  // b joins and becomes an indexer
  const b = make_base(store_b, a.key)
  await b.ready()
  let streams = connect(store_a, store_b)
  await a.append({ add: hex(b.local.key) })
  await wait_for(() => b.isIndexer, [a, b])
  await a.append('a3')
  await b.append('b0')
  await wait_signed([a, b], 5)
  const view_2 = signed_core(a)
  const prologue = view_2.manifest.prologue
  console.log(`3. b became an indexer: the view key changed ${short(key_1)} -> ${short(view_2.key)}: ${!b4a.equals(key_1, view_2.key)}`)
  console.log(`   the new core starts with a prologue of the old data: length ${prologue.length}, and its hash at 3 is the same: ${hex(await view_2.treeHash(3)) === hash_3}`)
  console.log(`   b has the same view key: ${b4a.equals(signed_core(b).key, view_2.key)}`)
  // both write at the same moment, so autobase has to reorder
  const forks_before = [a.view.fork, b.view.fork]
  if (offline) {
    for (const stream of streams) stream.destroy()
    await sleep(300)
    for (let i = 0; i < 4; i++) {
      await a.append('x' + i)
      await b.append('y' + i)
    }
    streams = connect(store_a, store_b)
  } else {
    for (let i = 0; i < 4; i++) await Promise.all([a.append('x' + i), b.append('y' + i)])
  }
  await wait_signed([a, b], 13)
  const signed_a = signed_core(a)
  const signed_b = signed_core(b)
  console.log(`4. both wrote at the same time (${offline ? 'offline' : 'connected'}): the in memory view fork went a ${forks_before[0]} -> ${a.view.fork}, b ${forks_before[1]} -> ${b.view.fork}`)
  console.log(`   the signed view core stayed fork a ${signed_a.fork} b ${signed_b.fork}, same hash at 13 on both: ${hex(await signed_a.treeHash(13)) === hex(await signed_b.treeHash(13))}, hash at 3 still the same: ${hex(await signed_a.treeHash(3)) === hash_3}`)
  const system_a = a.core
  const system_b = b.core
  const system_length = Math.min(system_a.signedLength, system_b.signedLength)
  console.log(`5. the system core is fork a ${system_a.fork} b ${system_b.fork}, same hash at ${system_length} on both: ${hex(await system_a.treeHash(system_length)) === hex(await system_b.treeHash(system_length))}`)
  const then = await a.system.getIndexedInfo(system_length_1)
  const now = await a.system.getIndexedInfo()
  console.log(`6. the system core at its old length ${system_length_1} still says view ${short(then.views[0].key)} at ${then.views[0].length}, now it says ${short(now.views[0].key)} at ${now.views[0].length}`)
  const old_core = store_a.get({ key: then.views[0].key })
  await old_core.ready()
  console.log(`   the old view core is still on a: fork ${old_core.fork}, hash at 3 the same: ${hex(await old_core.treeHash(3)) === hash_3}`)
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

// on autobase 7 the view is the signed core itself, everything up to its signedLength is signed
function signed_core (base) { return base.view }

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

function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function hex (buffer) { return b4a.toString(buffer, 'hex') }
function short (buffer) { return (typeof buffer === 'string' ? buffer : hex(buffer)).slice(0, 8) }
function on_error (err) {
  console.log('FAILED', err)
  process.exit(1)
}
