# Meteor connector

Source: https://github.com/Meteor-Wallet/meteor_wallet_sdk/blob/6369ad789d2f3aaf8e6ccb065021723111027174/storage/meteor-near-connect-latest.js

Upstream SHA-256: `e1795611500188077a6eadd5597b03b840f6d530f5e2904b621b378f8e007c73`. MIT license in LICENSE-meteor.txt.

Local changes: removed four remote font links from the popup head and 5 embedded font declarations (use system font fallbacks) and replaced the loader URL with the self-hosted asset. Wallet and signing code is unchanged. The loader comes from https://meteorwallet.app/loader.gif (SHA-256 `0d3aaccd3af6267aec6d85fdf24969a41e42b4528b5be888b8c435e3cf2371d0`).
