# P2P System Glossary

This document explains the main terms and concepts used across the p2p architecture so everyone has the same understanding of how things work.

## Identity & People

* **User**: A person using the system. Technically, a user is defined by their **root identity seed phrase**.
* **Peer**: Another person (or external user) on the network. From your perspective, anyone not sharing your root seed phrase is a peer.

## Devices & Environments

* **Device (Real Device)**: A physical device or separate digital environment used by a user (like a laptop, phone, or even a completely different browser).
* **Virtual Device**: A simulated device running inside a browser tab (usually using sandboxed iframes). It behaves like a real device cryptographically, with its own keys, and is useful for testing, simulating users, or running sandboxed desktop-like environments.
* **Bare/CLI Peer**: A node running in a terminal using the Bare runtime (or Node.js). It integrates with the same core data layer, Vault system, and Datashell concepts, offering a terminal-based interface (`clisys-ui.js` and `cliapp-ui.js`) without a graphical browser environment.

## Apps & Data Contexts

* **Data-Pod**: An isolated data space that lets you run the same app multiple times with completely separate data.
* **User Profile**: A special type of data-pod used in social or identity-focused apps (like `p2p-news-app`). Utility apps (like calculators) usually use the term "data-pod" instead since there's no real concept of a profile.
* **App**: Any application installed and running on a device or virtual device (for example `p2p-news-app`).
* **Background App**: An app running full-screen in the background inside devkit.
* **Vault App (or System-UI)**: The identity and data management app. Similar to a crypto wallet, except it manages identities, devices, and data instead of coins.
* **Datashell**: The frontend framework/shell used for building modular VanillaJS apps. It connects frontend UI components to the peer-to-peer data layer.
* **Devkit**: A tiling window manager environment that runs multiple apps, handles split screens, and shows active profiles through Vault integration.

## Vaults & Storage

* **Root Vault**: The main vault-ui that manages the primary identity. It has access to the root seed phrase and handles syncing/replication across paired devices.
* **Sub Vault (or App Vault)**: A smaller, restricted vault-ui used by apps, virtual devices, or data-pods. It only exposes the part of the data tree relevant to that context so apps don't get unrestricted access to everything.

## Networking & Lifecycle

* **Pairing**: Connecting a new device (real or virtual) to an existing identity so multiple devices can share the same data and behave as the same user.
* **Pairing Code**: A code used when connecting your own devices together (for example laptop ↔ phone). This is only for your own devices, not for inviting other users.
* **Background Sync**: The root vault automatically opens and replicates data structures for data-pods in the background across paired devices. This keeps syncing fast without exposing presence to external peers.
* **Relay Server**: A server that helps browsers connect with each other since browsers don't support true direct peer-to-peer connections. Can run locally or in the cloud.
