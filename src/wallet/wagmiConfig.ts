// Minimal wallet-connect config, matching BotSpend's proven approach for BOT
// Chain: the bare injected() connector only (MetaMask-compatible / BO Wallet's
// injected provider). No WalletConnect, no MetaMask SDK deep-linking — those
// pull in transitively-vulnerable packages (see docs/adr/0004) that this
// config never imports and are confirmed absent from the built bundle.
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { botChainMainnet, botChainTestnet } from './chain';

export const wagmiConfig = createConfig({
    chains: [botChainMainnet, botChainTestnet],
    connectors: [injected()],
    transports: {
        [botChainMainnet.id]: http(),
        [botChainTestnet.id]: http(),
    },
    ssr: false,
});

declare module 'wagmi' {
    interface Register {
        config: typeof wagmiConfig;
    }
}
