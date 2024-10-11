import * as React from 'react';

import { formatNumber } from '../misc/utils';
import Decimal from 'decimal.js';
import { useAccounts, useUserBalance } from 'src/contexts/accountsv2';

interface ICoinBalanceProps {
  mintAddress: string;
  hideZeroBalance?: boolean;
}

const GetBalance: React.FunctionComponent<ICoinBalanceProps> = ({ mintAddress, ...props }) => {
  const { balance } = useUserBalance(mintAddress);

  const totalBalance = React.useMemo(() => {
    return new Decimal(balance);
  }, [balance]);

  if (props.hideZeroBalance && totalBalance.eq(0)) return null;

  return <span translate="no">{formatNumber.format(totalBalance)}</span>;
};

const CoinBalance: React.FunctionComponent<ICoinBalanceProps> = (props) => {
  const { accounts } = useAccounts();
  // Prevent too many RPC calls
  if (!accounts) {
    return <></>;
  }

  return <GetBalance {...props} />;
};

export default CoinBalance;
