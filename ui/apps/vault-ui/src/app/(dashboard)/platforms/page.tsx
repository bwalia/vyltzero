'use client'
import { motion } from 'framer-motion'
import { Fingerprint, Cloud, Package, Boxes, Bot, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { stagger, staggerItem } from '@/lib/motion'

type Status = 'available' | 'soon'

interface Item {
  name: string
  detail: string
  status?: Status
  code?: string
}

interface Group {
  title: string
  icon: LucideIcon
  blurb: string
  items: Item[]
}

/**
 * What this deployment can talk to. Kept to what the services actually ship:
 * a connector or sign-in method that exists in source but is not wired up is
 * marked "Coming soon" rather than advertised as working.
 */
const groups: Group[] = [
  {
    title: 'Sign-in & workload identity',
    icon: Fingerprint,
    blurb: 'How people, services and AI agents prove who they are. Every method ends in the same signed, tenant-scoped token.',
    items: [
      { name: 'Kubernetes service accounts', detail: 'Pods and agents log in with their SA token, verified by TokenReview.', code: '/v1/auth/kubernetes/login' },
      { name: 'API keys', detail: 'Scoped, rotatable keys with per-key policies and rate limits.', code: '/v1/auth/api-key' },
      { name: 'OIDC device flow', detail: 'Browser-less sign-in for CLIs and headless agents.', code: '/v1/auth/oidc/device/start' },
      { name: 'LDAP', detail: 'Bind against an existing directory.', code: '/v1/auth/ldap/login' },
      { name: 'TOTP two-factor', detail: 'Self-service enrolment with recovery codes.', code: '/v1/auth/mfa/totp' },
      { name: 'SCIM 2.0 provisioning', detail: 'Users and groups pushed from your identity provider.', code: '/scim/v2' },
      { name: 'AWS IAM · Azure workload · mTLS', detail: 'Verifiers exist in identity-service; login routes are not enabled yet.', status: 'soon' },
    ],
  },
  {
    title: 'Secret sync',
    icon: Cloud,
    blurb: 'Keep external secret stores in step, pull, push or both ways, on a schedule.',
    items: [
      { name: 'AWS Secrets Manager', detail: 'Pull, push or bidirectional sync by prefix.', status: 'available' },
      { name: 'HashiCorp Vault', detail: 'Sync with an existing Vault KV mount.', status: 'available' },
      { name: 'Kubernetes Secrets', detail: 'Sync into native Secrets in your clusters.', status: 'available' },
      { name: 'Azure Key Vault', detail: 'Connector written; scheduled sync not enabled yet.', status: 'soon' },
      { name: 'GCP Secret Manager', detail: 'Connector written; scheduled sync not enabled yet.', status: 'soon' },
    ],
  },
  {
    title: 'SDKs, CLI & API',
    icon: Package,
    blurb: 'One JSON contract across every client.',
    items: [
      { name: 'Go · Python · Rust · TypeScript', detail: 'Official SDKs under sdks/.' },
      { name: 'vyltzero CLI', detail: 'Secrets, transit, leases, policies, regions and integrations, with profiles.', code: 'vyltzero secret put' },
      { name: 'HashiCorp Vault KV v2 API', detail: 'Existing Vault clients and External Secrets Operator work unchanged.', code: '/v1/kv/data/<path>' },
      { name: 'Examples', detail: 'Bash, Go, Java, Node.js, PHP and Rust in examples/.' },
    ],
  },
  {
    title: 'Run it anywhere Kubernetes runs',
    icon: Boxes,
    blurb: 'Self-hosted, Rust services, PostgreSQL underneath.',
    items: [
      { name: 'Helm chart', detail: 'One release per environment or region.' },
      { name: 'Kubernetes operator', detail: 'VaultSecret and VaultPolicy CRDs reconciled into native Secrets.' },
      { name: 'Multi-region', detail: 'Active/active replication between independent regions.' },
      { name: 'Prometheus metrics', detail: 'Every service exports /metrics.' },
    ],
  },
  {
    title: 'AI agent harnesses',
    icon: Bot,
    blurb: 'Agents use the vault through the MCP server, the agent-proxy, or the vyltzero-secrets skill.',
    items: [
      { name: 'Claude Code · OpenAI Codex · Cursor · Gemini CLI', detail: 'The vyltzero-secrets skill runs in any harness that can run shell commands, with MFA and a typed approval for every change.' },
      { name: 'Model Context Protocol', detail: 'Secrets, transit and lease tools at /v1/mcp.', code: '/v1/mcp' },
      { name: 'Any HTTP SDK', detail: 'Point the base URL at the agent-proxy; the real key is injected in flight.', code: '/r/<route>' },
    ],
  },
]

function StatusPill({ status }: { status?: Status }) {
  if (status === 'available') return <Badge variant="success" size="sm">Available</Badge>
  if (status === 'soon') return <Badge variant="outline" size="sm">Coming soon</Badge>
  return null
}

export default function PlatformsPage() {
  return (
    <div className="max-w-7xl space-y-6">
      <PageHeader
        title="Platforms"
        description="Identity providers, clouds, languages and agent harnesses this vault works with."
        guide={
          <p>
            A catalogue of what this deployment can connect to. Items marked{' '}
            <strong>Coming soon</strong> exist in the codebase but are not switched on yet,
            so nothing here promises more than the services actually do.
          </p>
        }
      />

      <motion.div
        variants={stagger}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        {groups.map(g => (
          <motion.div key={g.title} variants={staggerItem} className="h-full">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>
                  <span className="inline-flex items-center gap-2">
                    <g.icon className="h-4 w-4 text-[var(--brass)]" aria-hidden="true" />
                    {g.title}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <p className="mb-4 text-sm text-ink-muted">{g.blurb}</p>
                <ul className="divide-y divide-line">
                  {g.items.map(it => (
                    <li key={it.name} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink">{it.name}</div>
                        <div className="text-xs text-ink-muted">{it.detail}</div>
                        {it.code && (
                          <code className="mt-1 inline-block font-mono text-xs text-ink-faint">{it.code}</code>
                        )}
                      </div>
                      <StatusPill status={it.status} />
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
