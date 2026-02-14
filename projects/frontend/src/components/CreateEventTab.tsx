import { useState, useEffect } from 'react'
import { useSnackbar } from 'notistack'
import { getApplicationAddress, makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk'
import { microAlgos } from '@algorandfoundation/algokit-utils'
import { useAlgorand } from '../hooks/useAlgorand'
import { EventManagerClient, EventManagerFactory } from '../contracts/EventManager'
import XpWindow from './XpWindow'

const MBR_AMOUNT = 200_000

interface CreateEventTabProps {
  onBack: () => void
}

const CreateEventTab = ({ onBack }: CreateEventTabProps) => {
  const { enqueueSnackbar } = useSnackbar()
  const { algorand, activeAddress, transactionSigner } = useAlgorand()

  const [appId, setAppId] = useState<string>('')
  const [appIdLoading, setAppIdLoading] = useState(true)
  const [deploying, setDeploying] = useState(false)
  const [loading, setLoading] = useState(false)

  // On mount, try to find an existing App ID from the DB
  useEffect(() => {
    const fetchExistingAppId = async () => {
      try {
        const res = await fetch('/api/events')
        if (res.ok) {
          const events = await res.json()
          if (events.length > 0) {
            setAppId(String(events[0].appId))
          }
        }
      } catch {
        // DB unavailable — user will need to deploy
      } finally {
        setAppIdLoading(false)
      }
    }
    fetchExistingAppId()
  }, [])

  const [eventName, setEventName] = useState('')
  const [eventDescription, setEventDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [clubAppId, setClubAppId] = useState('')
  const [ticketPrice, setTicketPrice] = useState('')
  const [maxSupply, setMaxSupply] = useState('')

  const getClient = () => {
    if (!appId || !activeAddress) throw new Error('Set App ID and connect wallet')
    return new EventManagerClient({
      appId: BigInt(appId),
      algorand,
      defaultSigner: transactionSigner,
    })
  }

  const makeMbrTxn = async (amount = MBR_AMOUNT) => {
    const sp = await algorand.client.algod.getTransactionParams().do()
    return makePaymentTxnWithSuggestedParamsFromObject({
      sender: activeAddress!,
      receiver: getApplicationAddress(Number(appId)),
      amount,
      suggestedParams: sp,
    })
  }

  const deploy = async () => {
    try {
      if (!activeAddress) throw new Error('Connect wallet')
      setDeploying(true)
      const factory = new EventManagerFactory({ defaultSender: activeAddress, algorand })
      const res = await factory.send.create.bare()
      const id = String(res.appClient.appId)
      setAppId(id)
      enqueueSnackbar(`EventManager deployed. App ID: ${id}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Deploy failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setDeploying(false)
    }
  }

  const createEvent = async () => {
    try {
      if (!eventName.trim()) {
        enqueueSnackbar('Event name is required', { variant: 'warning' })
        return
      }
      setLoading(true)

      const priceMicro = Math.round(Number(ticketPrice) * 1_000_000)

      // 1. On-chain transaction
      const client = getClient()
      const mbrTxn = await makeMbrTxn()
      const res = await client.send.createEvent({
        args: {
          clubAppId: BigInt(clubAppId || '0'),
          ticketPrice: BigInt(priceMicro),
          maxSupply: BigInt(maxSupply),
          mbrPay: { txn: mbrTxn, signer: transactionSigner },
        },
        sender: activeAddress!,
        extraFee: microAlgos(1000),
      })

      const onChainEventId = Number(res.return)

      // 2. Mint ticket ASA for this event (required before anyone can buy)
      const mintMbrTxn = await makeMbrTxn(200_000)
      const mintRes = await client.send.mintTicket({
        args: {
          eventId: BigInt(onChainEventId),
          mbrPay: { txn: mintMbrTxn, signer: transactionSigner },
        },
        sender: activeAddress!,
        extraFee: microAlgos(1000),
      })

      const ticketAsaId = Number(mintRes.return)
      enqueueSnackbar(`Ticket ASA minted (ID: ${ticketAsaId})`, { variant: 'info' })

      // 3. Save metadata to backend DB
      const apiRes = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: onChainEventId,
          appId: Number(appId),
          ticketAsaId,
          name: eventName.trim(),
          description: eventDescription.trim(),
          imageUrl: imageUrl.trim(),
          eventDate,
          organizer: activeAddress,
          clubAppId: Number(clubAppId) || 0,
          ticketPrice: priceMicro,
          maxSupply: Number(maxSupply),
        }),
      })

      if (!apiRes.ok) {
        const errBody = await apiRes.json().catch(() => ({}))
        throw new Error(errBody.error || 'Failed to save event to database')
      }

      enqueueSnackbar(`Event "${eventName}" created! On-chain ID: ${onChainEventId}`, {
        variant: 'success',
      })

      // Reset form
      setEventName('')
      setEventDescription('')
      setImageUrl('')
      setEventDate('')
      setClubAppId('')
      setTicketPrice('')
      setMaxSupply('')
    } catch (e) {
      enqueueSnackbar(`Create event failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button className="xp-btn text-xs self-start" onClick={onBack}>
        &larr; Back to Events
      </button>

      <XpWindow title="Create New Event" showControls={false}>
        <div className="flex flex-col gap-3">
          {/* App ID status */}
          {appIdLoading ? (
            <div className="text-xs font-xp-body text-gray-500">
              Checking for existing contract...
            </div>
          ) : appId ? (
            <div className="text-xs font-xp-body text-gray-500">
              Using EventManager contract: <span className="font-mono font-bold">{appId}</span>
            </div>
          ) : (
            <div
              className="flex flex-col gap-2 pb-3"
              style={{ borderBottom: '1px solid #808080' }}
            >
              <p className="text-xs text-gray-500 font-xp-body">
                No EventManager contract found. Deploy one to get started:
              </p>
              <button
                className="xp-btn text-xs"
                disabled={deploying || !activeAddress}
                onClick={deploy}
              >
                {deploying ? 'Deploying...' : 'Deploy New Contract'}
              </button>
            </div>
          )}

          <input
            className="xp-input"
            placeholder="Event Name *"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
          />
          <input
            className="xp-input"
            placeholder="Description (optional)"
            value={eventDescription}
            onChange={(e) => setEventDescription(e.target.value)}
          />
          <input
            className="xp-input"
            placeholder="Image URL (optional)"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
          />
          <div>
            <label className="font-xp-body text-xs text-gray-600 block mb-1">Event Date *</label>
            <input
              className="xp-input"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </div>
          <input
            className="xp-input"
            placeholder="Club App ID (0 if none)"
            value={clubAppId}
            onChange={(e) => setClubAppId(e.target.value)}
          />
          <input
            className="xp-input"
            placeholder="Ticket Price (ALGO) *"
            type="number"
            step="0.001"
            value={ticketPrice}
            onChange={(e) => setTicketPrice(e.target.value)}
          />
          <input
            className="xp-input"
            placeholder="Max Supply *"
            type="number"
            value={maxSupply}
            onChange={(e) => setMaxSupply(e.target.value)}
          />
          <button
            className="xp-btn"
            disabled={loading || !appId || !activeAddress || !eventName || !eventDate || !ticketPrice || !maxSupply}
            onClick={createEvent}
          >
            {loading ? 'Creating & Minting...' : 'Create Event'}
          </button>
        </div>
      </XpWindow>
    </div>
  )
}

export default CreateEventTab
