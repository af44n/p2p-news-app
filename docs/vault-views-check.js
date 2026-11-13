// the vault as 2 autobases (what we have, autobee for the bee + auditcore for the log) vs 1 autobase with 2 views
// (the bee and the log, one apply writes both). serapath asked for a performance check before we merge them
// measures, writes on one device, reopening the store, and 2 devices writing while cut off and then syncing (a reorder).
// "2 bases" uses our real autobee and auditcore modules, "1 base" is a small autobase with the same apply code for both views
// prints the times, every number is the middle one of RUNS runs. run with: node docs/vault-views-check.js
const fs = require('fs')
const os = require('os')
const path = require('path')
const b4a = require('b4a')
const Autobase = require('autobase')
const Hyperbee = require('hyperbee')
const Corestore = require('corestore')
const { create_automap } = require('../lib/node_modules/automap')
const { create_auditcore } = require('../lib/node_modules/auditcore')

const WRITES = +process.env.WRITES || 300
const SPLIT = +process.env.SPLIT || 50 // writes per device while they cant see each other
const RUNS = +process.env.RUNS || 3

main().catch(err => { console.error(err); process.exit(1) })

async function main () {
  for (const kind of ['2 bases', '1 base']) {
    const results = []
    for (let run = 0; run < RUNS; run++) results.push(await measure(kind))
    const mid = key => results.map(r => r[key]).sort((a, b) => a - b)[Math.floor(RUNS / 2)]
    console.log(`${kind}: ${WRITES} writes ${mid('writes')}ms, reopen ${mid('reopen')}ms, sync after ${SPLIT} + ${SPLIT} split writes ${mid('sync')}ms, ${mid('cores')} cores per device`)
  }
  process.exit(0)
}

async function measure (kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-views-'))
  const open = kind === '2 bases' ? open_two_bases : open_one_base
  let a = await open(new Corestore(path.join(root, 'a')))
  // writes on one device
  let t = Date.now()
  for (let i = 0; i < WRITES; i++) await a.put(`key/${i}`, { i })
  const writes = Date.now() - t
  const before = await a.lengths()
  // reopen
  await a.close()
  t = Date.now()
  a = await open(new Corestore(path.join(root, 'a')))
  const after = await a.lengths()
  const reopen = Date.now() - t
  check(`${kind}: the same data after reopening`, before.bee === after.bee && before.log === after.log, JSON.stringify([before, after]))
  // a second device, then both write while cut off, then they meet again and autobase reorders
  const b = await open(new Corestore(path.join(root, 'b')), a.keys)
  let streams = connect(a.store, b.store)
  await a.add_writer(b.writer_keys)
  await settle([a, b], async () => (await b.lengths()).log === (await a.lengths()).log && b.writable())
  streams.forEach(stream => stream.destroy())
  for (let i = 0; i < SPLIT; i++) {
    await a.put(`a/${i}`, { i })
    await b.put(`b/${i}`, { i })
  }
  t = Date.now()
  streams = connect(a.store, b.store)
  const total = WRITES + 2 * SPLIT
  await settle([a, b], async () => { const [la, lb] = [await a.lengths(), await b.lengths()]; return la.log >= total && la.log === lb.log && la.bee === lb.bee })
  const sync = Date.now() - t
  check(`${kind}: both devices have every write after the reorder`, (await a.lengths()).log >= total && (await a.log_heads()) === (await b.log_heads()))
  const cores = [...a.store.cores].length
  streams.forEach(stream => stream.destroy())
  await a.close()
  await b.close()
  fs.rmSync(root, { recursive: true, force: true })
  return { writes, reopen, sync, cores }
}

/***************************************
THE 2 VARIANTS
both give put(key, value) that writes the bee entry and its audit entry, like vault_put in identity-operations
***************************************/
async function open_two_bases (store, keys = {}) {
  const bee = create_automap({ store: store.namespace('vault-bee'), bootstrap: keys.bee || null })
  const audit = create_auditcore({ store: store.namespace('vault-audit'), bootstrap: keys.audit || null })
  await bee.ready()
  await audit.ready()
  return {
    store,
    keys: { bee: bee.key, audit: audit.key },
    writer_keys: [bee.base.local.key, audit.base.local.key],
    put: async (key, value) => { await bee.put(key, value); await audit.append({ type: 'vault_put', data: { key }, meta: { time: Date.now() } }) },
    add_writer: async ([bee_key, audit_key]) => { await bee.add_writer(bee_key); await audit.add_writer(audit_key) },
    writable: () => bee.writable && audit.writable,
    update: async () => { await bee.update(); await audit.update() },
    lengths: async () => ({ bee: bee.base.view.bee.version, log: audit.length }),
    log_heads: async () => (await audit.read()).map(entry => entry.data.key).join(),
    close: async () => { await bee.close(); await audit.close(); await store.close() }
  }
}

async function open_one_base (store, keys = {}) {
  const base = new Autobase(store.namespace('vault'), keys.bee || null, { valueEncoding: 'json', open: open_views, apply: apply_both, ackInterval: 1000, ackThreshold: 1, fastForward: false })
  await base.ready()
  await base.update()
  return {
    store,
    keys: { bee: base.key },
    writer_keys: [base.local.key],
    put: async (key, value) => { await base.append({ type: 'put', data: { key, value }, meta: { time: Date.now() } }); await base.update() },
    add_writer: async ([key]) => { await base.append({ type: 'add_writer', data: { key: b4a.toString(key, 'hex') } }); await base.update() },
    writable: () => base.writable,
    update: () => base.update(),
    lengths: async () => ({ bee: base.view.bee.version, log: base.view.log.length }),
    log_heads: async () => { const keys = []; for (let i = 0; i < base.view.log.length; i++) keys.push((await base.view.log.get(i)).data.key); return keys.join() },
    close: async () => { await base.close(); await store.close() }
  }
}

function open_views (store) {
  return { bee: new Hyperbee(store.get('bee'), { keyEncoding: 'utf-8', valueEncoding: 'json', extension: false }), log: store.get({ name: 'log', valueEncoding: 'json' }) }
}

// the same work autobee and auditcore do in their apply, here in one apply for both views
async function apply_both (nodes, view, host) {
  const batch = view.bee.batch()
  for (const node of nodes) {
    if (node.value === null) continue
    const { type, data, meta } = node.value
    if (type === 'add_writer') { await host.addWriter(b4a.from(data.key, 'hex'), { indexer: true }); continue }
    await batch.put(data.key, data.value)
    await view.log.append({ head: [b4a.toString(node.from.key, 'hex')], refs: {}, type: 'vault_put', data: { key: data.key }, meta })
  }
  await batch.flush()
}

/***************************************
HELPERS
***************************************/
function connect (store_a, store_b) {
  const stream_a = store_a.replicate(true)
  const stream_b = store_b.replicate(false)
  stream_a.pipe(stream_b).pipe(stream_a)
  return [stream_a, stream_b]
}

// update both devices until done() or about 60 seconds passed
async function settle (devices, done) {
  for (let i = 0; i < 600; i++) {
    for (const device of devices) await device.update()
    if (await done()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('devices did not settle')
}

function check (name, ok, info = '') {
  if (!ok) console.log(`NOT ok ${name} ${info}`)
}
