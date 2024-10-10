import React, { CSSProperties, useEffect, useMemo, useRef } from 'react';
import { TokenInfo } from '@solana/spl-token-registry';
import Decimal from 'decimal.js';
import { WRAPPED_SOL_MINT } from 'src/constants';
import { checkIsStrictOrVerified, checkIsToken2022, checkIsUnknownToken } from 'src/misc/tokenTags';
import { formatNumber } from 'src/misc/utils';
import TokenIcon from './TokenIcon';
import TokenLink from './TokenLink';
import CoinBalance from './Coinbalance';
import { useAccounts } from 'src/contexts/accountsv2';

export const PAIR_ROW_HEIGHT = 72;

export interface IPairRow {
  usdValue?: Decimal;
  item: TokenInfo;
  style: CSSProperties;
  onSubmit(item: TokenInfo): void;
  suppressCloseModal?: boolean;
  showExplorer?: boolean;
  enableUnknownTokenWarning?: boolean;
  isLST?: boolean;
}

interface IMultiTag {
  isVerified: boolean;
  isLST: boolean;
  // isUnknown: boolean;
  isToken2022: boolean;
  isFrozen: boolean;
}

const MultiTags: React.FC<IPairRow> = ({ item }) => {
  const { mintToAssociatedTokenAccountMap } = useAccounts();
  const isLoading = useRef<boolean>(false);
  const isLoaded = useRef<boolean>(false);
  // It's cheaper to slightly delay and rendering once, than rendering everything all the time
  const [renderedTag, setRenderedTag] = React.useState<IMultiTag>({
    isVerified: false,
    isLST: false,
    // isUnknown: false,
    isToken2022: false,
    isFrozen: false,
  });

  useEffect(() => {
    if (isLoaded.current || isLoading.current) return;

    isLoading.current = true;
    setTimeout(() => {
      const result = {
        isVerified: checkIsStrictOrVerified(item),
        isLST: Boolean(item.tags?.includes('lst')),
        // isUnknown: checkIsUnknownToken(item),
        isToken2022: Boolean(checkIsToken2022(item)),
        isFrozen: mintToAssociatedTokenAccountMap?.get(item.address)?.info.isFrozen || false,
      };
      setRenderedTag(result);
      isLoading.current = false;
      isLoaded.current = true;
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remainingTags = useMemo(() => {
    // Only render whitelisted tags
    const WHITELISTED_TAGS = ['pump'];
    return item.tags?.filter((item) => WHITELISTED_TAGS.includes(item));
  }, [item.tags]);

  if (!renderedTag) return null;

  const { isVerified, isToken2022, isFrozen } = renderedTag;

  return (
    <div className="flex justify-end gap-x-1">
      {isFrozen && (
        <p className="border rounded-md text-xxs leading-none transition-all py-0.5 px-1 border-warning/50 text-warning/50">
          Frozen
        </p>
      )}

      {isToken2022 && (
        <p className="rounded-md text-xxs leading-none transition-all py-0.5 px-1 bg-black/10 font-semibold text-white/20">
          Token2022
        </p>
      )}
      {remainingTags?.map((tag, idx) => (
        <div
          key={idx}
          className="rounded-md text-xxs leading-none transition-all py-0.5 px-1 bg-black/10 font-semibold text-white/20"
        >
          {tag}
        </div>
      ))}

      {isVerified && (
        <p className="rounded-md text-xxs leading-none transition-all py-0.5 px-1 text-v3-primary/50 border border-v3-primary/50 font-semibold">
          {/* We're renaming verified to stict for now, requested by Mei */}
          Community
        </p>
      )}
    </div>
  );
};

const FormPairRow = (props: IPairRow) => {
  const {
    item,
    style,
    onSubmit,
    suppressCloseModal,
    usdValue,
    showExplorer = true,
    enableUnknownTokenWarning = true,
  } = props;
  const onClick = React.useCallback(() => {
    onSubmit(item);

    if (suppressCloseModal) return;
  }, [onSubmit, item, suppressCloseModal]);

  const usdValueDisplay =
    usdValue && usdValue.gte(0.01) // If smaller than 0.01 cents, dont show
      ? `$${formatNumber.format(usdValue, 2)}` // USD value can hardcode to 2
      : '';

  return (
    <li
      className={`rounded cursor-pointer px-5 my-1 list-none flex w-full items-center bg-v2-lily/5 hover:bg-v2-lily/10`}
      style={{ maxHeight: PAIR_ROW_HEIGHT - 4, height: PAIR_ROW_HEIGHT - 4, ...style }}
      onClick={onClick}
      translate="no"
    >
      <div className="flex h-full w-full items-center space-x-4">
        <div className="flex-shrink-0">
          <div className="bg-gray-200 rounded-full">
            <TokenIcon info={item} width={24} height={24} enableUnknownTokenWarning={enableUnknownTokenWarning} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex space-x-2">
            <p className="text-sm font-medium text-white truncate">{item.symbol}</p>
            {/* Intentionally higher z to be clickable */}
            {showExplorer ? (
              <div className="z-10" onClick={(e) => e.stopPropagation()}>
                <TokenLink tokenInfo={item} />
              </div>
            ) : null}
          </div>
          <p className="text-xs text-gray-500 dark:text-white-35 truncate">
            {item.address === WRAPPED_SOL_MINT.toBase58() ? 'Solana' : item.name}
          </p>
        </div>

        <div className="text-xs text-v2-lily/50 text-right h-full flex flex-col justify-evenly">
          <CoinBalance mintAddress={item.address} hideZeroBalance />
          {usdValueDisplay ? <p>{usdValueDisplay}</p> : null}
          <MultiTags {...props} />
        </div>
      </div>
    </li>
  );
};

export default FormPairRow;
