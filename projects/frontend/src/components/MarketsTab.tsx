import { useState, useEffect } from 'react'
import { useSnackbar } from 'notistack'
import { getApplicationAddress, makePaymentTxnWithSuggestedParamsFromObject, decodeAddress } from 'algosdk'
import { microAlgos } from '@algorandfoundation/algokit-utils'
import { useAlgorand } from '../hooks/useAlgorand'
import { PredictionMarketClient } from '../contracts/PredictionMarket'
import XpWindow from './XpWindow'

interface MarketMeta {
  _id: string
  marketId: number
  appId: number
  question: string
  description: string
  resolutionDate: string
  creator: string
  priceScale: number
  council1: string
  council2: string
  council3: string
}

interface MarketData {
  marketId: number
  question: string
  description: string
  resolutionDate: string
  yesSupply: number
  noSupply: number
  collateral: number
  scale: number
  resolved: boolean
  outcome: number // 1 = YES, 0 = NO
  userYes: number
  userNo: number
}

interface MarketsTabProps {
  onNavigateToCreate: () => void
}

// SVG distribution bar
const MarketBar = ({ yesSupply, noSupply }: { yesSupply: number; noSupply: number }) => {
  const total = yesSupply + noSupply
  const yesPct = total > 0 ? (yesSupply / total) * 100 : 50
  const noPct = total > 0 ? (noSupply / total) * 100 : 50

  return (
    <svg width="100%" height="28" viewBox="0 0 300 28" preserveAspectRatio="none">
      <rect x="0" y="0" width={yesPct * 3} height="28" fill="#4CAF50" rx="3" />
      <rect x={yesPct * 3} y="0" width={noPct * 3} height="28" fill="#F44336" rx="3" />
      {yesPct > 15 && (
        <text x={((yesPct * 3) / 2)} y="18" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">
          YES {yesPct.toFixed(0)}%
        </text>
      )}
      {noPct > 15 && (
        <text x={(yesPct * 3) + ((noPct * 3) / 2)} y="18" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">
          NO {noPct.toFixed(0)}%
        </text>
      )}
    </svg>
  )
}

// Encode a BoxMap key: 2-byte ASCII prefix + 8-byte big-endian uint64
const encodeBoxName = (prefix: string, marketId: number): Uint8Array => {
  const prefixBytes = new TextEncoder().encode(prefix)
  const idBytes = new Uint8Array(8)
  new DataView(idBytes.buffer).setBigUint64(0, BigInt(marketId))
  const combined = new Uint8Array(prefixBytes.length + 8)
  combined.set(prefixBytes)
  combined.set(idBytes, prefixBytes.length)
  return combined
}

// Encode a composite position key: prefix + itob(marketId) + account bytes
const encodePositionBoxName = (prefix: string, marketId: number, address: string): Uint8Array => {
  const prefixBytes = new TextEncoder().encode(prefix)
  const idBytes = new Uint8Array(8)
  new DataView(idBytes.buffer).setBigUint64(0, BigInt(marketId))
  const addrBytes = decodeAddress(address).publicKey
  const combined = new Uint8Array(prefixBytes.length + 8 + 32)
  combined.set(prefixBytes)
  combined.set(idBytes, prefixBytes.length)
  combined.set(addrBytes, prefixBytes.length + 8)
  return combined
}

