'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserClient } from '@/lib/supabaseBrowser'

export default function LoginPage() {
  const router = useRouter()
  const supabase = getBrowserClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (error) throw error
      // Full navigation so the middleware re-runs with the new session cookie.
      window.location.assign('/dashboard/marketing')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleMagicLink() {
    if (!email.trim()) {
      setError('Enter your email first.')
      return
    }
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `${window.location.origin}/dashboard/marketing` },
      })
      if (error) throw error
      setMessage('Check your email for a sign-in link.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send magic link.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#070708] text-zinc-100 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-sm bg-[#0c0c0e] border border-zinc-900 rounded-2xl p-8 flex flex-col gap-6">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold tracking-wider">OpenMatch Portal</h1>
          <p className="text-xs text-zinc-500 uppercase tracking-widest font-mono">Admin sign-in</p>
        </div>

        <form onSubmit={handlePasswordSignIn} className="flex flex-col gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="bg-[#070708] border border-zinc-800 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="bg-[#070708] border border-zinc-800 rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-[#E6C687] hover:bg-[#d4b373] text-black font-semibold py-2.5 rounded-lg text-xs tracking-wider uppercase disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="flex items-center gap-3 text-[10px] text-zinc-600 font-mono uppercase">
          <div className="h-px bg-zinc-900 flex-1" />
          or
          <div className="h-px bg-zinc-900 flex-1" />
        </div>

        <button
          onClick={handleMagicLink}
          disabled={loading}
          className="bg-[#111115] border border-zinc-800 hover:text-zinc-100 text-zinc-400 py-2.5 rounded-lg text-xs tracking-wider uppercase disabled:opacity-50"
        >
          Email me a magic link
        </button>

        {message && <p className="text-emerald-400 text-xs text-center">{message}</p>}
        {error && <p className="text-red-400 text-xs text-center">{error}</p>}
      </div>
    </div>
  )
}
