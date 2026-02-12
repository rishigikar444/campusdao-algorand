import { useState } from 'react'
import { useSnackbar } from 'notistack'
import { getApplicationAddress, makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk'
import { microAlgos } from '@algorandfoundation/algokit-utils'
import { useAlgorand } from '../hooks/useAlgorand'
import { EventManagerClient, EventManagerFactory } from '../contracts/EventManager'

const MBR_AMOUNT = 200_000

const EventsTab = () => {
  const { enqueueSnackbar } = useSnackbar()
  const { algorand, activeAddress, transactionSigner } = useAlgorand()

  const [appId, setAppId] = useState<string>('')
  const [deploying, setDeploying] = useState(false)
  const [loading, setLoading] = useState(false)

  // Create Event
  const [clubAppId, setClubAppId] = useState('')
  const [ticketPrice, setTicketPrice] = useState('')
  const [maxSupply, setMaxSupply] = useState('')

  // Event Info
  const [lookupEventId, setLookupEventId] = useState('')
  const [eventInfo, setEventInfo] = useState<{ price: string; supply: string; sold: string; active: string } | null>(null)

  // Mint / Buy / Validate / Close
  const [mintEventId, setMintEventId] = useState('')
  const [buyEventId, setBuyEventId] = useState('')
  const [treasuryAddr, setTreasuryAddr] = useState('')
  const [validateEventId, setValidateEventId] = useState('')
  const [validateAsaId, setValidateAsaId] = useState('')
  const [closeEventId, setCloseEventId] = useState('')

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
      setLoading(true)
      const client = getClient()
      const mbrTxn = await makeMbrTxn()
      const res = await client.send.createEvent({
        args: {
          clubAppId: BigInt(clubAppId || '0'),
          ticketPrice: BigInt(Math.round(Number(ticketPrice) * 1_000_000)),
          maxSupply: BigInt(maxSupply),
          mbrPay: { txn: mbrTxn, signer: transactionSigner },
        },
        sender: activeAddress!,
        extraFee: microAlgos(1000),
      })
      enqueueSnackbar(`Event created! ID: ${res.return}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Create event failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const lookupEvent = async () => {
    try {
      setLoading(true)
      const client = getClient()
      const res = await client.send.getEventInfo({
        args: { eventId: BigInt(lookupEventId) },
        sender: activeAddress!,
      })
      if (res.return) {
        const [price, supply, sold, active] = res.return
        setEventInfo({
          price: `${Number(price) / 1_000_000} ALGO`,
          supply: supply.toString(),
          sold: sold.toString(),
          active: active === 1n ? 'Active' : 'Closed',
        })
      }
    } catch (e) {
      enqueueSnackbar(`Lookup failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const mintTicket = async () => {
    try {
      setLoading(true)
      const client = getClient()
      const mbrTxn = await makeMbrTxn()
      const res = await client.send.mintTicket({
        args: {
          eventId: BigInt(mintEventId),
          mbrPay: { txn: mbrTxn, signer: transactionSigner },
        },
        sender: activeAddress!,
        extraFee: microAlgos(2000),
      })
      enqueueSnackbar(`Tickets minted! ASA ID: ${res.return}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Mint failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const buyTicket = async () => {
    try {
      setLoading(true)
      const client = getClient()
      // Look up event price first
      const info = await client.send.getEventInfo({
        args: { eventId: BigInt(buyEventId) },
        sender: activeAddress!,
      })
      const price = info.return![0]
      const sp = await algorand.client.algod.getTransactionParams().do()
      const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress!,
        receiver: treasuryAddr,
        amount: Number(price),
        suggestedParams: sp,
      })
      await client.send.buyTicket({
        args: {
          eventId: BigInt(buyEventId),
          payTxn: { txn: payTxn, signer: transactionSigner },
          treasuryAddress: treasuryAddr,
        },
        sender: activeAddress!,
        extraFee: microAlgos(2000),
      })
      enqueueSnackbar('Ticket purchased!', { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Buy failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const validateTicket = async () => {
    try {
      setLoading(true)
      const client = getClient()
      const res = await client.send.validateTicket({
        args: {
          eventId: BigInt(validateEventId),
          ticketAsaId: BigInt(validateAsaId),
        },
        sender: activeAddress!,
      })
      enqueueSnackbar(`Ticket valid: ${res.return}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Validate failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const closeSales = async () => {
    try {
      setLoading(true)
      const client = getClient()
      await client.send.closeSales({
        args: { eventId: BigInt(closeEventId) },
        sender: activeAddress!,
      })
      enqueueSnackbar('Sales closed!', { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Close failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* App ID + Deploy */}
      <div className="flex flex-col md:flex-row gap-4 items-end">
        <div className="flex-1">
          <label className="label"><span className="label-text font-semibold">Application ID</span></label>
          <input className="input input-bordered w-full" type="number" placeholder="Enter EventManager App ID" value={appId} onChange={(e) => setAppId(e.target.value)} />
        </div>
        <button className={`btn btn-accent ${deploying ? 'loading' : ''}`} disabled={deploying || !activeAddress} onClick={deploy}>
          Deploy New
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Create Event */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Create Event</h3>
            <input className="input input-bordered input-sm" placeholder="Club App ID (0 if none)" value={clubAppId} onChange={(e) => setClubAppId(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Ticket Price (ALGO)" type="number" step="0.001" value={ticketPrice} onChange={(e) => setTicketPrice(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Max Supply" type="number" value={maxSupply} onChange={(e) => setMaxSupply(e.target.value)} />
            <button className={`btn btn-primary btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={createEvent}>Create Event</button>
          </div>
        </div>

        {/* Event Lookup */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Event Lookup</h3>
            <input className="input input-bordered input-sm" placeholder="Event ID" type="number" value={lookupEventId} onChange={(e) => setLookupEventId(e.target.value)} />
            <button className={`btn btn-info btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={lookupEvent}>Lookup</button>
            {eventInfo && (
              <div className="text-xs mt-2 space-y-1">
                <div>Price: <span className="font-mono">{eventInfo.price}</span></div>
                <div>Max Supply: <span className="font-mono">{eventInfo.supply}</span></div>
                <div>Sold: <span className="font-mono">{eventInfo.sold}</span></div>
                <div>Status: <span className="badge badge-sm">{eventInfo.active}</span></div>
              </div>
            )}
          </div>
        </div>

        {/* Mint Tickets */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Mint Tickets</h3>
            <input className="input input-bordered input-sm" placeholder="Event ID" type="number" value={mintEventId} onChange={(e) => setMintEventId(e.target.value)} />
            <button className={`btn btn-secondary btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={mintTicket}>Mint Ticket ASA</button>
          </div>
        </div>

        {/* Buy Ticket */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Buy Ticket</h3>
            <input className="input input-bordered input-sm" placeholder="Event ID" type="number" value={buyEventId} onChange={(e) => setBuyEventId(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Treasury Address" value={treasuryAddr} onChange={(e) => setTreasuryAddr(e.target.value)} />
            <button className={`btn btn-primary btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={buyTicket}>Buy Ticket</button>
          </div>
        </div>

        {/* Validate Ticket */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Validate Ticket</h3>
            <input className="input input-bordered input-sm" placeholder="Event ID" type="number" value={validateEventId} onChange={(e) => setValidateEventId(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Ticket ASA ID" type="number" value={validateAsaId} onChange={(e) => setValidateAsaId(e.target.value)} />
            <button className={`btn btn-warning btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={validateTicket}>Validate</button>
          </div>
        </div>

        {/* Close Sales */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Close Sales</h3>
            <input className="input input-bordered input-sm" placeholder="Event ID" type="number" value={closeEventId} onChange={(e) => setCloseEventId(e.target.value)} />
            <button className={`btn btn-error btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={closeSales}>Close Sales</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EventsTab
