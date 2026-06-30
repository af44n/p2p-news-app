# P2P News App – UI Documentation

Welcome! This doc explains the user interfaces (UI) of the P2P News App for both the **Web** and **CLI** versions.

---

# Web UI

## Login & Join
<img width="507" height="282" alt="image" src="https://github.com/user-attachments/assets/fd0f0562-ea38-450b-8768-4168a938a4b0" />

- Enter your username and click **Join** to connect to the P2P network.

<details>
  <summary>Click to see the UI code</summary>

  - The UI is rendered from this code:
  ```js
  // web/page.js
  document.body.innerHTML = `
    <div id="app">
      <div id="login" style="display: ${username ? 'none' : 'block'}">
        <h3>P2P Blog</h3>
        <input id="username" value="${username}" placeholder="Your Name">
        <button id="join_btn">Join</button>
      </div>
      <div id="main" style="display: ${username ? 'block' : 'none'}">
        ...
      </div>
    </div>
  `
  ```
  - When you click **Join**, the following happens:
  ```js
  // web/page.js
  async function join_network () {
    const user = document.getElementById('username').value.trim() || username
    if (!user) return alert('Enter your name')
    localStorage.setItem('username', user)
    username = user
    document.getElementById('login').style.display = 'none'
    document.getElementById('main').style.display = 'block'
    document.getElementById('connection_status').textContent = 'Connecting...'
    connection_status = 'connecting'
    const result = await start_browser_peer({ name: username })
    store = result.store
    blog_core = result.blog_core
    await blog_helper.init_blog(store, username)
    connection_status = 'connected'
    document.getElementById('connection_status').textContent = `Connected as ${username}`
    // ... more event listeners and view setup
  }
  ```
</details>

- **What happens in code:**
  - Your username is saved to `localStorage`.
  - The app connects to the P2P network (`start_browser_peer`).
  - Your blog data is initialized and ready for use.
  - The UI switches to the main dashboard.

## Main Dashboard
<img width="495" height="275" alt="image" src="https://github.com/user-attachments/assets/cf794f6a-b0bf-4931-a2f4-9ab043c99e1c" />

- The dashboard is shown after joining:

<details>
  <summary>Click to see the UI code</summary>

  ```js
  // web/page.js
  <div id="main" style="display: ${username ? 'block' : 'none'}">
    <div>Status: <span id="connection_status">Disconnected</span></div>
    <nav>
      <button data-view="news">News</button>
      <button data-view="blog">Blog</button>
      <button data-view="explore">Explore</button>
      <button data-view="post">Post</button>
      <button data-view="config">Config</button>
    </nav>
    <div id="view"></div>
  </div>
  ```
  - The nav bar lets you switch between all main features. The status bar updates live:
  ```js
  // web/page.js
  document.getElementById('connection_status').textContent = `Connected as ${username}`
  ```
</details>

- **What happens in code:**
  - Clicking a nav button calls `show_view(name)`, which updates the highlighted button and triggers `render_view(name)`.
  - The current view is rendered inside `<div id="view"></div>`.

## News Feed
<img width="623" height="316" alt="image" src="https://github.com/user-attachments/assets/daffc03b-a036-4beb-a3db-6586b151bef2" />

- The news feed shows all posts from your subscriptions, newest first.

<details>
  <summary>Click to see the UI code</summary>

  - Code that fetches and renders posts:
  ```js
  // web/page.js
      const peer_blogs = await blog_helper.get_peer_blogs()
      const posts = Array.from(peer_blogs.entries()).flatMap(([key, peer]) => 
        (peer.posts || []).map(p => ({ ...p, peer_key: key, peer_name: peer.username || 'Unknown' }))
      ).sort((a, b) => b.created - a.created)
       return `
        <h3>News Feed (${posts.length} posts)</h3>
        ${posts.map(p => `
          <div>
            <h4>${p.title}</h4>
            <small>${p.peer_name} - ${format_date(p.created)}</small>
            <p>${p.content}</p>
            <hr>
          </div>
        `).join('') || '<p>No posts yet</p>'}
      `
    },
  ```
  - Each post is rendered as:
  ```js
  // web/page.js
  <div>
    <h4>${p.title}</h4>
    <small>${p.is_own ? 'You' : p.peer_name} - ${format_date(p.created)}</small>
    <p>${p.content}</p>
    <hr>
  </div>
  ```
