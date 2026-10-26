# Setup and permission reasons

Only owner-configured Keepers can participate. The owner configures the two channel IDs and exact callback/origin allowlists. Each broadcaster opens their private Keeper setup in their own browser, grants the Keeper permissions, then explicitly bootstraps and opts in. The bot uses its own browser/account consent; it cannot authorize Keeper controls. Never share a redirected authorization URL or credentials. Private session links are not judge credentials.

| Role | Scope | Why |
|---|---|---|
| Keeper default | `channel:bot` | Permit the approved bot in that broadcaster's channel |
| Keeper default | `channel:manage:raids` | Start the explicitly requested native raid |
| Bot default | `user:read:chat` | Receive signed managed chat commands |
| Bot default | `user:write:chat` | Send bounded command/completion replies |
| Bot default | `user:bot` | Bot identity/grant authorization for app-token operations |
| Bot optional | `moderator:manage:announcements` | Source-only completion announcement |
| Bot optional | `moderator:manage:chat_messages` | Pin the already-sent target completion message |
| Bot optional | `moderator:manage:shoutouts` | Shout out the outgoing configured Keeper |
| Bot optional | `user:read:moderated_channels` | Prove moderator membership in both configured rooms |
| Future bot only | `clips:edit` | USER-token clip creation, not APP-token creation; not requested now |

Ordinary bot consent requests only its three baseline scopes. Optional actions require four additional explicit bot permissions (seven total), bot moderator status in both rooms and separate operator flags. Consent does not switch those flags. Pin replacement requires explicit operator acknowledgement, with a bounded 300-second default. Existing grants are preserved on cancelled/wrong-account consent.

Future clips would preserve the seven existing scopes and add one (eight total), only with explicit approval. Clips are currently design-only, double-disabled and not runtime-wired. A 202 is acceptance, not proof of a created clip; confirmation and matching completed-stop attachment are required. Public edit URLs must never be exposed.
