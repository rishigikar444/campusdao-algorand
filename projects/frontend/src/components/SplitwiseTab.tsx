import { useState, useEffect, useCallback } from 'react'
import { useSnackbar } from 'notistack'
import { getApplicationAddress, makePaymentTxnWithSuggestedParamsFromObject, decodeAddress } from 'algosdk'
import { microAlgos } from '@algorandfoundation/algokit-utils'
import { useAlgorand } from '../hooks/useAlgorand'
import { SplitwiseClient } from '../contracts/Splitwise'
import XpWindow from './XpWindow'
import { ellipseAddress } from '../utils/ellipseAddress'

const ZERO_ADDR = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'

// Encode a BoxMap key: prefix bytes + 8-byte big-endian uint64
const encodeBoxName = (prefix: string, id: number): Uint8Array => {
  const prefixBytes = new TextEncoder().encode(prefix)
  const idBytes = new Uint8Array(8)
  new DataView(idBytes.buffer).setBigUint64(0, BigInt(id))
  const combined = new Uint8Array(prefixBytes.length + 8)
  combined.set(prefixBytes)
  combined.set(idBytes, prefixBytes.length)
  return combined
}

// Encode composite box key: prefix + 8-byte id + 32-byte address public key
const encodeMemberBoxName = (prefix: string, id: number, address: string): Uint8Array => {
  const prefixBytes = new TextEncoder().encode(prefix)
  const idBytes = new Uint8Array(8)
  new DataView(idBytes.buffer).setBigUint64(0, BigInt(id))
  const addrBytes = decodeAddress(address).publicKey
  const combined = new Uint8Array(prefixBytes.length + 8 + 32)
  combined.set(prefixBytes)
  combined.set(idBytes, prefixBytes.length)
  combined.set(addrBytes, prefixBytes.length + 8)
  return combined
}

interface Member {
  name: string
  address: string
}

interface GroupData {
  _id: string
  groupId: number
  appId: number
  name: string
  creator: string
  members: Member[]
  active: boolean
}

interface ExpenseData {
  _id: string
  expenseId: number
  appId: number
  groupId: number
  description: string
  amount: number
  payer: string
  participants: string[]
  sharePerPerson: number
  settledBy: string[]
}

interface SplitwiseTabProps {
  onNavigateToCreate: () => void
}

