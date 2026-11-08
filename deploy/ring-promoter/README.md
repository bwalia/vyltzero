# Ring Promoter — VYLTZERO on k3s1

VYLTZERO ships through four rings on [Ring Promoter](https://rp.workstation.co.uk/?app=vyltzero)
(`workstation-ring-promoter` on k3s1), driven by GitHub workflows.

| Ring | Namespace | URL | Promotion |
|------|-----------|-----|-----------|
| `int`  | `vyltzero-int`  | https://int.vyltzero.com  | seeded by CI on every release tag; auto-promotes |
| `test` | `vyltzero-test` | https://test.vyltzero.com | auto-promotes |
| `acc`  | `vyltzero-acc`  | https://acc.vyltzero.com  | **stops** — human promotes to prod |
| `prod` | `vyltzero-prod` | https://app.vyltzero.com  | — |

Marketing site: https://www.vyltzero.com (GitHub Pages, `pages.yml`, every push to `main`).

## How a release flows

```
push to main ─► ci.yml (GitHub-hosted)
                 ├─ check + test
                 ├─ build 15 images ─► GHCR + Docker Hub (bwalia/vyltzero-*)
                 ├─ auto-tag vX.Y.Z (only after every image is published)
                 └─ seed-ring-promoter ─► POST /api/apps/vyltzero/seed {ring:int, version:vX.Y.Z}
                                              │
Ring Promoter (k8sjob in ring-exec) ◄─────────┘
  per ring: git clone --branch vX.Y.Z ─► helm upgrade --install vyltzero
            -f values-k3s1.yaml -f values-<env>.yaml --set global.imageTag=vX.Y.Z
            ─► health: https://<host>/api/version reports vX.Y.Z
  int ─auto─► test ─auto─► acc ─(click Promote)─► prod
```

Every ring runs the **same tag and the same images**; nothing is rebuilt between rings.
Each ring has its **own** PostgreSQL and its **own** key material, so a token or
ciphertext from one ring is useless in another.

## Traffic and failover

```
<ring>.vyltzero.com
  Cloudflare (vyltzero.com zone): NS -> ns1.nebuladns.net / ns2.nebuladns.net
  NebulaDNS (cloud001 / vps002):  apex A, TTL 30 -> lon1 195.20.255.201
                                                 or lon2 85.190.106.189
  nebula-dns-failover (on ns1 AND ns2) probes lon1/lon2 /healthz every 10s and
  rewrites the A record: 3 failures -> lon2, 3 OKs + 30s -> back to lon1
  lon1 / lon2 (WSLProxy, own Let's Encrypt certs on each, TLS terminated)
  -> vps002 traefik-edge 85.190.106.88:80 -> vault-ui (/) + services (/v1/*)
```

Clients follow a failover after ~2-3 x TTL (60-90 s). Both POPs hold valid
certificates for every ring host (issued 2026-11-08 by forcing each host onto lon2).

| Layer | Source of truth |
|-------|-----------------|
| Cloudflare NS delegation | `diy-tax-return-infra/scripts/nebuladns-cloudflare-dns.py` (`vyltzero.com` block) |
| NebulaDNS zones | `diy-tax-return-infra/ansible/files/zones/<ring>.vyltzero.com.toml` (`ansible/nebuladns.yml`) |
| Failover hostnames | `diy-tax-return-infra/ansible/files/nebuladns/dns-failover.toml` |
| WSLProxy vhosts + rule `vyltzero-vps002-traefik-edge` | `cp.pop0.uk` (imported), live on lon1, mirrored to lon2; git via the wslproxy CP-sync PRs |
| www + apex (marketing) | `../dns/vyltzero.com.records` (`.github/workflows/dns.yml`) |

Break-glass (run on ns1 **and** ns2; the token is in `/etc/nebuladns/dns-failover.env`):

```sh
curl -s -X POST -H "Authorization: Bearer $FAILOVER_API_TOKEN" 127.0.0.1:9119/v1/hostnames/app.vyltzero.com/failover  # force lon2
curl -s -X POST -H "Authorization: Bearer $FAILOVER_API_TOKEN" 127.0.0.1:9119/v1/hostnames/app.vyltzero.com/auto      # back to health-driven
```

## Files

| File | What it is |
|------|------------|
| [`vyltzero.yaml`](vyltzero.yaml) | RP app (`deployer: k8sjob`, rings int/test/acc/prod) |
| [`rbac.yaml`](rbac.yaml) | `ring-deploy-job` RoleBindings in the four ring namespaces |
| [`vyltzero-www.yaml`](vyltzero-www.yaml) | Optional RP app for the marketing site (`deployer: github`) |
| `../helm/vyltzero/values-k3s1.yaml` | Shared overlay for every ring |
| `../helm/vyltzero/values-<env>.yaml` | Per-ring host, namespace, region id |
| `../dns/vyltzero.com.records` | Cloudflare records for www + apex (`.github/workflows/dns.yml`) |

## One-time setup

```sh
export KUBECONFIG=~/.kube/k3s1.yaml

# 1. Namespaces, per-ring keys + DB credentials, RP RoleBindings (idempotent)
./scripts/vyltzero-env-bootstrap.sh all

# 2. Edge vhosts on lon1 + lon2 + cp.pop0.uk (from a bwalia/wslproxy checkout).
#    The first host creates the shared rule; the rest reuse it with --rule-id.
#    Skip the skill's dns step: these names are NebulaDNS delegations.
.claude/skills/wslproxy-add-domain/scripts/add_domain.py --host int.vyltzero.com \
  --backend 85.190.106.88:80 --upstream-host int.vyltzero.com \
  --rule-name vyltzero-vps002-traefik-edge --steps preflight,generate,lon1,lon2,cp
#    Then write /opt/nginx/data/ssl/<host>.json on lon1 AND lon2 and reload
#    openresty: add_domain.py writes files over ssh, which skips the edge's
#    SSL wire-up, so auto-ssl refuses the domain ("domain not allowed").

# 3. DNS failover (bwalia/diy-tax-return-infra): zone file + hostname entry,
#    ansible-playbook nebuladns.yml -e nebuladns_version=<live version>, copy
#    dns-failover.toml to ns1/ns2, then
#    python3 scripts/nebuladns-cloudflare-dns.py --zone vyltzero.com

# 4. Register the app: append the `apps:` item from vyltzero.yaml to
#    workstation-ring-promoter/ring-promoter-config (data.config.yaml), then
kubectl rollout restart deploy/ring-promoter -n workstation-ring-promoter
```

Repo secrets on `bwalia/vyltzero`:

| Secret | Used by |
|--------|---------|
| `RP_API_TOKEN` | `ci.yml` seed (from `workstation-ring-promoter/ring-promoter`) |
| `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` | `ci.yml` Docker Hub mirror (the cluster pulls `bwalia/vyltzero-*`) |
| `CLOUDFLARE_API_TOKEN` (+ optional `CLOUDFLARE_ZONE_ID`) | `dns.yml` — Zone:DNS:Edit on vyltzero.com |

## Day to day

- **Ship:** merge to `main`. CI tags, seeds int; it rolls to acc on its own.
- **Go to prod:** Promote `acc → prod` in https://rp.workstation.co.uk/?app=vyltzero.
- **Roll back:** Rollback on the ring in the RP UI (redeploys that ring's previous version).
- **Manual seed:**
  ```sh
  TOKEN=$(kubectl -n workstation-ring-promoter get secret ring-promoter \
    -o jsonpath='{.data.RP_API_TOKEN}' | base64 -d)
  curl --fail -sS -X POST 'https://rp.workstation.co.uk/api/apps/vyltzero/seed?async=1' \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"ring":"int","version":"v1.0.1"}'
  ```
- **Bootstrap admin token** for a ring (mint the first API key with it):
  ```sh
  kubectl -n vyltzero-int get secret vyltzero-mesh-keys -o jsonpath='{.data.admin-token}' | base64 -d
  ```

## Not this app

`deploy/gitops/` and `deploy/ring-promoter/upstream-display-name.*` came over from
the WSLVault codebase and describe its two-region (Manchester/London) mesh. They are
not used by the VYLTZERO rings.