</details>

- **What happens in code:**
  - `blog_helper.get_my_posts()` gets your posts from your local blog feed.
  - `blog_helper.get_peer_blogs()` fetches posts from all blogs you're subscribed to.
  - All posts are combined and sorted by date.
  - The UI is updated in real time whenever new posts arrive (via event listeners on the store and blog_helper).

<details>
  <summary>Click to see how peer blogs and posts are loaded</summary>

  - Peer blog and post loading logic in `blog-helpers/index.js`:
  ```js
  // get all blogs you are subscribed to, with metadata and posts
  async function get_peer_blogs() {
    const blogs = new Map(), subscribed_keys = [], peer_metadata = new Map()
    for (let i = 1; i < blog_core.length; i++) {
      try {
        const entry = JSON.parse(b4a.toString(await blog_core.get(i)))
        if (entry.type === 'peer-blog-init') {
          subscribed_keys.push(entry.peer_key)
          peer_metadata.set(entry.peer_key, {
            username: entry.username, title: entry.title, drive_key: entry.drive_key, subscribed_at: entry.subscribed_at
          })
        }
        if (entry.type === 'peer-blog-unsubscribe') {
          // ...unsubscribe logic
        }
      } catch {}
    }
    for (const key of subscribed_keys) {
      const posts = []
      // ...load peer posts
      for (let i = 1; i < blog_core.length; i++) {
        try {
          const entry = JSON.parse(b4a.toString(await blog_core.get(i)))
          if (entry.type === 'peer-blog-post' && entry.peer_key === key) {
            const content = await drive.get(entry.filepath)
            if (content) posts.push({ title: entry.title, content: b4a.toString(content), created: entry.created })
          }
        } catch {}
      }
      const metadata = peer_metadata.get(key) || {}
      blogs.set(key, { key, posts, username: metadata.username, title: metadata.title, drive_key: metadata.drive_key, subscribed_at: metadata.subscribed_at })
    }
    return blogs
  }
  ```
  - This looks up all peer subscriptions, loads their posts, and attaches metadata for rendering.
</details>

- **Behind the scenes:**
  ```js
  // web/page.js
  const my_posts = await blog_helper.get_my_posts()
  const peer_blogs = await blog_helper.get_peer_blogs()
  // Posts are combined and sorted for display
  ```

## My Blog
<img width="414" height="221" alt="image" src="https://github.com/user-attachments/assets/37a8f336-759b-4801-8adc-4a7a6eaf1e51" />

- Displays only your posts.
- Posts are stored locally and published to the network.

<details>
  <summary>Click to see how your posts are loaded</summary>

  - Posts are loaded using:
  ```js
  // get your own posts
  async function get_my_posts() {
    const posts = []
    for (let i = 1; i < blog_core.length; i++) {
      try {
        const entry = JSON.parse(b4a.toString(await blog_core.get(i)))
        if (entry.type === 'blog-post') {
          const content = await drive.get(entry.filepath)
          if (content) posts.push({ ...entry, content: b4a.toString(content) })
        }
      } catch {}
    }
    return posts
  }
  ```
  - This iterates through your blog feed, loading both the metadata and actual post content from Hyperdrive.
</details>

## Explore Blogs
<img width="364" height="168" alt="image" src="https://github.com/user-attachments/assets/a6cc488a-91df-4f6d-aeef-683797c9e602" />

- Discover other blogs on the network.
- **Subscribe/Unsubscribe** buttons for each peer.
- **Behind the scenes:**
  ```js
  // web/page.js
  const discovered = await blog_helper.get_discovered_blogs()
  const subscribed = await blog_helper.get_peer_blogs()
  // Render subscribe/unsubscribe buttons
  ```
