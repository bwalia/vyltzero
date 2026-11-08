#!/usr/bin/env bash
# One-time (idempotent) bootstrap of a VYLTZERO ring on k3s1.
#
#   ./scripts/vyltzero-env-bootstrap.sh <int|test|acc|prod> [...]
#   ./scripts/vyltzero-env-bootstrap.sh all
#
# For each ring it ensures, in namespace vyltzero-<env>:
#   * the namespace exists (Ring Promoter's deploy SA cannot create it)
#   * vyltzero-mesh-keys — FRESH root/JWT/PKI/audit keys + bootstrap admin
#     token, unique to this ring. Never overwritten once present: replacing
#     the root key makes every secret already stored in the ring unreadable.
#   * vyltzero-db-auth   — PostgreSQL credentials, generated before the
#     database is first initialised, adopted afterwards.
#   * the ring-deploy-job RoleBinding (deploy/ring-promoter/rbac.yaml)
#
# Nothing secret is printed. To read a ring's bootstrap admin token later:
#   kubectl -n vyltzero-<env> get secret vyltzero-mesh-keys \
#     -o jsonpath='{.data.admin-token}' | base64 -d
set -euo pipefail

cd "$(dirname "$0")/.."
: "${KUBECONFIG:=$HOME/.kube/k3s1.yaml}"
export KUBECONFIG

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
note() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[ $# -ge 1 ] || die "usage: $0 <int|test|acc|prod|all> [...]"
envs=()
for a in "$@"; do
  case "$a" in
    all) envs+=(int test acc prod) ;;
    int|test|acc|prod) envs+=("$a") ;;
    *) die "unknown ring '$a' (expected int|test|acc|prod|all)" ;;
  esac
done

for env in "${envs[@]}"; do
  ns="vyltzero-${env}"
  note "ring ${env} -> namespace ${ns}"

  kubectl create namespace "$ns" --dry-run=client -o yaml \
    | kubectl label --local -f - -o yaml \
        app.kubernetes.io/part-of=vyltzero vyltzero.io/ring="$env" \
    | kubectl apply -f - >/dev/null
  printf '  namespace ready\n'

  if kubectl -n "$ns" get secret vyltzero-mesh-keys >/dev/null 2>&1; then
    printf '  vyltzero-mesh-keys already present — kept (never rotated here)\n'
  else
    NAMESPACES="$ns" VAULT_ADMIN_TOKEN="$(openssl rand -hex 32)" \
      ./scripts/vyltzero-mesh-keys.sh create >/dev/null
    printf '  vyltzero-mesh-keys generated (unique to %s)\n' "$env"
  fi

  if kubectl -n "$ns" get secret vyltzero-db-auth >/dev/null 2>&1; then
    printf '  vyltzero-db-auth already present — kept\n'
  elif kubectl -n "$ns" get statefulset vyltzero-postgresql >/dev/null 2>&1; then
    ./scripts/vyltzero-mesh-keys.sh db-secret "$ns" >/dev/null
    printf '  vyltzero-db-auth adopted from the running database\n'
  else
    ./scripts/vyltzero-mesh-keys.sh db-secret "$ns" --generate >/dev/null
    printf '  vyltzero-db-auth generated\n'
  fi
done

note "RoleBindings for Ring Promoter (ring-exec/ring-deploy-job)"
# Apply only the ClusterRole + bindings whose namespace exists, so
# bootstrapping a single ring does not fail on the others.
existing="$(kubectl get ns -o name | sed 's#namespace/##')"
python3 - "$existing" <<'PY' | kubectl apply -f -
import sys, re
have = set(sys.argv[1].split())
docs = open('deploy/ring-promoter/rbac.yaml').read().split('\n---')
out = []
for d in docs:
    m = re.search(r'^kind: RoleBinding.*?^  namespace: (\S+)', d, re.S | re.M)
    if 'kind:' in d and (m is None or m.group(1) in have):
        out.append(d)
print('\n---'.join(out))
PY

note "done"
