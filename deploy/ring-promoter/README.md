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

Traffic: `<host>.vyltzero.com` (Cloudflare DNS-only CNAME) → `lon1.pop0.uk` (WSLProxy,
terminates TLS) → cloud001 traefik-edge `72.62.211.28:80` → vault-ui (`/`) and the
service route map (`/v1/*`) on the same host.

## Files

| File | What it is |
|------|------------|
| [`vyltzero.yaml`](vyltzero.yaml) | RP app (`deployer: k8sjob`, rings int/test/acc/prod) |
| [`rbac.yaml`](rbac.yaml) | `ring-deploy-job` RoleBindings in the four ring namespaces |
| [`vyltzero-www.yaml`](vyltzero-www.yaml) | Optional RP app for the marketing site (`deployer: github`) |
| `../helm/vyltzero/values-k3s1.yaml` | Shared overlay for every ring |
| `../helm/vyltzero/values-<env>.yaml` | Per-ring host, namespace, region id |
| `../wslproxy/data/` | Edge vhosts + routing rule (`scripts/wslproxy-register.sh`) |
| `../dns/vyltzero.com.records` | Cloudflare records (`.github/workflows/dns.yml`) |

## One-time setup

```sh
export KUBECONFIG=~/.kube/k3s1.yaml

# 1. Namespaces, per-ring keys + DB credentials, RP RoleBindings (idempotent)
./scripts/vyltzero-env-bootstrap.sh all

# 2. Edge vhosts (LAN only — the control plane is not reachable from GitHub)
./scripts/wslproxy-register.sh

# 3. Register the app: append the `apps:` item from vyltzero.yaml to
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
