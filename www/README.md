# VyltZero marketing site

The public site at **https://www.vyltzero.com** (apex `vyltzero.com` redirects to it).

A Next.js static export published to GitHub Pages, mirroring the vantiq site's
setup. It is self-contained here in `www/` and shares nothing with the Rust
workspace or `ui/apps/vault-ui`.

## Local development

```bash
cd www
npm install
npm run dev              # http://localhost:3000
npm run build:static     # static export into www/out
npm run preview:static   # serve the exported site
```

The footer shows `NEXT_PUBLIC_SITE_VERSION` (defaults to `dev` locally). Pages CI
bakes the git tag / `git describe` / short SHA into that value.

## Product tour

The landing page embeds a silent console walkthrough (`public/feature-tour.mp4`)
covering multi-tenancy, KV secrets, transit, MFA, regions, audit, and the
“steal the disk” security story. Rebuild/publish via `pages.yml` on every
merge to `main`.

**Every merge/push to `main`** runs `.github/workflows/pages.yml`, which builds
`www/` and publishes to GitHub Pages → **https://www.vyltzero.com/**.

The footer version tag is stamped at build time (exact git tag when HEAD is
tagged, otherwise `git describe`, otherwise the short SHA). The same build
writes `/version.json` for health checks.

Optional Ring Promoter path: `.github/workflows/seed-www-ring-promoter.yml`
seeds app `vyltzero-www`, which can also `workflow_dispatch` `pages.yml`.
Pages source must be **GitHub Actions**.

See `deploy/ring-promoter/README.md` and
https://rp.workstation.co.uk/?app=vyltzero-www.

## Domain

`www/CNAME` holds the custom domain (`www.vyltzero.com`) and is copied into the
build artifact on every deploy. DNS (Cloudflare) is already configured:

- `vyltzero.com` — A records to the GitHub Pages addresses (185.199.108–111.153)
- `www.vyltzero.com` — CNAME to `bwalia.github.io`

GitHub Pages serves both and redirects the apex to `www`. Do not orange-cloud
(proxy) the records through Cloudflare, or the Pages TLS certificate cannot
issue.
