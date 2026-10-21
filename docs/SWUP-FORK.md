# SwitchUp OpenWork fork

## Purpose and ownership

`swupde/openwork` builds the OpenWork images needed for SwitchUp's deployment.
`different-ai/openwork` is the upstream product source. Ordinary maintenance
PRs target `dev` in **swupde/openwork**. Upstream contributions require an
explicit separate decision. A branch containing `upstream` in its name means
an import into our fork, not a PR to the official project.

Keep application changes limited to demonstrated deployment needs and remove
local patches when an upstream release supplies the same behavior. Prefer
upstream configuration and preserve upstream tests. Do not adopt the upstream
team's paid services merely because their workflows were imported.

## Build versus deploy

| Location | Responsibility |
| --- | --- |
| `different-ai/openwork` | Upstream product and releases |
| `swupde/openwork` | Reviewed local patches, tests, and GHCR image builds |
| `swupde/swup-ai-workspace` | Deployment Compose files and image pins |
| Dokploy | Deployment, runtime secrets, registry credentials, and persistent volumes |

Use the deployment repository's `openwork-den/compose.yaml` and operational
documentation for runtime configuration. Read its reviewed Git revision;
an old local checkout or a version in historical evidence is not proof of
what is deployed. Record upstream release, fork revision, and deployed image
separately. A green image build does not prove a production deployment.

## CI policy

Warden is an optional AI code reviewer. Blacksmith is a third-party provider
of CI runner computers. Both appeared here through upstream workflow imports;
neither is part of the running Den service. This fork does not require a
Warden model credential or a Blacksmith account. GitHub Actions runs the
retained tests and builds, and Dokploy operates the resulting deployment.

Enable only these workflows in this fork's GitHub Actions settings:

| Workflow file | Purpose |
| --- | --- |
| `ci-tests.yml` | Upstream application, server, desktop, and integration checks |
| `ci-enterprise-mcp-mock.yml` | MCP contract checks |
| `den-db-check.yml` | Database schema and migration checks |
| `ci-i18n.yml` | Translation audit |
| `ci-no-new-eval-flows.yml` | Guard against obsolete test flows |
| `publish-ee-images.yml` | Build images, validate Helm, and smoke-test containers |

Linux validation uses standard GitHub-hosted Ubuntu runners; macOS validation
retains the upstream GitHub runner. No Blacksmith account or Warden provider
key is needed. These checks do not replace human review of security-sensitive
changes.

Other inherited workflows remain in source for easier upstream merges, but
are disabled through GitHub's native per-workflow setting. This includes
Warden and clearance, automatic approvals, public desktop/npm releases,
Daytona infrastructure, scheduled product updates, reports, and alerts.
Disabled is an intentional policy choice, not a passing test result.

The image workflow's inherited Render deployment job is disabled in source;
production deployment belongs to Dokploy. PRs build and test without publishing.
Pushes to `dev` publish affected images. Reviewed release tags or explicit
manual publication produce release artifacts. Do not use upstream desktop
release commands to publish SwitchUp's container images.

Workflow enablement is repository state, not a setting copied by git. Inspect
new workflow files during review and inspect GitHub's workflow inventory again
after every upstream merge. GitHub can register additional active workflows
when their files first reach the default branch, so a pre-merge inventory
alone is insufficient:

```sh
gh api repos/swupde/openwork/actions/workflows --paginate \
  --jq '.workflows[] | [.path, .state] | @tsv'
```

Compare against the table above. Disable newly imported workflows unless they
have an identified SwitchUp consumer; retain the six listed workflows.
Use `gh workflow disable <filename> --repo swupde/openwork` or the Actions UI.
Re-enabling an optional workflow requires checking its runners, credentials,
external destinations, permissions, and any dependent workflows first.

## Updating and releasing

1. Fetch a specific upstream release into a branch in our fork. Record the
   upstream tag and commit in the PR. Review release notes and migrations.
2. Review the local patch diff and new workflows. Preserve the runner choices
   above and reconcile workflow settings before running imported automation.
3. Run the retained CI checks and relevant deployment tests. Wait for the
   actual results; queued jobs are incomplete. Review security changes directly.
4. Merge the reviewed PR into `swupde/openwork:dev`. For a versioned release,
   use a unique `v<upstream-version>-swup.<revision>` tag on the reviewed commit
   and verify Publish EE Artifacts succeeds. Do not overwrite a released tag.
