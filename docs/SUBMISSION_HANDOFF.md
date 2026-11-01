# Raid Relic submission handoff · PRIVATE / NOT SUBMITTED · 1 November 2026

Only the owner-approved final submission may be published. This is a checklist, not an executed action. Original integration lead remains **01a1705c-a87d-7143-80f6-021e47b78ced**. The read-only rules/repository and media-inventory assistants are reviewers, not new application authors. Parent owns QA, Git/CI and authorised operations.

## Verified rules and timing

Parent rules research completed 1 November 07:21–07:24 UTC, using the [Official Rules](https://twitchcon-codex.devpost.com/rules), event home and official GitHub documentation. Official Rules prevail over website/form discrepancies; owner should recheck for changes before submission.

- **Submission deadline:** Monday 2 November 2026, **22:00 UTC / 22:00 UK (14:00 PST)**. Pacific daylight saving ends 1 November; do not use PDT for this conversion.
- **Owner target:** Sunday 1 November 2026, **20:00 UK**.
- **Availability:** keep the working project and repository free and unrestricted for judges through **16 November 2026, 01:00 UTC**, the judging end. Do not shorten this to midnight.
- **Video:** a **Public YouTube** link, **under 3 minutes**, showing the project functioning on Twitch **AND footage of Codex building**. Text session cards or a source slate alone do not meet the build-footage requirement. Private is not compliant; Unlisted is not expressly approved. Safest edit target is 2:45–2:59.
- **Repository:** source, assets and run instructions must be accessible. Private repositories must be GitHub/GitLab and shared with **testing@devpost.com**; the public website alone is insufficient.
- **Criteria:** four **equally weighted** criteria: **Innovation/Idea**, **Potential Impact**, **Technological implementation**, **Design**. Stage One is theme/tool-use pass/fail; no score is claimed here.
- **Owner declarations:** eligible individual/individual team, not an organisation entrant; age at least18 or local majority if older; residency/conflict exclusions, rights, permissions and build-period compliance must be affirmed by the owner. No invented team-size cap or personal eligibility verification. English materials/translations are required.

The exact logged-in form fields, account status and final submission confirmation remain unverified. Official rules do not require publishing raw transcripts; retain the project's privacy/evidence boundaries.

## Current blockers and media status

- **Repository admission: PENDING owner approval and accepted-access verification.** Parent read-only research found a private personal repository, default main and no pending invitations at that inspection. This does not identify the account behind testing@devpost.com or prove access.
- **Media inventory/video: PENDING and incomplete.** The footage worker timed out. Required genuine Twitch and Codex-building footage has not been verified.
- Parent verified the local private owner-review file `/home/ubuntu/.openclaw/workspace/.openclaw/tmp/raid-relic-final-submission/raid-relic-owner-review-INCOMPLETE.mp4`: **165 seconds, 1920×1080, H264/AAC, silent slideshow** of actual public retained-state screenshots plus an honest missing-footage slate. It is **NOT submission-ready**, not functioning-on-Twitch proof and not Codex-build proof. This author did not open the media file. No Public YouTube URL exists in this handoff.
- **Publication/submission approval: PENDING.** Do not start fresh public Twitch streams, raid/chat or new recording actions without explicit owner approval resolving standing constraints. No fabricated footage or invented video URL. Preparing fields or saving a draft is not actual submission.

## Owner-only repository access choices · NOT executed

Repository: https://github.com/OlsOls2/raid-relic. Final source ref: **feature/raid-relic-p9-stretch**, [direct branch link](https://github.com/OlsOls2/raid-relic/tree/feature/raid-relic-p9-stretch). Make this ref discoverable in the submission/run instructions; do **not** merge it or change default branch main. Repository access remains unresolved until the approved method works.

Any collaborator invitation or public-visibility change needs explicit owner OK. **A private personal-repository collaborator has write-capable access**; `permission=pull` is not a supported read-only workaround for this repository. No invitation or visibility change is authorised by this document.

**Email UI route, after owner approval of write-capable access:** open https://github.com/OlsOls2/raid-relic/settings/access → Collaborators → Add people; search **testing@devpost.com**. Review the resolved identity/email before confirming. If ambiguous or unresolved, stop. An invitation must be accepted before access is effective.

**CLI route, only after a verified GitHub username is supplied and owner approval obtained:** the placeholder below must be replaced with that verified handle, never the email address or a guessed username. `gh api` has no documented email-invitation equivalent for this endpoint.

```bash
# Read-only identity check; does not establish ownership of the email by itself.
gh api users/VERIFIED_DEVPOST_GITHUB_USERNAME --jq '{login,id,html_url}'
# OWNER-APPROVAL-ONLY mutation. Sends an invitation/notification; not executed.
gh api --method PUT repos/OlsOls2/raid-relic/collaborators/VERIFIED_DEVPOST_GITHUB_USERNAME
# Read-only status checks after the approved action.
gh api repos/OlsOls2/raid-relic/invitations --jq '[.[] | {id,login:.invitee.login,permissions}]'
gh api --include repos/OlsOls2/raid-relic/collaborators/VERIFIED_DEVPOST_GITHUB_USERNAME
```

Do not guess that an email address is a GitHub username. PUT201 means invitation created, not accepted access. A collaborator GET204 confirms collaborator status;404 does not prove access. Pending invitation alone is insufficient. Public visibility is another owner decision requiring a full publication/history audit; no public-change command or permission is supplied here.

## Paste-ready field map

| Field/task                                        | Source/status                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project name / tagline / description / built-with | Labelled fields in [DEVPOST_DRAFT](DEVPOST_DRAFT.md); owner review required                                                                          |
| Eight core narrative sections / Codex use         | Same draft, with four historical paraphrased prompt → code → test episodes                                                                           |
| Primary Codex session                             | 01a1705c-a87d-7143-80f6-021e47b78ced; most of the build, with actual application workers separately credited                                         |
| Public try-it / testing instructions              | https://raid-relic-760724762396.us-central1.run.app only; Atlas/Ring12 light, Keeperolsols3, overlay and fictional demos; no judge control authority |
| Repository                                        | Repository URL plus explicit feature/raid-relic-p9-stretch ref; PENDING accepted judge access                                                        |
| Video                                             | PENDING genuine Twitch/Codex footage, approved edit, Public YouTube upload and signed-out playback verification                                      |
| Criteria mapping                                  | Exact four equally weighted names above; design goals/proof limits, not invented scores or adoption                                                  |
| Participant/representative / eligibility / rights | PENDING owner-confirmed human account details and declarations; do not invent identities or acceptance                                               |
| Form-specific fields                              | Confirm actual editor questions/limits; do not invent unavailable dropdowns or declarations                                                          |

## Owner-controlled completion checklist

1. Review verified rules and resolve the remaining access/media/eligibility blockers. Confirm requirements remain unchanged, including 22:00 UTC submission and 16 November 01:00 UTC availability.
2. Owner approves fields, credits, rights, intended source ref, testing instructions and truthful proof limits. Historical source-bound1277/CI41252418241 belongs docs8eda3af, not deployed runtime2b218b3. Do not invent live or visual proof.
3. With explicit owner approval, **register/sign in** through the event's Join Hackathon/Register flow and **create the project entry** through Enter a Submission/Create project. If an entry already exists, edit it rather than duplicate it. Exact logged-in labels may vary; no guessed deep-submit URL. Registration is not submission.
4. **Paste the fields**, including primary session ID, narrative, built-with, public try-it URL, testing instructions and final source ref. Preview formatting. The local document is not a live Devpost draft.
5. Resolve **repository access** through an owner-approved route above. Verify the recipient and accepted access to source/assets/run instructions and the final branch. No default-branch switch, merge or automatic visibility change.
6. Resolve **video**: existing genuine functioning-on-Twitch AND Codex-building footage, English captions/narration, rights/privacy review, under3-minute edit. Owner approves Public YouTube upload. Verify signed-out playback and final URL. The INCOMPLETE owner-review MP4 cannot be treated as compliant; flag missing footage honestly.
7. Recheck every required field and declaration against actual rules; obtain final owner approval for publication and submission. No new live action or external post is implied by this checklist.
8. Perform **actual Submit** after approval; merely saving a draft is insufficient. Verify the correct event dashboard/project page explicitly reports submitted, not Draft; record its actual project/submission URL and confirmation/time, selected event and any supplied confirmation. Reload to confirm persistence. A click or proof of sending is not receipt. Until that receipt exists, status stays **NOT SUBMITTED**. Meet the verified deadline; later corrections require administrator permission under the rules.
9. Keep project and repository access available through **16 November 01:00 UTC**; no automatic restriction/removal at midnight is authorised.

## Delivery and safety

Standing USER.md prohibits Raid Relic Discord updates, including DMs. Parent delivers through **NON-DISCORD project context**. No public posting, outreach, visibility change, upload or submission without owner OK. No runtime/cloud/traffic changes, broadcast/raid/chat, credential reads, raw/selected transcript access or compaction. Preserve historical evidence and generated quality. No command above was executed by this author; all mutations remain owner-controlled and unapproved unless separately authorised.
