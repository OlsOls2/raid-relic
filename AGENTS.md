# Raid Relic authoring rules

Codex is the sole code author. All code and documentation changes must be authored in the original thread recorded in CODEX_SESSION.md. Always resume that thread; never create or fork a thread or delegate to other agents. Work only in this repository.

Do not read auth files or credentials. No deployments, live Twitch or Devpost calls, GCP changes, billing linkage, or costs. Project `raid-relic-hackathon` has billing intentionally disabled; deployment is blocked pending its owner.

Use Node.js 22+, node:test, Cloud Run scale-to-zero and a later Firestore adapter. Do not substitute Cloudflare. Keep increments bounded; OAuth and chat bot integration are later work. Never commit secrets, local env files, or raw rollout backups.

A local 90-second ritual begins after a verified raid EventSub notification. Never claim Twitch synchronization. Future claims require participation from both incoming raiders and host chat. Run all tests after changes; do not start the application server without authorization.
