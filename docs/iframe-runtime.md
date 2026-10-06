# Iframe Runtime

A small browser runtime for running code inside a sandboxed iframe and talking to it through a `MessageChannel`.

## What it does

- Creates an iframe inside a closed Shadow DOM
- Runs the iframe with `sandbox="allow-scripts"`
- Gives the host and iframe a plain, connected `MessagePort`
- Gives both sides `tx()` to create messages in one shared format
- Supports controlled and sandboxed modes
- Cleans up the iframe, port, and Blob URL

**Note:** This is a reusable iframe building block. A virtual device is one thing we can make with it, but the iframe itself is not specifically a virtual device.

## Quick Start

```javascript
const vm = require('iframe-runtime')

const tx = vm.make_tx('host')
const view = vm(run_child, on_ready, { mode: 'sandboxed', id: 'child' })
document.body.appendChild(view)

function run_child (port, tx) {
  port.onmessage = onmessage
  function onmessage (event) {
    const msg = event.data
    if (msg.type === 'greet') port.postMessage(tx({ to: msg.head[0], type: 'reply', data: `Hello ${msg.data}`, refs: { cause: msg.head } }))
  }
}

function on_ready (port) {
  port.onmessage = event => console.log(event.data.data) // Hello alice
  port.postMessage(tx({ to: 'child', type: 'greet', data: 'alice' }))
}
```

`vm()` returns the host view straight away. Append it to the document so the iframe can load. `on_ready(port, view)` runs once the host and child ports are connected.

The child function is turned into source and evaluated inside the iframe, so it cannot use variables from the closure where it was originally written. Send anything it needs through the port.

## Options

```javascript
const view = vm(run_child, on_ready, {
  mode: 'sandboxed',
  id: 'child',
  document,
  title: 'My sandbox'
})
```

- `mode` - `controlled` by default, or `sandboxed`
- `id` - the child's address, used as `by` in the child's messages (default `vm`)
- `document` - document used to create the iframe and host view
- `title` - accessible title for the iframe

## Messages

Every message has the same shape:

```javascript
{ head, refs, type, data, meta }
```

- `head` - `[by, to, mid]`: sender address, receiver address, message id
- `mid` - starts at 0 and counts up for every message the same sender sends to the same receiver
- `refs` - links to other messages, e.g. a reply has `refs.cause = msg.head` of the message it answers
- `type` - a string
- `data` - anything that belongs to the type
- `meta` - `{ time, stack }`

`make_tx(by)` returns `tx`, which creates these messages and keeps the counters:

```javascript
const tx = vm.make_tx('host')
port.postMessage(tx({ to: 'child', type: 'ping', data: 1 }))
```

The child gets its own `tx` (with `by` set to `options.id`) as its second argument. The host makes one with `vm.make_tx('host')`. Use one `tx` per sender so its message ids never repeat.

A common way to wait for replies:

```javascript
const wait = {}
port.onmessage = onmessage

function ask (type, data, on_answer) {
  const msg = tx({ to: 'child', type, data })
  wait[msg.head] = on_answer
  port.postMessage(msg)
}

function onmessage (event) {
  const msg = event.data
  const answer = wait[msg.refs.cause]
  if (answer) return answer(msg)
  // otherwise handle msg.type
}
```

## Modes

### Sandboxed

Sandboxed mode runs the first child function and then only reacts to the messages the child code chooses to handle. The host cannot send more code for execution.

### Controlled

Controlled mode is mainly for simulations and host-owned testing. After the first function runs, the host can send more source code to execute inside the iframe with a `run` message. The code gets `port` and `tx`:

```javascript
port.postMessage(tx({ to: 'child', type: 'run', data: 'port.postMessage(tx({ to: "host", type: "executed" }))' }))
```

If code throws, the child sends `{ type: 'error', data: err.message }` to `host`.

Do not give a controlled port to untrusted code because whoever controls that port can run code inside the iframe.

## Cleanup

```javascript
view.close()
```

Closing the view closes the host port, removes the iframe and host view, and revokes the generated Blob URL. Calling `close()` again does nothing, so cleanup is safe to repeat.

## Virtual Devices

The `virtual-device` module uses this runtime to create multiple local iframe devices. Each device's `id` is its address.

```javascript
const virtual_device = require('virtual-device')

const devices = virtual_device({ document })
const device_a = devices.create(run_child, { id: 'device-a' })
const device_b = devices.create(run_child, { id: 'device-b' })

document.body.append(device_a.view, device_b.view)
devices.connect(device_a.id, device_b.id)
```

- A device sends to another device by addressing it: `port.postMessage(tx({ to: 'device-b', type: 'note', data }))`. The host routes it unchanged.
- Messages are only routed between connected devices, and only if `head[0]` is the device that really sent it.
- A failed route comes back to the sender as `{ type: 'error', refs: { cause: msg.head } }`.
- The host talks to devices through `device.port` and `devices.tx`, so all host messages share one set of counters.

The devices still communicate locally through MessageChannels. There is no Hyperdrive, Hyperswarm, real pairing, or other p2p overhead yet.

## Scenario Tests

```javascript
const run_scenarios = require('virtual-device/scenarios')

run_scenarios().then(show_results).catch(show_error)

function show_results (results) { console.table(results) }
function show_error (error) { console.error(error) }
```

The scenarios create three devices and check messages both ways, the message format and counters, isolated runtime state, connected and disconnected routing, forged senders, and cleanup.
