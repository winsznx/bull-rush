// Builds an EIP-4361 (Sign-In with Ethereum) message for the wallet to sign.
// The server (server/src/siwe.ts) parses and verifies the exact same text
// format independently — the two sides share a public standard, not code, so
// there is nothing to keep in sync here the way src/sim/ needs sync-sim.
export interface SiweParams {
    domain: string;
    address: `0x${string}`;
    statement: string;
    uri: string;
    chainId: number;
    nonce: string;
    issuedAt: string;
    expirationTime: string;
}

export function buildSiweMessage(p: SiweParams): string {
    return `${p.domain} wants you to sign in with your Ethereum account:
${p.address}

${p.statement}

URI: ${p.uri}
Version: 1
Chain ID: ${p.chainId}
Nonce: ${p.nonce}
Issued At: ${p.issuedAt}
Expiration Time: ${p.expirationTime}`;
}
