'use client'

import { useQuery } from '@tanstack/react-query'
import { WalletGate } from '@/components/wallet-gate'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts'
import { useTheme } from 'next-themes'
import { Zap, Award, Leaf, TrendingUp, Download, Wifi, WifiOff } from 'lucide-react'
import { StatCardSkeleton, ChartSkeleton, TableRowSkeleton } from '@/components/skeleton'
import { useState } from 'react'
import { useRealtimeReadings } from '@/hooks/use-realtime-readings'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Reading {
  id: string
  meter_id: string
  kwh: number
  timestamp: string
  verified: boolean
}

interface Stats {
  total_kwh: number
  certificates_issued: number
  certificates_retired: number
  active_meters: number
}

type Period = 'daily' | 'weekly' | 'monthly'

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------
async function fetchStats(): Promise<Stats> {
  const res = await fetch('/api/readings?type=stats')
  if (!res.ok) throw new Error('Failed to load stats')
  return res.json()
}

async function fetchReadings(): Promise<Reading[]> {
  const res = await fetch('/api/readings')
  if (!res.ok) throw new Error('Failed to load readings')
  return res.json()
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
interface StatCardProps {
  label: string
  value: string | number
  icon: React.ElementType
  description?: string
}

function StatCard({ label, value, icon: Icon, description }: StatCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
        <Icon className="h-5 w-5 text-yellow-500" aria-hidden="true" />
      </div>
      <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
      {description && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">{description}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Accessible chart colours (WCAG AA contrast, colour-blind safe)
// ---------------------------------------------------------------------------
function useChartColors() {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  return {
    grid: dark ? '#374151' : '#e5e7eb',
    text: dark ? '#9ca3af' : '#6b7280',
    area: '#f59e0b',
    areaFill: dark ? '#f59e0b33' : '#fef3c7',
    bar1: '#f59e0b', // amber — generation
    bar2: '#0ea5e9', // sky blue — distinct from amber, CB-safe
    tooltip: {
      bg: dark ? '#1f2937' : '#ffffff',
      border: dark ? '#374151' : '#e5e7eb',
      text: dark ? '#f9fafb' : '#111827',
    },
  }
}

// ---------------------------------------------------------------------------
// Grouping helpers
// ---------------------------------------------------------------------------
function groupByPeriod(readings: Reading[], period: Period): { date: string; kwh: number }[] {
  const map: Record<string, number> = {}
  for (const r of readings) {
    const d = new Date(r.timestamp)
    let key: string
    if (period === 'daily') {
      key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } else if (period === 'weekly') {
      // ISO week label: "W{n} MMM"
      const startOfYear = new Date(d.getFullYear(), 0, 1)
      const week = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7)
      key = `W${week} ${d.toLocaleDateString('en-US', { month: 'short' })}`
    } else {
      key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    }
    map[key] = (map[key] ?? 0) + r.kwh
  }
  const limit = period === 'daily' ? 14 : period === 'weekly' ? 12 : 12
  return Object.entries(map)
    .slice(-limit)
    .map(([date, kwh]) => ({ date, kwh: Math.round(kwh * 100) / 100 }))
}

function groupByMeter(
  readings: Reading[],
  meters: Record<string, string>
): { meter: string; verified: number; unverified: number }[] {
  const map: Record<string, { verified: number; unverified: number }> = {}
  for (const r of readings) {
    const label = meters[r.meter_id] || r.meter_id.slice(0, 8)
    if (!map[label]) map[label] = { verified: 0, unverified: 0 }
    if (r.verified) map[label].verified += r.kwh
    else map[label].unverified += r.kwh
  }
  return Object.entries(map).map(([meter, counts]) => ({
    meter,
    verified: Math.round(counts.verified * 100) / 100,
    unverified: Math.round(counts.unverified * 100) / 100,
  }))
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
function exportCsv(rows: { date: string; kwh: number }[], filename: string) {
  const header = 'date,kwh'
  const body = rows.map((r) => `${r.date},${r.kwh}`).join('\n')
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('daily')
  const { isConnected, error: wsError } = useRealtimeReadings()

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useQuery({ queryKey: ['stats'], queryFn: fetchStats })

  const {
    data: readings,
    isLoading: readingsLoading,
    error: readingsError,
  } = useQuery({ 
    queryKey: ['readings'], 
    queryFn: fetchReadings,
    // Fallback to polling every 30s if WebSocket is not connected
    refetchInterval: isConnected ? false : 30000,
  })

  const { data: metersData } = useQuery({
    queryKey: ['meters'],
    queryFn: async () => {
      const res = await fetch('/api/meters')
      if (!res.ok) return []
      return res.json()
    },
  })

  const meterMap = (metersData || []).reduce((acc: Record<string, string>, m: any) => {
    acc[m.id] = m.name || m.serial_number
    return acc
  }, {})

  const colors = useChartColors()
  const chartData = readings ? groupByPeriod(readings, period) : []
  const meterData = readings ? groupByMeter(readings, meterMap) : []

  return (
    <WalletGate>
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
        
        {/* Connection status indicator */}
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <Wifi className="h-4 w-4 text-green-500" aria-hidden="true" />
              <span className="text-xs text-gray-600 dark:text-gray-400">Live</span>
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4 text-gray-400" aria-hidden="true" />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {wsError ? 'Offline' : 'Connecting...'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <section aria-labelledby="stats-heading" className="mb-8">
        <h2 id="stats-heading" className="sr-only">Key statistics</h2>
        {statsError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">Failed to load statistics.</p>
        )}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {statsLoading ? (
            <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
          ) : stats ? (
            <>
              <StatCard label="Total energy" value={`${stats.total_kwh.toLocaleString()} kWh`} icon={Zap} description="All verified readings" />
              <StatCard label="Certificates issued" value={stats.certificates_issued.toLocaleString()} icon={Award} description="Minted on Stellar" />
              <StatCard label="Certificates retired" value={stats.certificates_retired.toLocaleString()} icon={Leaf} description="Permanently burned" />
              <StatCard label="Active meters" value={stats.active_meters.toLocaleString()} icon={TrendingUp} description="Reporting in last 24 h" />
            </>
          ) : null}
        </div>
      </section>

      {/* Charts */}
      <section aria-labelledby="charts-heading" className="mb-8">
        <h2 id="charts-heading" className="sr-only">Energy charts</h2>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Line/area chart — kWh over time with period selector */}
          {readingsLoading ? (
            <ChartSkeleton title="Energy output" />
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Energy output (kWh)
                </h3>
                <div className="flex items-center gap-2">
                  {/* Period selector */}
                  <fieldset className="flex rounded-md border border-gray-200 dark:border-gray-700">
                    <legend className="sr-only">Time period</legend>
                    {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
                      <label key={p} className="cursor-pointer">
                        <input
                          type="radio"
                          name="period"
                          value={p}
                          checked={period === p}
                          onChange={() => setPeriod(p)}
                          className="sr-only"
                        />
                        <span
                          className={`block px-2.5 py-1 text-xs font-medium capitalize transition-colors first:rounded-l-md last:rounded-r-md ${
                            period === p
                              ? 'bg-yellow-400 text-gray-900'
                              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                          }`}
                        >
                          {p}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {/* CSV export */}
                  <button
                    onClick={() => exportCsv(chartData, `energy-${period}.csv`)}
                    aria-label={`Export ${period} energy data as CSV`}
                    className="rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div
                role="img"
                aria-label={`Area chart showing ${period} energy output in kWh`}
                className="h-48 w-full"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: colors.text }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: colors.text }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: colors.tooltip.bg, border: `1px solid ${colors.tooltip.border}`, borderRadius: '8px', color: colors.tooltip.text, fontSize: '12px' }}
                    />
                    <Area type="monotone" dataKey="kwh" stroke={colors.area} fill={colors.areaFill} strokeWidth={2} name="kWh" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Bar chart — per-meter kWh breakdown */}
          {readingsLoading ? (
            <ChartSkeleton title="Per-meter breakdown" />
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Per-meter kWh breakdown
                </h3>
                <button
                  onClick={() => {
                    const rows = meterData.map((m) => ({ date: m.meter, kwh: m.verified + m.unverified }))
                    exportCsv(rows, 'energy-by-meter.csv')
                  }}
                  aria-label="Export per-meter data as CSV"
                  className="rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <div
                role="img"
                aria-label="Bar chart showing verified and unverified kWh per meter"
                className="h-48 w-full"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={meterData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                    <XAxis dataKey="meter" tick={{ fontSize: 11, fill: colors.text }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: colors.text }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: colors.tooltip.bg, border: `1px solid ${colors.tooltip.border}`, borderRadius: '8px', color: colors.tooltip.text, fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', color: colors.text }} />
                    <Bar dataKey="verified" fill={colors.bar1} name="Verified (kWh)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="unverified" fill={colors.bar2} name="Unverified (kWh)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Recent readings table */}
      <section aria-labelledby="readings-heading">
        <h2 id="readings-heading" className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Recent readings
        </h2>
        {readingsError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">Failed to load readings.</p>
        )}
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <div className="overflow-x-auto">
            <table
              className="min-w-full divide-y divide-gray-200 bg-white text-sm dark:divide-gray-800 dark:bg-gray-900"
              aria-label="Recent meter readings"
              aria-busy={readingsLoading}
            >
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50">
                  {['Meter', 'kWh', 'Timestamp', 'Status'].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {readingsLoading ? (
                  <><TableRowSkeleton cols={4} /><TableRowSkeleton cols={4} /><TableRowSkeleton cols={4} /><TableRowSkeleton cols={4} /><TableRowSkeleton cols={4} /></>
                ) : readings && readings.length > 0 ? (
                  readings.slice(0, 20).map((r, index) => (
                    <tr 
                      key={r.id} 
                      className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40 animate-in fade-in slide-in-from-top-2 duration-300"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">{r.meter_id}</td>
                      <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{r.kwh.toFixed(3)}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{new Date(r.timestamp).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${r.verified ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'}`}>
                          {r.verified ? 'Verified' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No readings found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
    </WalletGate>
  )
}
