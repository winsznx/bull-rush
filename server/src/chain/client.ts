// Relayer chain clients. Deliberately NOT constructed at module load time and NOT
// required for the server to boot: no BOT Chain contract exists yet (Phase 15 is the
// gated point where one is actually deployed), so every caller must go through
// `loadChainConfig()` first and handle a `null` result (relayer disabled) rather than
// this module throwing on missing env vars during ordinary boot.
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export interface ChainRelayerConfig {
    chainId: number;
    rpcUrl: string;
    relayerPrivateKey: Hex;
    dailyGridRegistryAddress: Address;
    verifiedRunRegistryAddress: Address;
}

// Returns null when the relayer is not enabled for this environment — the caller's
// only job is to skip relayer work entirely in that case, not to treat it as an error.
export function loadChainConfig(env: NodeJS.ProcessEnv = process.env): ChainRelayerConfig | null {
    if (env.CHAIN_RELAYER_ENABLED !== 'true') return null;

    const chainId = Number(env.CHAIN_ID);
    const rpcUrl = env.CHAIN_RPC_URL;
    const relayerPrivateKey = env.RELAYER_PRIVATE_KEY as Hex | undefined;
    const dailyGridRegistryAddress = env.DAILY_GRID_REGISTRY_ADDRESS as Address | undefined;
    const verifiedRunRegistryAddress = env.VERIFIED_RUN_REGISTRY_ADDRESS as Address | undefined;

    if (!chainId || !rpcUrl || !relayerPrivateKey || !dailyGridRegistryAddress || !verifiedRunRegistryAddress) {
        throw new Error(
            'CHAIN_RELAYER_ENABLED=true but one or more of CHAIN_ID, CHAIN_RPC_URL, RELAYER_PRIVATE_KEY, ' +
                'DAILY_GRID_REGISTRY_ADDRESS, VERIFIED_RUN_REGISTRY_ADDRESS is missing.',
        );
    }

    return { chainId, rpcUrl, relayerPrivateKey, dailyGridRegistryAddress, verifiedRunRegistryAddress };
}

export function createChainClients(config: ChainRelayerConfig) {
    const chain = defineChain({
        id: config.chainId,
        name: `chain-${config.chainId}`,
        nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
        rpcUrls: { default: { http: [config.rpcUrl] } },
    });

    const account = privateKeyToAccount(config.relayerPrivateKey);
    const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
    const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });

    return { chain, account, publicClient, walletClient };
}
