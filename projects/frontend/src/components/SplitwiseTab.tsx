import { useState } from 'react'
import { useSnackbar } from 'notistack'
import { getApplicationAddress, makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk'
import { microAlgos } from '@algorandfoundation/algokit-utils'
import { useAlgorand } from '../hooks/useAlgorand'
import { SplitwiseClient, SplitwiseFactory } from '../contracts/Splitwise'

const ZERO_ADDR = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'
const MBR_AMOUNT = 200_000

const SplitwiseTab = () => {
  const { enqueueSnackbar } = useSnackbar()
  const { algorand, activeAddress, transactionSigner } = useAlgorand()

  const [appId, setAppId] = useState<string>('')
  const [deploying, setDeploying] = useState(false)
  const [loading, setLoading] = useState(false)

  // Create Group
  const [grpMember1, setGrpMember1] = useState('')
  const [grpMember2, setGrpMember2] = useState('')
  const [grpMember3, setGrpMember3] = useState('')

  // Add Expense
  const [expGroupId, setExpGroupId] = useState('')
  const [expAmount, setExpAmount] = useState('')
  const [expPart1, setExpPart1] = useState('')
  const [expPart2, setExpPart2] = useState('')
  const [expPart3, setExpPart3] = useState('')

  // Expense Info
  const [lookupExpId, setLookupExpId] = useState('')
  const [expenseInfo, setExpenseInfo] = useState<{ amount: string; share: string; participants: string; settled: string } | null>(null)

  // Settle
  const [settleExpId, setSettleExpId] = useState('')
  const [settlePayerAddr, setSettlePayerAddr] = useState('')

  // Close Group
  const [closeGroupId, setCloseGroupId] = useState('')

  const getClient = () => {
    if (!appId || !activeAddress) throw new Error('Set App ID and connect wallet')
    return new SplitwiseClient({
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
      const factory = new SplitwiseFactory({ defaultSender: activeAddress, algorand })
      const res = await factory.send.create.bare()
      const id = String(res.appClient.appId)
      setAppId(id)
      enqueueSnackbar(`Splitwise deployed. App ID: ${id}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Deploy failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setDeploying(false)
    }
  }

  const createGroup = async () => {
    try {
      setLoading(true)
      const client = getClient()
      const mbrTxn = await makeMbrTxn()
      const res = await client.send.createGroup({
        args: {
          member1: grpMember1 || ZERO_ADDR,
          member2: grpMember2 || ZERO_ADDR,
          member3: grpMember3 || ZERO_ADDR,
          mbrPay: { txn: mbrTxn, signer: transactionSigner },
        },
        sender: activeAddress!,
        extraFee: microAlgos(1000),
      })
      enqueueSnackbar(`Group created! ID: ${res.return}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Create group failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const addExpense = async () => {
    try {
      setLoading(true)
      const client = getClient()
      const mbrTxn = await makeMbrTxn()
      const res = await client.send.addExpense({
        args: {
          groupId: BigInt(expGroupId),
          amount: BigInt(Math.round(Number(expAmount) * 1_000_000)),
          participant1: expPart1 || ZERO_ADDR,
          participant2: expPart2 || ZERO_ADDR,
          participant3: expPart3 || ZERO_ADDR,
          mbrPay: { txn: mbrTxn, signer: transactionSigner },
        },
        sender: activeAddress!,
        extraFee: microAlgos(1000),
      })
      enqueueSnackbar(`Expense added! ID: ${res.return}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Add expense failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const lookupExpense = async () => {
    try {
      setLoading(true)
      const client = getClient()
      const res = await client.send.getExpenseInfo({
        args: { expenseId: BigInt(lookupExpId) },
        sender: activeAddress!,
      })
      if (res.return) {
        const [amount, share, participants, settled] = res.return
        setExpenseInfo({
          amount: `${Number(amount) / 1_000_000} ALGO`,
          share: `${Number(share) / 1_000_000} ALGO`,
          participants: participants.toString(),
          settled: settled.toString(),
        })
      }
    } catch (e) {
      enqueueSnackbar(`Lookup failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const settleExpense = async () => {
    try {
      setLoading(true)
      const client = getClient()
      // Lookup expense to get the share amount
      const info = await client.send.getExpenseInfo({
        args: { expenseId: BigInt(settleExpId) },
        sender: activeAddress!,
      })
      const share = Number(info.return![1])
      const sp = await algorand.client.algod.getTransactionParams().do()
      const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress!,
        receiver: settlePayerAddr,
        amount: share,
        suggestedParams: sp,
      })
      const res = await client.send.settleExpense({
        args: {
          expenseId: BigInt(settleExpId),
          payTxn: { txn: payTxn, signer: transactionSigner },
        },
        sender: activeAddress!,
      })
      enqueueSnackbar(`Settled! Remaining: ${res.return}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Settle failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const closeGroup = async () => {
    try {
      setLoading(true)
      const client = getClient()
      await client.send.closeGroup({
        args: { groupId: BigInt(closeGroupId) },
        sender: activeAddress!,
      })
      enqueueSnackbar('Group closed!', { variant: 'success' })
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
          <input className="input input-bordered w-full" type="number" placeholder="Enter Splitwise App ID" value={appId} onChange={(e) => setAppId(e.target.value)} />
        </div>
        <button className={`btn btn-accent ${deploying ? 'loading' : ''}`} disabled={deploying || !activeAddress} onClick={deploy}>
          Deploy New
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Create Group */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Create Group</h3>
            <input className="input input-bordered input-sm" placeholder="Member 1 Address" value={grpMember1} onChange={(e) => setGrpMember1(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Member 2 Address (optional)" value={grpMember2} onChange={(e) => setGrpMember2(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Member 3 Address (optional)" value={grpMember3} onChange={(e) => setGrpMember3(e.target.value)} />
            <button className={`btn btn-primary btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={createGroup}>Create Group</button>
          </div>
        </div>

        {/* Add Expense */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Add Expense</h3>
            <input className="input input-bordered input-sm" placeholder="Group ID" type="number" value={expGroupId} onChange={(e) => setExpGroupId(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Total Amount (ALGO)" type="number" step="0.001" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Participant 1 Address" value={expPart1} onChange={(e) => setExpPart1(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Participant 2 (optional)" value={expPart2} onChange={(e) => setExpPart2(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Participant 3 (optional)" value={expPart3} onChange={(e) => setExpPart3(e.target.value)} />
            <button className={`btn btn-primary btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={addExpense}>Add Expense</button>
          </div>
        </div>

        {/* Expense Info */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Expense Info</h3>
            <input className="input input-bordered input-sm" placeholder="Expense ID" type="number" value={lookupExpId} onChange={(e) => setLookupExpId(e.target.value)} />
            <button className={`btn btn-info btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={lookupExpense}>Lookup</button>
            {expenseInfo && (
              <div className="text-xs mt-2 space-y-1">
                <div>Total: <span className="font-mono">{expenseInfo.amount}</span></div>
                <div>Share per person: <span className="font-mono">{expenseInfo.share}</span></div>
                <div>Participants: <span className="font-mono">{expenseInfo.participants}</span></div>
                <div>Settled: <span className="font-mono">{expenseInfo.settled}</span></div>
              </div>
            )}
          </div>
        </div>

        {/* Settle Expense */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Settle Expense</h3>
            <input className="input input-bordered input-sm" placeholder="Expense ID" type="number" value={settleExpId} onChange={(e) => setSettleExpId(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Payer Address (who you owe)" value={settlePayerAddr} onChange={(e) => setSettlePayerAddr(e.target.value)} />
            <button className={`btn btn-secondary btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={settleExpense}>Settle My Share</button>
          </div>
        </div>

        {/* Close Group */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Close Group</h3>
            <input className="input input-bordered input-sm" placeholder="Group ID" type="number" value={closeGroupId} onChange={(e) => setCloseGroupId(e.target.value)} />
            <button className={`btn btn-error btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={closeGroup}>Close Group</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SplitwiseTab
