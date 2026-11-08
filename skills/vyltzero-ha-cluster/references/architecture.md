# Architecture: how a VYLTZERO HA mesh fits together

## Shape

```
                    clients, agents, SDKs
                            │  https://app.vyltzero.com   (the alias)
                            ▼
        ┌─────────── DNS: ns1 / ns2.nebuladns.net ───────────┐   layer 1: POP failover
        │   A record, TTL 30, flipped by nebula-dns-failover │   (automatic, ~60-90 s)
        └──────────┬──────────────────────────┬──────────────┘
                   ▼                          ▼
              lon1.pop0.uk               lon2.pop0.uk         WSLProxy POPs (TLS ends here)
                   │  alias rule: backend = ACTIVE region origin,
                   │  Host rewritten to that region's own host  layer 2: region failover
                   ▼                                            (operator-approved, seconds)
     ┌──────────────────────────┐        ┌──────────────────────────┐
     │ region prod  (primary)   │        │ region prod-b            │
     │ node vps002, ns          │        │ node cloud003, ns        │
     │   vyltzero-prod          │        │   vyltzero-prod-b        │
     │ host app-a.vyltzero.com  │◄──────►│ host app-b.vyltzero.com  │  layer 3: data
     │ + alias app.vyltzero.com │  pull  │                          │  active/active
     │ PostgreSQL (local-path)  │ events │ PostgreSQL (local-path)  │  replication, LWW
     └──────────────────────────┘ /v1/   └──────────────────────────┘
                                  replication (Bearer mesh token)
```

## Three independent failover layers

| Layer | Protects against | Mechanism | Who moves it |
|---|---|---|---|
| 1. POP | a POP (lon1/lon2) dying | NebulaDNS A record, TTL 30, health-checked by `nebula-dns-failover` on ns1 and ns2 | automatic |
| 2. Region | a node, namespace or database dying | WSLProxy alias rule `redirect_uri` + `proxy_server_name` repointed to the surviving region | operator, via `vyltzero-ha-failover` |
| 3. Data | losing writes when a region dies | every region accepts writes; `replication-agent` pulls each peer's outbox every 500 ms; last-write-wins | continuous |

Layer 2 is a human decision on purpose. Both regions accept writes, so moving
traffic is safe at any moment. But a flapping automatic switch on a vault
would also spread confusing audit trails and session churn. The failover skill
makes the switch take seconds and be repeatable.

## What each region owns, and what is shared

| | Per region | Shared by every region |
|---|---|---|
| Kubernetes namespace, node pinning | ✓ | |
| PostgreSQL + its credentials (`vyltzero-db-auth`) | ✓ | |
| Public host (`app-a`, `app-b`) and Ingress | ✓ | |
| `region.id` (stamped on every event, never renamed) | ✓ | |
| `vyltzero-mesh-keys`: root key, JWT secret, PKI root key, peer token, audit key | | ✓ byte-identical |
| Peer roster (`global.region.peers`) | | ✓ identical list; each chart drops itself |
| Image version | | ✓ keep in lockstep |
| `identityService.publicUrl` = alias | | ✓ invitation links work from either region |

Why the keys must be identical:

- Region B decrypts A's replicated ciphertext with **its own** root key.
- A session token minted in A is verified in B with B's JWT secret.
- Peers authenticate to each other with the peer token.

If the keys differ, nothing looks broken (pods are healthy and events flow),
but every replicated secret is undecryptable.

## Why the primary also claims the alias

The POP rewrites the `Host` header to the active region's own host
(`--upstream-host app-b.vyltzero.com`). So during a failover no Ingress
changes and no Helm release runs: only the POP rule moves. The primary keeps
the alias in `extraHosts` so that the current setup keeps working, because
today the POP sends `Host: app.vyltzero.com` to vps002. The secondary never
claims it. traefik-edge is one DaemonSet watching every namespace, so a host
claimed twice would make the cloud003 edge route to vps002 pods, which it has
no pod-network route to.

## Why one node per region

Edge nodes carry `network.k3s1/cross-node=unavailable`: flannel cannot reach
pods on other nodes. A region therefore lives whole on one node (Postgres
included). A region is redundant across nodes only by being one of several
regions. `cryptoService` must stay at one replica per region.

## Single control plane caveat

On k3s1, all regions share one Kubernetes control plane, which runs on the
LAN. Running pods keep serving if the control plane is unreachable, but
nothing can be rescheduled until it comes back. For full independence, give
each region its own cluster (a `kubeconfig` or `context` per region in
mesh.json). The skill supports that unchanged.

## Known limits (check before promising)

- **Conflicts resolve last-write-wins.** Concurrent writes to the same secret
  in two regions keep the later one. Steer each tenant's writes to one region
  (the alias does this) and treat the other as warm standby that also takes
  writes.
- **DEK replication** uses `dek_upsert` events (migration 028, emitted by
  crypto-service). `docs/ha-two-region.md` predates it and still lists
  "key not found" as expected. Prove it with the write-here, read-there test
  in step 10. Do not assume it works.
- **API keys** replicate as `api_key_upsert` events on current images. On
  older images they were per region. If a key works in A but returns
  `key_not_found` in B, mint one per region.
- **The root key cannot be rotated.** There is no re-encryption path. Guard
  it like the data itself.
- **PostgreSQL is `local-path`.** Moving a region to another node is a
  rebuild: the new region refills from its peers by replication.
