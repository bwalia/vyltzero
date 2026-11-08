# Ring Promoter: deploying every region of a ring

The vyltzero.com rings are deployed by Ring Promoter's `k8sjob` deployer
(`deploy/ring-promoter/vyltzero.yaml`). Today each ring is one `helm upgrade`
into `vyltzero-<env>`. To make a ring multi-region, the job reads
`deploy/ha/<env>/regions.txt` (written by `vz_ha.py render`) and deploys
each line in order, primary first. Rings without a `regions.txt` keep the
single-release behaviour, so int, test and acc are unaffected.

## The job change

In `deploy/ring-promoter/vyltzero.yaml`, replace the section from the Secret
check down to the final `echo` with:

```sh
          cd /src/deploy/helm/vyltzero
          deploy_one() {   # $1 namespace, $2 optional region values file
            for s in vyltzero-mesh-keys vyltzero-db-auth; do
              kubectl -n "$1" get secret "$s" >/dev/null \
                || { echo "missing Secret $1/$s — bootstrap the region first"; exit 1; }
            done
            helm upgrade --install vyltzero . \
              --namespace "$1" \
              -f values-k3s1.yaml \
              -f "values-${env}.yaml" \
              ${2:+-f "/src/$2"} \
              --set global.imageTag="${ver}" \
              --wait --timeout 15m
            echo "vyltzero ${ver} live in $1"
          }
          regions="/src/deploy/ha/${env}/regions.txt"
          if [ -f "$regions" ]; then
            # Multi-region ring: primary first, so a bad release stops in the
            # region already carrying traffic, before it reaches the standby.
            grep -v '^#' "$regions" | while read -r rid rns rvals; do
              [ -n "$rid" ] || continue
              echo "== region ${rid} -> ${rns}"
              deploy_one "$rns" "$rvals"
            done
          else
            deploy_one "${ns}"
          fi
```

Also:

- **RBAC:** add a `RoleBinding` for each new namespace to
  `deploy/ring-promoter/rbac.yaml`. `vz_ha.py bootstrap --apply` already
  applies it live; the file keeps Git in step.
- **Timeout:** raise the job `timeout` from `20m` to `20m × regions` (for
  example `40m` for two), because regions deploy one after another.
- **Health:** the ring's `health_url` stays on the alias. Add each region
  host to the ring's `links` so the RP page shows both.

## Rolling it out

1. Open a PR with the job change, rbac.yaml, and `deploy/ha/<env>/`.
2. After merge, re-import the app definition into Ring Promoter
   (https://rp.workstation.co.uk). Editing the file in Git does not update
   the running RP.
3. Promote the version prod already runs, so the first multi-region deploy
   changes only topology, not code. A prod promote needs the operator's
   production password. Never look for it or guess it.

## Without Ring Promoter

Run the `helm upgrade` from SKILL.md step 8 for each line of `regions.txt`.
For Argo CD (the legacy `deploy/gitops/` mesh), add one ApplicationSet list
element per region and point `valueFiles` at the region file. The roster
invariants are the same, and `scripts/validate-gitops.sh` checks them there.
