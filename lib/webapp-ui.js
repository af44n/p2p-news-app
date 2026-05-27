// webapp-ui receives `uservault` from datashell (after auth)
// this only runs when user is already authenticated

const blog_app = require('p2p-news-app')

// Uservault param is injected by datashell as 'vault'
const uservault = vault
console.log('[webapp-ui] Starting app with uservault:', uservault)

// Global state
const state = {
  store: null,
  username: uservault.username,
  current_view: null,
  is_ready: false,
  is_joining: false,
  swarm: null,
  api: null
}

/***************************************
UI SETUP
***************************************/

console.log('[webapp-ui] Setting up blog UI...')
// Blog app HTML structure (no login UI, handled by vault-ui)
document.body.innerHTML = `
    <div class="app">
      <div class="main">
        <div>Status: <span class="connection-status">Disconnected</span></div>
        <nav>
          <button data-view="news">News</button>
          <button data-view="blog">My Blog</button>
          <button data-view="explore">Explore</button>
          <button data-view="post">New Post</button>
          <button data-view="config">Config</button>
        </nav>
        <style>
          body { font-family: monospace; }
          nav button.active { background-color: #007bff; color: white; }
        </style>
        <div class="view"></div>
      </div>
    </div>
  `

/***************************************
UTILITY FUNCTIONS
***************************************/

/***************************************
FORMAT DATE
***************************************/
const format_date = timestamp => new Date(timestamp).toLocaleString()

