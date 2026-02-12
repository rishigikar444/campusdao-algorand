import { useState } from 'react'
import { useSnackbar } from 'notistack'
import { getApplicationAddress, makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk'
import { microAlgos } from '@algorandfoundation/algokit-utils'
import { useAlgorand } from '../hooks/useAlgorand'
import { TreasuryDaoClient, TreasuryDaoFactory } from '../contracts/TreasuryDAO'

const ZERO_ADDR = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'
const MBR_AMOUNT = 200_000

const TreasuryTab = () => {
  const { enqueueSnackbar } = useSnackbar()
  const { algorand, activeAddress, transactionSigner } = useAlgorand()

  const [appId, setAppId] = useState<string>('')
  const [deploying, setDeploying] = useState(false)
  const [loading, setLoading] = useState(false)

  // Create Club
  const [quorum, setQuorum] = useState('')
  const [member1, setMember1] = useState('')
  const [member2, setMember2] = useState('')
  const [member3, setMember3] = useState('')

  // Treasury Balance
  const [balClubId, setBalClubId] = useState('')
  const [treasuryBalance, setTreasuryBalance] = useState<string | null>(null)

  // Deposit
  const [depClubId, setDepClubId] = useState('')
  const [depAmount, setDepAmount] = useState('')

  // Create Proposal
  const [propClubId, setPropClubId] = useState('')
  const [propAmount, setPropAmount] = useState('')
  const [propRecipient, setPropRecipient] = useState('')
  const [propDeadline, setPropDeadline] = useState('')
  const [propMetadata, setPropMetadata] = useState('')

  // Proposal Info
  const [lookupPropId, setLookupPropId] = useState('')
  const [proposalInfo, setProposalInfo] = useState<{ amount: string; votesFor: string; votesAgainst: string; deadline: string; executed: string } | null>(null)

  // Vote
  const [voteProposalId, setVoteProposalId] = useState('')
  const [voteSupport, setVoteSupport] = useState('1')

  // Execute
  const [execProposalId, setExecProposalId] = useState('')

  const getClient = () => {
    if (!appId || !activeAddress) throw new Error('Set App ID and connect wallet')
    return new TreasuryDaoClient({
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
      const factory = new TreasuryDaoFactory({ defaultSender: activeAddress, algorand })
      const res = await factory.send.create.bare()
      const id = String(res.appClient.appId)
      setAppId(id)
      enqueueSnackbar(`TreasuryDAO deployed. App ID: ${id}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Deploy failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setDeploying(false)
    }
  }

  const createClub = async () => {
    try {
      setLoading(true)
      const client = getClient()
      const mbrTxn = await makeMbrTxn()
      const res = await client.send.createClub({
        args: {
          quorum: BigInt(quorum),
          member1: member1 || ZERO_ADDR,
          member2: member2 || ZERO_ADDR,
          member3: member3 || ZERO_ADDR,
          mbrPay: { txn: mbrTxn, signer: transactionSigner },
        },
        sender: activeAddress!,
        extraFee: microAlgos(1000),
      })
      enqueueSnackbar(`Club created! ID: ${res.return}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Create club failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const fetchBalance = async () => {
    try {
      setLoading(true)
      const client = getClient()
      const res = await client.send.getTreasuryBalance({
        args: { clubId: BigInt(balClubId) },
        sender: activeAddress!,
      })
      setTreasuryBalance(`${Number(res.return ?? 0n) / 1_000_000} ALGO`)
    } catch (e) {
      enqueueSnackbar(`Balance fetch failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const depositFunds = async () => {
    try {
      setLoading(true)
      const client = getClient()
      const amountMicro = Math.round(Number(depAmount) * 1_000_000)
      const sp = await algorand.client.algod.getTransactionParams().do()
      const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress!,
        receiver: getApplicationAddress(Number(appId)),
        amount: amountMicro,
        suggestedParams: sp,
      })
      const res = await client.send.deposit({
        args: {
          clubId: BigInt(depClubId),
          payTxn: { txn: payTxn, signer: transactionSigner },
        },
        sender: activeAddress!,
      })
      enqueueSnackbar(`Deposited! Treasury: ${Number(res.return ?? 0n) / 1_000_000} ALGO`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Deposit failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const createProposal = async () => {
    try {
      setLoading(true)
      const client = getClient()
      const mbrTxn = await makeMbrTxn()
      const metaBytes = new TextEncoder().encode(propMetadata || 'proposal')
      const res = await client.send.createProposal({
        args: {
          clubId: BigInt(propClubId),
          amount: BigInt(Math.round(Number(propAmount) * 1_000_000)),
          recipient: propRecipient,
          deadlineRound: BigInt(propDeadline),
          metadataHash: metaBytes,
          mbrPay: { txn: mbrTxn, signer: transactionSigner },
        },
        sender: activeAddress!,
        extraFee: microAlgos(1000),
      })
      enqueueSnackbar(`Proposal created! ID: ${res.return}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Create proposal failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const lookupProposal = async () => {
    try {
      setLoading(true)
      const client = getClient()
      const res = await client.send.getProposalInfo({
        args: { proposalId: BigInt(lookupPropId) },
        sender: activeAddress!,
      })
      if (res.return) {
        const [amount, votesFor, votesAgainst, deadline, executed] = res.return
        setProposalInfo({
          amount: `${Number(amount) / 1_000_000} ALGO`,
          votesFor: votesFor.toString(),
          votesAgainst: votesAgainst.toString(),
          deadline: deadline.toString(),
          executed: executed === 1n ? 'Yes' : 'No',
        })
      }
    } catch (e) {
      enqueueSnackbar(`Lookup failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const vote = async () => {
    try {
      setLoading(true)
      const client = getClient()
      await client.send.vote({
        args: {
          proposalId: BigInt(voteProposalId),
          support: BigInt(voteSupport),
        },
        sender: activeAddress!,
      })
      enqueueSnackbar(`Vote cast (${voteSupport === '1' ? 'Yes' : 'No'})!`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Vote failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const executeProposal = async () => {
    try {
      setLoading(true)
      const client = getClient()
      await client.send.executeProposal({
        args: { proposalId: BigInt(execProposalId) },
        sender: activeAddress!,
        extraFee: microAlgos(2000),
      })
      enqueueSnackbar('Proposal executed!', { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Execute failed: ${(e as Error).message}`, { variant: 'error' })
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
          <input className="input input-bordered w-full" type="number" placeholder="Enter TreasuryDAO App ID" value={appId} onChange={(e) => setAppId(e.target.value)} />
        </div>
        <button className={`btn btn-accent ${deploying ? 'loading' : ''}`} disabled={deploying || !activeAddress} onClick={deploy}>
          Deploy New
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Create Club */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Create Club</h3>
            <input className="input input-bordered input-sm" placeholder="Quorum (e.g. 2)" type="number" value={quorum} onChange={(e) => setQuorum(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Member 1 Address" value={member1} onChange={(e) => setMember1(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Member 2 Address (optional)" value={member2} onChange={(e) => setMember2(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Member 3 Address (optional)" value={member3} onChange={(e) => setMember3(e.target.value)} />
            <button className={`btn btn-primary btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={createClub}>Create Club</button>
          </div>
        </div>

        {/* Treasury Balance */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Treasury Balance</h3>
            <input className="input input-bordered input-sm" placeholder="Club ID" type="number" value={balClubId} onChange={(e) => setBalClubId(e.target.value)} />
            <button className={`btn btn-info btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={fetchBalance}>Check Balance</button>
            {treasuryBalance && <div className="text-sm font-mono mt-1">Balance: {treasuryBalance}</div>}
          </div>
        </div>

        {/* Deposit */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Deposit</h3>
            <input className="input input-bordered input-sm" placeholder="Club ID" type="number" value={depClubId} onChange={(e) => setDepClubId(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Amount (ALGO)" type="number" step="0.001" value={depAmount} onChange={(e) => setDepAmount(e.target.value)} />
            <button className={`btn btn-primary btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={depositFunds}>Deposit</button>
          </div>
        </div>

        {/* Create Proposal */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Create Proposal</h3>
            <input className="input input-bordered input-sm" placeholder="Club ID" type="number" value={propClubId} onChange={(e) => setPropClubId(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Amount (ALGO)" type="number" step="0.001" value={propAmount} onChange={(e) => setPropAmount(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Recipient Address" value={propRecipient} onChange={(e) => setPropRecipient(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Deadline Round" type="number" value={propDeadline} onChange={(e) => setPropDeadline(e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="Metadata / Description" value={propMetadata} onChange={(e) => setPropMetadata(e.target.value)} />
            <button className={`btn btn-primary btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={createProposal}>Create Proposal</button>
          </div>
        </div>

        {/* Proposal Info */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Proposal Info</h3>
            <input className="input input-bordered input-sm" placeholder="Proposal ID" type="number" value={lookupPropId} onChange={(e) => setLookupPropId(e.target.value)} />
            <button className={`btn btn-info btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={lookupProposal}>Lookup</button>
            {proposalInfo && (
              <div className="text-xs mt-2 space-y-1">
                <div>Amount: <span className="font-mono">{proposalInfo.amount}</span></div>
                <div>Votes For: <span className="font-mono">{proposalInfo.votesFor}</span></div>
                <div>Votes Against: <span className="font-mono">{proposalInfo.votesAgainst}</span></div>
                <div>Deadline Round: <span className="font-mono">{proposalInfo.deadline}</span></div>
                <div>Executed: <span className="badge badge-sm">{proposalInfo.executed}</span></div>
              </div>
            )}
          </div>
        </div>

        {/* Vote */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Vote</h3>
            <input className="input input-bordered input-sm" placeholder="Proposal ID" type="number" value={voteProposalId} onChange={(e) => setVoteProposalId(e.target.value)} />
            <select className="select select-bordered select-sm" value={voteSupport} onChange={(e) => setVoteSupport(e.target.value)}>
              <option value="1">Yes (Support)</option>
              <option value="0">No (Against)</option>
            </select>
            <button className={`btn btn-secondary btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={vote}>Cast Vote</button>
          </div>
        </div>

        {/* Execute Proposal */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title text-sm">Execute Proposal</h3>
            <input className="input input-bordered input-sm" placeholder="Proposal ID" type="number" value={execProposalId} onChange={(e) => setExecProposalId(e.target.value)} />
            <button className={`btn btn-error btn-sm ${loading ? 'loading' : ''}`} disabled={loading || !appId || !activeAddress} onClick={executeProposal}>Execute</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TreasuryTab
