
A p2p news app that uses the hypercore/hyperswarm stack to provide independent, no limit communication.

# Dev Diray
You can check out the dev-diary [here](https://hackmd.io/@mERxC4akTfWgpejBs9V3VQ/Hk-gF47-lg)

Also I have made a demo video which you guys can check that essentially explains this stack and app.
[Video](https://www.youtube.com/watch?v=79pv95Yk8qE)


# Usage

We've added some cool stuff recently:
- **Offline Mode:** If the relay crashes, the app just falls back to cached data.
- **Device Management:** You can now give devices petnames, kick them out safely, and see which ones are dead.
- **Top Bar:** A top bar that shows which profile you're logged in as.

For Web peers there is my deployed [github_page](https://af44n.github.io/p2p-news-app/). The hosted relay it uses by default is down right now (and its url has no `wss://`), so add a running relay in the Relays tab of the system bar and set it as default, or run everything locally like below.

But if you want to try it manually:


Clone the repository:
```git clone https://github.com/af44n/p2p-news-app```

## Install bare

```npm i -g bare```

## Run relay 


e.g: `npm run relay`                                                  
```
> p2p-news-app@0.0.1 relay
> node lib/node_modules/relay/index.js

Relay running on ws://localhost:8080

```


## Run web peer

e.g: `npm run build && npm run web`   

```
[0000] info  Server running at http://192.168.1.10:9966/ (connect)
[0000] info  LiveReload running
[0003] 2752ms     2.3MB (browserify)

```
Now open the webpage, click Seed and enter your name (or Pair with an invite code from your other device), launch the app, have your friends join aswell and when two peers connect, you can subsribe to each other and exchange blogs, fully decentralized. 

**Screenshot**

<img width="623" height="316" alt="image" src="https://github.com/user-attachments/assets/daffc03b-a036-4beb-a3db-6586b151bef2" />



## Run native peer

e.g: `npm run cli` (runs `bare lib/run.js`, its data is kept in the folder you run it in)

```
=== System Authentication ===
1. Seed   (create new account)
2. Pair   (join with invite code)
3. Load   (restore from mnemonic)
4. Reset All Data
```
After Seed (or Pair) you get the system menu (launch app, devices, invite code, vault log, reset). The news app on the cli joins the same topic as the web peers, so you can post, see other peers blogs (web or CLI), subscribe to them and see your profile. The screenshot below is from an older version of the cli.

**Screenshot**

<img width="322" height="151" alt="image" src="https://github.com/user-attachments/assets/ab4b0ce6-f41f-47e2-b63c-59f806552650" />

If you want to see the flow of the code and how everything was made step by step check out the dev diary and for quick go through, check [code_explanation](https://github.com/af44n/p2p-news-app/blob/main/docs/code_explanation.md)


# Protocol Architecture Trust Model

what u can rely on in the vault and in disks, and why. the details are in [docs/autobase.md](docs/autobase.md) (how autobase works) and [docs/disks.md](docs/disks.md) (our disks and pinned links), and every claim there links to a check in `docs/` you can run, the results are in [docs/autobase-checks.md](docs/autobase-checks.md). all of it is on autobase 6.5.13, hypercore 10.38.2 and corestore 6.18.4

## one identity, many devices

your vault (the vault bee and the audit log) and every disk are autobases. each device writes only to its own core, and every device puts all entries in the same order and builds the same views from them. a new device can only write once an existing one adds it, and pairing adds every device as an indexer

<details><summary>eli5</summary>

every device keeps its own diary, and everyone copies all diaries into one shared notebook in the same order. only the devices already in the group can let a new one write in it

</details>

## what makes it final

a view is only final where more than half of the indexers signed it together. no device has a key to write or cut a view alone, so a signed part can never be rewritten, its fork stays 0 ([docs/fork-check.js](docs/fork-check.js)). when the indexers change the views get new keys, but they start with the old data and the hashes of old versions stay the same, only the autobase key stays forever ([docs/view-history-check.js](docs/view-history-check.js))

<details><summary>eli5</summary>

a page in the notebook only counts once most of the group stamped it, and nobody has an eraser for stamped pages. if the group changes, they start a new notebook that begins with a copy of the old pages

</details>

## pinned links

a pack name always means the latest files. a pinned link `dat://<length>.<fork>.<autobase key>.<hash>` means exactly the files at that version, the hash proves it, and it keeps working after the indexers change, on every device ([docs/pin-check.js](docs/pin-check.js)). the file bytes are pinned through the file list, thats from the code, not tested against an indexer that signs something wrong

<details><summary>eli5</summary>

"page 2 of group X's notebook, and page 2 looks exactly like this". if someone shows u a different page 2, it doesnt match

</details>

## what u cant rely on yet

- **the newest entries.** whatever isnt signed yet can still be reordered, a device can even think its an indexer before thats signed ([docs/indexer-offline-check.js](docs/indexer-offline-check.js))
- **2 devices with one gone.** both have to sign, so with one offline nothing new gets final, and even a 3rd device cant be added till it is back. the newest entries can also stay unsigned while both are online ([docs/pin-hang-check.js](docs/pin-hang-check.js))
- **a removed device.** it only wipes its data if it sees its own removal and runs our code. a changed client keeps whatever it already had
- **privacy.** nothing is encrypted yet, anyone who gets the keys can read the vault and the disks
- **who continues a disk.** anyone can make a core that starts with the same data, only the autobase key and its indexers say which one is real. true forks arent supported yet
- **recovery.** what happens when devices are lost for good (mnemonic recovery) isnt defined yet


If you want to learn or collab.. Please dm me on discord. my username is `trulynotafan`


