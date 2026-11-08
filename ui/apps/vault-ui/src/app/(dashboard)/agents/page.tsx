'use client'
import { useMemo } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Bot, ArrowRight } from 'lucide-react'
import { useVaultSWR } from '@/hooks/useVaultSWR'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { CodeChip } from '@/components/ui/CodeChip'
import { LoadError } from '@/components/ErrorBanner'
import { stagger, staggerItem } from '@/lib/motion'
import { formatRelativeTime } from '@/lib/utils'

/** One brokered request, as audit-service serves it (AuditEventView). */
interface AgentEvent {
  event_id: string
  action: string
  resource: string // "broker/<route>"
  principal: string // "<namespace>:<serviceaccount>" for Kubernetes-authenticated agents
  outcome: string // success | failure | upstream_error
  outcome_detail?: string // e.g. policy_denied, egress_denied, tenant_mismatch
  timestamp: string
}

interface AuditResponse {
  events?: AgentEvent[]
  total?: number
}

/** Every request the agent-proxy handles is audited under this action. */
const AGENT_ACTION = 'agent_proxy.request'

/**
 * The agent access path, in the order it happens. Each step names the real
 * endpoint or control so an operator can go and look at it.
 */
const flow = [
  {
    title: 'Workload identity',
    body: 'The agent pod logs in with its Kubernetes service-account token. identity-service verifies it with a TokenReview — no API key is ever placed in the pod.',
    code: 'POST /v1/auth/kubernetes/login',
  },
  {
    title: 'Short-lived session token',
    body: 'The agent receives a one-hour session token bound to its tenant, policies and principal. It expires on its own and can be revoked at once.',
    code: 'session token · 1 h',
  },
  {
    title: 'Brokered, not fetched',
    body: 'The agent points its SDK at the agent-proxy and puts the session token where the API key would go. Its policy explicitly denies reading the real credential.',
    code: 'BASE_URL → /r/<route>',
  },
  {
    title: 'Delegated authority',
    body: 'Each route checks tenant, policy, principal, method and path, then injects the real credential — read with the proxy’s own identity — and strips it from the response.',
    code: 'allowed_policies · allowed_principals',
  },
  {
    title: 'Audited on every use',
    body: 'Allowed or denied, every request is written to the signed, hash-chained audit log with the agent’s principal, the route and the outcome.',
    code: AGENT_ACTION,
  },
]

/** Tools exposed by mcp-server at /v1/mcp (services/mcp-server/src/tools.rs). */
const mcpTools: { name: string; group: string }[] = [
  { name: 'read_secret', group: 'Secrets' },
  { name: 'write_secret', group: 'Secrets' },
  { name: 'list_secrets', group: 'Secrets' },
  { name: 'delete_secret', group: 'Secrets' },
  { name: 'destroy_secret_version', group: 'Secrets' },
  { name: 'encrypt_data', group: 'Transit' },
  { name: 'decrypt_data', group: 'Transit' },
  { name: 'rotate_transit_key', group: 'Transit' },
  { name: 'list_leases', group: 'Leases' },
  { name: 'revoke_lease', group: 'Leases' },
]

const quickStart = `# Agent pod: no real key, only a session token from the vault
export ANTHROPIC_BASE_URL=http://vyltzero-agent-proxy:8094/r/anthropic
export ANTHROPIC_API_KEY="$(cat /session/token)"

# Tools that cannot change a base URL: forward-proxy mode
export HTTP_PROXY=http://vyltzero-agent-proxy:8094`

