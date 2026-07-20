// BOT Chain network definitions. Values are NOT copied from memory or from the
// migration brief — they were independently confirmed live via eth_chainId
// against both RPCs during Phase 0 (docs/BOTCHAIN-NETWORK-VALIDATION.md) and
// cross-checked against BotSpend's own working networks.ts. If BOT Chain's
// infrastructure ever changes, re-verify with `eth_chainId` before editing this
// file — never trust a remembered value.
import { defineChain } from 'viem';

export const BOT_CHAIN_MAINNET_ID = 677;
export const BOT_CHAIN_TESTNET_ID = 968;

export const botChainMainnet = defineChain({
    id: BOT_CHAIN_MAINNET_ID,
    name: 'BOT Chain',
    nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.botchain.ai'] } },
    blockExplorers: { default: { name: 'BOTScan', url: 'https://scan.botchain.ai' } },
    testnet: false,
});

export const botChainTestnet = defineChain({
    id: BOT_CHAIN_TESTNET_ID,
    name: 'BOT Chain Testnet',
    nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.bohr.life'] } },
    blockExplorers: { default: { name: 'BOTScan Testnet', url: 'https://scan.bohr.life' } },
    testnet: true,
});

export function explorerAddress(chainId: number, address: string): string {
    const base = chainId === BOT_CHAIN_MAINNET_ID ? 'https://scan.botchain.ai' : 'https://scan.bohr.life';
    return `${base}/address/${address}`;
}

export function explorerTx(chainId: number, hash: string): string {
    const base = chainId === BOT_CHAIN_MAINNET_ID ? 'https://scan.botchain.ai' : 'https://scan.bohr.life';
    return `${base}/tx/${hash}`;
}
