// serapath (worklog-50 thread, 18 nov): can an autobase take the view core of another autobase as a writer (input)?
// user base U (1 device) has a view `log`. shared base S adds U's view core key as a writer. U writes. what does S do?
// plain autobase 7, node, results in docs/autobase-checks.md. run with: node docs/view-as-writer-check.js
// a writer core has to hold autobase's own nodes (each says which heads it links), a view core holds what the apps apply
// wrote, so s cant read it. s still has to keep working for its own writers
const fs = require('fs')
const os = require('os')
const path = require('path')
const Corestore = require('corestore')
const Autobase = require('autobase')
const b4a = require('b4a')

const events = []
const results = []
let dir
process.on('uncaughtException', err => events.push(`uncaught: ${err.message}`))
main().then(done, err => { console.log('FAILED', err); done() })

async function main () {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'view-as-writer-'))
  const store_u = new Corestore(path.join(dir, 'u'))
  const store_s = new Corestore(path.join(dir, 's'))
  const u = new Autobase(store_u, null, opts())
  await u.ready()
  await u.append('first from the user')
  await wait(() => u.view.signedLength === 1, [u])
  const s = new Autobase(store_s, null, opts())
  await s.ready()
  for (const [name, base] of [['u', u], ['s', s]]) {
    base.on('error', err => events.push(`${name} error: ${err.message}`))
    base.on('warning', err => events.push(`${name} warning: ${err.message}`))
  }
  const streams = connect(store_u, store_s)
  const view_key = b4a.from(u.view.key)
  // the shared base adds the users view core as a writer (not an indexer, s stays the only indexer)
  await s.append({ add: b4a.toString(view_key, 'hex'), indexer: false })
  await s.append('s0')
  await wait(() => s.view.length >= 1, [s])
  await u.append('second from the user')
  await wait(() => u.view.signedLength === 2, [u])
  // give s time to see the user view core and try to read it as a writer
  for (let i = 0; i < 30; i++) { await s.update().catch(err => events.push(`s update: ${err.message}`)); await sleep(100) }
  const s_view = []
  for (let i = 0; i < s.view.length; i++) s_view.push(await s.view.get(i))
  const writer = await s.system.get(view_key)
  console.log(`u's view core: length ${u.view.length}, key ${short(view_key)}`)
  console.log(`s's view: ${JSON.stringify(s_view)}`)
  console.log(`s's system record for u's view core: ${writer ? JSON.stringify({ length: writer.length, isIndexer: writer.isIndexer, isRemoved: writer.isRemoved }) : 'none'}`)
  console.log(`events: ${events.length ? events.join(' | ') : 'none'}`)
  // why: did s get the blocks of that core at all, and what does autobase's writer for it say
  const copy = store_s.get({ key: view_key })
  await copy.ready()
  await copy.update({ wait: true }).catch(() => {})
  const block = copy.length ? await copy.get(0, { wait: false, valueEncoding: 'json' }).catch(err => 'unreadable: ' + err.message) : null
  const w = s.activeWriters && s.activeWriters.get(view_key)
  console.log(`s's copy of u's view core: length ${copy.length}, block 0 as json: ${JSON.stringify(block)}`)
  console.log(`s's writer object for it: ${w ? JSON.stringify({ length: w.length, frozen: w.frozen, nodes: w.nodes.length }) : 'none (not active)'}`)
  show('s added the users view core as a writer (its in the system)', !!writer)
  show('nothing the user wrote reached the shared view', !s_view.some(v => /from the user/.test(JSON.stringify(v))))
  show(`s got the blocks of u's view core (length ${copy.length}), but autobase froze that writer and read 0 nodes from it, without an error or warning`, copy.length === 2 && w && w.frozen && w.nodes.length === 0 && events.length === 0)
  show('s still works for its own writes', s_view.includes('s0'))
  for (const stream of streams) stream.destroy()
}

function opts () {
  return {
    valueEncoding: 'json',
    ackInterval: 50,
    ackThreshold: 0,
    open: store => store.get('log', { valueEncoding: 'json' }),
    async apply (nodes, view, host) {
      for (const node of nodes) {
        if (node.value && node.value.add) await host.addWriter(b4a.from(node.value.add, 'hex'), { indexer: node.value.indexer })
        else await view.append(node.value)
      }
    }
  }
}

async function wait (cond, bases) {
  for (let i = 0; i < 200; i++) {
    for (const base of bases) await base.update()
    if (cond()) return
    await sleep(100)
  }
  throw new Error('timed out')
}
function connect (x, y) { const a = x.replicate(true); const b = y.replicate(false); a.pipe(b).pipe(a); return [a, b] }
function show (text, ok) { results.push(ok); console.log(`${ok ? 'ok    ' : 'NOT ok'} ${text}`) }
function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function short (buf) { return b4a.toString(buf, 'hex').slice(0, 8) }
function done () { if (dir) fs.rmSync(dir, { recursive: true, force: true }); process.exit(results.length && results.every(ok => ok) ? 0 : 1) }
