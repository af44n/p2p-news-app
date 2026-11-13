// serapath's idea for recovery when every device is lost: a plain hypercore made with the seed phrase keypair (the
// "master core"). every message (the first device's vault, later a restore) truncates to the current length with
// the date as the new fork id and appends one message, then the keypair is dropped again. a newer date wins, so an
// old copy of the core that comes back later gets truncated to the new one
// devices here, ali (the first device, lost later), a backup that only replicates, and a new device after the loss
// plain hypercore 11 + corestore 7, not our vault code. run with: node docs/master-core-check.js
const fs = require('fs')
const os = require('os')
const path = require('path')
const b4a = require('b4a')
const Corestore = require('corestore')
const Hypercore = require('hypercore')
const { create_mnemonic_keypair } = require('../lib/node_modules/crypto-helpers')

let failed = 0
main().then(done, err => { console.error(err); process.exit(1) })

async function main () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'master-core-'))
  const { mnemonic, keypair } = await create_mnemonic_keypair()
  const key = Hypercore.key(keypair.publicKey)
  const week_ago = Date.now() - 7 * 24 * 3600 * 1000 // ali wrote a week ago, the restore is now
  // ali makes the master core with the first message
  const ali = new Corestore(path.join(root, 'ali'))
  const ali_core = ali.get({ keyPair: keypair, valueEncoding: 'json' })
  await ali_core.ready()
  check('the master core key comes from the users public key alone, so anyone who knows it can find the core', b4a.equals(ali_core.key, key))
  await write(ali_core, { vault: 'v1' }, keypair, week_ago)
  // the backup gets it, then goes offline. ali writes once more (a second device was paired, say)
  const backup = new Corestore(path.join(root, 'backup'))
  const backup_core = backup.get({ key, valueEncoding: 'json' })
  let streams = connect(ali, backup)
  await wait(() => backup_core.length === 1, [backup_core])
  check('the backup replicates the master core without any key pair', (await backup_core.get(0)).vault === 'v1')
  streams.forEach(stream => stream.destroy())
  await write(ali_core, { vault: 'v2' }, keypair, week_ago + 1000)
  check('every message is on a new fork id (the date)', ali_core.fork > 0 && ali_core.length === 2, `fork ${ali_core.fork}`)
  const ali_fork = ali_core.fork
  // every device is lost. a new device has only the seed phrase, it can only reach the backup, which is behind
  const fresh = new Corestore(path.join(root, 'fresh'))
  const restored = await create_mnemonic_keypair({ mnemonic })
  const fresh_core = fresh.get({ key: Hypercore.key(restored.keypair.publicKey), valueEncoding: 'json' })
  streams = connect(fresh, backup)
  await wait(() => fresh_core.length === 1, [fresh_core])
  check('the new device finds the core from the seed phrase and reads what the backup has', (await fresh_core.get(0)).vault === 'v1')
  await write(fresh_core, { vault: 'v3' }, restored.keypair, Date.now())
  await wait(() => backup_core.fork === fresh_core.fork && backup_core.length === 2, [backup_core])
  check('the restore truncates to what it has, appends one message with a newer fork id, and the backup takes it', (await backup_core.get(1)).vault === 'v3', `fork ${fresh_core.fork} > ${ali_fork}`)
  streams.forEach(stream => stream.destroy())
  // ali comes back a week later with the old message v2 on an older fork
  check('the old device still has its own message on the old fork', (await ali_core.get(1)).vault === 'v2' && ali_core.fork === ali_fork)
  streams = connect(ali, backup)
  await wait(() => ali_core.fork === fresh_core.fork, [ali_core, backup_core], 10000)
  check('when the old device comes back, it gets truncated to the newer fork', ali_core.fork === fresh_core.fork && (await ali_core.get(1, { wait: true, timeout: 5000 }).catch(() => null))?.vault === 'v3', `fork ${ali_core.fork}`)
  check('and the backup keeps the newer fork, the old one cant replay over it', backup_core.fork === fresh_core.fork && (await backup_core.get(1)).vault === 'v3')
  streams.forEach(stream => stream.destroy())
  // without the key pair nobody can add a message
  const read_only = fresh.get({ key, valueEncoding: 'json' })
  check('without the seed phrase the core cant be written', await read_only.append({ vault: 'evil' }).then(() => false, () => true))
  // a later restore on a device whose clock is behind, its date is older than the fork the backup has
  const current = backup_core.fork
  const other = new Corestore(path.join(root, 'other'))
  const other_core = other.get({ key, valueEncoding: 'json' })
  streams = connect(other, backup)
  await wait(() => other_core.fork === current && other_core.length === 2, [other_core])
  streams.forEach(stream => stream.destroy())
  const lower = await write(other_core, { vault: 'v4' }, keypair, current - 3600 * 1000).then(() => 'allowed', err => err.message.split('\n')[0])
  console.log(`info, a restore with an older date on a device that has the newer fork: ${lower}`)
  streams = connect(other, backup)
  await wait(() => backup_core.fork !== current, [backup_core], 5000)
  check('a restore with an older date than the current fork doesnt replace it on the backup', backup_core.fork === current && (await backup_core.get(1)).vault === 'v3', `backup fork ${backup_core.fork}`)
  streams.forEach(stream => stream.destroy())
  await other.close()
  for (const store of [ali, backup, fresh]) await store.close()
  fs.rmSync(root, { recursive: true, force: true })
}

// one message: truncate to the current length with the date (ms) as the new fork id, then append
async function write (core, message, keyPair, date) {
  await core.truncate(core.length, { fork: date, keyPair })
  await core.append(message, { keyPair })
}

function connect (store_a, store_b) {
  const stream_a = store_a.replicate(true)
  const stream_b = store_b.replicate(false)
  stream_a.pipe(stream_b).pipe(stream_a)
  return [stream_a, stream_b]
}

async function wait (done, cores, ms = 10000) {
  for (const until = Date.now() + ms; Date.now() < until;) {
    for (const core of cores) await core.update({ wait: false }).catch(() => {})
    if (done()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

function check (name, ok, info = '') {
  if (!ok) failed++
  console.log(`${ok ? 'ok' : 'NOT ok'} ${name}${info ? ` (${info})` : ''}`)
}

function done () {
  console.log(failed ? `${failed} NOT ok` : 'all good')
  process.exit(failed ? 1 : 0)
}
