// the tests of all our modules, run with: npm test (bare)
// every module test runs the tests of the modules it uses first (vault-base runs automap and auditcore, packs runs disk-link),
// so this only lists the ones no other module test runs. sleep-watch is node only: node lib/node_modules/sleep-watch/sleep-watch.test.js
const tests = [
  require('../lib/node_modules/vault-base/vault-base.test.js'),
  require('../lib/node_modules/packs/packs.test.js'),
  require('../lib/node_modules/code-to-disk/code-to-disk.test.js'),
  require('../lib/node_modules/disk-loader/disk-loader.test.js')
]

main()

async function main () { for (const test of tests) await test() }
