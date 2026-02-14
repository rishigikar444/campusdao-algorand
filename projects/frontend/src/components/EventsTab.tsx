import { useState, useEffect } from 'react'
import { useSnackbar } from 'notistack'
import { makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk'
import { microAlgos } from '@algorandfoundation/algokit-utils'
import { useAlgorand } from '../hooks/useAlgorand'
import { EventManagerClient } from '../contracts/EventManager'
import XpWindow from './XpWindow'

interface EventData {
  _id: string
  eventId: number
  appId: number
  ticketAsaId?: number
  name: string
  description: string
  imageUrl: string
  eventDate: string     // ISO date string
  organizer: string
  clubAppId: number
  ticketPrice: number   // microAlgos
  maxSupply: number
  soldCount: number
  saleActive: boolean
}

// Deterministic color palette for ticket art
const TICKET_COLORS = [
  ['#6A11CB', '#2575FC'],
  ['#F7971E', '#FFD200'],
  ['#00B4DB', '#0083B0'],
  ['#ED213A', '#93291E'],
  ['#11998E', '#38EF7D'],
  ['#6441A5', '#2a0845'],
]

interface EventsTabProps {
  onNavigateToCreate: () => void
}

const EventsTab = ({ onNavigateToCreate }: EventsTabProps) => {
  const { enqueueSnackbar } = useSnackbar()
  const { algorand, activeAddress, transactionSigner } = useAlgorand()

  const [events, setEvents] = useState<EventData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [buyingId, setBuyingId] = useState<string | null>(null)

  useEffect(() => {
    fetchEvents()
  }, [])

  const fetchEvents = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/events')
      if (!res.ok) throw new Error(`Failed to fetch events: ${res.statusText}`)
      const data = await res.json()
      setEvents(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const formatPrice = (microAlgos: number) => {
    const algo = microAlgos / 1_000_000
    return algo === 0 ? 'FREE' : `${algo} ALGO`
  }

  // Encode a BoxMap key: 2-byte ASCII prefix + 8-byte big-endian uint64
  const encodeBoxName = (prefix: string, eventId: number): Uint8Array => {
    const prefixBytes = new TextEncoder().encode(prefix)
    const idBytes = new Uint8Array(8)
    new DataView(idBytes.buffer).setBigUint64(0, BigInt(eventId))
    const combined = new Uint8Array(prefixBytes.length + 8)
    combined.set(prefixBytes)
    combined.set(idBytes, prefixBytes.length)
    return combined
  }

  const buyTicket = async (event: EventData) => {
    if (!activeAddress) {
      enqueueSnackbar('Connect your wallet first', { variant: 'warning' })
      return
    }
    if (!event.ticketAsaId) {
      enqueueSnackbar('Tickets have not been minted for this event yet', { variant: 'warning' })
      return
    }

    try {
      setBuyingId(event._id)

      const client = new EventManagerClient({
        appId: BigInt(event.appId),
        algorand,
        defaultSigner: transactionSigner,
      })

      // Fetch on-chain price to be safe
      const info = await client.send.getEventInfo({
        args: { eventId: BigInt(event.eventId) },
        sender: activeAddress,
      })
      const price = Number(info.return![0])

      // Opt the buyer into the ticket ASA if not already opted in
      const ticketAsaId = event.ticketAsaId
      try {
        await algorand.client.algod
          .accountAssetInformation(activeAddress, ticketAsaId)
          .do()
      } catch {
        // Not opted in yet — send ASA opt-in (0-amount transfer to self)
        const { makeAssetTransferTxnWithSuggestedParamsFromObject } = await import('algosdk')
        const sp = await algorand.client.algod.getTransactionParams().do()
        const assetOptIn = makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: activeAddress,
          receiver: activeAddress,
          amount: 0,
          assetIndex: ticketAsaId,
          suggestedParams: sp,
        })
        const signed = await transactionSigner([assetOptIn], [0])
        await algorand.client.algod.sendRawTransaction(signed[0]).do()
        // Wait for confirmation
        await new Promise((r) => setTimeout(r, 4000))
      }

      // Build payment txn to the organizer (treasury)
      const sp = await algorand.client.algod.getTransactionParams().do()
      const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: event.organizer,
        amount: price,
        suggestedParams: sp,
      })

      // Manually specify box + asset references to avoid resource-limit errors
      const eid = event.eventId
      await client.send.buyTicket({
        args: {
          eventId: BigInt(eid),
          payTxn: { txn: payTxn, signer: transactionSigner },
          treasuryAddress: event.organizer,
        },
        sender: activeAddress,
        extraFee: microAlgos(2000),
        boxReferences: [
          encodeBoxName('eo', eid),
          encodeBoxName('ea', eid),
          encodeBoxName('es', eid),
          encodeBoxName('em', eid),
          encodeBoxName('ep', eid),
          encodeBoxName('et', eid),
        ],
        assetReferences: [BigInt(ticketAsaId)],
        populateAppCallResources: false,
      })

      enqueueSnackbar(`Ticket purchased for "${event.name}"!`, { variant: 'success' })

      // Update sold count in DB
      await fetch(`/api/events/${event._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soldCount: event.soldCount + 1 }),
      })

      fetchEvents()
    } catch (e) {
      enqueueSnackbar(`Purchase failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setBuyingId(null)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12 font-xp-body text-sm text-gray-500">
        Loading events...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <div className="font-xp-body text-sm text-red-600">
          Could not load events: {error}
        </div>
        <button className="xp-btn text-xs" onClick={fetchEvents}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {events.length === 0 ? (
        <div className="text-center py-12 font-xp-body text-sm text-gray-500">
          No events yet. Be the first to create one!
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((event, i) => {
            const [c1, c2] = TICKET_COLORS[i % TICKET_COLORS.length]
            const remaining = event.maxSupply - event.soldCount
            const isBuying = buyingId === event._id

            return (
              <XpWindow key={event._id} title={event.name} showControls={false}>
                {/* Ticket Image Area — 3/4 of the card */}
                <div
                  className="relative flex flex-col items-center justify-center select-none"
                  style={{
                    background: event.imageUrl
                      ? `url(${event.imageUrl}) center/cover no-repeat`
                      : `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
                    height: '220px',
                    margin: '-16px -16px 0 -16px',
                  }}
                >
                  {/* Ticket stub decoration */}
                  <div
                    className="absolute left-0 top-0 bottom-0 w-3"
                    style={{
                      background:
                        'repeating-linear-gradient(180deg, transparent 0px, transparent 8px, rgba(255,255,255,0.15) 8px, rgba(255,255,255,0.15) 16px)',
                    }}
                  />
                  <div className="text-white text-center px-6">
                    <div className="text-4xl mb-2">&#127915;</div>
                    <div
                      className="text-lg font-bold font-xp"
                      style={{ textShadow: '1px 2px 4px rgba(0,0,0,0.4)' }}
                    >
                      {event.name}
                    </div>
                    {event.description && (
                      <div className="text-xs mt-1 opacity-90 line-clamp-2">
                        {event.description}
                      </div>
                    )}
                    <div className="text-xs mt-2 opacity-90 font-bold">
                      {new Date(event.eventDate).toLocaleDateString(undefined, {
                        weekday: 'short',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                    <div className="text-xs mt-1 opacity-80">
                      {remaining} / {event.maxSupply} tickets left
                    </div>
                  </div>
                  {/* Perforated edge */}
                  <div className="absolute bottom-0 left-0 right-0 h-3 flex justify-between px-1">
                    {Array.from({ length: 20 }).map((_, j) => (
                      <div
                        key={j}
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: '#ECE9D8' }}
                      />
                    ))}
                  </div>
                  {/* Sold out / closed overlay */}
                  {(!event.saleActive || remaining <= 0) && (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
                    >
                      <span className="text-white text-xl font-bold font-xp">
                        {remaining <= 0 ? 'SOLD OUT' : 'SALES CLOSED'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Bottom strip — price + mint button */}
                <div className="flex items-center justify-between pt-4">
                  <div className="font-xp-body">
                    <span className="text-xs text-gray-500">Price</span>
                    <div className="text-sm font-bold">{formatPrice(event.ticketPrice)}</div>
                  </div>
                  <button
                    className="xp-btn text-xs px-3"
                    disabled={remaining <= 0 || !event.saleActive || isBuying || !activeAddress}
                    onClick={() => buyTicket(event)}
                  >
                    {isBuying ? 'Buying...' : remaining <= 0 ? 'Sold Out' : 'Mint Ticket'}
                  </button>
                </div>
              </XpWindow>
            )
          })}
        </div>
      )}

      {/* Create Event Button */}
      <div className="flex justify-center pt-2 pb-2">
        <button className="xp-btn text-xs px-4 py-1" onClick={onNavigateToCreate}>
          + Create Event
        </button>
      </div>
    </div>
  )
}

export default EventsTab