const SplitwiseTab = ({ onNavigateToCreate }: SplitwiseTabProps) => {
  const { enqueueSnackbar } = useSnackbar()
  const { algorand, activeAddress, transactionSigner } = useAlgorand()

  const [groups, setGroups] = useState<GroupData[]>([])
  const [expenses, setExpenses] = useState<Record<number, ExpenseData[]>>({}) // keyed by groupId
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [loadingAction, setLoadingAction] = useState(false)

  // Expanded group for add-expense form
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null)

  // Add expense form state
  const [expDesc, setExpDesc] = useState('')
  const [expAmount, setExpAmount] = useState('')
  const [expParticipants, setExpParticipants] = useState<string[]>([])

  const getClient = useCallback(
    (appId: number) => {
      if (!activeAddress) throw new Error('Connect wallet')
      return new SplitwiseClient({
        appId: BigInt(appId),
        algorand,
        defaultSigner: transactionSigner,
      })
    },
    [activeAddress, algorand, transactionSigner],
  )

  const getMemberName = useCallback(
    (address: string, group: GroupData) => {
      const m = group.members.find((m) => m.address === address)
      return m ? m.name : ellipseAddress(address)
    },
    [],
  )

  // Load groups from backend
  const loadGroups = useCallback(async () => {
    if (!activeAddress) return
    try {
      setLoadingGroups(true)
      const res = await fetch(`/api/splitwise/groups?address=${activeAddress}&all=true`)
      if (!res.ok) throw new Error('Failed to load groups')
      const data: GroupData[] = await res.json()
      setGroups(data)

      // Load expenses for all groups
      const expMap: Record<number, ExpenseData[]> = {}
      for (const g of data) {
        try {
          const expRes = await fetch(`/api/splitwise/expenses?appId=${g.appId}&groupId=${g.groupId}`)
          if (expRes.ok) {
            expMap[g.groupId] = await expRes.json()
          }
        } catch {
          // skip
        }
      }
      setExpenses(expMap)
    } catch {
      // No groups yet
    } finally {
      setLoadingGroups(false)
    }
  }, [activeAddress])

  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  const toggleExpand = (groupId: number) => {
    if (expandedGroup === groupId) {
      setExpandedGroup(null)
    } else {
      setExpandedGroup(groupId)
      setExpDesc('')
      setExpAmount('')
      setExpParticipants([])
    }
  }

  const toggleParticipant = (addr: string) => {
    setExpParticipants((prev) =>
      prev.includes(addr) ? prev.filter((a) => a !== addr) : [...prev, addr],
    )
  }

  const addExpense = async (group: GroupData) => {
    try {
      if (!expAmount || Number(expAmount) <= 0) {
        enqueueSnackbar('Amount must be positive', { variant: 'warning' })
        return
      }
      if (expParticipants.length === 0) {
        enqueueSnackbar('Select at least one participant who owes', { variant: 'warning' })
        return
      }

      setLoadingAction(true)
      const client = getClient(group.appId)
      const amountMicro = Math.round(Number(expAmount) * 1_000_000)

      // Guess next expense_id
      const countBig = await client.state.global.expenseCount()
      const nextExpId = Number(countBig ?? 0) + 1

      const p1 = expParticipants[0] || ZERO_ADDR
      const p2 = expParticipants[1] || ZERO_ADDR
      const p3 = expParticipants[2] || ZERO_ADDR

      // Build all box references for add_expense:
      // eg, ep, ea, es, en, sc (keyed by expense_id) = 6
      // xp (expense_id * 2^16 + index) for each participant = up to 3
      // ig (read for member verification) for each participant = up to 3
      // gc (read for group existence check) = 1
      // ga (read for group active check) = 1
      // ig for sender (member check) = 1
      const allBoxes: Uint8Array[] = [
        encodeBoxName('eg', nextExpId),
        encodeBoxName('ep', nextExpId),
        encodeBoxName('ea', nextExpId),
        encodeBoxName('es', nextExpId),
        encodeBoxName('en', nextExpId),
        encodeBoxName('sc', nextExpId),
        encodeBoxName('gc', group.groupId),
        encodeBoxName('ga', group.groupId),
        encodeMemberBoxName('ig', group.groupId, activeAddress!),
      ]

      // xp + ig boxes for each participant
      for (let i = 0; i < expParticipants.length; i++) {
        allBoxes.push(encodeBoxName('xp', nextExpId * 65536 + i))
        allBoxes.push(encodeMemberBoxName('ig', group.groupId, expParticipants[i]))
      }

      // Split across pad() + addExpense() (8 + remainder)
      const padBoxes = allBoxes.slice(0, 8)
      const addBoxes = allBoxes.slice(8)

      // Build MBR payment
      const sp = await algorand.client.algod.getTransactionParams().do()
      const mbrTxn = makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress!,
        receiver: getApplicationAddress(group.appId),
        amount: 400_000,
        suggestedParams: sp,
      })

      const res = await client.newGroup()
        .pad({
          args: [],
          sender: activeAddress!,
          boxReferences: padBoxes,
        })
        .addExpense({
          args: {
            groupId: BigInt(group.groupId),
            amount: BigInt(amountMicro),
            participant1: p1,
            participant2: p2,
            participant3: p3,
            mbrPay: { txn: mbrTxn, signer: transactionSigner },
          },
          sender: activeAddress!,
          extraFee: microAlgos(2000),
          boxReferences: addBoxes,
        })
        .send()

      const expenseId = Number(res.returns[1])
      const sharePerPerson = Math.floor(amountMicro / expParticipants.length)

      // Save to backend
      await fetch('/api/splitwise/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenseId,
          appId: group.appId,
          groupId: group.groupId,
          description: expDesc.trim(),
          amount: amountMicro,
          payer: activeAddress,
          participants: expParticipants,
          sharePerPerson,
        }),
      })

      enqueueSnackbar(`Expense added! Each person owes ${(sharePerPerson / 1_000_000).toFixed(3)} ALGO`, { variant: 'success' })

      // Reset form and reload
      setExpDesc('')
      setExpAmount('')
      setExpParticipants([])
      await loadGroups()
    } catch (e) {
      enqueueSnackbar(`Add expense failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoadingAction(false)
    }
  }

  const settleExpense = async (expense: ExpenseData, group: GroupData) => {
    try {
      setLoadingAction(true)
      const client = getClient(expense.appId)

      // Build box references for settle_expense:
      // ep (expense_payer), es (expense_share), en (participant_count),
      // sc (settled_count), hs (settlement key for sender),
      // xp (participant entries to verify caller)
      const allBoxes: Uint8Array[] = [
        encodeBoxName('ep', expense.expenseId),
        encodeBoxName('es', expense.expenseId),
        encodeBoxName('en', expense.expenseId),
        encodeBoxName('sc', expense.expenseId),
        encodeMemberBoxName('hs', expense.expenseId, activeAddress!),
      ]
      // xp boxes for participant iteration
      for (let i = 0; i < expense.participants.length; i++) {
        allBoxes.push(encodeBoxName('xp', expense.expenseId * 65536 + i))
      }

      // The payer is who we need to pay
      const sp = await algorand.client.algod.getTransactionParams().do()
      const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress!,
        receiver: expense.payer,
        amount: expense.sharePerPerson,
        suggestedParams: sp,
      })

      await client.send.settleExpense({
        args: {
          expenseId: BigInt(expense.expenseId),
          payTxn: { txn: payTxn, signer: transactionSigner },
        },
        sender: activeAddress!,
        boxReferences: allBoxes,
      })

      // Update backend
      await fetch(`/api/splitwise/expenses/${expense._id}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: activeAddress }),
      })

      enqueueSnackbar(`Settled! Paid ${(expense.sharePerPerson / 1_000_000).toFixed(3)} ALGO to ${getMemberName(expense.payer, group)}`, { variant: 'success' })
      await loadGroups()
    } catch (e) {
      enqueueSnackbar(`Settle failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoadingAction(false)
    }
  }

  const closeGroup = async (group: GroupData) => {
    try {
      setLoadingAction(true)
      const client = getClient(group.appId)

      await client.send.closeGroup({
        args: { groupId: BigInt(group.groupId) },
        sender: activeAddress!,
        boxReferences: [
          encodeBoxName('gc', group.groupId),
          encodeBoxName('ga', group.groupId),
        ],
      })

      // Update backend
      await fetch(`/api/splitwise/groups/${group._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      })

      enqueueSnackbar(`Group "${group.name}" closed`, { variant: 'success' })
      await loadGroups()
    } catch (e) {
      enqueueSnackbar(`Close failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoadingAction(false)
    }
  }

  if (loadingGroups) {
    return (
      <div className="text-center py-8 font-xp-body text-sm text-gray-500">
        Loading your groups...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h2 className="font-xp-body text-sm font-bold">My Groups</h2>
        <button className="xp-btn text-xs" onClick={onNavigateToCreate}>
          + New Group
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-8 font-xp-body text-sm text-gray-500">
          <p>You don't have any groups yet.</p>
          <button className="xp-btn mt-3" onClick={onNavigateToCreate}>
            Create Your First Group
          </button>
        </div>
      ) : (
        groups.map((group) => {
          const groupExpenses = expenses[group.groupId] || []
          const isExpanded = expandedGroup === group.groupId

          return (
            <XpWindow
              key={group._id}
              title={`${group.name} ${!group.active ? '(Closed)' : ''}`}
              showControls={false}
            >
              <div className="flex flex-col gap-3">
                {/* Members row */}
                <div className="flex flex-wrap gap-2">
                  {group.members.map((m) => (
                    <span
                      key={m.address}
                      className="text-xs font-xp-body px-2 py-1 rounded"
                      style={{
                        backgroundColor: m.address === activeAddress ? '#316AC5' : '#D4D0C8',
                        color: m.address === activeAddress ? '#fff' : '#000',
                      }}
                      title={m.address}
                    >
                      {m.name}
                    </span>
                  ))}
                </div>

                {/* Expenses list */}
                {groupExpenses.length > 0 && (
                  <div
                    className="flex flex-col gap-2"
                    style={{ borderTop: '1px solid #808080', paddingTop: '8px' }}
                  >
                    <div className="font-xp-body text-xs font-semibold text-gray-600">Expenses</div>
                    {groupExpenses.map((exp) => {
                      const allSettled = exp.participants.every((p) => exp.settledBy.includes(p))
                      const iOwe =
                        exp.participants.includes(activeAddress!) &&
                        !exp.settledBy.includes(activeAddress!) &&
                        exp.payer !== activeAddress
                      const iPaid = exp.payer === activeAddress

                      return (
                        <div
                          key={exp._id}
                          className="text-xs font-xp-body p-2 rounded"
                          style={{
                            backgroundColor: allSettled ? '#E8F5E9' : '#FFF8E1',
                            border: `1px solid ${allSettled ? '#A5D6A7' : '#FFE082'}`,
                          }}
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="font-bold">
                                {exp.description || `Expense #${exp.expenseId}`}
                              </div>
                              <div className="text-gray-600 mt-1">
                                <span className="font-semibold">{getMemberName(exp.payer, group)}</span> paid{' '}
                                <span className="font-mono font-bold">
                                  {(exp.amount / 1_000_000).toFixed(3)} ALGO
                                </span>
                              </div>
                              <div className="text-gray-500 mt-1">
                                Split between:{' '}
                                {exp.participants.map((p, i) => (
                                  <span key={p}>
                                    {i > 0 && ', '}
                                    <span
                                      style={{
                                        textDecoration: exp.settledBy.includes(p) ? 'line-through' : 'none',
                                        color: exp.settledBy.includes(p) ? '#4CAF50' : '#333',
                                      }}
                                    >
                                      {getMemberName(p, group)}
                                    </span>
                                  </span>
                                ))}
                              </div>
                              <div className="text-gray-500">
                                Share: <span className="font-mono">{(exp.sharePerPerson / 1_000_000).toFixed(3)} ALGO</span>
                                {' | '}
                                {allSettled ? (
                                  <span style={{ color: '#4CAF50' }}>All settled</span>
                                ) : (
                                  <span style={{ color: '#F57C00' }}>
                                    {exp.settledBy.length}/{exp.participants.length} settled
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Settle button */}
                            {iOwe && group.active && (
                              <button
                                className="xp-btn text-xs ml-2"
                                disabled={loadingAction}
                                onClick={() => settleExpense(exp, group)}
                              >
                                {loadingAction ? '...' : `Pay ${(exp.sharePerPerson / 1_000_000).toFixed(3)}`}
                              </button>
                            )}
                            {iPaid && !allSettled && (
                              <span
                                className="text-xs font-xp-body ml-2 px-2 py-1"
                                style={{ backgroundColor: '#E3F2FD', borderRadius: '4px' }}
                              >
                                You paid
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Action buttons */}
                {group.active && (
                  <div className="flex gap-2" style={{ borderTop: '1px solid #808080', paddingTop: '8px' }}>
                    <button
                      className="xp-btn text-xs flex-1"
                      onClick={() => toggleExpand(group.groupId)}
                    >
                      {isExpanded ? 'Cancel' : '+ Add Expense'}
                    </button>
                    {group.creator === activeAddress && (
                      <button
                        className="xp-btn text-xs"
                        style={{ color: '#c00' }}
                        disabled={loadingAction}
                        onClick={() => closeGroup(group)}
                      >
                        Close Group
                      </button>
                    )}
                  </div>
                )}

                {/* Add expense form (expanded) */}
                {isExpanded && group.active && (
                  <div
                    className="flex flex-col gap-2 p-3 rounded"
                    style={{ backgroundColor: '#F5F5F5', border: '1px solid #ccc' }}
                  >
                    <div className="font-xp-body text-xs font-semibold">New Expense</div>
                    <input
                      className="xp-input"
                      placeholder="Description (e.g. Lunch at campus cafe)"
                      value={expDesc}
                      onChange={(e) => setExpDesc(e.target.value)}
                    />
                    <input
                      className="xp-input"
                      placeholder="Total Amount (ALGO)"
                      type="number"
                      step="0.001"
                      min="0"
                      value={expAmount}
                      onChange={(e) => setExpAmount(e.target.value)}
                    />

                    <div className="font-xp-body text-xs text-gray-600">
                      Who owes? (select participants, excluding yourself as payer)
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.members
                        .filter((m) => m.address !== activeAddress)
                        .map((m) => (
                          <button
                            key={m.address}
                            className="text-xs font-xp-body px-2 py-1 rounded cursor-pointer"
                            style={{
                              backgroundColor: expParticipants.includes(m.address)
                                ? '#316AC5'
                                : '#D4D0C8',
                              color: expParticipants.includes(m.address) ? '#fff' : '#000',
                              border: '1px solid #808080',
                            }}
                            onClick={() => toggleParticipant(m.address)}
                          >
                            {m.name}
                          </button>
                        ))}
                    </div>

                    {expAmount && Number(expAmount) > 0 && expParticipants.length > 0 && (
                      <div className="text-xs font-xp-body text-gray-600">
                        Each person pays:{' '}
                        <span className="font-mono font-bold">
                          {(Number(expAmount) / expParticipants.length).toFixed(3)} ALGO
                        </span>
                      </div>
                    )}

                    <button
                      className="xp-btn text-xs"
                      disabled={loadingAction || !expAmount || expParticipants.length === 0}
                      onClick={() => addExpense(group)}
                    >
                      {loadingAction ? 'Adding...' : 'Add Expense'}
                    </button>
                  </div>
                )}
              </div>
            </XpWindow>
          )
        })
      )}
    </div>
  )
}

export default SplitwiseTab
