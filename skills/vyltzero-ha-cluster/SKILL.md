---
name: vyltzero-ha-cluster
description: Stand up a multi-region, active/active, highly available VYLTZERO deployment on Kubernetes for a vyltzero.com environment (or any domain). It plans the region mesh, checks nodes, DNS and edge, shares the mesh keys safely, renders and validates per-region Helm values, bootstraps namespaces, deploys region by region, and verifies replication end to end. Use when someone asks to make VYLTZERO highly available, add a second or third region, set up multi-region, geo-redundancy, disaster recovery or active/active for app.vyltzero.com or another ring, or to check whether an existing mesh is healthy. For moving traffic between regions, failover drills and recovery, use the sibling skill vyltzero-ha-failover.
license: Apache-2.0
compatibility: Needs python3 (3.8+, standard library only), kubectl and helm 3 with access to every region's cluster, curl, and a checkout of github.com/bwalia/vyltzero. The edge steps need SSH to the WSLProxy POP (lon1) and the wslproxy repo's add_domain.py. Works in any agent harness that can run shell commands (Claude Code, OpenAI Codex, Cursor, Gemini CLI, and others).
metadata:
  version: "1.0.0"
  homepage: https://github.com/bwalia/vyltzero/tree/main/skills/vyltzero-ha-cluster
---

# vyltzero-ha-cluster: build a multi-region HA mesh

You are helping an **operator** turn a single VYLTZERO deployment into a mesh
of two or more independent regions that replicate to each other. Each region
is a complete release (its own PostgreSQL, services and console), pinned to
its own node, reachable at its own hostname. All regions share one set of
cryptographic keys and pull each other's changes over the public edge.

All checks go through the bundled helper `scripts/vz_ha.py`. Run it from the
repo root. Read [references/architecture.md](references/architecture.md)
before your first run. It explains the three failover layers and why each
rule below exists.

## Non-negotiable rules

1. **Never print, echo or paste key material.** That covers the root key, JWT
   secret, PKI root key, peer token, audit key, DB passwords and admin token.
   Compare keys by fingerprint only (`vz_ha.py keys` / `verify`). If the
   operator pastes a key, tell them it must now be treated as leaked.
2. **A region that holds data is the key source, never a key target.**
   Overwriting its `vyltzero-mesh-keys` makes every secret it stores
   unreadable, and there is no undo. If `vz_ha.py keys` says two regions hold
   data under different keys, **stop**: that needs a data migration, not a
   key copy.
3. **Never change the `region.id` of a running region.** It is stamped on
   every replication event. Keep the live id (for example `prod`) even when
   it looks untidy next to `prod-b`.
4. **Only the primary region's Ingress may claim the shared alias**
   (`app.vyltzero.com`). traefik-edge watches every namespace, so a host
   claimed twice routes unpredictably. `render` enforces this.
5. **Do not publish the peer endpoint until the guard is proven.** Leave
   `publish_peer_endpoint: false` until `verify` shows an anonymous pull is
   refused with 401 or 503. A 200 without a token means the outbox (policies,
   tenant roster) is public: unpublish at once.
6. **Do not repoint a WSLProxy rule that other hosts share.** The four ring
   hosts share rule `vyltzero-vps002-traefik-edge`, and `add_domain.py
   --update --backend` edits the rule, which would move every ring. Preflight
   `--pop` checks this.
7. **Run every mutating command on its own** (bootstrap, key copy, helm,
   add_domain) so the harness shows it to the operator. Get an explicit "yes"
   before each one that touches prod. Do not chain them.
8. **Stop on the first FAIL.** Do not work around a failed check with manual
   edits. Report it and the fix from
   [references/troubleshooting.md](references/troubleshooting.md).

## Inputs to collect (ask only for what is missing)

| Input | Default for vyltzero.com prod | Notes |
|---|---|---|
| Environment | `prod` | `int`, `test` and `acc` work the same way |
| Shared alias | `app.vyltzero.com` | What users and agents call. For other rings, `<env>.vyltzero.com`. |
| Regions | `prod` on `vps002`, `prod-b` on `cloud003` | `ID:NAMESPACE:NODE:HOST`. The **first** is primary. Keep the live region's id. |
| Region hosts | `app-a.vyltzero.com`, `app-b.vyltzero.com` | Peer and replication endpoints. Each needs DNS and a WSLProxy vhost. |
| Clusters | one k3s1 kubeconfig | Add `kubeconfig` or `context` per region in mesh.json for separate clusters. |

Node rule of thumb: each region needs a node with CoreDNS and traefik-edge
Ready, a `local-path` StorageClass, and about 2 CPU of request headroom.
`preflight` checks all of this. On k3s1 today the candidates are
`vps002` (prod already runs there), `cloud003` (London, most headroom) and
`cloud001` (Manchester, nearly full).

## Workflow

Copy this checklist into your reply and tick it off as you go:

```text
[ ] 1. init        write deploy/ha/<env>/mesh.json from live node facts
[ ] 2. preflight   nodes, CoreDNS, traefik-edge, CPU, ingress conflicts, POP rules
[ ] 3. edge + DNS  per-region vhosts and DNS; a dedicated alias rule
[ ] 4. render      per-region values files + regions.txt
[ ] 5. validate    helm-render each region; check the mesh invariants
[ ] 6. bootstrap   namespace, DB credentials, RoleBinding (new regions)
[ ] 7. keys        one key set across the mesh, copied from the data holder
[ ] 8. deploy      primary first, then the others
[ ] 9. verify      keys, pods, peer auth, region roster, alias
[ ] 10. publish    enable the peer endpoint, redeploy, verify replication
[ ] 11. commit     mesh.json + generated values; open a PR
```

