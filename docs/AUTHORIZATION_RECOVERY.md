# Keeper authorization recovery — source 195, native QA pending

The parent’s read-only 26 October 2026, 21:10:00.847 UTC probe reported all three configured channels live, opted in, stream-matched and bootstrap-ready, with the correct bot validated and moderator in all three rooms. All three stored Keeper access-token validations returned 401. No refresh, lease, grant save, consent or game action was performed by that probe or by the source author. Refresh-token validity remains untested on the actual accounts; successful recovery cannot be promised.

Public receiving/Seeker reads continue to validate without refreshing or saving tokens. Invalid grants hide recipients. Closed, bounded warnings distinguish observation failures from grant rejection without logging tokens, identities, raw provider bodies, errors, cursors or URLs. Bot consent/scopes do not need changing based on the reported probe.

The candidate control page adds **Check / refresh my Keeper authorization**. Only an authenticated matching Keeper session with same-origin JSON POST and valid CSRF can invoke the existing own-Keeper leased validation/refresh/save path. It does not refresh the bot or another Keeper, bootstrap subscriptions, send chat, raid or change game state. Normal GET/Refresh status retains cached readiness and does not perform an extra own-grant validation or renewal. It explicitly reports authorization as not checked; only the explicit POST result reports ready or needs-reconnect. Existing receiving target observations retain their separate fail-closed read-only grant validation. The master read-only flag rejects this POST before provider/grant access, including on the planned new safe preview.

After owner review and any separately authorized canonical release, the owner may explicitly use their own canonical control action. If renewal fails, reconnect the matching account through the app’s existing routes:

- Home: `https://raid-relic-760724762396.us-central1.run.app/oauth/streamer/start`
- OlsOls2: `https://raid-relic-760724762396.us-central1.run.app/oauth/keeper/1591806023/start`
- OlsOls3: `https://raid-relic-760724762396.us-central1.run.app/oauth/keeper/1593561134/start`

These are canonical app state/identity-bound entry routes, not direct provider grant URLs. The read-only preview cannot perform renewal or consent. No actual owner action is claimed by this handoff.

Manual Send Off suggestions now include all configured, authoritative ready/live eligible Keepers, with explicit Seekers first and low viewers/login sorting within each bucket. Fresh stream identity, bot moderation, bootstrap and read-only grant checks remain required; dispatch rechecks authority/moderation/grants and retains the existing fresh raid preflight. Public Atlas Seekers still contains only explicit members. Wander uses its independent Seeker-only membership proof and is not expanded to non-Seekers.

No renderer, growth/demo art, cadence, scopes, dependencies, worker, cron or safety limits change. Wander scheduling remains commented out pending explicit Olly/Grok GO. The new candidate must be master read-only, P7 five OFF, Wander/clip/paid OFF; Seekers may be ON solely for the requested read-only projection. Existing runtime6831e25 performance proof is historical for that renderer; no new live recovery or physical raid validation is claimed. Parent native regression, browser checks and zero-preview publication remain pending.