<details>
  <summary>Click to see how the backend subscribes you to a peer (blog-helper)</summary>

  The actual subscription logic is in `blog-helpers/index.js`:
  ```js
  // subscribe to a peer's blog
  async function subscribe(key) {
    try {
      // 1. Get the peer's blog core (feed)
      const peer_core = store.get(b4a.from(key, 'hex'))
      await peer_core.ready()
      if (peer_core.length === 0) return false
      // 2. Read metadata about the peer's blog
      const data = JSON.parse(b4a.toString(await peer_core.get(0)))
      if (!data.drive_key || data.type !== 'blog-init') return false
      // 3. Download the peer's feed and drive (all posts)
      peer_core.download({ start: 0, end: -1 })
      const peer_drive = new Hyperdrive(store, b4a.from(data.drive_key, 'hex'))
      await peer_drive.ready(); peer_drive.download('/')
      // 4. Wait for sync
      await new Promise(resolve => {
        const check = () => (peer_core.downloaded || peer_core.length > 0) ? setTimeout(resolve, 1000) : setTimeout(check, 100)
        check()
      })
      // 5. Copy all posts from the peer into your local drive/feed
      let posts_found = 0, posts_downloaded = 0
      for (let i = 1; i < peer_core.length; i++) {
        try {
          const post = JSON.parse(b4a.toString(await peer_core.get(i)))
          if (post.type === 'blog-post') {
            posts_found++
            const post_id = `${key}:${post.title}:${post.created}`
            if (!(await has_peer_post(post_id))) {
              const content = await peer_drive.get(post.filepath)
              if (content) {
                const our_path = `/peer_posts/${key}/${post.filepath.split('/').pop()}`
                await drive.put(our_path, content)
                await blog_core.append(JSON.stringify({
                  type: 'peer-blog-post', peer_key: key, title: post.title, filepath: our_path, created: post.created, post_id
                }))
              }
            }
          }
        } catch {}
      }
      // 6. Mark the subscription in your feed
      await blog_core.append(JSON.stringify({
        type: 'peer-blog-init', peer_key: key, username: data.username, title: data.title, drive_key: data.drive_key, subscribed_at: Date.now()
      }))
      // 7. Listen for new posts from the peer (real-time updates)
      peer_core.on('append', async () => {
        try {
          const latest_post = JSON.parse(b4a.toString(await peer_core.get(peer_core.length - 1)))
          if (latest_post.type === 'blog-post') {
            const post_id = `${key}:${latest_post.title}:${latest_post.created}`
            if (!(await has_peer_post(post_id))) {
              const content = await peer_drive.get(latest_post.filepath)
              if (content) {
                const our_path = `/peer_posts/${key}/${latest_post.filepath.split('/').pop()}`
                await drive.put(our_path, content)
                await blog_core.append(JSON.stringify({
                  type: 'peer-blog-post', peer_key: key, title: latest_post.title, filepath: our_path, created: latest_post.created, post_id
                }))
              }
            }
          }
        } catch {}
      })
      // 8. Save the subscription locally and notify UI
      add_local_subscribed_peer(key)
      emitter.emit('update')
      return true
    } catch (err) { console.log('Subscribe error:', err); return false }
  }
  ```
  **Step-by-step explanation:**
  1. Gets the peer's blog feed and waits for it to be ready.
  2. Checks that the peer's blog is valid and gets drive key.
  3. Downloads all posts and blog files from the peer.
  4. Waits for sync to finish.
  5. Copies each post into your own local drive/feed if you don't already have it.
  6. Marks the subscription in your feed for future reference.
  7. Sets up a listener for new posts so you get updates in real time.
  8. Saves the subscription locally and emits an update so the UI/CLI refreshes.
</details>

## Create Post
<img width="436" height="269" alt="image" src="https://github.com/user-attachments/assets/20e525da-bbdc-45ed-bf55-5a261925ab78" />

- Simple form for title and content.

<details>
  <summary>Click to see the UI code</summary>

  - Publishing triggers:
  ```js
  // web/page.js
  window.publish = async () => {
    const title = document.getElementById('post_title').value.trim()
    const content = document.getElementById('post_content').value.trim()
    if (!title || !content) return alert('Enter title and content')
    if (await blog_helper.create_post(title, content)) {
      document.getElementById('post_title').value = ''
      document.getElementById('post_content').value = ''
      show_view('blog')
    }
  }
  ```
</details>

