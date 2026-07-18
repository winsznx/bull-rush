// Parses + verifies an EIP-4361 (Sign-In with Ethereum) message against the
// exact format src/wallet/siwe.ts builds client-side. No shared code between
// the two sides deliberately — SIWE is a public standard, so both ends target
// the same well-defined text format rather than importing one implementation.
import { verifyMessage } from 'viem';

export interface ParsedSiwe {
    domain: string;
    address: `0x${string}`;
    statement: string;
    uri: string;
    chainId: number;
    nonce: string;
    issuedAt: string;
    expirationTime: string;
}

// Returns null if the message doesn't match the expected shape at all —
// callers should treat that the same as any other rejection reason.
export function parseSiweMessage(message: string): ParsedSiwe | null {
    const lines = message.split('\n');
    if (lines.length < 10) return null;

    const header = /^(.+) wants you to sign in with your Ethereum account:$/.exec(lines[0]);
    const address = /^(0x[a-fA-F0-9]{40})$/.exec(lines[1]);
    if (!header || !address || lines[2] !== '') return null;

    // statement is everything between the address block and the empty line
    // preceding "URI:" — for our fixed builder this is exactly line 3.
    const statement = lines[3];
    if (lines[4] !== '') return null;

    const fields: Record<string, string> = {};
    for (const line of lines.slice(5)) {
        const m = /^([A-Za-z ]+):\s(.*)$/.exec(line);
        if (m) fields[m[1]] = m[2];
    }

    const chainId = Number(fields['Chain ID']);
    if (
        !fields['URI'] ||
        fields['Version'] !== '1' ||
        !Number.isInteger(chainId) ||
        !fields['Nonce'] ||
        !fields['Issued At'] ||
        !fields['Expiration Time']
    ) {
        return null;
    }

    return {
        domain: header[1],
        address: address[1].toLowerCase() as `0x${string}`,
        statement,
        uri: fields['URI'],
        chainId,
        nonce: fields['Nonce'],
        issuedAt: fields['Issued At'],
        expirationTime: fields['Expiration Time'],
    };
}

export type SiweRejection =
    | 'malformed_message'
    | 'wrong_domain'
    | 'wrong_uri'
    | 'wrong_chain'
    | 'expired'
    | 'not_yet_valid'
    | 'invalid_signature';

export interface VerifySiweContext {
    expectedDomain: string;
    expectedUri: string;
    expectedChainId: number;
}

// Verifies the message's fields AND that `signature` was produced by
// `parsed.address` signing exactly this message text (viem's verifyMessage
// recovers the signer from the raw message + signature — it does not trust
// any field in the message itself; the message is just signed data).
export async function verifySiwe(
    message: string,
    signature: `0x${string}`,
    ctx: VerifySiweContext,
): Promise<{ ok: true; parsed: ParsedSiwe } | { ok: false; reason: SiweRejection }> {
    const parsed = parseSiweMessage(message);
    if (!parsed) return { ok: false, reason: 'malformed_message' };
    if (parsed.domain !== ctx.expectedDomain) return { ok: false, reason: 'wrong_domain' };
    if (parsed.uri !== ctx.expectedUri) return { ok: false, reason: 'wrong_uri' };
    if (parsed.chainId !== ctx.expectedChainId) return { ok: false, reason: 'wrong_chain' };

    const now = Date.now();
    const issuedAt = Date.parse(parsed.issuedAt);
    const expirationTime = Date.parse(parsed.expirationTime);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expirationTime)) return { ok: false, reason: 'malformed_message' };
    if (now < issuedAt) return { ok: false, reason: 'not_yet_valid' };
    if (now >= expirationTime) return { ok: false, reason: 'expired' };

    const valid = await verifyMessage({ address: parsed.address, message, signature }).catch(() => false);
    if (!valid) return { ok: false, reason: 'invalid_signature' };

    return { ok: true, parsed };
}
