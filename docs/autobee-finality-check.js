// run with: npm install --no-save autobee@2.13.6 && node docs/autobee-finality-check.js (autobee isnt one of our dependencies)
// is something final in autobee once a majority (2 of 3 writers, 4 of 6 weight) linked it?
// 3 indexers a, b, c. c goes offline and writes z. then a writes x and b writes after it (b has seen x).
// c comes back. if x gets reordered behind z, 2 of 3 linking it wasnt final
const fs = require('fs')
const os = require('os')
const path = require('path')
const Corestore = require('corestore')
const Autobee = require('autobee')
const b4a = require('b4a')
const streams = new Set() // every open replication stream, data on them is when something new may have arrived

main().catch(err => { console.error(err); process.exit(1) })

async function main () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autobee-finality-'))
  const a = await open(path.join(dir, 'a'), null)
  const b = await open(path.join(dir, 'b'), a.key)
  const c = await open(path.join(dir, 'c'), a.key)
  let links = [connect(a, b), connect(a, c), connect(b, c)]
  await a.append(enc({ add: b.local.key.toString('hex') }))
  await a.append(enc({ add: c.local.key.toString('hex') }))
  await until([a, b, c], () => b.writable && c.writable)
  await a.append(enc({ v: 'start' }))
  await until([a, b, c], async () => (await order(b)).includes('start') && (await order(c)).includes('start'))

  links.forEach(cut) // c goes offline
  links = [connect(a, b)]
  await c.append(enc({ v: 'z' })) // c writes first, so z has the earlier timestamp
  await sleep(50)
  await a.append(enc({ v: 'x' }))
  await until([a, b], async () => (await order(b)).includes('x'))
  await b.append(enc({ v: 'y' })) // b has seen x, so 2 of 3 writers link x now
  await until([a, b], async () => (await order(a)).includes('y'))
  const before = await order(a)
  console.log('a before c is back:', before.join(' '))

  links.push(connect(a, c), connect(b, c)) // c comes back
  await until([a, b, c], async () => (await order(a)).includes('z') && (await order(c)).includes('y'))
  const after = await order(a)
  console.log('a after c is back: ', after.join(' '))
  console.log('c:                 ', (await order(c)).join(' '))
  console.log(after.indexOf('z') < after.indexOf('x')
    ? 'x was linked by 2 of 3 writers and still got reordered behind z, so a majority is not final in autobee'
    : 'z went after x, so x stayed where it was')
  process.exit(0)
}

async function open (dir, key) {
  const db = new Autobee(new Corestore(dir), key, { apply })
  await db.ready()
  return db
}

// every value goes to log/<n> in the order apply sees it
async function apply (nodes, view, host) {
  for (const node of nodes) {
    const op = JSON.parse(b4a.toString(node.value))
    if (op.add) { await host.addWriter(b4a.from(op.add, 'hex')); continue }
    const count = await view.get(b4a.from('count'))
    const n = count ? Number(b4a.toString(count.value)) : 0
    const w = view.write()
    w.tryPut(b4a.from('log/' + String(n).padStart(4, '0')), b4a.from(op.v))
    w.tryPut(b4a.from('count'), b4a.from(String(n + 1)))
    await w.flush()
  }
}

async function order (db) {
  await db.update()
  const out = []
  for await (const { value } of db.view.createReadStream({ gte: b4a.from('log/'), lt: b4a.from('log0') })) out.push(b4a.toString(value))
  return out
}

function enc (v) { return b4a.from(JSON.stringify(v)) }
function connect (x, y) { const s1 = x.replicate(true); const s2 = y.replicate(false); s1.pipe(s2).pipe(s1); streams.add(s1); streams.add(s2); return [s1, s2] }
function cut ([s1, s2]) { s1.destroy(); s2.destroy(); streams.delete(s1); streams.delete(s2) }
function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

// autobee has no event for "new data applied", so on every bit of replication data the dbs apply (update) and done() is checked
function until (dbs, done) {
  return new Promise((resolve, reject) => {
    const watched = [...streams]
    let finished = false
    const check = async () => {
      if (finished) return
      for (const db of dbs) await db.update()
      if (finished || !(await done())) return
      finished = true
      for (const s of watched) s.off('data', check)
      resolve()
    }
    for (const s of watched) s.on('data', () => check().catch(reject))
    check().catch(reject)
  })
}