<details>
  <summary>Click to see how posts are created and stored</summary>

  - The actual post creation and storage happens in `blog-helpers/index.js`:
  ```js
  // create a new post in your own blog
  async function create_post(title, content) {
    try {
      const path = `/posts/${Date.now()}.md`
      await drive.put(path, b4a.from(content))
      await blog_core.append(JSON.stringify({
        type: 'blog-post', title, filepath: path, created: Date.now()
      }))
      emitter.emit('update')
      return true
    } catch { return false }
  }
  ```
  - This writes the post content to your Hyperdrive and appends metadata to your personal blog feed (`blog_core`).
  - The `emitter.emit('update')` notifies the UI to refresh.
</details>

## Config & Reset
<img width="446" height="363" alt="image" src="https://github.com/user-attachments/assets/6f0fdd47-f0ff-4c1e-9b76-8d00a7067f4c" />

- Shows your username and connection status.
- **Device Management:** You can assign petnames to devices, check their "liveness" (to see if they are dead/inactive), and safely remove them (it'll ask for confirmation first!).
- **Reset All Data** button wipes your local data and reloads the app.

<details>
  <summary>Click to see the UI code</summary>

  - **Behind the scenes:**
  ```js
  // web/page.js
  window.reset_all_data = async () => {
    ...
    localStorage.clear()
    // Clear IndexedDB, files, and reload
    ...
  }
  ```
</details>

## Persistent Top Bar
- We added a sticky top bar across all views so you always know exactly which identity and device you're currently using. Super helpful for multi-tab setups!

---

# CLI UI (Bare/Node)

The CLI interface is now divided into two separate layers to match the Vault/App architecture of the system:
1. **System UI (`lib/clisys-ui.js`)**: Manages identity, authentication, device pairing, and app selection.
2. **App UI (`lib/cliapp-ui.js`)**: Runs the actual P2P News App (creating posts, viewing feeds, subscribing).

## System UI (`clisys-ui.js`)

### Auth Menu
When starting fresh, the system prompts you to create a new identity (Seed) or join an existing one (Pair).

- **Seed**: Creates a new identity and automatically creates a default app profile (e.g., `username:p2p-news-app`).
- **Pair**: Prompts for an invite code generated by another device, allowing you to link devices together.

<details>
  <summary>Click to see the UI code</summary>

  ```js
  // lib/clisys-ui.js
  console.log('1. Seed   (create new account)')
  console.log('2. Pair   (join with invite code)')
  ...
  vault.authenticate({ username }) // for seed
  vault.authenticate({ username: 'pairing-user', invite_code }) // for pair
  ```
</details>

### System Menu
Once logged in, the system menu allows you to manage your identity before launching the app.

- **Launch App**: Boots the selected data-pod/profile using `cliapp-ui.js`.
- **Devices**: Lists all devices paired to your identity. Allows renaming or removing devices (removing revokes their write access).
- **Create Invite Code**: Generates a base64 invite code to add a new device to your identity. Shows a 6-digit PIN for verification.
- **Vault Log**: Displays the cryptographically verifiable audit log of actions taken by devices in your identity.

<details>
  <summary>Click to see the UI code</summary>

  ```js
  // lib/clisys-ui.js
  console.log('1. Launch App')
  console.log('2. Devices')
  console.log('3. Create Invite Code')
  console.log('4. Vault Log')
  ...
  const devices = await vault.get_paired_devices()
  const result = await vault.create_vault_invite()
  const audit_entries = await vault.get_vault_audit().read()
  ```
</details>

## App UI (`cliapp-ui.js`)

Once you launch the app, `cliapp-ui.js` takes over, initializing the `p2p-news-app` logic using the `Datashell` API.

### App Menu
- **New Post**: Prompts for a title and content, and appends it to your Autobase structure.
- **View Posts**: Shows your posts and posts from peers you are subscribed to.
- **Subscriptions**: Lists discovered peers and allows you to subscribe or unsubscribe from their blogs.
- **My Profile**: Shows your local and global keys.
- **Config**: Shows your blog's raw public key for manual sharing.

<details>
  <summary>Click to see the UI code</summary>

  ```js
  // lib/cliapp-ui.js
  console.log('1. New Post')
  console.log('2. View Posts')
  console.log('3. Subscriptions')
  ...
  await api.create_post(title, content)
  const my_posts = await api.get_my_posts()
  const subscribed = await api.get_peer_blogs()
  await api.subscribe(peer.key)
  ```
</details>

