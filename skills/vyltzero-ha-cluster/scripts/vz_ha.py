#!/usr/bin/env python3
"""vz_ha.py: plan, check and verify a multi-region active/active VYLTZERO mesh.

Used by the vyltzero-ha-cluster and vyltzero-ha-failover agent skills.
Python 3.8+, standard library only. Shells out to kubectl, helm, curl and ssh.

    vz_ha.py init      --env prod --alias app.vyltzero.com \
                       --region prod:vyltzero-prod:vps002:app-a.vyltzero.com \
                       --region prod-b:vyltzero-prod-b:cloud003:app-b.vyltzero.com
    vz_ha.py preflight deploy/ha/prod/mesh.json
    vz_ha.py render    deploy/ha/prod/mesh.json
    vz_ha.py validate  deploy/ha/prod/mesh.json
    vz_ha.py keys      deploy/ha/prod/mesh.json
    vz_ha.py bootstrap deploy/ha/prod/mesh.json --region prod-b [--apply]
    vz_ha.py verify    deploy/ha/prod/mesh.json
    vz_ha.py status    deploy/ha/prod/mesh.json [--pop]

Safety:
  * Only `init`, `render` (local files) and `bootstrap --apply` change
    anything. Every other command reads only.
  * Key material is never printed. Secrets are compared by SHA-256
    fingerprint, and the peer token is read inside this process and sent
    only to the region's own peer endpoint.
  * Shared mesh keys are never written here. That is left to
    scripts/vyltzero-mesh-keys.sh, run as its own command so the operator
    sees it.
"""
import argparse
import base64
import hashlib
import ipaddress
import json
import os
import re
import shlex
import subprocess
import sys
import urllib.error
import urllib.request

MESH_KEYS = ["root-key", "jwt-secret", "pki-root-key", "replication-peer-token", "audit-signing-key"]
EDGE_TAINT = "node-role.kubernetes.io/edge"
LON1 = "root@195.20.255.201"
POP_DATA = "/opt/nginx/data"
UA = "vyltzero-ha-skill/1.0"

