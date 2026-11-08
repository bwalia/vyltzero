---
name: vyltzero-ha-failover
description: Operate a multi-region VYLTZERO mesh on Kubernetes. It shows which region serves the public alias (app.vyltzero.com), moves traffic to another region with a typed approval (planned switchover or emergency failover), fails back, runs failover drills, rebuilds and rejoins a lost region, and rotates the peer token. Use when someone asks which region is live, to fail over, switch over or fail back VYLTZERO, to run a DR or failover drill, when a region or node is down, or to rejoin a rebuilt region. The mesh must already be built with the sibling skill vyltzero-ha-cluster.
license: Apache-2.0
compatibility: Needs python3 (3.8+), kubectl and helm with access to every region, curl, SSH to the WSLProxy POP lon1 (root@195.20.255.201), the wslproxy repo's add_domain.py, and the vyltzero-ha-cluster skill installed alongside (it uses that skill's scripts/vz_ha.py). Works in any agent harness that can run shell commands.
metadata:
  version: "1.0.0"
  homepage: https://github.com/bwalia/vyltzero/tree/main/skills/vyltzero-ha-failover
---

# vyltzero-ha-failover: move traffic between regions safely

A VYLTZERO mesh has three failover layers (see
`../vyltzero-ha-cluster/references/architecture.md`):

1. **POP** (lon1 ↔ lon2): automatic, done by DNS. Nothing to do here except
   check it.
2. **Region**: which region the alias rule on WSLProxy sends traffic to.
   **This skill moves it.**
3. **Data**: every region takes writes and replicates continuously. Nothing to
   move.

Because every region accepts writes, a region switch moves no data and needs
no database promotion. You only repoint one POP rule. The risk is pointing
traffic at a region that is unhealthy, behind, or on another version. The
checks below exist to prevent that.

Helper: `S=../vyltzero-ha-cluster/scripts/vz_ha.py` (paths relative to this
skill; from the repo root use `skills/vyltzero-ha-cluster/scripts/vz_ha.py`).
Mesh file: `deploy/ha/<env>/mesh.json`.

## Non-negotiable rules

1. **Never switch without the operator's typed phrase**
   `FAILOVER <alias> TO <region-id>`, typed by them in this conversation,
   character for character. "yes", "go" or "do it" are not approval. The one
   exception: the operator may say up front that a drill is approved, and
   then type the phrase once for the whole drill.
2. **Check the alias rule is dedicated before every switch.** `status --pop`
   must say "the alias has a dedicated rule". If the rule is shared, stop:
   switching would move every host on that rule. The fix is in
   `../vyltzero-ha-cluster/references/edge-and-dns.md` §2.
3. **The target must be healthy.** It needs all pods Ready, `/api/version`
   answering on the same version as the source, and its `system.regions` row
   `active`. In an emergency (source down) the version and lag checks may be
   waived, but say that you are waiving them.
4. **Never scale down, delete, or stop a region that is serving the alias.**
   Drills switch traffic first, then disturb the old region.
5. **Never touch mesh keys here.** Key problems belong to `vyltzero-ha-cluster`.
6. One mutating command per tool call, and report the result of each before
   running the next.

## Status: where is traffic, and is everything healthy?

```bash
$S status deploy/ha/prod/mesh.json --pop
```

It reports, for each region:

- pods Ready;
- `/api/version`;
- `system.regions` rows (status, lag, last seen);
- the outbox size.

It also shows the alias's POP rule, ending with **"alias currently routed to:
<region>"**. Use `--quick` to skip the database queries. For the POP layer:
`dig +short app.vyltzero.com` (an A record for lon1 or lon2) and
`ssh <ns host> curl -s localhost:9119/v1/status`.

## Planned switchover (both regions healthy)

```text
[ ] 1. status --pop        source and target healthy, same version, alias rule dedicated
[ ] 2. lag check           target's view of the source: lag_ms small, last_seen recent
[ ] 3. typed approval      FAILOVER app.vyltzero.com TO prod-b
[ ] 4. dry-run repoint     add_domain.py --update ... --dry-run
[ ] 5. repoint             add_domain.py --update ...
[ ] 6. verify              alias 200 + status says routed to the target
[ ] 7. record              optional registry promote; tell the operator what changed
```

