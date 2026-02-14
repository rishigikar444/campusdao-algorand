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
  const [appIdLoading, setAppIdLoading] = useState(true)
  const [markets, setMarkets] = useState<MarketData[]>([])
  const [loading, setLoading] = useState(false)
  const [buyAmounts, setBuyAmounts] = useState<Record<number, string>>({})
  const [sellAmounts, setSellAmounts] = useState<Record<number, string>>({})
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // On mount, try to find an existing App ID from the DB
  useEffect(() => {
    const fetchExistingAppId = async () => {
      try {
        const res = await fetch('/api/markets?all=true')
        if (res.ok) {
          const markets = await res.json()
          if (markets.length > 0) {
            setAppId(String(markets[0].appId))
          }
        }
      } catch {
        // DB unavailable
      } finally {
        setAppIdLoading(false)
      }
    }
    fetchExistingAppId()
  }, [])

  const getClient = () => {
    if (!appId) throw new Error('Set App ID first')
    return new PredictionMarketClient({
      appId: BigInt(appId),
      algorand,
      defaultSigner: transactionSigner,
    })
  }

  const loadMarkets = async () => {
    if (!appId) {
      enqueueSnackbar('Enter an App ID first', { variant: 'warning' })
      return
    }
    try {
      setLoading(true)
      const client = getClient()

      // Fetch metadata from backend
      let metaMap = new Map<number, MarketMeta>()
      try {
        const metaRes = await fetch(`/api/markets?appId=${appId}&all=true`)
        if (metaRes.ok) {
          const metaList: MarketMeta[] = await metaRes.json()
          metaMap = new Map(metaList.map((m) => [m.marketId, m]))
        }
      } catch {
        // DB unavailable — will still show on-chain data
      }

      const countBig = await client.state.global.marketCount()
      const count = Number(countBig ?? 0)

      if (count === 0) {
        setMarkets([])
        enqueueSnackbar('No markets found', { variant: 'info' })
        return
      }

      const loaded: MarketData[] = []

      for (let i = 1; i <= count; i++) {
        try {
          const infoRes = await client.send.getMarketInfo({
            args: { marketId: BigInt(i) },
            sender: activeAddress!,
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

          if (activeAddress) {
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
      enqueueSnackbar(`Loaded ${loaded.length} market(s)`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Failed to load markets: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

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
      const client = getClient()

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
      const client = getClient()

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
      const client = getClient()

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
      {/* App ID Input */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="font-xp-body text-xs text-gray-600 block mb-1">Prediction Market App ID</label>
          {appIdLoading ? (
            <div className="text-xs font-xp-body text-gray-500 py-1">Checking for existing contract...</div>
          ) : (
            <input
              className="xp-input"
              placeholder="Enter App ID"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
            />
          )}
        </div>
        <button
          className="xp-btn text-xs px-3"
          disabled={loading || !appId || appIdLoading}
          onClick={loadMarkets}
        >
          {loading ? 'Loading...' : 'Load Markets'}
        </button>
      </div>

      {/* Markets Grid */}
      {markets.length === 0 && !loading ? (
        <div className="text-center py-12 font-xp-body text-sm text-gray-500">
          {appId ? 'No markets loaded. Click "Load Markets" to fetch on-chain data.' : 'Enter an App ID to browse prediction markets.'}
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
                  {!market.resolved && (
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
                  )}

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
