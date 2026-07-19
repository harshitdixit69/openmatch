import React from 'react'
import './globals.css'

export const metadata = {
  title: 'OpenMatch Sovereign Portal',
  description: 'Elite Autonomous Match Escrow Service',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-black text-white antialiased">
        {children}
      </body>
    </html>
  )
}
