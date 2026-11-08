# Troubleshooting a region mesh

| Symptom | Cause | Fix |
|---|---|---|
| Pods `Pending` in a new region | node CPU requests full, or the nodeSelector/taint does not match | `preflight` CPU line; pick a node with ~2 CPU free; `kubectl describe pod` |
| Pods crash-loop on missing tables | migrations Job did not complete | `kubectl -n <ns> logs job/vyltzero-migrations-<hash>` |
| Migrations Job fails on checksum | an applied `.sql` was edited in place | add a new numbered migration instead |
| `validate`: pods pinned to the wrong node | region values not layered last | the `-f` order must be k3s1 → env → region |
| `validate`: secondary claims the alias | hand edit of generated values | fix mesh.json (`primary`), render again |
| Peer pull `404` | `publish_peer_endpoint` still false | step 10 |
| Peer pull `401` **with** the token | mesh Secret differs between regions | `vyltzero-mesh-keys.sh verify`; copy from the data holder |
| Peer pull `503` | `replication-peer-token` missing; the API fails closed | `copy-from` backfills it |
| Peer pull `200` **without** a token | image predates the auth guard | unpublish at once (`publish_peer_endpoint: false`), redeploy, upgrade the image |
| Peers stuck `offline` while events flow | `/health` not routed to region-health | it is rendered with `publishPeerEndpoint`; check the edge Ingress has `/health` |
| Region roster row missing | migrations Job seeds `system.regions` from the roster | redeploy; the Job re-seeds on every run |
| Replication silent, no errors | roster updated in one region only | `validate` (rosters must be identical); redeploy all regions |
| Replicated secret reads as garbage | `root-key` differs | keys step; if both regions hold data, stop: data migration needed |
| `decryption failed: key not found` on a replicated secret | DEK not replicated (old image, or `dek_upsert` emit failed) | upgrade crypto-service; check `system.replication_events` for `dek_upsert` |
| `key_not_found` for an API key valid elsewhere | image predates `api_key_upsert` replication | mint a key per region, or upgrade |
| Region host times out | traefik-edge on the wrong node got the request | the POP rule's backend must be the region's own node origin |
| Alias 404 right after a failover | target region's Ingress lacks its own host | the region host must render in `edgeIngress.host` |
| `https://<host>` cert errors on lon2 only | lon2's sync does not copy `ssl/<host>.json` | write it on lon2, reload openresty |
| `preflight`: coredns not Ready on node | node cannot reach the API server (no LAN route) | fix the node's WireGuard route; see `docs/ha-two-region.md` §5.0 |
