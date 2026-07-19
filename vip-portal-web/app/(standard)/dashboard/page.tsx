'use client'

import React from 'react'

export default function StandardDashboardPage() {
  return (
    <div className="min-h-screen bg-[#070708] text-zinc-100 flex flex-col justify-between p-6 sm:p-12 relative overflow-hidden font-sans">
      {/* Background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#111115] via-[#070708] to-[#020202] pointer-events-none opacity-80" />

      <div className="max-w-4xl w-full mx-auto flex flex-col gap-10 z-10">
        
        {/* Header */}
        <header className="flex justify-between items-center border-b border-zinc-900 pb-6">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-wider text-zinc-100">OpenMatch Portal</h1>
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-mono">Standard Consumer Tier</p>
          </div>
          
          <div className="bg-[#111115] border border-zinc-800 px-3 py-1 rounded-full text-xs text-zinc-400 font-mono">
            Tier: Basic
          </div>
        </header>

        {/* Content Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Sourcing Status overview */}
          <div className="bg-[#0c0c0e] border border-zinc-900 rounded-2xl p-6 flex flex-col gap-4">
            <h2 className="text-base font-medium text-zinc-200">Matching Status</h2>
            <div className="border-t border-zinc-900 pt-4 flex flex-col gap-3">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Active Handshakes</span>
                <span className="font-mono text-zinc-300">0</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Pending Requests</span>
                <span className="font-mono text-zinc-300">0</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Sourcing Radius</span>
                <span className="font-mono text-zinc-300">50 km</span>
              </div>
            </div>
          </div>

          {/* Upgrade Call to Action */}
          <div className="bg-gradient-to-br from-[#12100d] to-[#080706] border border-[#231d14] rounded-2xl p-6 flex flex-col justify-between gap-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-[#E6C687]/10 text-[#E6C687] text-[9px] font-mono tracking-widest uppercase px-3 py-1 rounded-bl-xl border-l border-b border-[#E6C687]/20">
              Elite Tier
            </div>
            
            <div className="space-y-2">
              <h2 className="text-base font-serif text-[#E6C687]">Sovereign VIP Concierge</h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Unlock autonomous Retell AI matching brokers, priority sourcing timelines, private masked profiles, and the atomic credit refund protection protocol.
              </p>
            </div>

            <button className="w-full bg-[#E6C687] hover:bg-[#d4b373] text-black font-semibold py-2.5 px-4 rounded-xl text-xs tracking-wider uppercase transition-colors duration-300">
              Request Sovereign Invite
            </button>
          </div>

        </div>

      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-900 pt-6 text-center text-[10px] text-zinc-600 font-mono">
        © 2026 OpenMatch. Confidential Consumer Interface.
      </footer>
    </div>
  )
}
