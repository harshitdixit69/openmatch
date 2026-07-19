import React from 'react'

export const metadata = {
  title: 'VIP Concierge Portal',
  description: 'Confidential Autonomous Matching Service',
}

export default function VipLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-white antialiased selection:bg-[#E6C687] selection:text-black relative overflow-hidden">
      {/* Premium ambient light flare at top */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[400px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#1d1912] via-[#000000]/10 to-transparent pointer-events-none opacity-80" />
      
      {/* Subtle gold line at top */}
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#E6C687]/40 to-transparent absolute top-0 left-0" />

      {/* Header wrapper */}
      <header className="relative z-20 max-w-7xl mx-auto px-6 pt-6 pb-2 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[#E6C687] animate-pulse" />
          <span className="font-serif italic text-base tracking-wide text-[#E6C687]">Sovereign</span>
          <span className="text-zinc-500 text-[10px] uppercase tracking-widest font-mono">Concierge</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-400 font-mono">Status:</span>
          <div className="bg-[#12110e] border border-[#2d2516] text-[#E6C687] text-[9px] font-mono tracking-widest uppercase px-3 py-1 rounded-full flex items-center gap-1.5 shadow-[0_0_10px_rgba(230,198,135,0.05)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#E6C687] animate-ping" />
            Isolated Node
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {children}
      </main>
    </div>
  )
}