export default function AgentsPage() {
  // Most recent brokered requests for this tenant. The audit API filters on the
  // exact action server-side and verifies each record's signature on read.
  const { data, error, isLoading } = useVaultSWR<AuditResponse>(
    `/api/audit/v1/audit/events?limit=100&action=${encodeURIComponent(AGENT_ACTION)}`,
  )
  const events = useMemo(() => data?.events ?? [], [data])

  const stats = useMemo(() => {
    const denied = events.filter(e => e.outcome === 'failure').length
    const agents = new Set(events.map(e => e.principal).filter(Boolean)).size
    const routes = new Set(events.map(e => e.resource.replace(/^broker\//, ''))).size
    return { total: events.length, denied, agents, routes }
  }, [events])

  // Stats come from the last 100 events; say so rather than imply all-time totals.
  const v = (n: number) => (error ? '!' : isLoading ? '—' : n)

  return (
    <div className="max-w-7xl space-y-6">
      <PageHeader
        title="AI Agents"
        description="Agents act with delegated authority and hold zero static keys. Every brokered call is checked and audited."
        guide={
          <>
            <p>
              An AI agent here never holds a real API key. It proves who it is with its
              Kubernetes workload identity, gets a short-lived session token, and sends
              its traffic through the <strong>agent-proxy</strong>, which attaches the
              real credential in flight.
            </p>
            <p>
              A leaked transcript or a prompt-injected <code>env | curl</code> therefore
              exposes only a token that expires within the hour, works only through the
              proxy, and only for the routes its policy allows.
            </p>
          </>
        }
      />

      <motion.div
        variants={stagger}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <motion.div variants={staggerItem}>
          <StatCard label="Brokered calls" value={v(stats.total)} detail="most recent 100, all outcomes" />
        </motion.div>
        <motion.div variants={staggerItem}>
          <StatCard label="Denied" value={v(stats.denied)} detail="refused by policy or route rules" />
        </motion.div>
        <motion.div variants={staggerItem}>
          <StatCard label="Agents" value={v(stats.agents)} detail="distinct workload identities" />
        </motion.div>
        <motion.div variants={staggerItem}>
          <StatCard label="Routes" value={v(stats.routes)} detail="upstreams reached via the broker" />
        </motion.div>
      </motion.div>

      <Card>
        <CardHeader>
          <CardTitle>How agent access works</CardTitle>
        </CardHeader>
        <CardBody>
          <ol className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {flow.map((s, i) => (
              <li key={s.title} className="relative rounded-lg border border-line bg-surface-2 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--brass)] text-xs font-semibold text-white tabular">
                    {i + 1}
                  </span>
                  <h3 className="text-sm font-semibold text-ink">{s.title}</h3>
                </div>
                <p className="text-xs leading-relaxed text-ink-muted">{s.body}</p>
                <div className="mt-3">
                  <CodeChip value={s.code} truncate={40} />
                </div>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent brokered requests</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {events.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 border-b border-line-strong">
                  <tr>
                    {['Agent', 'Route', 'Outcome', 'Detail', 'Time'].map(h => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-ink-faint"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {events.slice(0, 25).map(e => (
                    <tr
                      key={e.event_id}
                      className="transition-colors hover:bg-surface-2 hover:shadow-[inset_2px_0_0_0_var(--brass)]"
                    >
                      <td className="px-4 py-3 max-w-xs truncate">
                        <CodeChip value={e.principal || 'unknown'} truncate={40} />
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-ink">
                        {e.resource.replace(/^broker\//, '')}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={e.outcome} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                        {e.outcome_detail || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-faint tabular">
                        {formatRelativeTime(e.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : error ? (
            <div className="p-4">
              <LoadError error={error} what="agent audit events" />
            </div>
          ) : (
            <EmptyState
              icon={Bot}
              title="No agent traffic yet"
              description="Requests an agent makes through the agent-proxy — allowed or denied — appear here as they happen."
            />
          )}
          {events.length > 0 && (
            <div className="border-t border-line px-4 py-3 text-right">
              <Link
                href={`/audit?action=${encodeURIComponent(AGENT_ACTION)}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink"
              >
                Full history in the audit log <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>MCP server tools</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">
              Agents that speak the Model Context Protocol reach the vault at{' '}
              <code className="font-mono text-ink">/v1/mcp</code> with their session token.
              Every tool call is policy-checked like any other request. Third-party MCP
              servers that speak streamable HTTP can sit behind the agent-proxy as routes.
            </p>
            <div className="flex flex-wrap gap-2">
              {mcpTools.map(t => (
                <Badge key={t.name} variant="outline">
                  <span className="text-ink-faint">{t.group}</span>
                  <span className="mx-1 text-ink-faint">·</span>
                  <span className="font-mono">{t.name}</span>
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connect an agent</CardTitle>
          </CardHeader>
          <CardBody>
            <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-4 font-mono text-xs leading-relaxed text-ink">
              {quickStart}
            </pre>
            <p className="mt-3 text-xs text-ink-muted">
              The proxy accepts a session token in the API-key slot and swaps in the real
              key; anything else is rejected. <code className="font-mono">CONNECT</code>{' '}
              tunnels are refused because a TLS tunnel can be neither brokered nor
              constrained. Setup guide: <code className="font-mono">docs/agent-proxy.md</code>.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
