const GITHUB = "https://github.com/bwalia/vyltzero";
const DOCS = `${GITHUB}/tree/main/docs`;
/** Baked at Pages build time (git tag / describe / short SHA). Local default: dev. */
const SITE_VERSION = process.env.NEXT_PUBLIC_SITE_VERSION || "dev";
const SITE_SHA = process.env.NEXT_PUBLIC_SITE_SHA || "";


/* ── Inline icons (no icon library — keeps the static build dependency-free) ── */
type IconProps = { className?: string };
const I = (d: string) => ({ className }: IconProps) => (
  <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.split("|").map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const LockIcon = I("M7 11V8a5 5 0 0 1 10 0v3|M5 11h14v9H5z");
const KeyIcon = I("M14 7a4 4 0 1 0-3.9 5H12l2 2 2-2 1.5 1.5|M20 7l-3 3");
const ShuffleIcon = I("M16 3h5v5|M4 20 21 3|M21 16v5h-5|M15 15l6 6|M4 4l5 5");
const CertIcon = I("M6 3h9l4 4v14H6z|M9 12h6|M9 16h4|M13 3v4h4");
const ClockIcon = I("M12 7v5l3 2|M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z");
const ShieldIcon = I("M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z|M9 12l2 2 4-4");
const GlobeIcon = I("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z|M3 12h18|M12 3c3 3.5 3 14.5 0 18|M12 3c-3 3.5-3 14.5 0 18");
const BoltIcon = I("M13 2 4 14h7l-1 8 9-12h-7z");
const GitIcon = I("M6 3v12|M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z|M6 3a3 3 0 1 0 0 .001|M18 9a3 3 0 1 0 0 .001|M18 9v1a4 4 0 0 1-4 4H9");
const CheckIcon = I("M20 6 9 17l-5-5");
const BotIcon = I("M12 8V4H8|M4 8h16v12H4z|M2 14h2|M20 14h2|M15 13v2|M9 13v2");
const IdIcon = I("M4 5h16v14H4z|M9 10a2 2 0 1 0 0 .001|M6 16c.6-1.6 1.8-2.4 3-2.4s2.4.8 3 2.4|M14 10h4|M14 14h3");
const RouteIcon = I("M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z|M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z|M8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7");
const AuditIcon = I("M9 4h6|M6 4h12v17H6z|M9 10h6|M9 14h6|M9 18h3");
const CloudIcon = I("M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z");
const BoxIcon = I("M12 3 4 7v10l8 4 8-4V7z|M4 7l8 4 8-4|M12 11v10");
const CodeIcon = I("M8 8l-4 4 4 4|M16 8l4 4-4 4|M14 5l-4 14");

const agentFeatures = [
  { icon: IdIcon, title: "Workload identity & Kubernetes auth", body: "Agent pods log in with their service-account token, verified by a Kubernetes TokenReview. No API key is ever written into the pod, the image or the prompt." },
  { icon: ClockIcon, title: "Short-lived agent session tokens", body: "Each agent gets a one-hour session token bound to its tenant, policies and principal. It expires on its own and revoking it stops it working immediately." },
  { icon: KeyIcon, title: "Centralised credential brokerage", body: "Real API keys live in the vault under brokered/, readable only by the broker. The agent's own policy explicitly denies reading them, so it cannot exfiltrate what it never holds." },
  { icon: RouteIcon, title: "Transparent HTTP and MCP proxy", body: "Point an SDK's base URL at the agent-proxy and put the session token where the key would go. The real credential is injected in flight; streamed responses and MCP servers just work." },
  { icon: ShieldIcon, title: "Policy-driven delegated authority", body: "Every route checks tenant, policy, principal, method and path. Upstreams must be HTTPS, redirects are never followed, and CONNECT tunnels are refused." },
  { icon: AuditIcon, title: "Auditable agent access", body: "Allowed or denied, every brokered call lands in the signed, hash-chained audit log with the agent's identity, the route and the outcome." },
];

const agentFlow = [
  { title: "Prove identity", body: "Agent pod presents its Kubernetes service-account token.", code: "/v1/auth/kubernetes/login" },
  { title: "Get a session token", body: "Short-lived, tenant- and policy-bound. Never a real key.", code: "1 h · revocable" },
  { title: "Call through the proxy", body: "SDK base URL points at the agent-proxy route.", code: "/r/anthropic" },
  { title: "Broker injects the key", body: "Checked against route rules, then the real key is attached.", code: "allowed_policies" },
  { title: "Signed audit", body: "Principal, route and outcome — allowed or denied.", code: "agent_proxy.request" },
];

const features = [
  { icon: LockIcon, title: "Versioned KV secrets", body: "A Vault-compatible KV v2 engine: versioned reads and writes, check-and-set, soft-delete and destroy, per-path metadata — every value sealed before it touches disk." },
  { icon: KeyIcon, title: "Envelope encryption", body: "AES-256-GCM with a per-tenant key hierarchy. Data keys are wrapped under a tenant KEK, which is wrapped under a root key held only by the crypto service." },
  { icon: ShuffleIcon, title: "Transit engine", body: "Encryption as a service: encrypt, decrypt, sign and verify without the plaintext key ever leaving the vault. Keys rotate while old ciphertext stays readable." },
  { icon: CertIcon, title: "PKI & certificates", body: "Issue and manage a private CA, roles and short-lived certificates. CA private keys are envelope-encrypted under their own root, never stored in the clear." },
  { icon: ClockIcon, title: "Dynamic leases", body: "Every credential is a lease: issued, listed, renewed and revoked for real. Revoking a token stops it working immediately, not just flips a row." },
  { icon: ShieldIcon, title: "Two-factor auth & identity", body: "Self-service TOTP two-factor with recovery codes, over fine-grained policies on API keys and JWTs — plus Kubernetes, OIDC device-flow and LDAP sign-in and SCIM provisioning. Identity comes from a signed, per-tenant token, never a header." },
];

const securityPoints = [
  { title: "Signed, tamper-evident audit", body: "Every operation joins a per-tenant hash chain signed with a dedicated key — a record cannot be altered or removed without breaking the chain." },
  { title: "Shamir-split custody", body: "The root key can be split into Shamir shares so no single operator can unseal the vault alone. It starts sealed and stays sealed until a quorum agrees." },
  { title: "Tenant isolation to the key layer", body: "A data key belongs to exactly one tenant; a cross-tenant request returns “not found” rather than another tenant’s data. Isolation holds even at the crypto service." },
  { title: "Zero plaintext at rest", body: "Secrets, transit keys and CA material are all encrypted before storage. A database dump yields ciphertext wrapped under keys the database never sees." },
];

type Plat = { name: string; live?: boolean; soon?: boolean };
const platforms: { icon: typeof LockIcon; title: string; items: Plat[] }[] = [
  { icon: BotIcon, title: "AI agent harnesses", items: [
    { name: "Claude Code" }, { name: "OpenAI Codex" }, { name: "Cursor" }, { name: "Gemini CLI" },
    { name: "Model Context Protocol (/v1/mcp)" }, { name: "Any SDK with a base URL" },
  ] },
  { icon: IdIcon, title: "Sign-in & identity", items: [
    { name: "Kubernetes service accounts" }, { name: "API keys" }, { name: "OIDC device flow" },
    { name: "LDAP" }, { name: "SCIM 2.0 provisioning" }, { name: "AWS IAM · Azure workload · mTLS", soon: true },
  ] },
  { icon: CloudIcon, title: "Secret sync", items: [
    { name: "AWS Secrets Manager", live: true }, { name: "HashiCorp Vault", live: true },
    { name: "Kubernetes Secrets", live: true }, { name: "Azure Key Vault", soon: true }, { name: "GCP Secret Manager", soon: true },
  ] },
  { icon: CodeIcon, title: "SDKs, CLI & API", items: [
    { name: "Go · Python · Rust · TypeScript" }, { name: "vyltzero CLI" },
    { name: "Vault KV v2-compatible API" }, { name: "External Secrets Operator" }, { name: "Examples: Java · PHP · Node.js · Bash" },
  ] },
  { icon: BoxIcon, title: "Deploy", items: [
    { name: "Helm chart" }, { name: "Kubernetes operator (CRDs)" }, { name: "Multi-region, active/active" },
    { name: "Prometheus metrics" }, { name: "Self-hosted, Rust + PostgreSQL" },
  ] },
];

export default function Page() {
  return (
    <>
      {/* Nav */}
      <header className="nav">
        <div className="wrap nav-inner">
          <a className="brand" href="#top">
            <span className="brand-mark">
              <LockIcon className="" />
            </span>
            <span>VYLT<span className="brand-accent">ZERO</span></span>
          </a>
          <nav className="nav-links">
            <a className="hide-sm" href="#agents">AI Agents</a>
            <a className="hide-sm" href="#platforms">Platforms</a>
            <a className="hide-sm" href="#features">Features</a>
            <a className="hide-sm" href="#security">Security</a>
            <a className="hide-sm" href={DOCS}>Docs</a>
            <a className="nav-cta" href={GITHUB}>GitHub</a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main id="top">
        <section className="hero">
          <div className="wrap">
            <span className="eyebrow"><span className="dot" /> Rust-powered · Kubernetes-native · Zero-trust agent infrastructure</span>
            <h1 className="hero-title">
              The Vault for AI Agents.<br />
              <span className="grad">Zero Keys. Agent Authority.</span>
            </h1>
            <p className="hero-sub">
              VYLTZERO gives autonomous AI agents delegated authority without static
              credentials. Agents prove who they are with workload identity, hold a
              short-lived session token, and reach APIs and MCP servers through a broker
              that injects the real key in flight — every call policy-checked and signed
              into the audit log. Underneath is a full self-hosted secrets platform:
              envelope encryption, transit, PKI, leases and multi-region replication.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#agents">How agent access works</a>
              <a className="btn btn-ghost" href={GITHUB}><GitIcon className="" /> GitHub</a>
            </div>
            <div className="hero-meta">
              <span><CheckIcon className="check" /> No static keys in agents</span>
              <span><CheckIcon className="check" /> HTTP &amp; MCP credential broker</span>
              <span><CheckIcon className="check" /> Vault-compatible API</span>
              <span><CheckIcon className="check" /> No plaintext at rest</span>
            </div>

            {/* Product tour — dominant hero visual */}
            <figure id="tour" className="tour">
              <div className="tour-frame">
                <video
                  className="tour-video"
                  controls
                  playsInline
                  preload="metadata"
                  poster="/feature-tour-poster.png"
                  aria-label="VyltZero product tour: console walkthrough of multi-tenancy, secrets, transit, and security"
                >
                  <source src="/feature-tour.mp4" type="video/mp4" />
                  Your browser does not support embedded video.
                </video>
              </div>
              <figcaption className="tour-caption">
                Silent console tour (~2 min) — tenants, KV, transit, MFA, regions, audit, and how envelope
                encryption protects secrets if the vault disk walks away.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* AI agents */}
        <section id="agents">
          <div className="wrap">
            <div className="section-head">
              <div className="kicker">Built for autonomous AI agents</div>
              <h2>Agents act with authority, never with keys</h2>
              <p className="section-sub">
                A leaked transcript, a prompt-injected <code>env | curl</code> or a compromised
                container exposes only a session token — one that expires within the hour,
                works only through the broker, and only for the routes its policy allows.
              </p>
            </div>
            <div className="grid cols-3">
              {agentFeatures.map((f) => (
                <article className="card" key={f.title}>
                  <div className="card-icon"><f.icon className="" /></div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
              ))}
            </div>

            <ol className="flow" aria-label="How an agent call is brokered">
              {agentFlow.map((s) => (
                <li key={s.title}>
                  <h4>{s.title}</h4>
                  <p>{s.body}</p>
                  <code>{s.code}</code>
                </li>
              ))}
            </ol>

            <div className="terminal" role="img" aria-label="Agent pod configured with a VYLTZERO session token instead of an API key" style={{ marginTop: 28 }}>
              <div className="terminal-bar">
                <span className="tdot r" /><span className="tdot y" /><span className="tdot g" />
                <span className="terminal-title">agent pod — no real key inside</span>
              </div>
              <pre>
{`$ `}<span className="c-dim"># the session token came from /v1/auth/kubernetes/login</span>{`
$ `}<span className="c-cmd">export</span>{` ANTHROPIC_BASE_URL=`}<span className="c-str">http://vyltzero-agent-proxy:8094/r/anthropic</span>{`
$ `}<span className="c-cmd">export</span>{` ANTHROPIC_API_KEY=`}<span className="c-str">&quot;$(cat /session/token)&quot;</span>{`   `}<span className="c-dim"># expires in 1h</span>{`
$ `}<span className="c-cmd">claude</span>{` `}<span className="c-flag">-p</span>{` `}<span className="c-str">&quot;fix the flaky test&quot;</span>{`
`}<span className="c-ok">✓</span>{` brokered  route=`}<span className="c-str">anthropic</span>{`  principal=`}<span className="c-str">agents:claude-coder</span>{`  audit=`}<span className="c-ok">signed</span>{`

$ `}<span className="c-cmd">vyltzero</span>{` secret get `}<span className="c-str">brokered/anthropic</span>{`   `}<span className="c-dim"># as the agent</span>{`
`}<span className="c-flag">403</span>{` policy agent-claude denies brokered/**`}
              </pre>
            </div>
          </div>
        </section>

        {/* Multi-platform */}
        <section id="platforms" className="band-canvas">
          <div className="wrap">
            <div className="section-head">
              <div className="kicker">Multi-platform</div>
              <h2>Works with your agents, clouds and clusters</h2>
              <p className="section-sub">
                One vault in front of the AI harnesses, identity providers, cloud secret
                stores and languages you already run. Items marked <em>coming soon</em> exist
                in the codebase and are not switched on yet.
              </p>
            </div>
            <div className="grid cols-3">
              {platforms.map((g) => (
                <article className="card plat" key={g.title}>
                  <h3><g.icon className="" /> {g.title}</h3>
                  <ul>
                    {g.items.map((it) => (
                      <li key={it.name}>
                        <span>{it.name}</span>
                        {it.live && <span className="tag live">sync live</span>}
                        {it.soon && <span className="tag">coming soon</span>}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features">
          <div className="wrap">
            <div className="section-head">
              <div className="kicker">The vault underneath</div>
              <h2>Everything a secret needs, behind one API</h2>
              <p className="section-sub">
                Static and dynamic secrets, encryption-as-a-service, a private CA, and the
                identity and policy layer to govern them — each engine sealed by the same
                per-tenant key hierarchy.
              </p>
            </div>
            <div className="grid cols-3">
              {features.map((f) => (
                <article className="card" key={f.title}>
                  <div className="card-icon"><f.icon className="" /></div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Architecture */}
        <section id="architecture">
          <div className="wrap">
            <div className="section-head">
              <div className="kicker">Active / active by design</div>
              <h2>Two regions, one mesh</h2>
              <p className="section-sub">
                Each region is a complete, independent stack — its own database, its own
                services, its own public hostname. They share nothing at runtime but key
                material, and each region&rsquo;s agent pulls the other&rsquo;s changes over the public edge.
              </p>
            </div>
            <div className="regions">
              <div className="region">
                <div className="region-name"><GlobeIcon className="" /> Region A</div>
                <div className="region-loc">manchester · active</div>
                <ul>
                  <li><CheckIcon className="check" /> Own PostgreSQL, node-local storage</li>
                  <li><CheckIcon className="check" /> Full service set, sealed at rest</li>
                  <li><CheckIcon className="check" /> Serves its own public endpoint</li>
                </ul>
              </div>
              <div className="sync">
                <span className="sync-badge"><BoltIcon className="" /><br />encrypted<br />replication</span>
              </div>
              <div className="region">
                <div className="region-name"><GlobeIcon className="" /> Region B</div>
                <div className="region-loc">london · active</div>
                <ul>
                  <li><CheckIcon className="check" /> Byte-identical key material</li>
                  <li><CheckIcon className="check" /> Reads secrets written anywhere</li>
                  <li><CheckIcon className="check" /> Fails over as a PoP-side change</li>
                </ul>
              </div>
            </div>
            <div className="terminal" role="img" aria-label="Example VyltZero CLI session writing and reading a secret">
              <div className="terminal-bar">
                <span className="tdot r" /><span className="tdot y" /><span className="tdot g" />
                <span className="terminal-title">vyltzero — kv</span>
              </div>
              <pre>
{`$ `}<span className="c-cmd">vyltzero</span>{` init`}{`
`}<span className="c-ok">✓</span>{` wrote ~/.vyltzero/config.toml  tenant=`}<span className="c-str">acme</span>{`  region=`}<span className="c-str">manchester</span>{`

$ `}<span className="c-cmd">vyltzero</span>{` secret put `}<span className="c-str">prod/db/creds</span>{` `}<span className="c-flag">-d</span>{` password=`}<span className="c-str">s3cr3t</span>{`
`}<span className="c-ok">✓</span>{` sealed with dek `}<span className="c-dim">01a0&hellip;93a7</span>{`  version=1

$ `}<span className="c-cmd">vyltzero</span>{` secret get `}<span className="c-str">prod/db/creds</span>{`  `}<span className="c-flag">--profile</span>{` london
`}<span className="c-dim"># same secret, decrypted in the peer region</span>{`
password = `}<span className="c-str">s3cr3t</span>{`   `}<span className="c-ok">replication_lag=14ms</span>
              </pre>
            </div>
          </div>
        </section>

        <div className="wrap"><hr className="divider" /></div>

        {/* Security */}
        <section id="security">
          <div className="wrap">
            <div className="section-head">
              <div className="kicker">Security model</div>
              <h2>Encrypted where it matters, provable after the fact</h2>
              <p className="section-sub">
                The vault fails closed. Keys are wrapped, custody can be split, and every
                action is signed into a chain you can verify.
              </p>
            </div>
            <div className="sec-list">
              {securityPoints.map((s) => (
                <div className="sec-item" key={s.title}>
                  <span className="mk"><ShieldIcon className="" /></span>
                  <div>
                    <h4>{s.title}</h4>
                    <p>{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="wrap"><hr className="divider" /></div>

        {/* CTA */}
        <section>
          <div className="wrap">
            <div className="cta">
              <div className="kicker" style={{ marginBottom: 10 }}>Self-hosted &amp; open source</div>
              <h2>Give your agents authority, not keys</h2>
              <p>
                Clone the repo, install the Helm chart and unseal. The getting-started guide
                takes you from an empty cluster to your first sealed secret; the agent-proxy
                guide gets your first agent brokered.
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary" href={GITHUB}><GitIcon className="" /> View on GitHub</a>
                <a className="btn btn-ghost" href={DOCS}>Read the docs</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer>
        <div className="wrap foot-inner">
          <div className="brand" style={{ fontSize: 15 }}>
            <span className="brand-mark" style={{ width: 26, height: 26 }}><LockIcon className="" /></span>
            <span>VYLT<span className="brand-accent">ZERO</span></span>
          </div>
          <nav className="foot-links">
            <a href="#agents">AI Agents</a>
            <a href="#platforms">Platforms</a>
            <a href="#features">Features</a>
            <a href="#architecture">Architecture</a>
            <a href="#security">Security</a>
            <a href={DOCS}>Docs</a>
            <a href={GITHUB}>GitHub</a>
          </nav>
          <div className="foot-meta">
            <div className="foot-note">© {new Date().getFullYear()} VyltZero · Open source</div>
            <a
              className="foot-version"
              href={SITE_SHA ? `${GITHUB}/commit/${SITE_SHA}` : `${GITHUB}/tree/main`}
              title={SITE_SHA ? `Commit ${SITE_SHA}` : "Published site version"}
            >
              {SITE_VERSION}
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
