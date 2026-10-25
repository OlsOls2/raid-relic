# Raid Relic authoring rules

Codex is the sole code author. All code and documentation changes must be authored in the original thread recorded in CODEX_SESSION.md. Always resume that thread; never create or fork a thread or delegate to other agents. Work only in this repository.

Do not read auth files or credentials. No deployments, live Twitch or Devpost calls, GCP operations, IAM changes, billing linkage, or costs from Codex. Operator-verified setup for `raid-relic-hackathon`: billing linked to Firebase Payment GBP; project-specific £1 GBP monthly budget with 50/90/100 percent actual-spend alerts and default IAM email enabled; default native Standard Firestore in `us-central1`, freeTier=true, PITR disabled; run/firestore/secretmanager and billing control APIs enabled. No Cloud Run service is deployed and no client secret is present. These are facts reported as verified by the operator, not cloud state independently inspected by Codex. Do not commit until parent review.

Use Node.js 22+, node:test, Cloud Run scale-to-zero and Firestore for production. Do not substitute Cloudflare. Keep increments bounded; OAuth, encrypted tokens, bot chat and Firestore are the authorized local next increment. Mock all HTTP and cloud tests; memory is tests/dev only. Never commit secrets, local env files, or raw rollout backups.

A local 90-second ritual begins after a verified raid EventSub notification. Never claim Twitch synchronization. Future claims require participation from both incoming raiders and host chat. Run all tests after changes; do not start the application server without authorization.
