import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import React, { PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { AccountLayout, TOKEN_PROGRAM_ID, Token, AccountInfo as TokenAccountInfo, u64 } from '@solana/spl-token';
import { useWalletPassThrough } from './WalletPassthroughProvider';
import { useConnection } from '@jup-ag/wallet-adapter';
import useNativeAccount from 'src/queries/useNativeAccount';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getAssociatedTokenAddressSync } from 'src/misc/utils';
import { checkIsToken2022 } from 'src/misc/tokenTags';
import { getMultipleAccountsInfo } from '@mercurial-finance/optimist';
import { useTokenContext } from './TokenContextProvider';
import { useUSDValueProvider } from './USDValueProvider';

const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export interface IAccountsBalance {
  pubkey: PublicKey;
  balance: string;
  balanceLamports: BN;
  decimals: number;
  isFrozen: boolean;
}

interface IAccountContext {
  accounts: TokenAccount[];
  nativeAccount: TokenAccount | null;
  isFetching: boolean;
  isInitialLoading: boolean;
  fetchTokenAccounts: (mintsOrAccounts: (string | PublicKey)[]) => void;
  fetchAllAccounts: () => void;
  refetchAccounts: (mints?: (string | PublicKey)[]) => void;
}

const AccountContext = React.createContext<IAccountContext>({
  accounts: [],
  nativeAccount: null,
  isFetching: false,
  isInitialLoading: false,
  fetchTokenAccounts: () => {},
  fetchAllAccounts: () => {},
  refetchAccounts: () => {},
});

export interface TokenAccount {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
  info: TokenAccountInfo;
}

const deserializeAccount = (data: Buffer) => {
  if (data == undefined || data.length == 0) {
    return undefined;
  }
  const accountInfo = AccountLayout.decode(data);
  accountInfo.mint = new PublicKey(accountInfo.mint);
  accountInfo.owner = new PublicKey(accountInfo.owner);
  accountInfo.amount = u64.fromBuffer(accountInfo.amount);
  if (accountInfo.delegateOption === 0) {
    accountInfo.delegate = null;
    accountInfo.delegatedAmount = new u64(0);
  } else {
    accountInfo.delegate = new PublicKey(accountInfo.delegate);
    accountInfo.delegatedAmount = u64.fromBuffer(accountInfo.delegatedAmount);
  }
  accountInfo.isInitialized = accountInfo.state !== 0;
  accountInfo.isFrozen = accountInfo.state === 2;
  if (accountInfo.isNativeOption === 1) {
    accountInfo.rentExemptReserve = u64.fromBuffer(accountInfo.isNative);
    accountInfo.isNative = true;
  } else {
    accountInfo.rentExemptReserve = null;
    accountInfo.isNative = false;
  }
  if (accountInfo.closeAuthorityOption === 0) {
    accountInfo.closeAuthority = null;
  } else {
    accountInfo.closeAuthority = new PublicKey(accountInfo.closeAuthority);
  }
  return accountInfo;
};

export const TokenAccountParser = (pubkey: PublicKey, info: AccountInfo<Buffer>): TokenAccount | undefined => {
  const tokenAccountInfo = deserializeAccount(info.data);

  if (!tokenAccountInfo) return;
  return {
    pubkey,
    account: info,
    info: tokenAccountInfo,
  };
};

const queryUserTokenAccounts = async (
  connection: Connection,
  tokenProgramId: PublicKey,
  owner?: PublicKey,
): Promise<Map<string, TokenAccount>> => {
  if (owner) {
    try {
      const accounts = await connection.getTokenAccountsByOwner(
        owner,
        {
          programId: tokenProgramId,
        },
        'confirmed',
      );
      return accounts.value.reduce((map, { pubkey, account }) => {
        const tokenAccount = TokenAccountParser(pubkey, account);
        if (tokenAccount) {
          map.set(pubkey.toString(), tokenAccount);
        }
        return map;
      }, new Map<string, TokenAccount>());
    } catch (error) {
      // Most likely it's rate limited, or rpc is down
      console.error(error);
      throw error;
    }
  }
  return new Map();
};

const AccountsProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const { publicKey, connected } = useWalletPassThrough();
  const { connection } = useConnection();
  const { getTokenInfo } = useTokenContext();
  const lastAllTokensFetchedTime = useRef(0);

  const { data: nativeAccount = null, refetch: refetchSOL, isFetching: isFetchingNativeAccount } = useNativeAccount();

  const tokenOrMintAccountsToFetch = useRef<string[]>([]);

  const cacheKey = useMemo(() => {
    // Force refetch when user or RPC changes
    lastAllTokensFetchedTime.current = 0;
    return [connection.rpcEndpoint, publicKey?.toString() || ''].join('');
  }, [connection.rpcEndpoint, publicKey]);

  const {
    mutateAsync: _fetchAllAccounts,
    data: ataToUserAccount = new Map<string, TokenAccount>(),
    isLoading: isFetchingAllAccounts,
    status: fetchAllAccountsStatus,
    reset,
  } = useMutation(
    ['accounts', ...cacheKey],
    async () => {
      if (publicKey) {
        const [userAccountMap, user2022AccountMap] = await Promise.all([
          queryUserTokenAccounts(connection, TOKEN_PROGRAM_ID, publicKey),
          queryUserTokenAccounts(connection, TOKEN_2022_PROGRAM_ID, publicKey),
        ]);
        lastAllTokensFetchedTime.current = Date.now();

        return new Map<string, TokenAccount>([...userAccountMap, ...user2022AccountMap]);
      }

      return new Map<string, TokenAccount>();
    },
    { cacheTime: Infinity },
  );

  const fetchAllAccounts = useCallback(() => {
    // only refetch when > 20s or not fetched before
    if (!lastAllTokensFetchedTime.current || Date.now() - lastAllTokensFetchedTime.current > 20_000) {
      return _fetchAllAccounts();
    }
  }, [_fetchAllAccounts]);

  const {
    refetch: fetchTokenAccounts,
    data: fetchedAtaToUserAccount,
    isLoading: isFetchingTokenAcounts,
    // variables,
    remove,
  } = useQuery(
    ['specific-token-accounts', ...cacheKey, tokenOrMintAccountsToFetch.current.map((t) => t.toString()).join()],
    async () => {
      if (tokenOrMintAccountsToFetch.current.length <= 0) {
        return new Map<string, TokenAccount>();
      }

      const mintsOrAccounts = tokenOrMintAccountsToFetch.current;
      if (!publicKey) {
        return new Map<string, TokenAccount>();
      }
      const atasSet = mintsOrAccounts.reduce((atas, mintOrAta) => {
        const mintStr = mintOrAta.toString();
        const tokenInfo = getTokenInfo(mintStr);
        if (tokenInfo) {
          const isToken2022 = checkIsToken2022(tokenInfo);
          const tokenAta = getAssociatedTokenAddressSync(
            new PublicKey(mintStr),
            publicKey!,
            isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
          );
          atas.add(tokenAta.toString());
        } else {
          // could be ATA
          atas.add(mintOrAta.toString());
        }

        return atas;
      }, new Set<string>());
      const atas = Array.from(atasSet).map((ata) => new PublicKey(ata));
      const accountToAccountInfosMap = await getMultipleAccountsInfo(connection, atas);
      const ataToTokenAccountMap = Array.from(accountToAccountInfosMap).reduce(
        (_ataToTokenAccountMap, [pubkey, account]) => {
          if (!account) return _ataToTokenAccountMap;
          const tokenAccount = TokenAccountParser(new PublicKey(pubkey), account);
          if (tokenAccount) {
            _ataToTokenAccountMap.set(pubkey, tokenAccount);
          }
          return _ataToTokenAccountMap;
        },
        new Map<string, TokenAccount>(),
      );
      return ataToTokenAccountMap;
    },
    {
      initialData: new Map<string, TokenAccount>(),
      refetchInterval: 5000,
    },
  );

  useEffect(() => {
    if (publicKey) {
      return () => {
        remove();
        reset();
      };
    }
  }, [publicKey, remove, reset]);

  const { userAccounts } = useMemo(() => {
    const addressToTokenAccountMap = new Map([...ataToUserAccount, ...(fetchedAtaToUserAccount || new Map())]);
    const userAccounts = Array.from(addressToTokenAccountMap.values());

    const mintToAssociatedTokenAccountMap = (() => {
      if (!publicKey) return new Map<string, TokenAccount>();
      return userAccounts.reduce((map, tokenAccount) => {
        const expectedAta = getAssociatedTokenAddressSync(
          tokenAccount.info.mint,
          publicKey,
          tokenAccount.account.owner,
        );
        if (expectedAta.equals(tokenAccount.pubkey)) {
          map.set(tokenAccount.info.mint.toBase58(), tokenAccount);
        }

        return map;
      }, new Map<string, TokenAccount>());
    })();

    return {
      addressToTokenAccountMap,
      userAccounts,
      mintToAssociatedTokenAccountMap,
    };
  }, [ataToUserAccount, fetchedAtaToUserAccount, publicKey]);

  return (
    <AccountContext.Provider
      value={{
        accounts: userAccounts,
        nativeAccount,
        isInitialLoading: fetchAllAccountsStatus !== 'success',
        isFetching: isFetchingTokenAcounts || isFetchingAllAccounts || isFetchingNativeAccount,
        fetchAllAccounts,
        refetchAccounts: React.useCallback(
          async (tokenAccounts?: (string | PublicKey)[]) => {
            const filteredTokenAccounts = tokenAccounts?.filter(Boolean).map((t) => t.toString());

            refetchSOL();
            if (filteredTokenAccounts) {
              tokenOrMintAccountsToFetch.current = filteredTokenAccounts;
            } else {
              return fetchAllAccounts();
            }
          },
          // eslint-disable-next-line react-hooks/exhaustive-deps
          [fetchTokenAccounts],
        ),
        fetchTokenAccounts: React.useCallback(
          (newToFetch: (string | PublicKey)[]) => {
            const filteredTokenAccounts = newToFetch?.filter(Boolean).map((t) => t.toString());
            if (filteredTokenAccounts) {
              const newSet = new Set(filteredTokenAccounts);
              tokenOrMintAccountsToFetch.current = tokenOrMintAccountsToFetch.current.concat(Array.from(newSet));
            }
          },
          [tokenOrMintAccountsToFetch],
        ),
      }}
    >
      {children}
    </AccountContext.Provider>
  );
};

const useAccounts = () => {
  return useContext(AccountContext);
};

export { AccountsProvider, useAccounts };