5. Update immutable image references in `swup-ai-workspace` in a separate
   reviewed change. Deploy that revision through the existing Dokploy service.
6. Verify readiness, Google sign-in, team membership, and an existing managed
   connection. Preserve the database volume and follow the deployment
   repository's migration and backup procedure.

Upstream v0.18.48 removed `spec-impact.yml` and its contract registry. The fork follows that removal; the retained application and migration suites provide the relevant checks.

## v0.18.48 reconciliation (2026-09-19)

The upstream release is `c67ba51eda99ae6cfba1ff75b31e84f915c47be5`.
This import preserves runtime API path prefixes, organisation skill guidance,
managed attachment storage, Google native file compatibility routes, and the
false-baseline database repair. Google compatibility routes now honor the
upstream Connect policy denial before using credentials or calling Google.

The upstream query-schema extractor and policy-aware desktop updater replace
fork duplicates. The image selector follows the upstream inference-to-gateway
source rename while retaining the existing image repository name. Newly
imported API-contract, SDK, and evidence-review jobs are restricted to the
upstream repository; they are outside our retained workflow list.

The pending OAuth credential contract requires `connected_account.connected_at`
to remain nullable with no automatic timestamp. Migration `0102_connected_account_pending`
restores that contract without rewriting any historical row. Successful authorization
sets the timestamp; refresh preserves it and credential invalidation clears it.
Fresh-schema and historical migration tests must check both pending nulls and
completed timestamps when reconciling this fork patch.

A production upgrade must rehearse pending migrations and the built image's
bootstrap against an isolated snapshot, preserve the database volume and
credential encryption key, and update the deployment pin separately.

## Repository settings evidence

