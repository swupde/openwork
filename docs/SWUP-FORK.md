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
