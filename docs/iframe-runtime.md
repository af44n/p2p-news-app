# Iframe Runtime

A small browser runtime for running code inside a sandboxed iframe and talking to it through a `MessageChannel`.

## What it does

- Creates an iframe inside a closed Shadow DOM
- Runs the iframe with `sandbox="allow-scripts"`
- Gives the host and iframe a connected `MessagePort`
- Supports controlled and sandboxed modes
- Adds small `request()` and `handle()` RPC helpers
- Keeps the raw MessagePorts available for normal messages
- Cleans up the iframe, port, RPC handlers, and pending requests

**Note:** This is a reusable iframe building block. A virtual device is one thing we can make with it, but the iframe itself is not specifically a virtual device.

## Quick Start

```javascript
const vm = require('iframe-runtime')

const view = vm(run_child, on_ready, { mode: 'sandboxed' })
document.body.appendChild(view)

function run_child (port) {
  port.handle('greet', greet)

  function greet (name) { return `Hello ${name}` }
}

async function on_ready (port) {
  const greeting = await port.request('greet', 'alice')
  console.log(greeting)
}
```

`vm()` returns the host view straight away. Append it to the document so the iframe can load. `on_ready()` runs once the host and child ports are connected.

The child function is turned into source and evaluated inside the iframe, so it cannot use variables from the closure where it was originally written. Send anything it needs through the port.

## Options

```javascript
const view = vm(run_child, on_ready, {
  mode: 'sandboxed',
  document,
  title: 'My sandbox'
})
```

- `mode` - `controlled` by default, or `sandboxed`
- `document` - document used to create the iframe and host view
- `title` - accessible title for the iframe

## Modes

### Sandboxed

Sandboxed mode runs the first child function and then only accepts the messages and RPC handlers that the child chooses to support.

```javascript
function run_child (port) {
  port.handle('ping', ping)

  function ping (value) { return value }
}
```

The host cannot send more code for execution in this mode.

### Controlled

Controlled mode is mainly for simulations and host-owned testing. After the first function runs, the host can send more source code to execute inside the iframe.

```javascript
function on_ready (port) {
  port.postMessage({
    source: 'port.postMessage({ type: "executed" })'
  })
}
```

Do not give a controlled port to untrusted code because whoever controls that port can run code inside the iframe.

## RPC Helpers

RPC here is just request and response messaging. One side asks the other side to run a named handler and send the result back.

```javascript
port.handle('add', add)

function add ({ first, second }) {
  return first + second
}
```

The other side can call it with:

```javascript
const total = await port.request('add', {
  first: 2,
  second: 3
})
```

Available helpers:

```javascript
port.handle(name, handler)
port.request(name, data)
port.stop_rpc()
```

- `handle()` adds or removes a named handler
- `request()` returns a promise with the result from the other side
- `stop_rpc()` removes handlers and rejects pending requests

Unsupported handlers and errors reject the request instead of leaving it hanging.

## Raw Messages

The RPC helpers do not replace the normal `MessagePort` API. Both sides can still send their own message types.

```javascript
function run_child (port) {
  port.addEventListener('message', receive)
  port.postMessage({ type: 'child-ready' })

  function receive (event) {
    if (event.data?.type === 'notice') console.log(event.data.value)
  }
}
```

The RPC helper internally uses `rpc-request` and `rpc-response`, so other code should avoid using those two message types.

## Cleanup

```javascript
view.close()
```

Closing the view:

- tells the child port to close
- rejects pending host RPC requests
- removes RPC listeners and handlers
- closes the host port
- removes the iframe and host view
- revokes the generated Blob URL

Calling `close()` again does nothing, so cleanup is safe to repeat.

## Virtual Devices

The `virtual-device` module uses this runtime to create multiple local iframe devices.

```javascript
const virtual_device = require('virtual-device')

const devices = virtual_device({ document })
const device_a = devices.create(run_child, { id: 'device-a' })
const device_b = devices.create(run_child, { id: 'device-b' })

document.body.append(device_a.view, device_b.view)
devices.connect(device_a.id, device_b.id)
```

The devices still communicate locally through MessageChannels. There is no Hyperdrive, Hyperswarm, real pairing, or other p2p overhead yet.

## Scenario Tests

```javascript
const run_scenarios = require('virtual-device/scenarios')

run_scenarios().then(show_results).catch(show_error)

function show_results (results) { console.table(results) }
function show_error (error) { console.error(error) }
```

The scenarios create three devices and check RPC both ways, isolated runtime state, connected and disconnected routing, and cleanup.