/***************************************
ESCAPE HTML
***************************************/
function escape_html (str) {
  if (!str) return ''
  if (typeof str !== 'string') str = String(str)
  function get_html_entity (tag) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return entities[tag]
  }
  return str.replace(/[&<>"']/g, get_html_entity)
}

/***************************************
SETUP CONNECTION STATUS
***************************************/
function setup_connection_status (swarm) {
  const status_el = document.querySelector('.connection-status')
  if (swarm) {
    state.is_joining = false
    if (swarm.connections.size > 0) {
      status_el.textContent = `🟢 Connected (${swarm.connections.size} peers)`
    } else {
      status_el.textContent = '🟢 Joined swarm (waiting for peers...)'
    }
    function handle_swarm_connection () {
      status_el.textContent = `🟢 Connected (${swarm.connections.size} peers)`
      if (state.current_view) render_view(state.current_view)
    }
    function handle_swarm_disconnection () {
      status_el.textContent = `🟢 Connected (${swarm.connections.size} peers)`
    }
    swarm.on('connection', handle_swarm_connection)
    swarm.on('disconnection', handle_swarm_disconnection)
  } else {
    state.is_joining = false
    status_el.textContent = '🟠 Offline mode (relay not available)'
  }
}

/***************************************
APP INITIALIZATION
***************************************/

/***************************************
INIT BLOG APP
***************************************/
async function init_blog_app () {
  try {
    document.querySelector('.connection-status').textContent = 'Connecting...'
    state.is_joining = true
    state.api = blog_app(uservault)
    function handle_blog_update () {
      if (state.current_view) render_view(state.current_view)
    }
    state.api.on_update(handle_blog_update)
    const init_options = { username: state.username }
    console.log('[webapp-ui] Calling api.init_blog with options:', init_options)
    const result = await state.api.init_blog(init_options)
    console.log('[webapp-ui] init_blog succeeded, result:', result)
    state.store = result.store
    state.swarm = result.swarm
    if (uservault.mode === 'pair' && uservault.username) {
      state.username = uservault.username
    }
    setup_connection_status(state.swarm)
    state.is_ready = true
    state.is_joining = false
    show_view('news')
  } catch (err) {
    state.is_joining = false
    console.error('[webapp-ui] init_blog_app error:', err)
    document.querySelector('.connection-status').textContent = `🔴 Error: ${err.message}`
  }
}

/***************************************
VIEW SYSTEM
***************************************/

/***************************************
SHOW VIEW
***************************************/
function show_view (name) {
  state.current_view = name
  function handle_nav_button_toggle (btn) {
    btn.classList.toggle('active', btn.dataset.view === name)
  }
  document.querySelectorAll('nav button').forEach(handle_nav_button_toggle)
  render_view(name)
}

/***************************************
RENDER VIEW
***************************************/
async function render_view (view, ...args) {
  const view_el = document.querySelector('.view')
  if (state.is_joining) {
    view_el.innerHTML = '<p>Joining, please wait...</p>'
    return
  }
  if (!state.is_ready && view !== 'explore') return
  view_el.innerHTML = 'Loading...'
  const renderers = {
    news: render_news,
    blog: render_blog,
    explore: render_explore,
    post: render_post,
    config: render_config
  }
  if (renderers[view]) await renderers[view]()
  else view_el.innerHTML = `View '${view}' not found.`

  async function render_news () {
    const peer_blogs = await state.api.get_peer_blogs()
    if (peer_blogs.size === 0) {
      view_el.innerHTML = '<p>No posts from subscribed peers yet. Go to the explore tab to find peers.</p>'
      return
    }
    let html = ''
    for (const [key, blog] of peer_blogs) {
      const profile = await state.api.get_profile(key)
      const display_name = profile ? profile.name : blog.username
      html += `<h2>${escape_html(display_name)}'s Blog (${escape_html(blog.title)})</h2>`
      if (blog.posts.length === 0) {
        html += '<p>No posts from this peer yet.</p>'
      } else {
        for (const post of blog.posts) {
          html += `<div class="post"><h3>${escape_html(post.title)}</h3><p>${escape_html(post.content)}</p><span>Posted by ${escape_html(display_name)} on: ${new Date(post.created).toLocaleString()}</span></div>`
        }
      }
    }
    view_el.innerHTML = html
  }

  async function render_blog () {
    const profile = await state.api.get_profile()
    const display_name = profile ? profile.name : state.username
    view_el.innerHTML = `<h3>${escape_html(display_name)}'s Blog</h3>`
    const posts = await state.api.get_my_posts()
    if (posts.length === 0) {
      view_el.innerHTML += '<p>You have not written any posts yet. Go to New Post to create one.</p>'
      return
    }
    for (const post of posts) {
      const device_info = post.device_name ? ` • ${escape_html(post.device_name)}` : ''
      view_el.innerHTML += `<div class="post"><h4>${escape_html(post.title)}</h4><p>${escape_html(post.content)}</p><small>Posted on: ${format_date(post.created)}${device_info}</small></div>`
    }
  }

  async function render_explore () {
    let html = '<h3>Explore Peers</h3>'
    const discovered = state.api.get_discovered_blogs()
    const subscribed_blogs = await state.api.get_peer_blogs()
    const subscribed_keys = Array.from(subscribed_blogs.keys())
    const my_key = state.api.get_autobase_key()
    if (discovered.size > 0) {
      html += '<h4>Discovered Peers</h4>'
      for (const [key, peer] of discovered) {
        if (key === my_key || subscribed_keys.includes(key)) continue
        const profile = await state.api.get_profile(key)
        const display_name = profile ? profile.name : peer.username
        const title_info = peer.title ? ` (${escape_html(peer.title)})` : ''
        html += `<div><h5>${escape_html(display_name)}'s Blog${title_info}</h5><p><code>${key}</code></p><button class="subscribe-btn" data-key="${key}">Subscribe</button></div><hr>`
      }
    }
    if (subscribed_blogs.size > 0) {
      html += '<h4>Subscribed Peers</h4>'
      for (const [key, blog] of subscribed_blogs) {
        if (key === my_key) continue
        const profile = await state.api.get_profile(key)
        const display_name = profile ? profile.name : blog.username
        html += `<div><h5>${escape_html(display_name)}'s Blog (${escape_html(blog.title)})</h5><p><code>${key}</code></p><button class="unsubscribe-btn" data-key="${key}">Unsubscribe</button></div><hr>`
      }
    }
    if (discovered.size === 0 && subscribed_blogs.size === 0) {
      html += '<p>No peers found yet. Wait for peers to be discovered.</p>'
    }
    view_el.innerHTML = html
  }

  function render_post () {
    view_el.innerHTML = '<h3>Create New Post</h3><input class="post-title" placeholder="Title"><textarea class="post-content" placeholder="Content"></textarea><button class="publish-btn">Publish</button>'
    const publish_btn = view_el.querySelector('.publish-btn')
    publish_btn.addEventListener('click', handle_publish)
  }

  async function render_config () {
    const my_key = state.api.get_autobase_key()
    const profile = await state.api.get_profile()
    const avatar_content = await state.api.get_avatar_content()
    view_el.innerHTML = `<h3>Configuration</h3><div><h4>My Profile</h4><p>Your current profile information:</p><div><p><strong>Name:</strong> ${profile ? escape_html(profile.name) : 'Loading...'}</p><div><strong>Avatar:</strong></div><div>${avatar_content ? (avatar_content.startsWith('data:') ? `<img src="${avatar_content}" style="max-width: 100px; max-height: 100px;">` : avatar_content) : 'Loading...'}</div></div><div><input type="file" class="avatar-upload" accept="image/*"><button class="upload-avatar-btn">Upload Profile Picture</button></div></div><hr><div><h4>My Blog Address</h4><p>Share this address with others so they can subscribe to your blog.</p><input class="blog-address-input" readonly value="${my_key}" size="70"><button class="copy-address-btn">Copy</button></div><hr><div><h4>Manual Subscribe</h4><p>Subscribe to a blog by its address.</p><input class="manual-key-input" placeholder="Blog Address" size="70"><button class="manual-subscribe-btn">Subscribe</button></div>`
  }
}

/***************************************
ACTION HANDLERS
***************************************/

/***************************************
HANDLE PUBLISH
***************************************/
async function handle_publish () {
  const title = document.querySelector('.post-title').value
  const content = document.querySelector('.post-content').value
  if (!title || !content) return alert('Title and content are required.')
  try {
    await state.api.create_post(title, content)
    show_view('blog')
  } catch (err) {
    alert('Publish error: ' + err.message)
  }
}

/***************************************
HANDLE SUBSCRIBE
***************************************/
async function handle_subscribe (key) {
  await state.api.subscribe(key)
  render_view('explore')
}

/***************************************
HANDLE UNSUBSCRIBE
***************************************/
async function handle_unsubscribe (key) {
  await state.api.unsubscribe(key)
  render_view('explore')
}

/***************************************
HANDLE MANUAL SUBSCRIBE
***************************************/
async function handle_manual_subscribe () {
  const key = document.querySelector('.manual-key-input').value.trim()
  if (!key) return alert('Please enter a blog address.')
  const my_key = state.api.get_autobase_key()
  if (key === my_key) return alert("You can't subscribe to yourself.")
  const success = await state.api.subscribe(key)
  if (success) {
    alert('Successfully subscribed!')
    show_view('news')
  } else {
    alert('Failed to subscribe. The key may be invalid or the peer is offline.')
  }
}

/***************************************
HANDLE UPLOAD AVATAR
***************************************/
function handle_upload_avatar () {
  const file_input = document.querySelector('.avatar-upload')
  const file = file_input.files[0]
  if (!file) {
    alert('Please select a file first')
    return
  }
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file')
    return
  }
  const max_file_size = 1024 * 1024 // 1MB limit
  if (file.size > max_file_size) {
    alert(`File too large! Maximum size is 1MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)}MB`)
    return
  }
  const reader = new FileReader()
  reader.onload = async function (e) {
    try {
      const image_data = new Uint8Array(e.target.result)
      await state.api.upload_avatar(image_data, file.name)
      alert('Profile picture uploaded successfully!')
      if (state.current_view === 'config') render_view('config')
    } catch (err) {
      alert('Upload failed: ' + err.message)
    }
  }
  reader.readAsArrayBuffer(file)
}

/***************************************
EVENT LISTENERS
***************************************/

document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => show_view(btn.dataset.view))
})

document.addEventListener('click', handle_global_click)

function handle_global_click (event) {
  const target = event.target
  if (target.classList.contains('subscribe-btn')) handle_subscribe(target.dataset.key)
  if (target.classList.contains('unsubscribe-btn')) handle_unsubscribe(target.dataset.key)
  if (target.classList.contains('copy-address-btn')) {
    const text = document.querySelector('.blog-address-input').value
    if (navigator.clipboard) navigator.clipboard.writeText(text)
    else { const el = document.createElement('textarea'); el.value = text; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el) }
  }
  if (target.classList.contains('manual-subscribe-btn')) handle_manual_subscribe()
  if (target.classList.contains('upload-avatar-btn')) handle_upload_avatar()
}

/***************************************
START APP
***************************************/

if (state.username) {
  init_blog_app()
}
