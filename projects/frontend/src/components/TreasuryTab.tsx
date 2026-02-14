import { useState } from 'react'
import { useSnackbar } from 'notistack'
import { getApplicationAddress, makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk'
import { microAlgos } from '@algorandfoundation/algokit-utils'
import { useAlgorand } from '../hooks/useAlgorand'
import { TreasuryDaoClient, TreasuryDaoFactory } from '../contracts/TreasuryDAO'
import XpWindow from './XpWindow'

const ZERO_ADDR = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'
const MBR_AMOUNT = 200_000

const TreasuryTab = () => {
  const { enqueueSnackbar } = useSnackbar()
  const { algorand, activeAddress, transactionSigner } = useAlgorand()

  const [appId, setAppId] = useState<string>('')
  const [deploying, setDeploying] = useState(false)
  const [loading, setLoading] = useState(false)

  const [quorum, setQuorum] = useState('')
  const [member1, setMember1] = useState('')
  const [member2, setMember2] = useState('')
  const [member3, setMember3] = useState('')

  const [balClubId, setBalClubId] = useState('')
  const [treasuryBalance, setTreasuryBalance] = useState<string | null>(null)

  const [depClubId, setDepClubId] = useState('')
  const [depAmount, setDepAmount] = useState('')

  const [propClubId, setPropClubId] = useState('')
  const [propAmount, setPropAmount] = useState('')
  const [propRecipient, setPropRecipient] = useState('')
  const [propDeadline, setPropDeadline] = useState('')
  const [propMetadata, setPropMetadata] = useState('')

  const [lookupPropId, setLookupPropId] = useState('')
  const [proposalInfo, setProposalInfo] = useState<{ amount: string; votesFor: string; votesAgainst: string; deadline: string; executed: string } | null>(null)

  const [voteProposalId, setVoteProposalId] = useState('')
  const [voteSupport, setVoteSupport] = useState('1')

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
    <div className="flex flex-col gap-4">
      {/* App ID + Deploy */}
      <div className="flex flex-col md:flex-row gap-3 items-end">
        <div className="flex-1">
          <label className="font-xp-body text-sm font-semibold block mb-1">Application ID</label>
          <input className="xp-input" type="number" placeholder="Enter TreasuryDAO App ID" value={appId} onChange={(e) => setAppId(e.target.value)} />
        </div>
        <button className="xp-btn" disabled={deploying || !activeAddress} onClick={deploy}>
          {deploying ? 'Deploying...' : 'Deploy New'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Create Club */}
        <XpWindow title="Create Club" showControls={false}>
          <div className="flex flex-col gap-2">
            <input className="xp-input" placeholder="Quorum (e.g. 2)" type="number" value={quorum} onChange={(e) => setQuorum(e.target.value)} />
            <input className="xp-input" placeholder="Member 1 Address" value={member1} onChange={(e) => setMember1(e.target.value)} />
            <input className="xp-input" placeholder="Member 2 Address (optional)" value={member2} onChange={(e) => setMember2(e.target.value)} />
            <input className="xp-input" placeholder="Member 3 Address (optional)" value={member3} onChange={(e) => setMember3(e.target.value)} />
            <button className="xp-btn" disabled={loading || !appId || !activeAddress} onClick={createClub}>
              {loading ? 'Working...' : 'Create Club'}
            </button>
          </div>
        </XpWindow>

        {/* Treasury Balance */}
        <XpWindow title="Treasury Balance" showControls={false}>
          <div className="flex flex-col gap-2">
            <input className="xp-input" placeholder="Club ID" type="number" value={balClubId} onChange={(e) => setBalClubId(e.target.value)} />
            <button className="xp-btn" disabled={loading || !appId || !activeAddress} onClick={fetchBalance}>
              {loading ? 'Working...' : 'Check Balance'}
            </button>
            {treasuryBalance && <div className="text-sm font-mono mt-1">Balance: {treasuryBalance}</div>}
          </div>
        </XpWindow>

        {/* Deposit */}
        <XpWindow title="Deposit" showControls={false}>
          <div className="flex flex-col gap-2">
            <input className="xp-input" placeholder="Club ID" type="number" value={depClubId} onChange={(e) => setDepClubId(e.target.value)} />
            <input className="xp-input" placeholder="Amount (ALGO)" type="number" step="0.001" value={depAmount} onChange={(e) => setDepAmount(e.target.value)} />
            <button className="xp-btn" disabled={loading || !appId || !activeAddress} onClick={depositFunds}>
              {loading ? 'Working...' : 'Deposit'}
            </button>
          </div>
        </XpWindow>

        {/* Create Proposal */}
        <XpWindow title="Create Proposal" showControls={false}>
          <div className="flex flex-col gap-2">
            <input className="xp-input" placeholder="Club ID" type="number" value={propClubId} onChange={(e) => setPropClubId(e.target.value)} />
            <input className="xp-input" placeholder="Amount (ALGO)" type="number" step="0.001" value={propAmount} onChange={(e) => setPropAmount(e.target.value)} />
            <input className="xp-input" placeholder="Recipient Address" value={propRecipient} onChange={(e) => setPropRecipient(e.target.value)} />
            <input className="xp-input" placeholder="Deadline Round" type="number" value={propDeadline} onChange={(e) => setPropDeadline(e.target.value)} />
            <input className="xp-input" placeholder="Metadata / Description" value={propMetadata} onChange={(e) => setPropMetadata(e.target.value)} />
            <button className="xp-btn" disabled={loading || !appId || !activeAddress} onClick={createProposal}>
              {loading ? 'Working...' : 'Create Proposal'}
            </button>
          </div>
        </XpWindow>

        {/* Proposal Info */}
        <XpWindow title="Proposal Info" showControls={false}>
          <div className="flex flex-col gap-2">
            <input className="xp-input" placeholder="Proposal ID" type="number" value={lookupPropId} onChange={(e) => setLookupPropId(e.target.value)} />
            <button className="xp-btn" disabled={loading || !appId || !activeAddress} onClick={lookupProposal}>
              {loading ? 'Working...' : 'Lookup'}
            </button>
            {proposalInfo && (
              <div className="text-xs mt-1 space-y-1 font-xp-body">
                <div>Amount: <span className="font-mono">{proposalInfo.amount}</span></div>
                <div>Votes For: <span className="font-mono">{proposalInfo.votesFor}</span></div>
                <div>Votes Against: <span className="font-mono">{proposalInfo.votesAgainst}</span></div>
                <div>Deadline Round: <span className="font-mono">{proposalInfo.deadline}</span></div>
                <div>Executed: <span className="xp-badge">{proposalInfo.executed}</span></div>
              </div>
            )}
          </div>
        </XpWindow>

        {/* Vote */}
        <XpWindow title="Vote" showControls={false}>
          <div className="flex flex-col gap-2">
            <input className="xp-input" placeholder="Proposal ID" type="number" value={voteProposalId} onChange={(e) => setVoteProposalId(e.target.value)} />
            <select className="xp-select" value={voteSupport} onChange={(e) => setVoteSupport(e.target.value)}>
              <option value="1">Yes (Support)</option>
              <option value="0">No (Against)</option>
            </select>
            <button className="xp-btn" disabled={loading || !appId || !activeAddress} onClick={vote}>
              {loading ? 'Working...' : 'Cast Vote'}
            </button>
          </div>
        </XpWindow>

        {/* Execute Proposal */}
        <XpWindow title="Execute Proposal" showControls={false}>
          <div className="flex flex-col gap-2">
            <input className="xp-input" placeholder="Proposal ID" type="number" value={execProposalId} onChange={(e) => setExecProposalId(e.target.value)} />
            <button className="xp-btn" disabled={loading || !appId || !activeAddress} onClick={executeProposal}>
              {loading ? 'Working...' : 'Execute'}
            </button>
          </div>
        </XpWindow>
      </div>
    </div>
  )
}

export default TreasuryTab
