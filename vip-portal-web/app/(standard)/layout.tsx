import React from 'react'

export const metadata = {
  title: 'OpenMatch Dashboard',
  description: 'Consumer Onboarding & Matching Portal',
}

export default function StandardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
      <main className="relative z-10">{children}</main>
    </div>
  )
}
