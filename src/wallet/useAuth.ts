import { useEffect, useState } from 'react';
import { useAccount, useConnect, useSignMessage, useSwitchChain } from 'wagmi';
import { buildSiweMessage } from './siwe';
import { BOT_CHAIN_MAINNET_ID } from './chain';
import { requestNonce, verifySiweSignature, getSession, logout, type SessionInfo } from '../authApi';

export type AuthStatus = 'idle' | 'connecting' | 'switching_chain' | 'signing' | 'verifying' | 'error';

// Wallet connect + chain validation + SIWE, in one call. Never invoked on the
// practice/CHARGE path — only when the player explicitly enters Daily Grid,
// per the product's "wallet is identity, not a repeated popup" requirement.
export function useAuth() {
    const { address, chainId, isConnected } = useAccount();
    const { connectAsync, connectors } = useConnect();
    const { signMessageAsync } = useSignMessage();
    const { switchChainAsync } = useSwitchChain();

    const [session, setSession] = useState<SessionInfo>({ authenticated: false });
    const [status, setStatus] = useState<AuthStatus>('idle');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void getSession().then(setSession);
    }, []);

    const signIn = async (): Promise<void> => {
        setError(null);
        try {
            let addr = address;
            let effectiveChainId = chainId;
            if (!isConnected || !addr) {
                setStatus('connecting');
                const connector = connectors.find((c) => c.id === 'injected') ?? connectors[0];
                if (!connector) {
                    setError('no_wallet_found');
                    setStatus('error');
                    return;
                }
                const res = await connectAsync({ connector });
                addr = res.accounts[0];
                effectiveChainId = res.chainId;
            }
            if (!addr) {
                setError('no_wallet_found');
                setStatus('error');
                return;
            }

            if (effectiveChainId !== BOT_CHAIN_MAINNET_ID) {
                setStatus('switching_chain');
                await switchChainAsync({ chainId: BOT_CHAIN_MAINNET_ID });
            }

            setStatus('signing');
            const nonce = await requestNonce(addr);
            if (!nonce) {
                setError('nonce_request_failed');
                setStatus('error');
                return;
            }
            const now = new Date();
            const message = buildSiweMessage({
                domain: window.location.host,
                address: addr as `0x${string}`,
                statement: 'Sign in to Bull Rush to enter the Daily Grid.',
                uri: window.location.origin,
                chainId: BOT_CHAIN_MAINNET_ID,
                nonce,
                issuedAt: now.toISOString(),
                expirationTime: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
            });
            const signature = await signMessageAsync({ message });

            setStatus('verifying');
            const result = await verifySiweSignature(message, signature);
            if (!result.ok) {
                setError(result.error ?? 'verification_failed');
                setStatus('error');
                return;
            }
            setSession({ authenticated: true, wallet: result.wallet, chainId: result.chainId });
            setStatus('idle');
        } catch {
            setError('wallet_rejected_or_unavailable');
            setStatus('error');
        }
    };

    const signOut = async (): Promise<void> => {
        await logout();
        setSession({ authenticated: false });
    };

    return { session, status, error, signIn, signOut };
}