Verified 2026-09-05 after [PR #19](https://github.com/swupde/openwork/pull/19)
merged as `7f5ba855aa6acb7745a6d596749487ade0feee12`:

- Seven workflows were active (the six above plus the since-removed `spec-impact.yml`); 21 were
  `disabled_manually`.
- The post-merge inventory exposed three newly registered workflows:
  `daytona-e2e-singles.yml`, `nightly-flake-report.yml`, and
  `opencode-agents.yml`. These were disabled as part of reconciliation.
- All retained pre-merge checks passed, including Linux/macOS tests, MySQL
  migration checks, MCP contracts, and all four container build/smoke tests.
- The merge commit's OpenWork Tests, Enterprise MCP Mock, i18n Audit, and
  Publish EE Artifacts workflows also completed successfully. Publication
  is verified; this evidence does not establish a Dokploy deployment.

These counts and results are dated evidence. The enabled-workflow table is
the ongoing policy; recheck GitHub after subsequent imports.

Checked 2026-09-05: `dev` had no branch protection and its effective rules API
returned no rules. Upstream documentation claiming mandatory approvals or
Warden enforcement did not describe this fork. Follow the review/CI policy
above regardless; do not describe it as server-enforced protection without
verifying GitHub settings. Adding branch protection is a separate repository
policy change, not a prerequisite for configuring a model provider.


## v0.18.56 reconciliation (2026-10-04)

This import retains the deployed fork migration history through
`0102_connected_account_pending`. Upstream migrations `0102`–`0121` become
fork migrations `0103`–`0122`. The first seven upstream timestamps predate
our already-deployed `0102` receipt; they are ordered immediately after that
receipt so Drizzle cannot silently skip them. Their SQL bytes are unchanged.
Later upstream timestamps are retained. Snapshot links and the nullable,
no-default `connected_account.connected_at` contract are preserved throughout.
The migration-history regression pins every deployed SQL hash and timestamp.

The upstream strict 0097 migration compatibility preflight is retained. Known
fork false-baseline repairs remain available, while an existing schema without
a ledger or a ledger with missing application tables now fails closed. For a
historical database that has not applied 0097, its external writers must be
stopped before explicitly setting `DEN_DB_0097_WRITERS_STOPPED=1`. Our deployed
102-migration database already passed 0097 and does not need that override.

Upstream removed its unit-test suite in this release. This fork retains the
native connection, credential, Google compatibility, migration, attachment,
runtime-storage, skill-guidance, authoring, and MCP-contract regressions that
protect deployment-specific behavior. `test:fork` runs these alongside the
new upstream boot and core journeys; retained migration and authoring gates
continue to run in CI. This is source integration documentation, not evidence
of publication or deployment.


Upstream v0.18.56 broadens live and unattended Workflow execution to all
capabilities the runner can access. This fork retains the prior first-party,
read-only restriction for unattended automation, live Workflow refreshes, and
live authoring tests. The upgrade does not authorize new background writes.
Interactive execution retains its existing permission checks. Reconsidering
that boundary is a separate explicit deployment decision; the retained
`codemode-tools`, `codemode-readonly-policy`, `workflow-authoring-test`, and
`live-workflow-execution` tests protect it.

Configured desktop policies also remain enforced through
`DESKTOP_POLICY_ENFORCEMENT_ENABLED=true`; the upstream default-off change
would otherwise discard configured capability restrictions. Re-evaluate these
fork guards only through an explicit authorization-policy change with matching
negative tests, not as a side effect of a future version import.

Cached managed restrictions survive sign-out and restart until a fresh verified
identity establishes the applicable policy; credentials and identity still clear
on sign-out. Unmanaged local profiles remain unaffected.


## v0.18.58 reconciliation (2026-10-20)

The reviewed upstream release is `v0.18.58` at
`258218b9b69c91e3d5020488fe1d14ff767679e9`. The existing 122-migration
prefix retains its deployed SQL hashes, tags, and timestamps. Upstream
migrations `0122`–`0141` become fork migrations `0123`–`0142`; their SQL
bytes and timestamps are unchanged. Snapshot links retain the pending OAuth
nullable, no-default `connected_account.connected_at` contract. The migration
history regression now pins all 122 deployed receipts.

The upstream analytics-retirement migration is now a no-op, so this upgrade
preserves existing analytics data; its later restoration uses `CREATE TABLE
IF NOT EXISTS`. The upstream role migration intentionally normalizes legacy
super-admin/custom roles to the built-in roles. The new native permission and
feature tables are retained without a custom-role compatibility layer.

Unattended/live Workflow execution remains restricted to first-party read-only
capabilities, and desktop policy enforcement remains enabled. New connection
readiness fields coexist with the pending OAuth timestamp contract. Native
Google compatibility routes retain connector policy and scope checks and now
carry declarations in the upstream audit coverage registry.

The upstream Node unit suites coexist with the retained Bun deployment
regressions. Their package commands select the appropriate runner explicitly.
Shared API-key configuration constants have a dependency-free module so the
new audited service graph cannot initialize authentication through a circular
service import.

The six retained workflows continue to use GitHub-hosted runners. Optional
inherited workflow jobs are restricted to the upstream repository before
registration, and native workflow enablement must still be checked after
merge. Container PR triggers cover all workspace packages and patches;
selection retains the four existing deployment images. New headless/Workbot
images and upstream cloud deployment automation are not adopted. Source
integration and CI evidence do not establish production deployment or a
published desktop update.


## v0.18.59 reconciliation (2026-10-21)

The reviewed upstream release is `v0.18.59` at
`0c60c8a6dd22db83a6c68552c00cabe601ec1f77`. All 142 deployed SQL files,
journal tags/timestamps, and historical snapshots remain byte-for-byte intact.
Official migrations `0142`–`0151` append as fork `0143`–`0152`; their SQL bytes
and timestamps are unchanged. New snapshot links include the fork's nullable,
no-default pending OAuth timestamp. A regression pins the complete deployed
142-entry prefix before checking the ten appended migrations.

The native organization/team default model is included without a client fork.
Desktop applies it only to OpenCode v2: a deliberate workspace selection wins,
then the resolved team/organization default, then the app-wide preference.
The API validates model availability and administrator permission before saving.

The native usage-rollup migration (fork `0144`) replaces three raw event fields
(`tool_name`, `via`, `dedupe_key`) with the supported rollup/source model. Release
rehearsal must keep the full original dump, verify its restore before migration,
and compare every surviving field after migration. Historical `0130` remains
unchanged rather than backporting upstream's later MariaDB portability edits.
Upstream also removes the retired Dashboard ORM exports while explicitly
preserving `dashboard` and `dashboard_access_grant` in migration `0148`.
Schema parity checks all active tables plus those two retained tables against
their original `0078` DDL, including indexes; they never drop historical data
or ignore arbitrary schema differences.

The agent MCP keeps upstream's compact instructions plus detailed guidance
resource; both retain search-once and exact capability reuse. First-party
read-only Workflow restrictions and desktop policy enforcement stay in place.
Google Drive reads additionally require the connector's administrator-enabled
read scope, even when the account still carries a previously granted token.
Retained fixtures use the native permission, audit, and MCP resource contracts.
The six-workflow, standard-runner and four-image release boundaries still apply.
