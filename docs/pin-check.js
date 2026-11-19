// does a packs pin() link (dat://<length>.<fork>.<autobase key>.<hash> of the db view) surive an indexer change?
// our packs + autodisk + automap on autobase 7, 2 devices, results in docs/autobase-checks.md
// run with: bare docs/pin-check.js
// 1. a pins alone, b becomes an indexer, the db view gets a new key
// 2. the old link still works on a and b, by autobase key + current signed db core + checkout(length)
// 3. the hash at any other length doesnt match
// not covered: true forks, and the link doesnt say which view

const fs = require('bare-fs')
const process = require('bare-process')
const os = require('bare-os')
const path = require('bare-path')
const Corestore = require('corestore')
const b4a = require('b4a')
const id = require('hypercore-id-encoding')
const { create_automap } = require('../lib/node_modules/automap')
const autodisk = require('../lib/node_modules/autodisk')
const disk_link = require('../lib/node_modules/disk-link')
const disk_loader = require('../lib/node_modules/disk-loader')
const packs = require('../lib/node_modules/packs')

const { decode } = disk_link()
const results = []
main().then(on_done, on_error)

async function main () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-check-'))
  const store_a = new Corestore(path.join(dir, 'a'))
  const store_b = new Corestore(path.join(dir, 'b'))
  const vault = await make_vault(store_a)
  const app = path.join(dir, 'app')
  fs.mkdirSync(app)
  fs.writeFileSync(path.join(app, 'main.js'), "module.exports = 'v1'")
  await packs(vault).create('hello', app)
  const pin = await packs(vault).pin('hello')
  const [length, fork, key, hash] = decode(pin).key
  const record = await vault.vault_get('packs/hello')
  console.log(`a pinned the pack alone: ${pin.slice(0, 40)}... (length ${length}, fork ${fork})`)
  // a opens the pack disk again, b joins it and becomes an indexer
  const disk_a = autodisk({ store: store_a.namespace(record.namespace), bootstrap: id.decode(key) })
  await disk_a.ready()
  const key_before = hex(signed_core(disk_a).key)
  const disk_b = autodisk({ store: store_b.namespace('pack-copy'), bootstrap: id.decode(key) })
  await disk_b.ready()
  const streams = connect(store_a, store_b)
  await disk_a.add_writer(disk_b.base.local.key)
  await wait_for(() => disk_b.base.isIndexer && disk_b.base.writable, [disk_a, disk_b])
  // both write new versions, so the disk moves on past the pin
  await disk_a.put('/main.js', b4a.from("module.exports = 'v2 from a'"))
  await disk_b.put('/extra.js', b4a.from("module.exports = 'from b'"))
  await wait_signed([disk_a, disk_b], Number(length) + 2)
  // 1.
  const key_after = hex(signed_core(disk_a).key)
  const same_on_b = hex(signed_core(disk_b).key) === key_after
  const prologue = signed_core(disk_a).manifest.prologue
  show(`1. b became an indexer: the db view key changed ${key_before.slice(0, 8)} -> ${key_after.slice(0, 8)}, b has the same new key: ${same_on_b}, the new core starts with a prologue of length ${prologue && prologue.length}`, key_before !== key_after && same_on_b && prologue)
  // 2. resolving the old link only needs the autobase key from it
  for (const [name, disk] of [['a', disk_a], ['b', disk_b]]) {
    const same_hash = hex(await signed_core(disk).treeHash(Number(length))) === hash
    const pinned = disk.base.view.drive.checkout(Number(length))
    const code = await disk_loader({ drive: pinned, file: '/main.js' })
    await pinned.close()
    const latest = await disk_loader({ drive: disk.base.view.drive, file: '/main.js' })
    show(`2. on ${name}: the hash at the pinned length ${length} matches the link: ${same_hash}, the pinned checkout runs '${code}', latest runs '${latest}'`, same_hash && code === 'v1' && latest === 'v2 from a')
  }
  // 3.
  const other = hex(await signed_core(disk_a).treeHash(Number(length) + 1)) === hash
  show(`3. the hash at another length matches the link too: ${other}`, !other)
  for (const stream of streams) stream.destroy()
}

/***************************************
HELPERS
***************************************/
// just enough of the vault api for packs (vault_put / vault_get / vault_del on an autobee)
async function make_vault (store) {
  const bee = create_automap({ store: store.namespace('vault-bee') })
  await bee.ready()
  return { store, get_vault_bee: () => bee, vault_put: (k, v) => bee.put(k, v), vault_get: async k => (await bee.get(k))?.value || null, vault_del: k => bee.del(k) }
}

// the disks db view (the file list). on autobase 7 the view is the signed core itself, up to its signedLength
function signed_core (disk) { return disk.base.view.drive.core }

function connect (store_a, store_b) {
  const stream_a = store_a.replicate(true)
  const stream_b = store_b.replicate(false)
  stream_a.pipe(stream_b).pipe(stream_a)
  return [stream_a, stream_b]
}

async function wait_for (done, disks) {
  for (let i = 0; i < 300; i++) {
    for (const disk of disks) await disk.base.update()
    if (done()) return
    await sleep(100)
  }
  throw new Error('timed out')
}

// with 2 indexers the newest entries only get signed once more entries come in, so it keeps writing a small file.
// on autobase 7 a and b take turns, ticks from a alone often didnt get anything signed for 40s
async function wait_signed (disks, length) {
  for (let i = 0; i < 400; i++) {
    for (const disk of disks) await disk.base.update()
    if (disks.every(disk => signed_core(disk).signedLength >= length)) return
    if (i % 10 === 9) await disks[(i + 1) / 10 % disks.length].put('/tick.txt', b4a.from(String(i)))
    await sleep(100)
  }
  throw new Error('not signed')
}

function show (text, ok) {
  results.push(!!ok)
  console.log(`${ok ? 'ok    ' : 'NOT ok'} ${text}`)
}

function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function hex (buffer) { return b4a.toString(buffer, 'hex') }
function on_done () { process.exit(results.every(ok => ok) ? 0 : 1) }
function on_error (err) {
  console.log('FAILED', err)
  process.exit(1)
}
