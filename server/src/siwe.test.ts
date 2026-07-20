// Pure-logic tests — no DB/Redis needed. Uses a well-known, public throwaway
// test private key (Hardhat/Anvil's default account #0) purely to produce a
// REAL signature to verify against, never a fund-holding key.
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { parseSiweMessage, verifySiwe } from './siwe';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`;
const account = privateKeyToAccount(TEST_PRIVATE_KEY);

const CTX = { expectedDomain: 'trybullrush.xyz', expectedUri: 'https://trybullrush.xyz', expectedChainId: 677 };

function buildMessage(overrides: Partial<Record<string, string>> = {}): string {
    const now = new Date();
    const issuedAt = overrides.issuedAt ?? now.toISOString();
    const expirationTime = overrides.expirationTime ?? new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    return `${overrides.domain ?? CTX.expectedDomain} wants you to sign in with your Ethereum account:
${account.address}

Sign in to Bull Rush.

URI: ${overrides.uri ?? CTX.expectedUri}
Version: 1
Chain ID: ${overrides.chainId ?? CTX.expectedChainId}
Nonce: ${overrides.nonce ?? 'abc123nonce'}
Issued At: ${issuedAt}
Expiration Time: ${expirationTime}`;
}

describe('SIWE message parsing', () => {
    it('parses every field from a well-formed message', () => {
        const parsed = parseSiweMessage(buildMessage());
        expect(parsed?.domain).toBe(CTX.expectedDomain);
        expect(parsed?.address).toBe(account.address.toLowerCase());
        expect(parsed?.chainId).toBe(677);
        expect(parsed?.nonce).toBe('abc123nonce');
    });

    it('returns null for a message that does not match the expected shape', () => {
        expect(parseSiweMessage('not a siwe message')).toBeNull();
    });
});

describe('SIWE verification', () => {
    it('accepts a genuinely signed, well-formed, unexpired message', async () => {
        // #given a message actually signed by the test account's private key
        const message = buildMessage();
        const signature = await account.signMessage({ message });
        // #when verified against the expected domain/uri/chain
        const result = await verifySiwe(message, signature, CTX);
        // #then it is accepted and the recovered address matches the signer
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.parsed.address).toBe(account.address.toLowerCase());
    });

    it('rejects a signature that does not match the message (forged/tampered)', async () => {
        // #given a real signature over one message, attached to a DIFFERENT message
        const signed = buildMessage({ nonce: 'original-nonce' });
        const signature = await account.signMessage({ message: signed });
        const tampered = buildMessage({ nonce: 'different-nonce' });
        // #when verified
        const result = await verifySiwe(tampered, signature, CTX);
        // #then the recovered signer does not match — rejected
        expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
    });

    it('rejects a message for the wrong domain (phishing-relay defense)', async () => {
        const message = buildMessage({ domain: 'evil.example' });
        const signature = await account.signMessage({ message });
        expect(await verifySiwe(message, signature, CTX)).toEqual({ ok: false, reason: 'wrong_domain' });
    });

    it('rejects a message for the wrong chain', async () => {
        const message = buildMessage({ chainId: '968' });
        const signature = await account.signMessage({ message });
        expect(await verifySiwe(message, signature, CTX)).toEqual({ ok: false, reason: 'wrong_chain' });
    });

    it('rejects an expired message', async () => {
        const past = new Date(Date.now() - 60_000).toISOString();
        const message = buildMessage({ issuedAt: new Date(Date.now() - 120_000).toISOString(), expirationTime: past });
        const signature = await account.signMessage({ message });
        expect(await verifySiwe(message, signature, CTX)).toEqual({ ok: false, reason: 'expired' });
    });

    it('rejects a message issued in the future', async () => {
        const future = new Date(Date.now() + 60_000).toISOString();
        const message = buildMessage({ issuedAt: future, expirationTime: new Date(Date.now() + 120_000).toISOString() });
        const signature = await account.signMessage({ message });
        expect(await verifySiwe(message, signature, CTX)).toEqual({ ok: false, reason: 'not_yet_valid' });
    });
});