### 1. init

```bash
export KUBECONFIG=~/.kube/k3s1.yaml
S=skills/vyltzero-ha-cluster/scripts/vz_ha.py
$S init --env prod --alias app.vyltzero.com \
  --region prod:vyltzero-prod:vps002:app-a.vyltzero.com \
  --region prod-b:vyltzero-prod-b:cloud003:app-b.vyltzero.com
```

This writes `deploy/ha/prod/mesh.json`, filling in each node's public origin
IP and edge CIDR. It warns if a live release already uses a different region
id. Show the operator the table it prints. See
[examples/mesh.prod.example.json](examples/mesh.prod.example.json).

### 2. preflight

```bash
$S preflight deploy/ha/prod/mesh.json --pop
```

It is read only. `--pop` reads the WSLProxy rules on lon1 over SSH. Expect
warnings for things later steps create (namespace, vhosts). Fix every
**FAIL** before going on.

### 3. Edge and DNS

Follow [references/edge-and-dns.md](references/edge-and-dns.md):

- a WSLProxy vhost per region host (`app-a` to the vps002 origin, `app-b` to
  cloud003), with `--upstream-host` set to the host itself;
- **a dedicated rule for the alias**, so failover moves only the alias;
- NebulaDNS ns1/ns2 delegation with lon1↔lon2 failover for each new host
  (sibling skill `add-host-ns-failover`).

Each of these publishes a public hostname, so confirm with the operator first.

### 4. render, 5. validate

```bash
$S render   deploy/ha/prod/mesh.json
$S validate deploy/ha/prod/mesh.json
```

`render` writes `deploy/ha/prod/<region>.values.yaml`, layered after
`values-k3s1.yaml` and `values-<env>.yaml`, plus `regions.txt` (deploy
order, primary first). Never hand-edit the generated files: change
`mesh.json` and render again. `validate` checks that every region:

- renders cleanly;
- pins every pod to its node;
- claims only its own host, with the alias on the primary only;
- carries an identical roster;
- reads the shared Secret;
- ships the migrations Job.

### 6. bootstrap (each new region)

```bash
$S bootstrap deploy/ha/prod/mesh.json --region prod-b           # plan
$S bootstrap deploy/ha/prod/mesh.json --region prod-b --apply   # after the operator agrees
```

This creates the namespace, PostgreSQL credentials (generated, because the
region has no database yet) and the Ring Promoter RoleBinding. It never
touches mesh keys.

### 7. keys

```bash
$S keys deploy/ha/prod/mesh.json
```

This prints fingerprints and **the one safe command** for this mesh. That is
usually `copy-from <namespace that holds data>`, or `create` for a mesh with
no data at all. Show the command, explain that it overwrites the *targets'*
keys, get a yes, then run it exactly as printed. Then run the `verify` line it
prints.

### 8. deploy

Use the path the operator already uses for this environment:

- **Ring Promoter (vyltzero.com rings):** make the ring job region-aware
  once, as described in [references/ring-promoter.md](references/ring-promoter.md).
  After that, promoting a version deploys every line of `regions.txt` in
  order. The PR and the RP re-import need the operator's approval.
- **By hand (first build, or no RP):** for each line of `regions.txt`, in
  order:

  ```bash
  helm upgrade --install vyltzero deploy/helm/vyltzero -n <namespace> \
    -f deploy/helm/vyltzero/values-k3s1.yaml \
    -f deploy/helm/vyltzero/values-prod.yaml \
    -f deploy/ha/prod/<region>.values.yaml \
    --set global.imageTag=<the version prod runs> --wait --timeout 15m
  ```

  Use the **same version** in every region. Read it from `https://<alias>/api/version`.

### 9. verify

```bash
$S verify deploy/ha/prod/mesh.json
```

It checks:

- identical key fingerprints;
- all pods Ready;
- `/api/version` on each region host;
- `system.regions` lists every region;
- the peer endpoint refuses anonymous pulls and accepts the mesh token;
- the alias answers.

### 10. publish the peer endpoint

When `verify` reports a 404 for the peer endpoint (not published yet), set
`"publish_peer_endpoint": true` in mesh.json. Then render, validate, deploy
every region again and verify. Now the anonymous pull must be **401/503** and
the token pull **200**. In `system.regions` each region should show the
others `active` with a small `lag_ms`. A region stuck `offline` while events
flow means `/health` is not routed (see troubleshooting).

Then prove data really moves. Have the operator write a test secret in
region A and read it back in region B. The `vyltzero-secrets` skill or the
console both work. Never put the test value in the chat.

### 11. commit

Commit `deploy/ha/<env>/` on a branch and open a PR. The operator merges it.
Do not push to `main` unless they ask.

## Done means

- `verify` prints **PASSED** with the peer endpoint published;
- a secret written in one region reads back in another;
- `vyltzero-ha-failover` `status` shows which region serves the alias;
- the operator knows the failover command (hand over to `vyltzero-ha-failover`).

## Files

| Path | What |
|---|---|
| `scripts/vz_ha.py` | init / preflight / render / validate / bootstrap / keys / verify / status |
| `references/architecture.md` | topology, failover layers, what is shared, known limits |
| `references/edge-and-dns.md` | WSLProxy vhosts, dedicated alias rule, NebulaDNS |
| `references/ring-promoter.md` | region-aware Ring Promoter deploy job |
| `references/troubleshooting.md` | symptom → cause → fix |
| `examples/mesh.prod.example.json` | the vyltzero.com prod mesh (vps002 + cloud003) |
| repo `scripts/vyltzero-mesh-keys.sh` | key create / copy-from / verify (the only key writer) |
| repo `docs/ha-two-region.md` | the original two-region design notes |
