export const FINDHUB_MIN_HELPER_VERSION = '0.1.4'

export function compatibleFindHubHelper(version: unknown): boolean {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return false
  const actual = version.split('.').map(Number)
  const minimum = FINDHUB_MIN_HELPER_VERSION.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (actual[index] !== minimum[index]) return actual[index] > minimum[index]
  }
  return true
}

export function consumedFindHubAttempt(error: unknown): boolean {
  // These fixed backend outcomes already finish or invalidate the attempt; do not issue a second failing cancel.
  const message = error instanceof Error ? error.message : ''
  return /\[FH-AUTH-91(?:0[1-9]|1[0-6])\]/.test(message)
}
