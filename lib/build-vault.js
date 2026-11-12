// builds vault.bundle.js, the vault worker (lib/vault-worker.js) for the browser.
// browserify with the module swaps rocksdb-native-opfs needs (its README, "Using it in a browser build") as a global transform
const browserify = require('browserify')
const fs = require('fs')
const path = require('path')
const { Transform } = require('stream')
const opfs = path.dirname(require.resolve('rocksdb-native-opfs/package.json'))
// browserify 17 cant parse libsodium.js (es2021 syntax, sodium-crypto uses it for noclamp), so it goes in unparsed
const libsodium = require.resolve('libsodium-sumo', { paths: [require.resolve('libsodium-wrappers-sumo', { paths: [require.resolve('sodium-universal')] })] })

// rocksdb-native's binding -> opfs, fs and device-file -> its browser versions, path -> path-browserify,
// and get-webrtc -> webrtc-bridge (workers have no webrtc, hyper-webrtc gets its RTCPeerConnection from get-webrtc)
const SWAPS = {
  fs: path.join(opfs, 'browser/fs.js'),
  'device-file': path.join(opfs, 'browser/device-file.js'),
  path: require.resolve('path-browserify'),
  'get-webrtc': path.join(__dirname, 'node_modules/webrtc-bridge/index.js')
}

browserify(path.join(__dirname, 'vault-worker.js'), { paths: [path.join(__dirname, 'node_modules')], noParse: [libsodium] }) // our own modules in lib/node_modules
  .transform(browser_swaps, { global: true })
  .bundle()
  .on('error', handle_error)
  .pipe(fs.createWriteStream(path.join(__dirname, '..', 'vault.bundle.js')))

function handle_error (err) {
  console.error(err.message)
  process.exit(1)
}

function browser_swaps (file) {
  const from_rocksdb = file.split(path.sep).includes('rocksdb-native')
  let src = ''
  return new Transform({ transform, flush })
  function transform (chunk, enc, next) {
    src += chunk
    next()
  }
  function flush (done) {
    src = src.replace(/require\((['"])([^'".][^'"]*)\1\)/g, swap)
    if (from_rocksdb) src = src.replace(/require\((['"])\.\.?\/binding(\.js)?\1\)/g, () => `require(${JSON.stringify(path.join(opfs, 'index.js'))})`)
    this.push(src)
    done()
  }
  function swap (all, quote, name) {
    const to = SWAPS[name] || exports_target(name, file)
    return to ? `require(${JSON.stringify(to)})` : all
  }
}

// browserify 17 doesnt read package.json "exports" (hypercore-storage needs hyperschema/runtime, which only exists
// through it), so requires it cant find itself get the file node resolves. only for packages with "exports" and no "browser"
function exports_target (name, file) {
  const parts = name.split('/')
  const scoped = name.startsWith('@')
  const pkg_file = find_package(parts.slice(0, scoped ? 2 : 1).join('/'), path.dirname(file))
  if (!pkg_file) return null
  const pkg = JSON.parse(fs.readFileSync(pkg_file, 'utf8'))
  if (!pkg.exports || pkg.browser) return null
  const subpath = parts.length > (scoped ? 2 : 1)
  if (!subpath && (pkg.main || fs.existsSync(path.join(path.dirname(pkg_file), 'index.js')))) return null
  try {
    return require.resolve(name, { paths: [path.dirname(file)] })
  } catch {
    return null
  }
}

function find_package (name, dir) {
  while (dir !== path.dirname(dir)) {
    const file = path.join(dir, 'node_modules', name, 'package.json')
    if (fs.existsSync(file)) return file
    dir = path.dirname(dir)
  }
  return null
}