const MarketsTab = ({ onNavigateToCreate }: MarketsTabProps) => {
  const { enqueueSnackbar } = useSnackbar()
  const { algorand, activeAddress, transactionSigner } = useAlgorand()

  const [appId, setAppId] = useState('')
  const [markets, setMarkets] = useState<MarketData[]>([])
  const [loading, setLoading] = useState(true)
  const [buyAmounts, setBuyAmounts] = useState<Record<number, string>>({})
  const [sellAmounts, setSellAmounts] = useState<Record<number, string>>({})
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const getClient = (id: string) => {
    return new PredictionMarketClient({
      appId: BigInt(id),
      algorand,
      defaultSigner: transactionSigner,
    })
  }

  const loadMarkets = async (resolvedAppId?: string) => {
    const currentAppId = resolvedAppId || appId
    try {
      setLoading(true)

      // Fetch all market metadata from the backend
      const metaRes = await fetch('/api/markets?all=true')
      if (!metaRes.ok) {
        setMarkets([])
        return
      }
      const metaList: MarketMeta[] = await metaRes.json()

      if (metaList.length === 0) {
        setMarkets([])
        return
      }

      // Use the appId from the first market record if we don't have one yet
      const effectiveAppId = currentAppId || String(metaList[0].appId)
      if (!currentAppId) setAppId(effectiveAppId)

      const metaMap = new Map(metaList.filter((m) => m.appId === Number(effectiveAppId)).map((m) => [m.marketId, m]))

      if (!activeAddress) {
        // No wallet connected — show metadata-only cards
        const loaded: MarketData[] = Array.from(metaMap.values()).map((meta) => ({
          marketId: meta.marketId,
          question: meta.question,
          description: meta.description,
          resolutionDate: meta.resolutionDate,
          yesSupply: 0,
          noSupply: 0,
          collateral: 0,
          scale: meta.priceScale,
          resolved: false,
          outcome: 0,
          userYes: 0,
          userNo: 0,
        }))
        setMarkets(loaded)
        return
      }

      // Wallet connected — enrich with on-chain data
      const client = getClient(effectiveAppId)
      const countBig = await client.state.global.marketCount()
      const count = Number(countBig ?? 0)

      if (count === 0) {
        setMarkets([])
        return
      }

      const loaded: MarketData[] = []

      for (let i = 1; i <= count; i++) {
        try {
          const infoRes = await client.send.getMarketInfo({
            args: { marketId: BigInt(i) },
            sender: activeAddress,
            boxReferences: [
              encodeBoxName('mc', i),
              encodeBoxName('my', i),
              encodeBoxName('mn', i),
              encodeBoxName('ml', i),
              encodeBoxName('ms', i),
              encodeBoxName('md', i),
              encodeBoxName('mo', i),
            ],
            populateAppCallResources: false,
          })

          const [yesSupply, noSupply, collateral, scale, resolved, outcome] = infoRes.return!

          let userYes = 0
          let userNo = 0

          try {
            const posRes = await client.send.getPosition({
              args: { marketId: BigInt(i), account: activeAddress },
              sender: activeAddress,
              boxReferences: [
                encodePositionBoxName('yb', i, activeAddress),
                encodePositionBoxName('nb', i, activeAddress),
              ],
              populateAppCallResources: false,
            })
            userYes = Number(posRes.return![0])
            userNo = Number(posRes.return![1])
          } catch {
            // No position yet
          }

          const meta = metaMap.get(i)

          loaded.push({
            marketId: i,
            question: meta?.question || `Market #${i}`,
            description: meta?.description || '',
            resolutionDate: meta?.resolutionDate || '',
            yesSupply: Number(yesSupply),
            noSupply: Number(noSupply),
            collateral: Number(collateral),
            scale: Number(scale),
            resolved: Number(resolved) === 1,
            outcome: Number(outcome),
            userYes,
            userNo,
          })
        } catch (err) {
          console.warn(`Failed to load market ${i}:`, err)
        }
      }

      setMarkets(loaded)
    } catch (e) {
      console.warn('Failed to load markets:', e)
      setMarkets([])
    } finally {
      setLoading(false)
    }
  }

  // Auto-load markets on mount and when wallet changes
  useEffect(() => {
    loadMarkets()
  }, [activeAddress])

  const buyShares = async (marketId: number, side: 'yes' | 'no') => {
    const amountStr = buyAmounts[marketId]
    const amount = parseInt(amountStr || '0', 10)
    if (amount <= 0) {
      enqueueSnackbar('Enter a valid amount', { variant: 'warning' })
      return
    }
    if (!activeAddress) {
      enqueueSnackbar('Connect your wallet first', { variant: 'warning' })
      return
    }

    const key = `buy-${side}-${marketId}`
    try {
      setActionLoading(key)
      const client = getClient(appId)

      // Get exact cost
      const costRes = await client.send.getBuyCost({
        args: { marketId: BigInt(marketId), side: side === 'yes' ? BigInt(1) : BigInt(0), amount: BigInt(amount) },
        sender: activeAddress,
        boxReferences: [
          encodeBoxName('mc', marketId),
          encodeBoxName('ms', marketId),
        ],
        populateAppCallResources: false,
      })
      const cost = Number(costRes.return!)

      // Build payment txn
      const appAddr = getApplicationAddress(Number(appId))
      const sp = await algorand.client.algod.getTransactionParams().do()
      const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: appAddr,
        amount: cost,
        suggestedParams: sp,
      })

      const positionBoxes = [
        encodePositionBoxName(side === 'yes' ? 'yb' : 'nb', marketId, activeAddress),
      ]

      const boxRefs = [
        encodeBoxName('mc', marketId),
        encodeBoxName('md', marketId),
        encodeBoxName('ms', marketId),
        encodeBoxName(side === 'yes' ? 'my' : 'mn', marketId),
        encodeBoxName('ml', marketId),
        ...positionBoxes,
      ]

      if (side === 'yes') {
        await client.send.buyYes({
          args: { marketId: BigInt(marketId), amount: BigInt(amount), payTxn: { txn: payTxn, signer: transactionSigner } },
          sender: activeAddress,
          extraFee: microAlgos(2000),
          boxReferences: boxRefs,
          populateAppCallResources: false,
        })
      } else {
        await client.send.buyNo({
          args: { marketId: BigInt(marketId), amount: BigInt(amount), payTxn: { txn: payTxn, signer: transactionSigner } },
          sender: activeAddress,
          extraFee: microAlgos(2000),
          boxReferences: boxRefs,
          populateAppCallResources: false,
        })
      }

      enqueueSnackbar(`Bought ${amount} ${side.toUpperCase()} shares!`, { variant: 'success' })
      setBuyAmounts((prev) => ({ ...prev, [marketId]: '' }))
      loadMarkets()
    } catch (e) {
      enqueueSnackbar(`Buy failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const sellShares = async (marketId: number, side: 'yes' | 'no') => {
    const amountStr = sellAmounts[marketId]
    const amount = parseInt(amountStr || '0', 10)
    if (amount <= 0) {
      enqueueSnackbar('Enter a valid amount', { variant: 'warning' })
      return
    }
    if (!activeAddress) {
      enqueueSnackbar('Connect your wallet first', { variant: 'warning' })
      return
    }

    const key = `sell-${side}-${marketId}`
    try {
      setActionLoading(key)
      const client = getClient(appId)

      const positionBoxes = [
        encodePositionBoxName(side === 'yes' ? 'yb' : 'nb', marketId, activeAddress),
      ]

      const boxRefs = [
        encodeBoxName('mc', marketId),
        encodeBoxName('md', marketId),
        encodeBoxName('ms', marketId),
        encodeBoxName(side === 'yes' ? 'my' : 'mn', marketId),
        encodeBoxName('ml', marketId),
        ...positionBoxes,
      ]

      if (side === 'yes') {
        await client.send.sellYes({
          args: { marketId: BigInt(marketId), amount: BigInt(amount) },
          sender: activeAddress,
          extraFee: microAlgos(1000),
          boxReferences: boxRefs,
          populateAppCallResources: false,
        })
      } else {
        await client.send.sellNo({
          args: { marketId: BigInt(marketId), amount: BigInt(amount) },
          sender: activeAddress,
          extraFee: microAlgos(1000),
          boxReferences: boxRefs,
          populateAppCallResources: false,
        })
      }

      enqueueSnackbar(`Sold ${amount} ${side.toUpperCase()} shares!`, { variant: 'success' })
      setSellAmounts((prev) => ({ ...prev, [marketId]: '' }))
      loadMarkets()
    } catch (e) {
      enqueueSnackbar(`Sell failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const redeemShares = async (marketId: number) => {
    if (!activeAddress) {
      enqueueSnackbar('Connect your wallet first', { variant: 'warning' })
      return
    }

    const key = `redeem-${marketId}`
    try {
      setActionLoading(key)
      const client = getClient(appId)

      const boxRefs = [
        encodeBoxName('mc', marketId),
        encodeBoxName('md', marketId),
        encodeBoxName('mo', marketId),
        encodeBoxName('my', marketId),
        encodeBoxName('mn', marketId),
        encodeBoxName('ml', marketId),
        encodePositionBoxName('yb', marketId, activeAddress),
        encodePositionBoxName('nb', marketId, activeAddress),
        encodePositionBoxName('hr', marketId, activeAddress),
      ]

      const res = await client.send.redeem({
        args: { marketId: BigInt(marketId) },
        sender: activeAddress,
        extraFee: microAlgos(1000),
        boxReferences: boxRefs,
        populateAppCallResources: false,
      })

      const payout = Number(res.return ?? 0)
      enqueueSnackbar(`Redeemed! Payout: ${(payout / 1_000_000).toFixed(6)} ALGO`, { variant: 'success' })
      loadMarkets()
    } catch (e) {
      enqueueSnackbar(`Redeem failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const formatAlgo = (microAlgos: number) => {
    return (microAlgos / 1_000_000).toFixed(6)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Loading / Empty State */}
      {loading ? (
        <div className="text-center py-12 font-xp-body text-sm text-gray-500">
          Loading markets...
        </div>
      ) : markets.length === 0 ? (
        <div className="text-center py-12 font-xp-body text-sm text-gray-500">
          No markets yet. Create one to get started!
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {markets.map((market) => {
            const isBuying = actionLoading === `buy-yes-${market.marketId}` || actionLoading === `buy-no-${market.marketId}`
            const isSelling = actionLoading === `sell-yes-${market.marketId}` || actionLoading === `sell-no-${market.marketId}`
            const isRedeeming = actionLoading === `redeem-${market.marketId}`
            const hasWinningShares = market.resolved && (
              (market.outcome === 1 && market.userYes > 0) ||
              (market.outcome === 0 && market.userNo > 0)
            )

            return (
              <XpWindow key={market.marketId} title={market.question} showControls={false}>
                <div className="flex flex-col gap-3">
                  {/* Description & Resolution Date */}
                  {market.description && (
                    <div className="text-xs font-xp-body text-gray-600">{market.description}</div>
                  )}

                  {/* Status Badge + Resolution Date */}
                  <div className="flex items-center justify-between">
                    {market.resolved ? (
                      <span
                        className="text-xs font-bold px-2 py-1 rounded"
                        style={{
                          backgroundColor: market.outcome === 1 ? '#E8F5E9' : '#FFEBEE',
                          color: market.outcome === 1 ? '#2E7D32' : '#C62828',
                        }}
                      >
                        Resolved: {market.outcome === 1 ? 'YES' : 'NO'}
                      </span>
                    ) : (
                      <span
                        className="text-xs font-bold px-2 py-1 rounded"
                        style={{ backgroundColor: '#E3F2FD', color: '#1565C0' }}
                      >
                        Active
                      </span>
                    )}
                    <span className="text-xs font-xp-body text-gray-500">
                      {market.resolutionDate
                        ? `Resolves: ${new Date(market.resolutionDate).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}`
                        : `Price: ${formatAlgo(market.scale)} ALGO/share`}
                    </span>
                  </div>

                  {/* Price per share */}
                  <div className="text-xs font-xp-body text-gray-500">
                    Price: {formatAlgo(market.scale)} ALGO/share
                  </div>

                  {/* SVG Distribution Bar */}
                  <MarketBar yesSupply={market.yesSupply} noSupply={market.noSupply} />

                  {/* Stats Row */}
                  <div className="flex justify-between text-xs font-xp-body text-gray-600">
                    <span>YES: {market.yesSupply}</span>
                    <span>NO: {market.noSupply}</span>
                    <span>Pool: {formatAlgo(market.collateral)} ALGO</span>
                  </div>

                  {/* User Position */}
                  {(market.userYes > 0 || market.userNo > 0) && (
                    <div
                      className="text-xs font-xp-body px-2 py-1 rounded"
                      style={{ backgroundColor: '#FFF3E0', border: '1px solid #FFB74D' }}
                    >
                      Your position: {market.userYes > 0 && <strong>{market.userYes} YES</strong>}
                      {market.userYes > 0 && market.userNo > 0 && ' / '}
                      {market.userNo > 0 && <strong>{market.userNo} NO</strong>}
                    </div>
                  )}

                  {/* Buy Row (only on active markets) */}
                  {!market.resolved && (() => {
                    const buyAmt = parseInt(buyAmounts[market.marketId] || '0', 10)
                    const buyCost = buyAmt > 0 ? buyAmt * market.scale : 0

                    return (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          <input
                            className="xp-input flex-1"
                            type="number"
                            min="1"
                            placeholder="Amount"
                            value={buyAmounts[market.marketId] ?? ''}
                            onChange={(e) => setBuyAmounts((prev) => ({ ...prev, [market.marketId]: e.target.value }))}
                          />
                          <button
                            className="xp-btn text-xs px-2"
                            style={{ backgroundColor: '#E8F5E9' }}
                            disabled={isBuying || !activeAddress}
                            onClick={() => buyShares(market.marketId, 'yes')}
                          >
                            {actionLoading === `buy-yes-${market.marketId}` ? '...' : 'Buy YES'}
                          </button>
                          <button
                            className="xp-btn text-xs px-2"
                            style={{ backgroundColor: '#FFEBEE' }}
                            disabled={isBuying || !activeAddress}
                            onClick={() => buyShares(market.marketId, 'no')}
                          >
                            {actionLoading === `buy-no-${market.marketId}` ? '...' : 'Buy NO'}
                          </button>
                        </div>
                        {buyCost > 0 && (
                          <div className="text-xs font-xp-body text-gray-500 pl-1">
                            Cost: <strong>{formatAlgo(buyCost)} ALGO</strong> for {buyAmt} share{buyAmt > 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* Sell Row (only if user holds shares on active markets) */}
                  {!market.resolved && (market.userYes > 0 || market.userNo > 0) && (
                    <div className="flex items-center gap-1">
                      <input
                        className="xp-input flex-1"
                        type="number"
                        min="1"
                        placeholder="Sell amount"
                        value={sellAmounts[market.marketId] ?? ''}
                        onChange={(e) => setSellAmounts((prev) => ({ ...prev, [market.marketId]: e.target.value }))}
                      />
                      {market.userYes > 0 && (
                        <button
                          className="xp-btn text-xs px-2"
                          disabled={isSelling || !activeAddress}
                          onClick={() => sellShares(market.marketId, 'yes')}
                        >
                          {actionLoading === `sell-yes-${market.marketId}` ? '...' : 'Sell YES'}
                        </button>
                      )}
                      {market.userNo > 0 && (
                        <button
                          className="xp-btn text-xs px-2"
                          disabled={isSelling || !activeAddress}
                          onClick={() => sellShares(market.marketId, 'no')}
                        >
                          {actionLoading === `sell-no-${market.marketId}` ? '...' : 'Sell NO'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Redeem Button (only on resolved markets with winning shares) */}
                  {hasWinningShares && (
                    <button
                      className="xp-btn text-xs"
                      disabled={isRedeeming || !activeAddress}
                      onClick={() => redeemShares(market.marketId)}
                    >
                      {isRedeeming ? 'Redeeming...' : 'Redeem Winning Shares'}
                    </button>
                  )}
                </div>
              </XpWindow>
            )
          })}
        </div>
      )}

      {/* Create Market Button */}
      <div className="flex justify-center pt-2 pb-2">
        <button className="xp-btn text-xs px-4 py-1" onClick={onNavigateToCreate}>
          + Create Market
        </button>
      </div>
    </div>
  )
}

export default MarketsTab
