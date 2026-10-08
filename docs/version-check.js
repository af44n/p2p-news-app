// we are on corestore 6 / hypercore 10 (works in browsers), basim's packs code is on corestore 7.
// This runs the drive operations his code relies on against our versions and prints what works.
const fs = require('bare-fs')
const os = require('bare-os')
const path = require('bare-path')
const process = require('bare-process')
const Corestore = require('corestore')
const RAM = require('random-access-memory')
const Hyperdrive = require('hyperdrive')
const MirrorDrive = require('mirror-drive')
const b4a = require('b4a')
const { create_autodrive } = require('../lib/node_modules/autodrive')

const results = []

main().then(print_results, on_crash)

async function main () {
  await check_hyperdrive()
  await check_storage()
  await check_autodrive()
}

/***************************************
HYPERDRIVE
basim's packs use plain hyperdrives
***************************************/
async function check_hyperdrive () {
  const store = new Corestore(RAM)
  const drive = new Hyperdrive(store.namespace('pack'))
  await drive.ready()
  await drive.put('/main.js', b4a.from('module.exports = 1'))
  await drive.put('/data/a.txt', b4a.from('hello'))
  const length = drive.core.length
  const hash = b4a.toString(await drive.core.treeHash(length), 'hex')
  const link = `dat://${length}.${drive.core.fork}.${drive.id}.${hash}`
  check({ name: 'hyperdrive: build a dat://length.fork.id.hash link', ok: /^dat:\/\/\d+\.\d+\.[a-z0-9]+\.[a-f0-9]{64}$/.test(link) })
  await drive.put('/data/a.txt', b4a.from('changed'))
  const pinned = drive.checkout(length)
  await pinned.ready()
  check({ name: 'hyperdrive: checkout(length) still reads the old file', ok: b4a.toString(await pinned.get('/data/a.txt')) === 'hello' })
  check({ name: 'hyperdrive: hash of an old length does not change after new writes', ok: b4a.toString(await drive.core.treeHash(length), 'hex') === hash })
  check({ name: 'hyperdrive: entry() works (bare-module loader reads code through it)', ok: !!(await drive.entry('/main.js')) })
  const copy = new Hyperdrive(store.namespace('copy'))
  await copy.ready()
  await new MirrorDrive(pinned, copy, { prune: false }).done()
  check({ name: 'mirror-drive 1.10: copy a pinned version into a new drive', ok: b4a.toString(await copy.get('/data/a.txt')) === 'hello' })
  await pinned.close()
  await store.close()
}

/***************************************
STORAGE
the two corestore 7 calls that broke basim's tests on our versions
***************************************/
async function check_storage () {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'version-check-'))
  const store = new Corestore(folder)
  check({ name: 'corestore 6: store.storage.getAuth() exists (basim uses it to find local drives)', ok: typeof store.storage.getAuth === 'function' })
  const keep = await make_drive(store, 'keep')
  const gone = await make_drive(store, 'gone')
  const unknown = b4a.alloc(32, 7)
  check({ name: 'corestore 6: createIfMissing: false tells a stored drive from an unknown one', ok: await is_stored(store, keep.key) && !(await is_stored(store, unknown)) })
  const before = count_cores(folder)
  const blobs = await gone.getBlobs()
  await blobs.core.purge()
  await gone.core.purge()
  const after = count_cores(folder)
  check({ name: 'hypercore 10: core.purge() deletes one drive from disk, keeps the other', ok: before - after === 2 && b4a.toString(await keep.get('/a.txt')) === 'kept', note: `core folders ${before} -> ${after}` })
  await store.close()
  fs.rmSync(folder, { recursive: true, force: true })
}

