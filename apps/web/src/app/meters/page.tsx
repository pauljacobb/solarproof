'use client'

import { useState } from 'react'
import { WalletGate } from '@/components/wallet-gate'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PlusCircle, ShieldOff } from 'lucide-react'
import { CopyableText } from '@/components/copy-button'

interface Meter {
  id: string
  name: string
  serial_number: string
  pubkey_hex: string
  active: boolean
  created_at: string
  cooperative_id: string
  meter_group: string | null
  tags: string[]
}

async function fetchMeters(): Promise<Meter[]> {
  const res = await fetch('/api/meters')
  if (!res.ok) throw new Error('Failed to load meters')
  return res.json()
}

async function registerMeter(body: {
  name: string
  cooperative_id: string
  serial_number: string
  pubkey_hex: string
  meter_group?: string
  tags?: string[]
}): Promise<Meter> {
  const res = await fetch('/api/meters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? 'Registration failed')
  }
  return res.json()
}

async function revokeMeter(id: string): Promise<void> {
  const res = await fetch(`/api/meters/${id}/revoke`, { method: 'PATCH' })
  if (!res.ok) throw new Error('Revoke failed')
}

// ---------------------------------------------------------------------------
// Register form
// ---------------------------------------------------------------------------
function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({
    name: '',
    cooperative_id: '',
    serial_number: '',
    pubkey_hex: '',
    meter_group: '',
    tags: '',
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      registerMeter({
        ...data,
        tags: data.tags
          ? data.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        meter_group: data.meter_group || undefined,
      }),
    onSuccess: () => {
      setForm({
        name: '',
        cooperative_id: '',
        serial_number: '',
        pubkey_hex: '',
        meter_group: '',
        tags: '',
      })
      setError('')
      onSuccess()
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    mutation.mutate(form)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
      aria-label="Register new meter"
    >
      <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-gray-100">
        Register new meter
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label
            htmlFor="name"
            className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
          >
            Meter name
          </label>
          <input
            id="name"
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Solar Array A - Meter 1"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div>
          <label
            htmlFor="cooperative_id"
            className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
          >
            Cooperative ID (UUID)
          </label>
          <input
            id="cooperative_id"
            type="text"
            required
            value={form.cooperative_id}
            onChange={(e) => setForm((f) => ({ ...f, cooperative_id: e.target.value }))}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div>
          <label
            htmlFor="serial_number"
            className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
          >
            Serial number
          </label>
          <input
            id="serial_number"
            type="text"
            required
            value={form.serial_number}
            onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))}
            placeholder="MTR-001"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div>
          <label
            htmlFor="pubkey_hex"
            className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
          >
            Ed25519 public key (64 hex chars)
          </label>
          <input
            id="pubkey_hex"
            type="text"
            required
            pattern="[0-9a-fA-F]{64}"
            value={form.pubkey_hex}
            onChange={(e) => setForm((f) => ({ ...f, pubkey_hex: e.target.value }))}
            placeholder="0a1b2c…"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div>
          <label
            htmlFor="meter_group"
            className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
          >
            Group (optional)
          </label>
          <input
            id="meter_group"
            type="text"
            value={form.meter_group}
            onChange={(e) => setForm((f) => ({ ...f, meter_group: e.target.value }))}
            placeholder="North Farm"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div>
          <label
            htmlFor="tags"
            className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
          >
            Labels (comma separated)
          </label>
          <input
            id="tags"
            type="text"
            value={form.tags}
            onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
            placeholder="residential, phase-1"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-yellow-400 px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {mutation.isPending ? (
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
        )}
        {mutation.isPending ? 'Registering…' : 'Register meter'}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Revoke confirmation dialog
// ---------------------------------------------------------------------------
function RevokeDialog({
  meter,
  onConfirm,
  onCancel,
  pending,
}: {
  meter: Meter
  onConfirm: () => void
  onCancel: () => void
  pending: boolean
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="revoke-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <h3
          id="revoke-title"
          className="mb-2 text-base font-semibold text-gray-900 dark:text-gray-100"
        >
          Revoke meter?
        </h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Meter <span className="font-mono font-medium">{meter.serial_number}</span> will be
          deactivated and can no longer submit readings.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-md px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending && (
              <svg
                className="h-4 w-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
            {pending ? 'Revoking…' : 'Revoke'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Meters page
// ---------------------------------------------------------------------------
export default function MetersPage() {
  const qc = useQueryClient()
  const [revokeTarget, setRevokeTarget] = useState<Meter | null>(null)

  const { data: meters, isLoading, error } = useQuery({
    queryKey: ['meters'],
    queryFn: fetchMeters,
  })

  const revokeMutation = useMutation({
    mutationFn: revokeMeter,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meters'] })
      setRevokeTarget(null)
    },
  })

  return (
    <WalletGate>
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">Meters</h1>

      <div className="mb-8">
        <RegisterForm onSuccess={() => qc.invalidateQueries({ queryKey: ['meters'] })} />
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
          Failed to load meters.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="overflow-x-auto">
          <table
            className="min-w-full divide-y divide-gray-200 bg-white text-sm dark:divide-gray-800 dark:bg-gray-900"
            aria-label="Registered meters"
            aria-busy={isLoading}
          >
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50">
                {['Name', 'Serial number', 'Group', 'Labels', 'Status', 'Actions'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : meters && meters.length > 0 ? (
                meters.map((m) => (
                  <tr
                    key={m.id}
                    className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      {m.name}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {m.serial_number}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {m.meter_group || <span className="text-gray-400 italic">None</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {m.tags.length > 0 ? (
                          m.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                            >
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          m.active
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        {m.active ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {m.active && (
                        <button
                          onClick={() => setRevokeTarget(m)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                          aria-label={`Revoke meter ${m.serial_number}`}
                        >
                          <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400"
                  >
                    No meters registered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {revokeTarget && (
        <RevokeDialog
          meter={revokeTarget}
          onConfirm={() => revokeMutation.mutate(revokeTarget.id)}
          onCancel={() => setRevokeTarget(null)}
          pending={revokeMutation.isPending}
        />
      )}
    </div>
    </WalletGate>
  )
}
