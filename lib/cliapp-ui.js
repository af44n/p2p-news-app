// CLI app UI — p2p-news-app content only

const process = require('bare-process')
const blog_app = require('p2p-news-app')

const uservault = vault
const username = uservault.username

/* check the state so if we switch to the system menu and come back,
it doesn't try to load everything from scratch again */

if (!vault.app_state.api) {
  vault.app_state.api = blog_app(uservault)
}
const api = vault.app_state.api

if (!vault.app_state.initialized) {
  await init_app()
  vault.app_state.initialized = true
}

await run_app_menu()

/***************************************
INIT
***************************************/
async function init_app () {
  try {
    console.log('Initializing blog...')
    await api.init_blog({ username })
    
    api.on_update(function () {
      console.log('\n[update] New content available.')
    })
    
    console.log('Blog ready.')
  } catch (err) {
    console.error('Failed to initialize blog:', err.message)
    process.exit(1)
  }
}

/***************************************
APP MENU
***************************************/
async function run_app_menu () {
  while (true) {
    console.log('\n=== P2P News App ===')
    console.log('1. New Post')
    console.log('2. View Posts')
    console.log('3. Subscriptions')
    console.log('4. My Profile')
    console.log('5. Config (blog address)')
    console.log('6. Exit App to System Menu')
    console.log('\nChoice: ')
    const choice = await read_line()
    if (choice === '1') await create_post_flow()
    else if (choice === '2') await view_posts()
    else if (choice === '3') await manage_subscriptions()
    else if (choice === '4') await view_profile()
    else if (choice === '5') await view_config()
    else if (choice === '6') { console.log('Exiting app...'); return }
    else console.log('Invalid choice.')
  }
}

/***************************************
NEW POST
***************************************/
async function create_post_flow () {
  console.log('\n=== New Post ===')
  console.log('Title: ')
  const title = await read_line()
  if (!title) { console.log('Cancelled.'); return }
  console.log('Content: ')
  const content = await read_line()
  if (!content) { console.log('Cancelled.'); return }
  await api.create_post(title, content)
  console.log('\nPost published.')
}

/***************************************
VIEW POSTS
***************************************/
async function view_posts () {
  console.log('\n=== All Posts ===')
  // Show my posts first
  const my_posts = await api.get_my_posts()
  const my_username = await api.get_blog_username() || username
  if (my_posts.length > 0) {
    console.log('\n--- ' + my_username + ' (You) ---')
    my_posts.forEach(function (post) {
      console.log('\n  ' + post.title)
      if (post.device_name) console.log('  Device: ' + post.device_name)
      console.log('  ' + post.content)
      console.log('  ' + new Date(post.created).toLocaleString())
    })
  }
  // Show subscribed peers' posts
  const subscribed = await api.get_peer_blogs()
  let has_peer_posts = false
  for (const [, blog] of subscribed) {
    if (!blog.posts?.length) continue
    has_peer_posts = true
    console.log('\n--- ' + blog.username + ' ---')
    blog.posts.forEach(function (post) {
      console.log('\n  ' + post.title)
      console.log('  ' + post.content)
      console.log('  ' + new Date(post.created).toLocaleString())
    })
  }
  if (!my_posts.length && !has_peer_posts) console.log('No posts yet.')
}

/***************************************
SUBSCRIPTIONS
***************************************/
async function manage_subscriptions () {
  const discovered = api.get_discovered_blogs()
  const subscribed = await api.get_peer_blogs()
  const my_key = api.get_autobase_key()
  const all_peers = []
  let idx = 1
  console.log('\n=== Subscriptions ===')
  if (subscribed.size > 0) {
    console.log('\nSubscribed:')
    for (const [key, blog] of subscribed) {
      console.log('  ' + idx + '. ' + blog.username + ' [' + key + '] [subscribed]')
      all_peers.push({ key, username: blog.username, subscribed: true })
      idx++
    }
  }
  const unsubbed = []
  for (const [key, data] of discovered) {
    if (!subscribed.has(key) && key !== my_key) unsubbed.push({ key, username: data.username || 'Unknown' })
  }
  if (unsubbed.length > 0) {
    console.log('\nDiscovered:')
    for (const peer of unsubbed) {
      console.log('  ' + idx + '. ' + peer.username + ' [' + peer.key + ']')
      all_peers.push({ key: peer.key, username: peer.username, subscribed: false })
      idx++
    }
  }
  if (!all_peers.length) { console.log('No peers found yet.'); return }
  console.log('\nEnter number to subscribe/unsubscribe, 0 to go back: ')
  const choice = await read_line()
  const num = parseInt(choice.trim()) - 1
  if (num < 0 || num >= all_peers.length) return
  const peer = all_peers[num]
  if (peer.subscribed) {
    await api.unsubscribe(peer.key)
    console.log('Unsubscribed from ' + peer.username)
  } else {
    console.log('Subscribing to ' + peer.username + '...')
    const ok = await api.subscribe(peer.key)
    console.log(ok ? 'Subscribed!' : 'Failed to subscribe.')
  }
}

/***************************************
PROFILE
***************************************/
async function view_profile () {
  const profile = await api.get_profile()
  const key = api.get_autobase_key()
  console.log('\n=== My Profile ===')
  console.log('Name:     ' + (profile?.name || username))
  console.log('Blog key: ' + (key || 'N/A'))
  console.log('Local key: ' + (api.get_local_key() || 'N/A'))
}

/***************************************
CONFIG
***************************************/
async function view_config () {
  const key = api.get_autobase_key()
  console.log('\n=== Blog Address ===')
  console.log('Share this with others to let them subscribe to your blog:')
  console.log('\n' + key + '\n')
  console.log('Press Enter to continue: ')
  await read_line()
}

/***************************************
GENERAL HELPERS
***************************************/
function read_line () {
  return new Promise(collect_input)
  function collect_input (resolve) {
    const chunks = []
    process.stdin.on('data', on_data)
    function on_data (chunk) {
      chunks.push(chunk)
      if (chunk.includes('\n')) {
        process.stdin.removeAllListeners('data')
        resolve(Buffer.concat(chunks).toString().trim())
      }
    }
  }
}
