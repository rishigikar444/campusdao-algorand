import { useState, useEffect } from 'react'
import { useSnackbar } from 'notistack'
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

interface CouncilVoteStatus {
  v1: boolean
  v2: boolean
  v3: boolean
  o1: number
  o2: number
  o3: number
}

interface ResolveMarketData {
  meta: MarketMeta
  resolved: boolean
  outcome: number
  yesSupply: number
  noSupply: number
  collateral: number
  scale: number
  votes: CouncilVoteStatus
}

interface ResolveMarketTabProps {
  onBack: () => void
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

const ResolveMarketTab = ({ onBack }: ResolveMarketTabProps) => {
  const { enqueueSnackbar } = useSnackbar()
  const { algorand, activeAddress, transactionSigner } = useAlgorand()

  const [markets, setMarkets] = useState<ResolveMarketData[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const getClient = (appId: string) => {
    return new PredictionMarketClient({
      appId: BigInt(appId),
      algorand,
      defaultSigner: transactionSigner,
    })
  }

  const readBoxValue = async (appId: number, boxName: Uint8Array): Promise<Uint8Array | null> => {
    try {
      const result = await algorand.client.algod.getApplicationBoxByName(appId, boxName).do()
      return result.value
    } catch {
      return null
    }
  }

  const loadMarkets = async () => {
    if (!activeAddress) return

    try {
      setLoading(true)

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

      const loaded: ResolveMarketData[] = []

      for (const meta of metaList) {
        try {
          const client = getClient(String(meta.appId))

          // Fetch on-chain market info
          const infoRes = await client.send.getMarketInfo({
            args: { marketId: BigInt(meta.marketId) },
            sender: activeAddress,
            boxReferences: [
              encodeBoxName('mc', meta.marketId),
              encodeBoxName('my', meta.marketId),
              encodeBoxName('mn', meta.marketId),
              encodeBoxName('ml', meta.marketId),
              encodeBoxName('ms', meta.marketId),
              encodeBoxName('md', meta.marketId),
              encodeBoxName('mo', meta.marketId),
            ],
            populateAppCallResources: false,
          })

          const [yesSupply, noSupply, collateral, scale, resolved, outcome] = infoRes.return!

          // Read council vote boxes
          const v1Raw = await readBoxValue(meta.appId, encodeBoxName('v1', meta.marketId))
          const v2Raw = await readBoxValue(meta.appId, encodeBoxName('v2', meta.marketId))
          const v3Raw = await readBoxValue(meta.appId, encodeBoxName('v3', meta.marketId))
          const o1Raw = await readBoxValue(meta.appId, encodeBoxName('o1', meta.marketId))
          const o2Raw = await readBoxValue(meta.appId, encodeBoxName('o2', meta.marketId))
          const o3Raw = await readBoxValue(meta.appId, encodeBoxName('o3', meta.marketId))

          const decodeUint64 = (raw: Uint8Array | null): number => {
            if (!raw || raw.length === 0) return 0
            return Number(new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getBigUint64(0))
          }

          const votes: CouncilVoteStatus = {
            v1: decodeUint64(v1Raw) === 1,
            v2: decodeUint64(v2Raw) === 1,
            v3: decodeUint64(v3Raw) === 1,
            o1: decodeUint64(o1Raw),
            o2: decodeUint64(o2Raw),
            o3: decodeUint64(o3Raw),
          }

          loaded.push({
            meta,
            resolved: Number(resolved) === 1,
            outcome: Number(outcome),
            yesSupply: Number(yesSupply),
            noSupply: Number(noSupply),
            collateral: Number(collateral),
            scale: Number(scale),
            votes,
          })
        } catch (err) {
          console.warn(`Failed to load market ${meta.marketId} for resolve:`, err)
        }
      }

      setMarkets(loaded)
    } catch (e) {
      console.warn('Failed to load council markets:', e)
      setMarkets([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMarkets()
  }, [activeAddress])

  const getUserCouncilIndex = (meta: MarketMeta): number => {
    if (activeAddress === meta.council1) return 1
    if (activeAddress === meta.council2) return 2
    if (activeAddress === meta.council3) return 3
    return 0
  }

  const hasUserVoted = (market: ResolveMarketData): boolean => {
    const idx = getUserCouncilIndex(market.meta)
    if (idx === 1) return market.votes.v1
    if (idx === 2) return market.votes.v2
    if (idx === 3) return market.votes.v3
    return false
  }

  const isResolutionTimePassed = (meta: MarketMeta): boolean => {
    if (!meta.resolutionDate) return false
    return new Date(meta.resolutionDate).getTime() <= Date.now()
  }

  const voteOnMarket = async (market: ResolveMarketData, outcomeValue: number) => {
    if (!activeAddress) {
      enqueueSnackbar('Connect your wallet first', { variant: 'warning' })
      return
    }

    const key = `vote-${outcomeValue}-${market.meta.marketId}`
    try {
      setActionLoading(key)
      const client = getClient(String(market.meta.appId))
      const mid = market.meta.marketId

      // 13 boxes total for vote_outcome, split across pad (8) + voteOutcome (5)
      const padBoxes = [
        encodeBoxName('mc', mid),
        encodeBoxName('md', mid),
        encodeBoxName('mr', mid),
        encodeBoxName('mo', mid),
        encodeBoxName('c1', mid),
        encodeBoxName('c2', mid),
        encodeBoxName('c3', mid),
        encodeBoxName('v1', mid),
      ]

      const voteBoxes = [
        encodeBoxName('v2', mid),
        encodeBoxName('v3', mid),
        encodeBoxName('o1', mid),
        encodeBoxName('o2', mid),
        encodeBoxName('o3', mid),
      ]

      await client.newGroup()
        .pad({
          args: [],
          sender: activeAddress,
          boxReferences: padBoxes,
        })
        .voteOutcome({
          args: { marketId: BigInt(mid), outcome: BigInt(outcomeValue) },
          sender: activeAddress,
          boxReferences: voteBoxes,
        })
        .send()

      enqueueSnackbar(
        `Voted ${outcomeValue === 1 ? 'YES' : 'NO'} on "${market.meta.question}"`,
        { variant: 'success' },
      )

      // Reload to see updated vote status
      await loadMarkets()
    } catch (e) {
      enqueueSnackbar(`Vote failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const formatAlgo = (microAlgos: number) => (microAlgos / 1_000_000).toFixed(6)

  const ellipseAddr = (addr: string) => `${addr.slice(0, 4)}...${addr.slice(-4)}`

  const getVoteLabel = (voted: boolean, outcomeVal: number): string => {
    if (!voted) return 'Pending'
    return outcomeVal === 1 ? 'YES' : 'NO'
  }

  const getVoteColor = (voted: boolean, outcomeVal: number): string => {
    if (!voted) return '#9E9E9E'
    return outcomeVal === 1 ? '#4CAF50' : '#F44336'
  }

  return (
    <div className="flex flex-col gap-4">
      <button className="xp-btn text-xs self-start" onClick={onBack}>
        &larr; Back to Markets
      </button>

      {loading ? (
        <div className="text-center py-12 font-xp-body text-sm text-gray-500">
          Loading council markets...
        </div>
      ) : markets.length === 0 ? (
        <div className="text-center py-12 font-xp-body text-sm text-gray-500">
          No markets found.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {markets.map((market) => {
            const mid = market.meta.marketId
            const userVoted = hasUserVoted(market)
            const timePassed = isResolutionTimePassed(market.meta)
            const canVote = !market.resolved && !userVoted && timePassed
            const isVoting =
              actionLoading === `vote-1-${mid}` || actionLoading === `vote-0-${mid}`

            return (
              <XpWindow key={mid} title={market.meta.question} showControls={false}>
                <div className="flex flex-col gap-3">
                  {/* Description */}
                  {market.meta.description && (
                    <div className="text-xs font-xp-body text-gray-600">
                      {market.meta.description}
                    </div>
                  )}

                  {/* Status Badge */}
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
                    ) : timePassed ? (
                      <span
                        className="text-xs font-bold px-2 py-1 rounded"
                        style={{ backgroundColor: '#FFF3E0', color: '#E65100' }}
                      >
                        Pending Resolution
                      </span>
                    ) : (
                      <span
                        className="text-xs font-bold px-2 py-1 rounded"
                        style={{ backgroundColor: '#E3F2FD', color: '#1565C0' }}
                      >
                        Active (not yet resolvable)
                      </span>
                    )}
                    <span className="text-xs font-xp-body text-gray-500">
                      {market.meta.resolutionDate &&
                        `Resolves: ${new Date(market.meta.resolutionDate).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}`}
                    </span>
                  </div>

                  {/* Council Vote Status */}
                  <div
                    className="text-xs font-xp-body p-2 rounded"
                    style={{ backgroundColor: '#F5F5F5', border: '1px solid #E0E0E0' }}
                  >
                    <div className="font-bold mb-1">Council Votes:</div>
                    <div className="flex flex-col gap-1">
                      {[
                        { label: 'Council 1', addr: market.meta.council1, voted: market.votes.v1, outcome: market.votes.o1 },
                        { label: 'Council 2', addr: market.meta.council2, voted: market.votes.v2, outcome: market.votes.o2 },
                        { label: 'Council 3', addr: market.meta.council3, voted: market.votes.v3, outcome: market.votes.o3 },
                      ].map((c) => (
                        <div key={c.label} className="flex items-center justify-between">
                          <span>
                            {c.label} ({ellipseAddr(c.addr)})
                            {c.addr === activeAddress && (
                              <span className="font-bold text-blue-600"> (You)</span>
                            )}
                          </span>
                          <span
                            className="font-bold px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: c.voted
                                ? c.outcome === 1
                                  ? '#E8F5E9'
                                  : '#FFEBEE'
                                : '#EEEEEE',
                              color: getVoteColor(c.voted, c.outcome),
                            }}
                          >
                            {getVoteLabel(c.voted, c.outcome)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Market Stats */}
                  <div className="flex justify-between text-xs font-xp-body text-gray-600">
                    <span>YES: {market.yesSupply}</span>
                    <span>NO: {market.noSupply}</span>
                    <span>Pool: {formatAlgo(market.collateral)} ALGO</span>
                  </div>

                  {/* Vote Buttons */}
                  {canVote && (
                    <div className="flex gap-2">
                      <button
                        className="xp-btn flex-1 text-xs py-2"
                        style={{ backgroundColor: '#E8F5E9' }}
                        disabled={isVoting}
                        onClick={() => voteOnMarket(market, 1)}
                      >
                        {actionLoading === `vote-1-${mid}` ? 'Voting...' : 'Vote YES'}
                      </button>
                      <button
                        className="xp-btn flex-1 text-xs py-2"
                        style={{ backgroundColor: '#FFEBEE' }}
                        disabled={isVoting}
                        onClick={() => voteOnMarket(market, 0)}
                      >
                        {actionLoading === `vote-0-${mid}` ? 'Voting...' : 'Vote NO'}
                      </button>
                    </div>
                  )}

                  {/* Status messages */}
                  {!market.resolved && userVoted && (
                    <div className="text-xs font-xp-body text-gray-500 text-center">
                      You have already voted. Waiting for other council members.
                    </div>
                  )}
                  {!market.resolved && !timePassed && (
                    <div className="text-xs font-xp-body text-gray-500 text-center">
                      Voting opens after the resolution date passes.
                    </div>
                  )}
                </div>
              </XpWindow>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ResolveMarketTab