Step 4 and 5 (target `prod-b` from the example mesh: origin `77.68.126.63`,
host `app-b.vyltzero.com`; read the real values from mesh.json):

```bash
W=~/projects/wslproxy/.claude/skills/wslproxy-add-domain/scripts/add_domain.py
$W --host app.vyltzero.com --update --backend 77.68.126.63:80 --upstream-host app-b.vyltzero.com --dry-run
$W --host app.vyltzero.com --update --backend 77.68.126.63:80 --upstream-host app-b.vyltzero.com
```

`--update` writes CP first, then lon1, checks, then lon2. lon1 reads the rule
files per request, so the switch is live on the next request, with no reload
and no DNS wait. Then:

```bash
curl -sS https://app.vyltzero.com/api/version
$S status deploy/ha/prod/mesh.json --pop --quick     # "alias currently routed to: prod-b"
```

Step 7, optional: `POST https://<target-host>/v1/sys/regions/<target>/promote`
with a platform-admin token. It **only records** a `region_promote` event and
marks the row active. It does not move traffic. The operator runs it with
their own token. Never ask for the token in the chat.

Then run the CP→git sync workflows that add_domain prints, so Git matches the
POP. Give the operator the PR links.

## Emergency failover (a region is down)

Same steps, faster:

1. `status --pop --quick`: confirm the **source** is down (pods not Ready or
   `/api/version` failing) and the **target** is up.
2. Ask for the typed phrase. Say plainly that writes made in the dead region
   in the last few seconds before it failed may not have replicated yet. They
   come back when it rejoins, and last-write-wins resolves any overlap.
3. Repoint (skip the dry run only if the operator asks for speed), then
   verify.
4. Leave the dead region alone. Do not delete its namespace or PVC: its
   database holds its un-replicated tail.

## Failback

When the original region is healthy again, run `status` and wait until its
`system.regions` view shows the other region `active` with low lag. It is
then caught up on writes made while it was out. Then do a **planned
switchover** back, with a new typed phrase.

## Failover drill (prove it works; schedule with the operator)

```text
[ ] 1. status --pop                 baseline; note which region is active
[ ] 2. write a canary secret in the active region (vyltzero-secrets skill or console)
[ ] 3. planned switchover to the standby   (typed phrase)
[ ] 4. read the canary through the alias   → must match (replication + DEK works)
[ ] 5. log in to the console through the alias, open Secrets  (sessions, cookies)
[ ] 6. optional: scale the OLD region's secret-engine to 0 and confirm the alias is unaffected,
       then scale it back:  kubectl -n <old-ns> scale deploy/vyltzero-secret-engine --replicas=1
[ ] 7. failback (typed phrase), delete the canary
[ ] 8. write up: switch time, errors seen, anything that did not replicate
```

Never put the canary's value in the chat. Ask the operator to compare it, or
use the `vyltzero-secrets` skill, which keeps values out of the conversation.

## Rejoin a rebuilt region

A region whose node or database was lost is rebuilt, not repaired:

1. Use `vyltzero-ha-cluster` steps 6 to 9 for that region only:
   - bootstrap with `--generate` DB credentials;
   - **copy-from** a surviving region's keys;
   - deploy;
   - verify.
2. Replication refills it from its peers' outboxes. Watch `system.regions`
   lag fall to a steady small number before sending it traffic.
3. If the old database is recoverable and holds writes that never replicated,
   tell the operator before deleting it. Its outbox can still be pulled once
   it is up.

## Rotate the peer token

Safe: it carries no data. Peers return 401 for the seconds between writes,
then retry. Generate it once and write it to every region's Secret in the
same sitting. Do this with the `vyltzero-ha-cluster` key tooling, never by
hand-editing one region. Then restart each region's replication-agent and run
`verify`.

## Do not

- Switch with `--backend` on a shared rule (moves every host on it).
- Add the alias to the secondary region's Ingress. Failover is a POP change
  only.
- Promote in the registry and believe traffic moved. It did not.
- Scale or delete the region that serves the alias.
- Rotate or regenerate the root key. There is no re-encryption path.
