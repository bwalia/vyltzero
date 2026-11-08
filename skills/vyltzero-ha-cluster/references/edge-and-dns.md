# Edge and DNS for a region mesh

Every region host (`app-a.vyltzero.com`, `app-b.vyltzero.com`) needs the same
public path the rings already use:

```
Cloudflare (vyltzero.com zone)  NS  <host> → ns1/ns2.nebuladns.net
NebulaDNS                       A   <host> → lon1 | lon2 (TTL 30, health-flipped)
WSLProxy (cp.pop0.uk → lon1, mirrored to lon2)   vhost <host> → region origin :80
traefik-edge on the region's node                 Ingress <host> → services
```

Each step below publishes a public hostname. Confirm with the operator before
running any of them.

## 1. A WSLProxy vhost per region host

Use the wslproxy repo's add-domain helper (`~/projects/wslproxy`). It writes lon1,
mirrors to lon2 and imports into cp.pop0.uk. Let's Encrypt HTTP-01 needs DNS
(step 3) first, so the first HTTPS hit can take 30 to 60 seconds once DNS
resolves.

```bash
W=~/projects/wslproxy/.claude/skills/wslproxy-add-domain/scripts/add_domain.py

# Region on vps002: share the existing vps002 rule (same origin), own Host header.
$W --host app-a.vyltzero.com --rule-id d6ccf475-e92e-4937-9352-b254f71bad40 \
   --upstream-host app-a.vyltzero.com --dry-run

# Region on cloud003: new rule to the cloud003 traefik-edge origin.
$W --host app-b.vyltzero.com --backend 77.68.126.63:80 \
   --rule-name vyltzero-cloud003-traefik-edge --upstream-host app-b.vyltzero.com --dry-run
```

Drop `--dry-run` after the operator agrees. Earlier vyltzero hosts hit a
"domain not allowed" refusal from auto-ssl. If that happens, check that
`/opt/nginx/data/ssl/<host>.json` exists on **both** lon1 and lon2. lon2's
sync does not copy the SSL files.

Afterwards, run the CP→git sync workflows the helper prints, and give the
operator the PR links. Do not bypass review.

## 2. A dedicated rule for the alias (do this once, before any failover)

`add_domain.py --update --backend` edits the **rule** the host points at. Today
`app.vyltzero.com` shares `vyltzero-vps002-traefik-edge` with int, test and
acc, so repointing it would move all four. Give the alias its own rule first.
`vz_ha.py preflight --pop` reports how many hosts share it.

The helper cannot change which rule a host uses, so recreate the alias vhost
on a new rule. The origin stays the same, so traffic is unchanged:

1. Back up the current files on lon1:
   `ssh root@195.20.255.201 'cd /opt/nginx/data && tar czf /root/app-vyltzero-$(date +%s).tgz "servers/prod/host:app.vyltzero.com.json" ssl/app.vyltzero.com.json'`
2. Remove only the alias server file on lon1
   (`servers/prod/host:app.vyltzero.com.json`), and delete the alias server
   in the cp.pop0.uk admin UI. **Leave the shared rule alone.** Keep the SSL
   file.
3. Re-add it on a dedicated rule pointing at the current primary:
   `$W --host app.vyltzero.com --backend 85.190.106.88:80 --rule-name vyltzero-prod-alias --upstream-host app-a.vyltzero.com`
4. Check that `https://app.vyltzero.com/api/version` returns 200, and that
   `vz_ha.py preflight <mesh> --pop` reports "the alias has a dedicated rule".

Expect a few seconds of 404 between steps 2 and 3. Do it in a quiet window,
or ask the operator to schedule it.

## 3. DNS: delegate each region host to NebulaDNS with POP failover

Use the sibling skill **`add-host-ns-failover`** (Mode N) for each new host.
The pieces it touches for vyltzero.com live in the infra repo
`~/projects/diy-tax-return-infra` (PR #125 did the four ring hosts):

| Piece | Path |
|---|---|
| Zone file per host | `ansible/files/zones/<host>.toml` (SOA, NS, A → lon1, TTL 30) |
| Zones list | `nebuladns_zones` in group_vars |
| Failover controller | `dns-failover.toml`: add an A-record hostname entry |
| Cloudflare delegation | `scripts/nebuladns-cloudflare-dns.py`, `vyltzero.com` block (delete any CNAME, add 2 NS) |

Ship the zone with `-e nebuladns_version=<the version ns1/ns2 run now>` so the
playbook does not upgrade the NebulaDNS binary as a side effect. Check:

```bash
dig @72.62.211.28 app-b.vyltzero.com A +short   # ns1
dig @85.190.106.88 app-b.vyltzero.com A +short  # ns2
curl -sS https://app-b.vyltzero.com/api/version
```

## Ports and origins

| Node | Origin (traefik-edge, port 80) | podCIDR → edge /31 |
|---|---|---|
| vps002 | 85.190.106.88 | 10.42.17.0/31 |
| cloud003 | 77.68.126.63 | 10.42.0.0/31 |
| cloud001 | 72.62.211.28 | 10.42.16.0/31 |

`vz_ha.py init` reads these from the live nodes. This table is only a
reminder, and the live values win.