GREEN, RED, YELLOW, BOLD, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[1m", "\033[0m"
if not sys.stdout.isatty():
    GREEN = RED = YELLOW = BOLD = RESET = ""

_fail = 0


def note(msg):
    print(f"\n{BOLD}==> {msg}{RESET}")


def ok(msg):
    print(f"  {GREEN}ok{RESET}   {msg}")


def warn(msg):
    print(f"  {YELLOW}warn{RESET} {msg}")


def bad(msg):
    global _fail
    _fail = 1
    print(f"  {RED}FAIL{RESET} {msg}")


def die(msg):
    print(f"{RED}error:{RESET} {msg}", file=sys.stderr)
    sys.exit(2)


# ─── shell helpers ──────────────────────────────────────────────────────────

def run(cmd, check=False, stdin=None, env=None, timeout=120):
    try:
        p = subprocess.run(cmd, input=stdin, capture_output=True, text=True, env=env, timeout=timeout)
    except FileNotFoundError:
        die(f"{cmd[0]} not found on PATH")
    except subprocess.TimeoutExpired:
        return 124, "", f"timed out after {timeout}s"
    if check and p.returncode != 0:
        die(f"{' '.join(shlex.quote(c) for c in cmd)} failed:\n{p.stderr.strip()}")
    return p.returncode, p.stdout, p.stderr


def kube_env(region):
    env = dict(os.environ)
    kc = region.get("kubeconfig")
    if kc:
        env["KUBECONFIG"] = os.path.expanduser(kc)
    return env


def kctl(region, *args, check=False, stdin=None, timeout=60):
    cmd = ["kubectl"]
    if region.get("context"):
        cmd += ["--context", region["context"]]
    return run(cmd + list(args), check=check, stdin=stdin, env=kube_env(region), timeout=timeout)


def kjson(region, *args):
    rc, out, err = kctl(region, *args, "-o", "json")
    if rc != 0:
        return None
    try:
        return json.loads(out)
    except ValueError:
        return None


def http(url, headers=None, timeout=10):
    """Return (status, body). Status 0 means the request never got an answer."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(4096).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(4096).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - any network failure is "no answer"
        return 0, str(e)


def cpu_milli(q):
    q = str(q)
    if q.endswith("m"):
        return int(float(q[:-1]))
    return int(float(q) * 1000)


# ─── mesh file ──────────────────────────────────────────────────────────────

def load_mesh(path):
    try:
        with open(path) as f:
            mesh = json.load(f)
    except (OSError, ValueError) as e:
        die(f"cannot read mesh file {path}: {e}")
    mesh["_path"] = os.path.abspath(path)
    mesh["_dir"] = os.path.dirname(mesh["_path"])
    regions = mesh.get("regions") or []
    if len(regions) < 2:
        die("a mesh needs at least two regions")
    for key in ("id", "namespace", "node", "host"):
        vals = [r.get(key) for r in regions]
        if not all(vals):
            die(f"every region needs '{key}'")
        if len(set(vals)) != len(vals):
            die(f"region '{key}' values must be unique: {vals}")
    prim = [r for r in regions if r.get("primary")]
    if len(prim) != 1:
        die("exactly one region must have \"primary\": true (it serves the alias)")
    return mesh


def repo_root(mesh):
    d = mesh["_dir"]
    while d != "/":
        if os.path.isdir(os.path.join(d, ".git")):
            return d
        d = os.path.dirname(d)
    die("mesh file is not inside a git checkout of the vyltzero repo")


def chart_dir(mesh):
    return os.path.join(repo_root(mesh), mesh.get("chart", "deploy/helm/vyltzero"))


def values_path(mesh, region):
    return os.path.join(mesh["_dir"], f"{region['id']}.values.yaml")


def roster(mesh):
    return [{"id": r["id"], "displayName": r.get("display_name", r["id"]),
             "replicationUrl": f"https://{r['host']}"} for r in mesh["regions"]]


# ─── init ───────────────────────────────────────────────────────────────────

def node_facts(region):
    node = kjson(region, "get", "node", region["node"])
    if not node:
        die(f"node {region['node']} not found (kubeconfig/context right?)")
    addrs = {a["type"]: a["address"] for a in node["status"].get("addresses", [])}
    cidr = node["spec"].get("podCIDR")
    if not cidr:
        die(f"node {region['node']} has no podCIDR")
    net = ipaddress.ip_network(cidr)
    edge_cidr = f"{net.network_address}/31"
    origin = addrs.get("ExternalIP") or addrs.get("InternalIP")
    return origin, edge_cidr


def cmd_init(a):
    out = a.out or f"deploy/ha/{a.env}/mesh.json"
    if os.path.exists(out) and not a.force:
        die(f"{out} exists; edit it, or pass --force to regenerate")
    regions = []
    for i, spec in enumerate(a.region):
        parts = spec.split(":")
        if len(parts) != 4:
            die(f"--region wants ID:NAMESPACE:NODE:HOST, got {spec!r}")
        rid, ns, node, host = parts
        r = {"id": rid, "display_name": rid, "namespace": ns, "node": node, "host": host,
             "primary": i == 0}
        if a.kubeconfig:
            r["kubeconfig"] = a.kubeconfig
        origin, edge_cidr = node_facts(r)
        r["origin"] = origin
        r["edge_cidr"] = edge_cidr
        # A live release already stamped its region id on every replication
        # event; renaming it orphans that state.
        rc, vals, _ = run(["helm", "-n", ns, "get", "values", a.release, "-a", "-o", "json"],
                          env=kube_env(r))
        if rc == 0:
            live = (json.loads(vals).get("global", {}).get("region", {}) or {}).get("id")
            if live and live != rid:
                warn(f"{ns} already runs region id '{live}', not '{rid}'. Keep '{live}' unless "
                     f"the operator confirms the region holds no data.")
        regions.append(r)
    mesh = {
        "env": a.env,
        "alias": a.alias,
        "release": a.release,
        "chart": "deploy/helm/vyltzero",
        "base_values": a.base_values or ["values-k3s1.yaml", f"values-{a.env}.yaml"],
        "public_url": f"https://{a.alias}",
        "secret_name": "vyltzero-mesh-keys",
        # Flip to true only after `verify` shows the deployed image answers 401
        # to an unauthenticated peer pull (see references/architecture.md).
        "publish_peer_endpoint": False,
        "regions": regions,
    }
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w") as f:
        json.dump(mesh, f, indent=2)
        f.write("\n")
    print(f"wrote {out}")
    for r in regions:
        print(f"  {r['id']:<10} ns={r['namespace']:<18} node={r['node']:<10} origin={r['origin']:<15} "
              f"edge_cidr={r['edge_cidr']:<15} host={r['host']}{'  (primary, serves alias)' if r['primary'] else ''}")


# ─── render ─────────────────────────────────────────────────────────────────

def yaml_dump(obj, indent=0):
    """Minimal YAML emitter for dicts, lists and scalars. Strings are JSON-quoted,
    which is valid YAML, so no value can be misread as another type."""
    pad = "  " * indent
    lines = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (dict, list)) and v:
                lines.append(f"{pad}{k}:")
                lines.append(yaml_dump(v, indent + 1))
            else:
                lines.append(f"{pad}{k}: {scalar(v)}")
    elif isinstance(obj, list):
        for v in obj:
            if isinstance(v, dict) and v:
                inner = yaml_dump(v, indent + 1).split("\n")
                lines.append(f"{pad}- {inner[0].lstrip()}")
                lines.extend(inner[1:])
            else:
                lines.append(f"{pad}- {scalar(v)}")
    return "\n".join(lines)


def scalar(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, dict):
        return "{}"
    if isinstance(v, list):
        return "[]"
    return json.dumps(v)


def region_values(mesh, r):
    node_sel = {"kubernetes.io/hostname": r["node"]}
    tol = [{"key": EDGE_TAINT, "operator": "Exists", "effect": "NoSchedule"}]
    cidrs = [r["edge_cidr"]]
    hosts = [r["host"]]
    extra = [mesh["alias"]] if r.get("primary") else []
    return {
        "global": {
            "namespace": r["namespace"],
            "region": {
                "id": r["id"],
                "displayName": r.get("display_name", r["id"]),
                "endpoint": f"https://{r['host']}",
                "peers": roster(mesh),
            },
            "scheduling": {"nodeSelector": node_sel, "tolerations": tol, "affinity": {}},
            "edgeHostCidrs": cidrs,
        },
        "networkPolicies": {"wslproxyHostIngress": {"cidrs": cidrs}},
        "ui": {"host": r["host"], "extraHosts": extra, "wslproxyIngress": {"cidrs": cidrs}},
        "edgeIngress": {
            "host": r["host"],
            "extraHosts": extra,
            "tls": {"secretName": "vyltzero-gateway-tls", "hosts": hosts + extra},
        },
        "identityService": {"publicUrl": mesh.get("public_url", f"https://{mesh['alias']}")},
        "replicationAgent": {
            "enabled": True,
            # One node per region: a second replica is a standby on the same
            # node and adds CPU requests without adding availability.
            "replicaCount": 1,
            "publishPeerEndpoint": bool(mesh.get("publish_peer_endpoint")),
        },
        "regionHealth": {"enabled": True, "replicaCount": 1},
        "postgresql": {"primary": {"nodeSelector": node_sel, "tolerations": tol}},
    }


def cmd_render(a):
    mesh = load_mesh(a.mesh)
    order = []
    for r in mesh["regions"]:
        p = values_path(mesh, r)
        head = (f"# GENERATED by skills/vyltzero-ha-cluster/scripts/vz_ha.py render\n"
                f"# from {os.path.relpath(mesh['_path'], repo_root(mesh))}. Edit mesh.json and re-render;\n"
                f"# hand edits are lost. Layered AFTER {', '.join(mesh['base_values'])}.\n"
                f"# Region {r['id']} -> ns {r['namespace']} on node {r['node']} "
                f"({'PRIMARY: also serves ' + mesh['alias'] if r.get('primary') else 'secondary'}).\n")
        with open(p, "w") as f:
            f.write(head + yaml_dump(region_values(mesh, r)) + "\n")
        order.append(f"{r['id']} {r['namespace']} {os.path.relpath(p, repo_root(mesh))}")
        print(f"wrote {os.path.relpath(p)}")
    # Deploy order: primary first, so a bad chart change shows up in the
    # region that already carries traffic, under the operator's eye, before
    # it reaches the standby.
    prim = [l for l, r in zip(order, mesh["regions"]) if r.get("primary")]
    rest = [l for l, r in zip(order, mesh["regions"]) if not r.get("primary")]
    rp = os.path.join(mesh["_dir"], "regions.txt")
    with open(rp, "w") as f:
        f.write("# <region-id> <namespace> <values-file>   (deploy order; generated by vz_ha.py render)\n")
        f.write("\n".join(prim + rest) + "\n")
    print(f"wrote {os.path.relpath(rp)}")


# ─── preflight ──────────────────────────────────────────────────────────────

def cmd_preflight(a):
    mesh = load_mesh(a.mesh)
    note("tools")
    for t in ("kubectl", "helm", "curl"):
        rc, _, _ = run(["which", t])
        (ok if rc == 0 else bad)(t)

    nodes_seen = {}
    for r in mesh["regions"]:
        note(f"region {r['id']}  (ns {r['namespace']}, node {r['node']})")
        node = kjson(r, "get", "node", r["node"])
        if not node:
            bad(f"cannot read node {r['node']}: check kubeconfig/context")
            continue
        conds = {c["type"]: c["status"] for c in node["status"].get("conditions", [])}
        (ok if conds.get("Ready") == "True" else bad)(f"node Ready={conds.get('Ready')}")
        taints = [t["key"] for t in node["spec"].get("taints", []) or []]
        if EDGE_TAINT in taints:
            ok("edge node (taint tolerated by the rendered values)")
        else:
            warn("not an edge node: the region values tolerate the edge taint but do not need it")
        cidr = node["spec"].get("podCIDR")
        want = f"{ipaddress.ip_network(cidr).network_address}/31" if cidr else None
        (ok if want == r.get("edge_cidr") else bad)(f"edge_cidr {r.get('edge_cidr')} (node podCIDR {cidr})")
        nodes_seen.setdefault(r["node"], []).append(r["id"])

        pods = kjson(r, "get", "pods", "-n", "kube-system", "--field-selector", f"spec.nodeName={r['node']}")
        names = {}
        for p in (pods or {}).get("items", []):
            ready = all(c.get("ready") for c in p["status"].get("containerStatuses", []) or [])
            names[p["metadata"]["name"]] = ready
        for prefix, why in (("coredns", "in-cluster DNS (kube-dns is node-local)"),
                            ("traefik-edge", "edge ingress for the region's hosts")):
            hit = {n: rd for n, rd in names.items() if n.startswith(prefix)}
            if hit and all(hit.values()):
                ok(f"{prefix} Ready on node: {why}")
            else:
                bad(f"{prefix} not Ready on {r['node']}: {why}")

        # CPU headroom: a region of this chart requests roughly 2 CPU at one
        # replica per service. Pending pods are the usual first failure.
        alloc = cpu_milli(node["status"]["allocatable"]["cpu"])
        allpods = kjson(r, "get", "pods", "-A", "--field-selector",
                        f"spec.nodeName={r['node']},status.phase!=Succeeded,status.phase!=Failed")
        used = 0
        for p in (allpods or {}).get("items", []):
            for c in p["spec"].get("containers", []):
                req = (c.get("resources") or {}).get("requests") or {}
                if "cpu" in req:
                    used += cpu_milli(req["cpu"])
        ns_used = sum(cpu_milli(((c.get("resources") or {}).get("requests") or {}).get("cpu", "0"))
                      for p in (allpods or {}).get("items", []) if p["metadata"]["namespace"] == r["namespace"]
                      for c in p["spec"].get("containers", []))
        free = alloc - used + ns_used
        msg = f"CPU requests {used}m / {alloc}m allocatable; ~{free}m free for this region"
        (ok if free >= 2000 else warn)(msg + ("" if free >= 2000 else ": tight, expect Pending pods"))

        rc, out, _ = kctl(r, "get", "storageclass", "local-path", "-o", "name")
        (ok if rc == 0 else bad)("storageclass local-path")

        ns = kjson(r, "get", "namespace", r["namespace"])
        if ns:
            ok(f"namespace {r['namespace']} exists")
            for s in (mesh.get("secret_name", "vyltzero-mesh-keys"), "vyltzero-db-auth"):
                rc, _, _ = kctl(r, "-n", r["namespace"], "get", "secret", s)
                (ok if rc == 0 else warn)(f"secret {s} {'present' if rc == 0 else 'missing: bootstrap/keys step'}")
            rc, _, _ = kctl(r, "-n", r["namespace"], "get", "rolebinding", "rp-deploy-vyltzero")
            (ok if rc == 0 else warn)("Ring Promoter RoleBinding " + ("present" if rc == 0 else "missing: bootstrap step"))
            rc, _, _ = kctl(r, "-n", r["namespace"], "get", "statefulset", "vyltzero-postgresql")
            if rc == 0:
                warn("PostgreSQL already exists here: this region HOLDS DATA. Its mesh keys must be the "
                     "source for every other region (keys step), never overwritten.")
        else:
            warn(f"namespace {r['namespace']} does not exist yet: bootstrap step creates it")

        # Public path: DNS -> POP -> origin.
        st, body = http(f"https://{r['host']}/api/version")
        if st == 200:
            ok(f"https://{r['host']}/api/version -> 200 {body.strip()[:80]}")
        elif st == 0:
            warn(f"https://{r['host']} does not answer yet ({body[:60]}): DNS + WSLProxy vhost needed")
        else:
            warn(f"https://{r['host']}/api/version -> {st} (vhost exists, region not deployed?)")

    note("mesh-wide")
    for node, ids in nodes_seen.items():
        if len(ids) > 1:
            bad(f"regions {ids} share node {node}: one node failure takes both down; that is not HA")
    if len(nodes_seen) == len(mesh["regions"]):
        ok("every region on its own node")
    cl = {(r.get("kubeconfig"), r.get("context")) for r in mesh["regions"]}
    if len(cl) == 1:
        warn("all regions share one Kubernetes control plane. Running pods survive a control-plane "
             "outage, but nothing can be (re)scheduled during one. For full independence give each "
             "region its own cluster (kubeconfig/context per region).")
    # Ingress hosts must be unique cluster-wide: traefik-edge is one DaemonSet
    # watching every namespace, so a host claimed twice routes unpredictably.
    claims, seen_clusters = {}, set()
    for r in mesh["regions"]:
        key = (r.get("kubeconfig"), r.get("context"))
        if key in seen_clusters:
            continue
        seen_clusters.add(key)
        for i in (kjson(r, "get", "ingress", "-A") or {}).get("items", []):
            for rule in i["spec"].get("rules", []) or []:
                if rule.get("host"):
                    claims.setdefault(rule["host"], set()).add(i["metadata"]["namespace"])
    prim = next(r for r in mesh["regions"] if r.get("primary"))
    mine = {r["host"]: r["namespace"] for r in mesh["regions"]}
    mine[mesh["alias"]] = prim["namespace"]
    for h, owner in mine.items():
        others = claims.get(h, set()) - {owner}
        if others:
            bad(f"{h} is already claimed by an Ingress in {sorted(others)}; it must belong to {owner} only")
        else:
            ok(f"{h}: no conflicting Ingress")
    if args_pop(a):
        pop_check(mesh)
    return finish()


def args_pop(a):
    return getattr(a, "pop", False)


def pop_rules(host):
    """Read the WSLProxy server + rule for host from lon1 (read only)."""
    rc, out, err = run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", LON1,
                        f"cat '{POP_DATA}/servers/prod/host:{host}.json' 2>/dev/null"], timeout=30)
    if rc != 0 or not out.strip():
        return None
    try:
        server = json.loads(out)
    except ValueError:
        return None
    rid = server.get("rules")
    rc, out, _ = run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", LON1,
                      f"cat {POP_DATA}/rules/prod/{rid}.json; echo; "
                      f"grep -l '\"rules\": *\"{rid}\"' {POP_DATA}/servers/prod/*.json | wc -l"], timeout=30)
    lines = out.strip().rsplit("\n", 1)
    try:
        rule = json.loads(lines[0])
        sharers = int(lines[1].strip())
    except (ValueError, IndexError):
        rule, sharers = {}, -1
    backend = ((rule.get("match") or {}).get("response") or {}).get("redirect_uri")
    return {"rule_id": rid, "rule_name": rule.get("name"), "backend": backend,
            "upstream_host": server.get("proxy_server_name"), "sharers": sharers}


def pop_check(mesh):
    note(f"WSLProxy (lon1, read only)")
    info = pop_rules(mesh["alias"])
    if not info:
        warn(f"no vhost for {mesh['alias']} on lon1 (or no SSH access as {LON1})")
        return None
    print(f"  {mesh['alias']}: rule {info['rule_name']} ({info['rule_id']}) -> {info['backend']}, "
          f"Host: {info['upstream_host']}")
    if info["sharers"] > 1:
        bad(f"the alias shares rule {info['rule_id']} with {info['sharers'] - 1} other host(s). Repointing "
            f"it would move ALL of them. Give the alias its own rule first (references/edge-and-dns.md).")
    else:
        ok("the alias has a dedicated rule: safe to repoint for region failover")
    for r in mesh["regions"]:
        ri = pop_rules(r["host"])
        if not ri:
            warn(f"no vhost for {r['host']} yet")
            continue
        want = r["origin"]
        (ok if ri["backend"] and want in ri["backend"] else bad)(
            f"{r['host']} -> {ri['backend']} (Host: {ri['upstream_host']}); expected origin {want}")
    return info


# ─── validate ───────────────────────────────────────────────────────────────

def helm_template(mesh, r):
    chart = chart_dir(mesh)
    files = [os.path.join(chart, v) for v in mesh["base_values"]] + [values_path(mesh, r)]
    for f in files:
        if not os.path.exists(f):
            die(f"missing values file {f} (run `render` first?)")
    cmd = ["helm", "template", mesh.get("release", "vyltzero"), chart, "--namespace", r["namespace"]]
    for f in files:
        cmd += ["-f", f]
    cmd += ["--set", "global.imageTag=validate"]
    return run(cmd, timeout=180)


def cmd_validate(a):
    mesh = load_mesh(a.mesh)
    ids = [r["id"] for r in mesh["regions"]]
    rosters = set()
    for r in mesh["regions"]:
        note(f"render {r['id']}")
        rc, out, err = helm_template(mesh, r)
        if rc != 0:
            bad(f"helm template failed:\n{err.strip()[:1500]}")
            continue
        ok(f"renders ({out.count(chr(10) + 'kind: ')} objects)")

        sel = set(re.findall(r"kubernetes\.io/hostname:\s*\"?([\w.-]+)\"?", out))
        (ok if sel == {r["node"]} else bad)(f"every pod pinned to {r['node']} (found {sorted(sel)})")

        hosts = set(re.findall(r"- host:\s*\"?([\w.-]+)\"?", out))
        allowed = {r["host"]} | ({mesh["alias"]} if r.get("primary") else set())
        (ok if hosts and hosts <= allowed else bad)(f"Ingress hosts {sorted(hosts)} (allowed {sorted(allowed)})")
        if not r.get("primary") and mesh["alias"] in hosts:
            bad(f"secondary region claims the alias {mesh['alias']}: only the primary may")

        m = re.search(r"name: REPLICATION_PEERS\s+value:\s*\"?([^\"\n]*)\"?", out)
        if not m:
            bad("replication-agent not rendered (REPLICATION_PEERS missing)")
        else:
            got = dict(p.split("=", 1) for p in m.group(1).split(",") if "=" in p)
            want = {x["id"]: x["replicationUrl"] for x in roster(mesh) if x["id"] != r["id"]}
            (ok if got == want else bad)(f"REPLICATION_PEERS = {m.group(1)}")
            rosters.add(tuple(sorted(list(got.items()) + [(r["id"], f"https://{r['host']}")])))

        if f"name: {mesh.get('secret_name', 'vyltzero-mesh-keys')}" in out:
            ok(f"keys read from shared Secret {mesh.get('secret_name', 'vyltzero-mesh-keys')}")
        else:
            bad("rendered output does not reference the shared mesh Secret")

        pub = re.search(r"path:\s*\"?/v1/replication\"?\s*$", out, re.M) is not None
        if mesh.get("publish_peer_endpoint"):
            (ok if pub else bad)("peer endpoint /v1/replication published on the edge Ingress")
        else:
            warn("peer endpoint NOT published (publish_peer_endpoint=false): regions will not replicate "
                 "until it is enabled after the guard check")

        mig = re.findall(r"name: vyltzero-migrations-\w+", out)
        (ok if mig else bad)("schema migrations Job rendered")

    note("mesh-wide")
    (ok if len(rosters) == 1 else bad)("every region sees the same full roster" if len(rosters) == 1
                                       else f"rosters differ between regions: {rosters}")
    return finish()


# ─── keys ───────────────────────────────────────────────────────────────────

def fingerprint(mesh, r):
    sec = kjson(r, "-n", r["namespace"], "get", "secret", mesh.get("secret_name", "vyltzero-mesh-keys"))
    if not sec:
        return None, []
    data = sec.get("data", {})
    missing = [k for k in MESH_KEYS if not data.get(k)]
    h = hashlib.sha256("".join(data.get(k, "") for k in MESH_KEYS).encode()).hexdigest()[:16]
    return h, missing


def has_data(r):
    rc, _, _ = kctl(r, "-n", r["namespace"], "get", "statefulset", "vyltzero-postgresql")
    return rc == 0


def cmd_keys(a):
    mesh = load_mesh(a.mesh)
    note("mesh key fingerprints (sha256 prefix; no key material is shown)")
    fps, holders = {}, []
    for r in mesh["regions"]:
        fp, missing = fingerprint(mesh, r)
        data = has_data(r)
        if data:
            holders.append(r)
        fps[r["id"]] = fp
        print(f"  {r['id']:<10} {r['namespace']:<18} {fp or '(no Secret)':<18} "
              f"{'HOLDS DATA' if data else 'empty':<11} {('missing: ' + ','.join(missing)) if missing else ''}")
    distinct = {v for v in fps.values() if v}
    note("recommendation")
    names = " ".join(r["namespace"] for r in mesh["regions"])
    if len(distinct) == 1 and all(fps.values()):
        ok("all regions hold identical key material: nothing to do")
        return finish()
    if len(holders) > 1:
        fp_h = {fps[r["id"]] for r in holders}
        if len(fp_h) > 1:
            bad("more than one region holds data AND their keys differ. Copying keys would make one "
                "region's existing secrets undecryptable. STOP: this needs a data migration "
                "(export from one region, re-import into the other), not a key copy.")
            return finish()
    src = holders[0] if holders else next(r for r in mesh["regions"] if r.get("primary"))
    if not fps[src["id"]]:
        print(f"  No region has keys yet. Create one fresh set for the whole mesh:\n"
              f"    NAMESPACES=\"{names}\" ./scripts/vyltzero-mesh-keys.sh create")
    else:
        targets = [r for r in mesh["regions"] if r is not src]
        for t in targets:
            if has_data(t) and fps[t["id"]] and fps[t["id"]] != fps[src["id"]]:
                bad(f"{t['namespace']} holds data under different keys; copying would orphan it")
                return finish()
        print(f"  Source of truth: {src['namespace']} ({'holds data' if holders else 'primary'}).\n"
              f"  Copy its keys to the other regions (overwrites THEIR keys; they must be empty):\n"
              f"    NAMESPACES=\"{names}\" ./scripts/vyltzero-mesh-keys.sh copy-from {src['namespace']}\n"
              f"  Then confirm:\n"
              f"    NAMESPACES=\"{names}\" ./scripts/vyltzero-mesh-keys.sh verify")
    return finish()


# ─── bootstrap ──────────────────────────────────────────────────────────────

RB = """apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: rp-deploy-vyltzero
  namespace: {ns}
  labels:
    app.kubernetes.io/part-of: vyltzero
subjects:
  - kind: ServiceAccount
    name: ring-deploy-job
    namespace: ring-exec
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: rp-deploy-vyltzero
"""


def cmd_bootstrap(a):
    mesh = load_mesh(a.mesh)
    r = next((x for x in mesh["regions"] if x["id"] == a.region), None)
    if not r:
        die(f"no region {a.region} in mesh")
    ns = r["namespace"]
    root = repo_root(mesh)
    steps = [
        ("namespace", ["kubectl", "create", "namespace", ns]),
        ("db credentials", [os.path.join(root, "scripts/vyltzero-mesh-keys.sh"), "db-secret", ns]
         + ([] if has_data(r) else ["--generate"])),
        ("Ring Promoter RoleBinding", ["kubectl", "apply", "-f", "-"]),
    ]
    note(f"bootstrap {r['id']} -> {ns} ({'apply' if a.apply else 'plan only; add --apply'})")
    exists = kjson(r, "get", "namespace", ns) is not None
    for name, cmd in steps:
        if name == "namespace" and exists:
            ok("namespace exists")
            continue
        if name == "db credentials":
            rc, _, _ = kctl(r, "-n", ns, "get", "secret", "vyltzero-db-auth")
            if rc == 0:
                ok("vyltzero-db-auth exists (kept)")
                continue
        if not a.apply:
            print(f"  would run: {' '.join(cmd)}")
            continue
        env = kube_env(r)
        if cmd[0] == "kubectl" and r.get("context"):
            cmd = cmd[:1] + ["--context", r["context"]] + cmd[1:]
        stdin = RB.format(ns=ns) if name.startswith("Ring") else None
        if name == "namespace":
            cmd = cmd + ["--dry-run=client", "-o", "yaml"]
            rc, out, err = run(cmd, env=env)
            rc, out, err = run(["kubectl", "label", "--local", "-f", "-", "-o", "yaml",
                                "app.kubernetes.io/part-of=vyltzero", f"vyltzero.io/region={r['id']}"],
                               stdin=out, env=env)
            rc, out, err = run(["kubectl", "apply", "-f", "-"] if not r.get("context") else
                               ["kubectl", "--context", r["context"], "apply", "-f", "-"], stdin=out, env=env)
        else:
            if name == "db credentials":
                env["NAMESPACES"] = ns
            rc, out, err = run(cmd, stdin=stdin, env=env)
        (ok if rc == 0 else bad)(f"{name}{'' if rc == 0 else ': ' + err.strip()[:300]}")
    print("\n  Mesh keys are NOT handled here. Run `vz_ha.py keys` for the exact command.")
    return finish()


# ─── verify / status ────────────────────────────────────────────────────────

def psql(r, sql):
    shell = 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DATABASE" -At -F"|" -f -'
    rc, out, err = kctl(r, "-n", r["namespace"], "exec", "-i", "vyltzero-postgresql-0", "-c", "postgresql",
                        "--", "sh", "-c", shell, stdin=sql)
    return (out if rc == 0 else None), err


def peer_token(mesh, r):
    sec = kjson(r, "-n", r["namespace"], "get", "secret", mesh.get("secret_name", "vyltzero-mesh-keys"))
    raw = ((sec or {}).get("data") or {}).get("replication-peer-token")
    return base64.b64decode(raw).decode() if raw else None


def region_report(mesh, r, deep=True):
    note(f"region {r['id']}  ({r['namespace']} on {r['node']}, https://{r['host']})")
    pods = kjson(r, "-n", r["namespace"], "get", "pods")
    if pods is None:
        bad("cannot list pods")
        return None
    notready = []
    for p in pods.get("items", []):
        if p["status"].get("phase") == "Succeeded":
            continue
        if not all(c.get("ready") for c in p["status"].get("containerStatuses", []) or [{}]):
            notready.append(p["metadata"]["name"])
    total = len([p for p in pods.get("items", []) if p["status"].get("phase") != "Succeeded"])
    (ok if total and not notready else bad)(f"{total - len(notready)}/{total} pods Ready"
                                            + (f"; not ready: {', '.join(notready[:6])}" if notready else ""))
    st, body = http(f"https://{r['host']}/api/version")
    ver = None
    if st == 200:
        try:
            ver = json.loads(body).get("version")
        except ValueError:
            pass
        ok(f"/api/version {ver}")
    else:
        bad(f"https://{r['host']}/api/version -> {st or body[:80]}")
    if not deep:
        return ver
    out, err = psql(r, "SELECT id, status, is_local, coalesce(replication_lag_ms::text,'-'), "
                       "coalesce(to_char(last_seen,'HH24:MI:SS'),'-') FROM system.regions ORDER BY id;\n"
                       "SELECT count(*) FROM system.replication_events;\n")
    if out is None:
        bad(f"cannot query system.regions: {err.strip()[:200]}")
    else:
        rows = [l for l in out.strip().split("\n") if l]
        events = rows.pop() if rows and "|" not in rows[-1] else "?"
        known = set()
        for row in rows:
            rid, status, local, lag, seen = (row.split("|") + ["", "", "", "", ""])[:5]
            known.add(rid)
            mark = ok if status == "active" else (warn if local == "t" else bad)
            mark(f"system.regions {rid:<10} {status:<9} local={local} lag_ms={lag} last_seen={seen}")
        missing = {x["id"] for x in mesh["regions"]} - known
        if missing:
            bad(f"roster rows missing: {sorted(missing)} (migrations Job seeds them)")
        print(f"       replication_events in outbox: {events}")
    return ver


def cmd_verify(a):
    mesh = load_mesh(a.mesh)
    note("mesh keys identical in every region")
    fps = {r["id"]: fingerprint(mesh, r)[0] for r in mesh["regions"]}
    if None in fps.values():
        bad(f"Secret missing in {[k for k, v in fps.items() if v is None]}")
    elif len(set(fps.values())) == 1:
        ok(f"all regions: {next(iter(fps.values()))}")
    else:
        bad(f"key material differs: {fps}. Replicated secrets will NOT decrypt.")

    versions = {}
    for r in mesh["regions"]:
        versions[r["id"]] = region_report(mesh, r)
        # The peer API must refuse anonymous pulls and accept the mesh token.
        url = f"https://{r['host']}/v1/replication/events?source_region=vz-ha-verify&limit=1"
        st, _ = http(url)
        if st == 404:
            warn("peer endpoint not published (404): replication is OFF for this region")
        elif st in (401, 503):
            ok(f"anonymous peer pull refused ({st})")
            tok = peer_token(mesh, r)
            if tok:
                st2, _ = http(url, headers={"Authorization": f"Bearer {tok}"})
                (ok if st2 == 200 else bad)(f"peer pull with the mesh token -> {st2}")
            else:
                bad("replication-peer-token missing from the mesh Secret")
        elif st == 200:
            bad("peer endpoint serves the outbox WITHOUT a token: unpublish now "
                "(publish_peer_endpoint=false), the image predates the auth guard")
        else:
            warn(f"peer endpoint -> {st}")

    note("mesh-wide")
    vs = {v for v in versions.values() if v}
    (ok if len(vs) == 1 and len(versions) == len([v for v in versions.values() if v]) else warn)(
        f"versions: {versions}")
    st, body = http(f"https://{mesh['alias']}/api/version")
    (ok if st == 200 else bad)(f"alias https://{mesh['alias']} -> {st} {body.strip()[:80] if st == 200 else ''}")
    return finish()


def cmd_status(a):
    mesh = load_mesh(a.mesh)
    for r in mesh["regions"]:
        region_report(mesh, r, deep=not a.quick)
    note("alias")
    st, body = http(f"https://{mesh['alias']}/api/version")
    (ok if st == 200 else bad)(f"https://{mesh['alias']}/api/version -> {st} {body.strip()[:80] if st == 200 else body[:80]}")
    if a.pop:
        info = pop_check(mesh)
        if info:
            active = [r["id"] for r in mesh["regions"]
                      if info["backend"] and r["origin"] in info["backend"]]
            print(f"\n  {BOLD}alias currently routed to: {', '.join(active) or 'UNKNOWN origin ' + str(info['backend'])}"
                  f"{RESET}")
    return finish()


def finish():
    print()
    if _fail:
        print(f"{RED}{BOLD}FAILED{RESET}: fix the items marked FAIL before continuing.")
        return 1
    print(f"{GREEN}{BOLD}PASSED{RESET}")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    i = sub.add_parser("init", help="discover nodes and write a mesh.json")
    i.add_argument("--env", required=True)
    i.add_argument("--alias", required=True, help="public name clients use, e.g. app.vyltzero.com")
    i.add_argument("--region", action="append", required=True,
                   help="ID:NAMESPACE:NODE:HOST; the first one is primary (serves the alias)")
    i.add_argument("--kubeconfig")
    i.add_argument("--release", default="vyltzero")
    i.add_argument("--base-values", nargs="*")
    i.add_argument("--out")
    i.add_argument("--force", action="store_true")
    i.set_defaults(fn=cmd_init)

    for name, fn, helptext in (
        ("preflight", cmd_preflight, "check nodes, DNS, ingress and secrets before deploying"),
        ("render", cmd_render, "write <region>.values.yaml and regions.txt next to mesh.json"),
        ("validate", cmd_validate, "helm-render every region and check the mesh invariants"),
        ("keys", cmd_keys, "compare key fingerprints and print the safe key command"),
        ("verify", cmd_verify, "post-deploy: keys, pods, peer auth, region roster, alias"),
        ("status", cmd_status, "health of every region and where the alias points"),
    ):
        s = sub.add_parser(name, help=helptext)
        s.add_argument("mesh")
        if name in ("preflight", "status"):
            s.add_argument("--pop", action="store_true", help="also read the WSLProxy rules on lon1 over SSH")
        if name == "status":
            s.add_argument("--quick", action="store_true", help="skip the database queries")
        s.set_defaults(fn=fn)

    b = sub.add_parser("bootstrap", help="namespace, DB credentials, RoleBinding for one region")
    b.add_argument("mesh")
    b.add_argument("--region", required=True)
    b.add_argument("--apply", action="store_true")
    b.set_defaults(fn=cmd_bootstrap)

    a = p.parse_args()
    rc = a.fn(a)
    sys.exit(rc or 0)


if __name__ == "__main__":
    main()
