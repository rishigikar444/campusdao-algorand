import { useState, useEffect } from 'react'
import { useSnackbar } from 'notistack'
import { getApplicationAddress, makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk'
import { microAlgos } from '@algorandfoundation/algokit-utils'
import { useAlgorand } from '../hooks/useAlgorand'
import { PredictionMarketClient, PredictionMarketFactory } from '../contracts/PredictionMarket'
import XpWindow from './XpWindow'

const MBR_AMOUNT = 400_000

// Encode a BoxMap key: prefix bytes + 8-byte big-endian uint64
const encodeBoxName = (prefix: string, marketId: number): Uint8Array => {
  const prefixBytes = new TextEncoder().encode(prefix)
  const idBytes = new Uint8Array(8)
  new DataView(idBytes.buffer).setBigUint64(0, BigInt(marketId))
  const combined = new Uint8Array(prefixBytes.length + 8)
  combined.set(prefixBytes)
  combined.set(idBytes, prefixBytes.length)
  return combined
}

interface CreateMarketTabProps {
  onBack: () => void
}

const CreateMarketTab = ({ onBack }: CreateMarketTabProps) => {
  const { enqueueSnackbar } = useSnackbar()
  const { algorand, activeAddress, transactionSigner } = useAlgorand()

  const [appId, setAppId] = useState('')
  const [appIdLoading, setAppIdLoading] = useState(true)
  const [deploying, setDeploying] = useState(false)
  const [loading, setLoading] = useState(false)

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
        // DB unavailable — user will need to deploy or enter manually
      } finally {
        setAppIdLoading(false)
      }
    }
    fetchExistingAppId()
  }, [])

  // Form fields
  const [question, setQuestion] = useState('')
  const [description, setDescription] = useState('')
  const [resolutionDate, setResolutionDate] = useState('')
  const [pricePerShare, setPricePerShare] = useState('')
  const [council1, setCouncil1] = useState('')
  const [council2, setCouncil2] = useState('')
  const [council3, setCouncil3] = useState('')

  const getClient = () => {
    if (!appId || !activeAddress) throw new Error('Set App ID and connect wallet')
    return new PredictionMarketClient({
      appId: BigInt(appId),
      algorand,
      defaultSigner: transactionSigner,
    })
  }

  const deploy = async () => {
    try {
      if (!activeAddress) throw new Error('Connect wallet')
      setDeploying(true)
      const factory = new PredictionMarketFactory({ defaultSender: activeAddress, algorand })
      const res = await factory.send.create.bare()
      const id = String(res.appClient.appClient.appId)
      setAppId(id)
      enqueueSnackbar(`PredictionMarket deployed. App ID: ${id}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Deploy failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setDeploying(false)
    }
  }

  const createMarket = async () => {
    try {
      if (!question.trim()) {
        enqueueSnackbar('Market question is required', { variant: 'warning' })
        return
      }
      if (!resolutionDate) {
        enqueueSnackbar('Resolution date is required', { variant: 'warning' })
        return
      }
      if (!pricePerShare || Number(pricePerShare) <= 0) {
        enqueueSnackbar('Price per share must be positive', { variant: 'warning' })
        return
      }
      if (!council1 || !council2 || !council3) {
        enqueueSnackbar('All 3 council addresses are required', { variant: 'warning' })
        return
      }

      setLoading(true)
      const client = getClient()

      // Convert datetime-local to Unix timestamp
      const resolutionTimestamp = Math.floor(new Date(resolutionDate).getTime() / 1000)

      // Convert ALGO to microAlgos for price scale
      const priceMicro = Math.round(Number(pricePerShare) * 1_000_000)

      // Build MBR payment
      const sp = await algorand.client.algod.getTransactionParams().do()
      const mbrTxn = makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress!,
        receiver: getApplicationAddress(Number(appId)),
        amount: MBR_AMOUNT,
        suggestedParams: sp,
      })

      // We need ~17 box references for create_market (mc, mr, md, mo, my, mn, ml, ms,
      // c1, c2, c3, v1, v2, v3, o1, o2, o3). Each app call supports 8 box refs max,
      // so we use 2 pad() calls to carry the extras. We guess marketId = count+1.
      const countBig = await client.state.global.marketCount()
      const nextId = Number(countBig ?? 0) + 1

      // All 17 box prefixes for a new market
      const allBoxes = [
        'mc', 'mr', 'md', 'mo', 'my', 'mn', 'ml', 'ms',
        'c1', 'c2', 'c3', 'v1', 'v2', 'v3', 'o1', 'o2', 'o3',
      ].map((p) => encodeBoxName(p, nextId))

      // Split across 3 transactions (8 + 8 + 1)
      const pad1Boxes = allBoxes.slice(0, 8)
      const pad2Boxes = allBoxes.slice(8, 16)
      const createBoxes = allBoxes.slice(16)

      // 1. On-chain transaction group: pad + pad + createMarket
      const res = await client.newGroup()
        .pad({
          args: [],
          sender: activeAddress!,
          boxReferences: pad1Boxes,

        })
        .pad({
          args: [],
          sender: activeAddress!,
          boxReferences: pad2Boxes,

        })
        .createMarket({
          args: {
            resolutionTime: BigInt(resolutionTimestamp),
            priceScale: BigInt(priceMicro),
            council1: council1.trim(),
            council2: council2.trim(),
            council3: council3.trim(),
            mbrPay: { txn: mbrTxn, signer: transactionSigner },
          },
          sender: activeAddress!,
          extraFee: microAlgos(3000),
          boxReferences: createBoxes,

        })
        .send()

      const marketId = Number(res.returns[2])

      // 2. Save metadata to backend DB
      const apiRes = await fetch('/api/markets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId,
          appId: Number(appId),
          question: question.trim(),
          description: description.trim(),
          resolutionDate,
          creator: activeAddress,
          priceScale: priceMicro,
          council1: council1.trim(),
          council2: council2.trim(),
          council3: council3.trim(),
        }),
      })

      if (!apiRes.ok) {
        const errBody = await apiRes.json().catch(() => ({}))
        throw new Error(errBody.error || 'Failed to save market to database')
      }

      enqueueSnackbar(`Market #${marketId} created: "${question.trim()}"`, { variant: 'success' })

      // Reset form
      setQuestion('')
      setDescription('')
      setResolutionDate('')
      setPricePerShare('')
      setCouncil1('')
      setCouncil2('')
      setCouncil3('')
    } catch (e) {
      enqueueSnackbar(`Create market failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button className="xp-btn text-xs self-start" onClick={onBack}>
        &larr; Back to Markets
      </button>

      <XpWindow title="Create New Prediction Market" showControls={false}>
        <div className="flex flex-col gap-3">
          {/* App ID status */}
          {appIdLoading ? (
            <div className="text-xs font-xp-body text-gray-500">
              Checking for existing contract...
            </div>
          ) : (
            <div
              className="flex flex-col gap-2 pb-3"
              style={{ borderBottom: '1px solid #808080' }}
            >
              {appId ? (
                <p className="text-xs text-gray-500 font-xp-body">
                  Using PredictionMarket contract: <span className="font-mono font-bold">{appId}</span>
                </p>
              ) : (
                <p className="text-xs text-gray-500 font-xp-body">
                  No contract found. Deploy a new one or enter an existing App ID:
                </p>
              )}
              <div className="flex gap-2">
                <input
                  className="xp-input flex-1"
                  placeholder="Existing App ID"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                />
                <button
                  className="xp-btn text-xs"
                  disabled={deploying || !activeAddress}
                  onClick={deploy}
                >
                  {deploying ? 'Deploying...' : 'Deploy New Contract'}
                </button>
              </div>
            </div>
          )}

          <input
            className="xp-input"
            placeholder="Market Question * (e.g. Will BTC hit $100k?)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <input
            className="xp-input"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div>
            <label className="font-xp-body text-xs text-gray-600 block mb-1">Resolution Date & Time *</label>
            <input
              className="xp-input"
              type="datetime-local"
              value={resolutionDate}
              onChange={(e) => setResolutionDate(e.target.value)}
            />
          </div>

          <input
            className="xp-input"
            placeholder="Price per Share (ALGO) *"
            type="number"
            step="0.001"
            min="0"
            value={pricePerShare}
            onChange={(e) => setPricePerShare(e.target.value)}
          />

          <input
            className="xp-input"
            placeholder="Council Member 1 Address *"
            value={council1}
            onChange={(e) => setCouncil1(e.target.value)}
          />
          <input
            className="xp-input"
            placeholder="Council Member 2 Address *"
            value={council2}
            onChange={(e) => setCouncil2(e.target.value)}
          />
          <input
            className="xp-input"
            placeholder="Council Member 3 Address *"
            value={council3}
            onChange={(e) => setCouncil3(e.target.value)}
          />

          <button
            className="xp-btn"
            disabled={loading || !appId || !activeAddress || !question || !resolutionDate || !pricePerShare || !council1 || !council2 || !council3}
            onClick={createMarket}
          >
            {loading ? 'Creating Market...' : 'Create Market'}
          </button>
        </div>
      </XpWindow>
    </div>
  )
}

export default CreateMarketTab
