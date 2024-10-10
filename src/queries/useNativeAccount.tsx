import { useConnection } from '@jup-ag/wallet-adapter';
import { AccountLayout, TOKEN_PROGRAM_ID, Token, AccountInfo as TokenAccountInfo, u64 } from '@solana/spl-token';
import { AccountInfo, PublicKey } from '@solana/web3.js';
import { useQuery } from '@tanstack/react-query';
import BN from 'bn.js';
import React, { PropsWithChildren, useCallback, useContext, useEffect, useState } from 'react';
import { WRAPPED_SOL_MINT } from 'src/constants';
import { fromLamports, getAssociatedTokenAddressSync } from 'src/misc/utils';
import Decimal from 'decimal.js';
import { TokenAccount } from 'src/contexts/accountsv2';
import { useWalletPassThrough } from 'src/contexts/WalletPassthroughProvider';
export function wrapNativeAccount(pubkey: PublicKey, account: AccountInfo<Buffer>): TokenAccount | undefined {
  if (!account) {
    return undefined;
  }

  return {
    pubkey: pubkey,
    account,
    info: {
      address: pubkey,
      mint: WRAPPED_SOL_MINT,
      owner: pubkey,
      amount: new u64(account.lamports.toString()),
      delegate: null,
      delegatedAmount: new u64(0),
      isInitialized: true,
      isFrozen: false,
      isNative: true,
      rentExemptReserve: null,
      closeAuthority: null,
    },
  };
}

const useNativeAccount = () => {
  const { publicKey, connected } = useWalletPassThrough();
  const { connection } = useConnection();

  return useQuery(['native', connection.rpcEndpoint, publicKey?.toString()], async () => {
    if (!publicKey) {
      return null;
    }
    return connection
      .getAccountInfo(publicKey, 'confirmed')
      .then((acc) => {
        if (acc) {
          return wrapNativeAccount(publicKey, acc);
        } else {
          // Fix nativeAccount stuck when user don't have native account
          return null;
        }
      })
      .catch((err) => {
        console.log(err);
        throw err;
      });
  });
};

export default useNativeAccount;
