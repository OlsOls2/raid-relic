# Privacy

Public pages expose configured Keeper names, retained completed stops and approved mark projections. They do not expose pending text, viewer IDs or a general account index. Chat presence is not verified raid membership.

Scores require explicit `!relic scores on` consent for future observed completions. Reading scores or marking does not opt anyone in. `!relic scores off` withdraws the score entry. `!relic forgetme` erases retained application marks, shared links and score associations, not Twitch-wide data. Existing minimal quota/cooldown identifiers remain until session closure/expiry so erasure does not refund abuse budgets.

Moderator veto removes the latest retained approved or pending mark. Revocation also invalidates retained public associations. A saved PNG or copied public link cannot be recalled from someone else's device. Pending/removed mark text is not searchable or exportable. The browser demo uses fixed fictional names and memory only; no network, cookies or persistent storage writes.

## Optional Seeker pilot and Keeper cards

A configured broadcaster explicitly joins/leaves the public Seeker queue; this is
separate from marks and score consent. Only channel identities and current reported
viewer counts are listed, never chatter identities. Keeper pages use retained completed
stops and approved glyphs; erasure/veto/opt-out flow through existing archive projections.
Each orientation-specific card freshly checks the public exact stop before exporting.
Previously saved downloads cannot be recalled. Twitch-reported raid audience is not
retention, conversion, unique chatters or proof of individual raid membership.

## Explicit non-raid Wander consent

The optional idle policy may select only explicitly joined eligible Seekers within the
configured network. A transfer records channel identities, time, typed growth and
approved retained origin references; it records no audience/raid participation and
creates no new viewer index. Original mark erasure/veto/block/opt-out invalidates derived
content through those references. Offline ownership does not fabricate a stream or
permit marks. The warning and arrival messages are fixed, bounded and at-most-once;
provider acceptance does not prove human visibility. Public requests cannot sign ticks
or choose a recipient. See [Wander policy](WANDER.md) before operator activation.
