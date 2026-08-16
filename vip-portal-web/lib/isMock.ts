/**
 * Determines whether an email belongs to a mock / test / seeded account.
 * Ported from openmatch/scripts/checkSignups.mjs
 *
 * Rules:
 *  - No email (phone/anonymous) → mock
 *  - Domain patterns: mock.*.test, @example.com, @mock-phone-auth
 *  - Prefix patterns: phase#, stripetest, test-, test_, sla-, profile-save,
 *    test-review, test-block, test-ghostwriter, test-concierge,
 *    test_spotlight, test_rpc
 */
export function isMock(email: string | null | undefined): boolean {
  if (!email) return true // no email = phone/anon test artifact

  const e = email.toLowerCase()

  return (
    (e.includes('mock.') && e.endsWith('.test')) ||
    e.endsWith('@example.com') ||
    e.includes('@mock-phone-auth') ||
    /^(phase\d|stripetest|test[-_]|sla-|profile-save|test-review|test-block|test-ghostwriter|test-concierge|test_spotlight|test_rpc)/.test(
      e
    )
  )
}
