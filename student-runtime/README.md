# LocalMind Private Study — experimental native app

See [the setup and design boundary](../docs/OFFLINE_STUDY.md).
This is a separate student runtime, not the classroom frontend and not a score-sync app.
It requires a native build, a trusted public key, an approved signed package and an
operator-supplied compatible GGUF. No model, private key or learner database is in Git.

`npm install`, `npm run typecheck`, `npm run test:core`, then `npm run android` or (macOS)
`npm run ios`. Real-device measurements and native acceptance remain mandatory. The
experimental package schema is not a frozen production contract.
