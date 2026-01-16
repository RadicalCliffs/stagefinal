/**
 * Converts any user identifier to the canonical prize:pid: format.
 * Mirrors the backend toPrizePid() function in netlify/functions/_shared/userId.mts
 */
export function toCanonicalUserId(input: string | null | undefined): string {
  if (!input) throw new Error('User ID required');
  if (input.startsWith('prize:pid:')) return input;

  // Privy DID format
  if (input.startsWith('did:privy:')) {
    return `prize:pid:${input.replace('did:privy:', '')}`;
  }

  // Wallet address
  if (input.startsWith('0x')) {
    return `prize:pid:${input.toLowerCase()}`;
  }

  return `prize:pid:${input}`;
}

export function isCanonicalUserId(input: string): boolean {
  return input.startsWith('prize:pid:');
}