/***************************************
AUTODRIVE
serapath wants packs to be autodrives (multi device)
***************************************/
async function check_autodrive () {
  const store_a = new Corestore(RAM)
  const store_b = new Corestore(RAM)
  const drive_a = create_autodrive({ store: store_a.namespace('pack') })
  await drive_a.ready()
  const drive_b = create_autodrive({ store: store_b.namespace('pack'), bootstrap: drive_a.base.key })
  await drive_b.ready()
  replicate(store_a, store_b)
  await drive_a.add_writer(drive_b.base.local.key)
  await drive_a.put('/main.js', b4a.from('from a'))
  await settle(drive_a, drive_b)
  await drive_b.put('/b.txt', b4a.from('from b'))
  await settle(drive_a, drive_b)
  check({ name: 'autodrive: second device can write after add_writer', ok: b4a.toString(await drive_a.get('/b.txt') || '') === 'from b' })
  const view_a = drive_a.base.view.drive
  const view_b = drive_b.base.view.drive
  check({ name: 'autodrive: files view has the same key on both devices', ok: b4a.equals(view_a.key, view_b.key), note: `a ${view_a.id.slice(0, 8)}, b ${view_b.id.slice(0, 8)}` })
  // autobase views only have a tree hash on their signed core
  const signed_a = view_a.core.getBackingCore().session
  const signed_b = view_b.core.getBackingCore().session
  const length = Math.min(signed_a.length, signed_b.length)
  const hash_a = b4a.toString(await signed_a.treeHash(length), 'hex')
  const hash_b = b4a.toString(await signed_b.treeHash(length), 'hex')
  check({ name: 'autodrive: same hash on both devices, so one dat:// link works everywhere', ok: length > 0 && hash_a === hash_b, note: `length ${length}` })
  const pinned = view_a.checkout(view_a.version)
  await pinned.ready()
  check({ name: 'autodrive: checkout of the files view works on one device', ok: b4a.toString(await pinned.get('/main.js') || '') === 'from a' })
  await pinned.close()
  check({ name: 'autodrive: has entry() itself (only base.view.drive has it)', ok: typeof drive_a.entry === 'function' })
  const source = new Hyperdrive(store_a.namespace('source'))
  await source.ready()
  await source.put('/c.txt', b4a.from('copied'))
  const error = await mirror_error(source, drive_b)
  check({ name: 'mirror-drive: copy a normal drive into an autodrive', ok: !error, note: error })
  await drive_a.close()
  await drive_b.close()
}

/***************************************
HELPERS
***************************************/
function check ({ name, ok, note = '' }) { results.push({ name, ok, note }) }

function print_results () {
  for (const { name, ok, note } of results) console.log(`${ok ? 'works ' : 'broken'}  ${name}${note ? `  (${note})` : ''}`)
  console.log(`\n${results.filter(result => result.ok).length} of ${results.length} work`)
  process.exit(0)
}

function on_crash (err) {
  console.error(err)
  process.exit(1)
}

async function make_drive (store, name) {
  const drive = new Hyperdrive(store.namespace(name))
  await drive.ready()
  await drive.put('/a.txt', b4a.from(name === 'keep' ? 'kept' : 'removed'))
  return drive
}

async function is_stored (store, key) {
  const core = store.get({ key, createIfMissing: false })
  return core.ready().then(() => true, () => false)
}

function count_cores (folder) {
  let count = 0
  for (const a of fs.readdirSync(path.join(folder, 'cores'))) {
    for (const b of fs.readdirSync(path.join(folder, 'cores', a))) count += fs.readdirSync(path.join(folder, 'cores', a, b)).length
  }
  return count
}

// same options basim's packs use when copying a drive
function mirror_error (source, destination) {
  return new MirrorDrive(source, destination, { prune: false, preload: false }).done().then(() => '', err => err.message)
}

function replicate (store_a, store_b) {
  const stream = store_a.replicate(true)
  stream.pipe(store_b.replicate(false)).pipe(stream)
}

async function settle (drive_a, drive_b) {
  for (let i = 0; i < 20; i++) {
    await drive_a.base.update()
    await drive_b.base.update()
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
