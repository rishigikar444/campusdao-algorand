import { useState, useEffect } from 'react'
import { useSnackbar } from 'notistack'
import { getApplicationAddress, makePaymentTxnWithSuggestedParamsFromObject, decodeAddress } from 'algosdk'
import { microAlgos } from '@algorandfoundation/algokit-utils'
import { useAlgorand } from '../hooks/useAlgorand'
import { SplitwiseClient, SplitwiseFactory } from '../contracts/Splitwise'
import XpWindow from './XpWindow'

const ZERO_ADDR = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'
const MBR_AMOUNT = 400_000

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

// Encode a composite box key: prefix + 8-byte id + 32-byte address public key
const encodeMemberBoxName = (prefix: string, groupId: number, address: string): Uint8Array => {
  const prefixBytes = new TextEncoder().encode(prefix)
  const idBytes = new Uint8Array(8)
  new DataView(idBytes.buffer).setBigUint64(0, BigInt(groupId))
  const addrBytes = decodeAddress(address).publicKey
  const combined = new Uint8Array(prefixBytes.length + 8 + 32)
  combined.set(prefixBytes)
  combined.set(idBytes, prefixBytes.length)
  combined.set(addrBytes, prefixBytes.length + 8)
  return combined
}

interface CreateGroupTabProps {
  onBack: () => void
}

const CreateGroupTab = ({ onBack }: CreateGroupTabProps) => {
  const { enqueueSnackbar } = useSnackbar()
  const { algorand, activeAddress, transactionSigner } = useAlgorand()

  const [appId, setAppId] = useState('')
  const [appIdLoading, setAppIdLoading] = useState(true)
  const [deploying, setDeploying] = useState(false)
  const [loading, setLoading] = useState(false)

  // Form fields
  const [groupName, setGroupName] = useState('')
  const [myName, setMyName] = useState('')
  const [member1Name, setMember1Name] = useState('')
  const [member1Addr, setMember1Addr] = useState('')
  const [member2Name, setMember2Name] = useState('')
  const [member2Addr, setMember2Addr] = useState('')
  const [member3Name, setMember3Name] = useState('')
  const [member3Addr, setMember3Addr] = useState('')

  // On mount, try to find an existing App ID from the DB
  useEffect(() => {
    const fetchExistingAppId = async () => {
      try {
        const res = await fetch('/api/splitwise/groups?all=true')
        if (res.ok) {
          const groups = await res.json()
          if (groups.length > 0) {
            setAppId(String(groups[0].appId))
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
    if (!appId || !activeAddress) throw new Error('Set App ID and connect wallet')
    return new SplitwiseClient({
      appId: BigInt(appId),
      algorand,
      defaultSigner: transactionSigner,
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
      if (!groupName.trim()) {
        enqueueSnackbar('Group name is required', { variant: 'warning' })
        return
      }
      if (!myName.trim()) {
        enqueueSnackbar('Your name is required', { variant: 'warning' })
        return
      }

      setLoading(true)
      const client = getClient()

      // Guess next group_id
      const countBig = await client.state.global.groupCount()
      const nextId = Number(countBig ?? 0) + 1

      // Collect member addresses for box refs
      const memberAddrs = [activeAddress!] // creator is always member 0
      const m1 = member1Addr.trim() || ''
      const m2 = member2Addr.trim() || ''
      const m3 = member3Addr.trim() || ''
      if (m1) memberAddrs.push(m1)
      if (m2) memberAddrs.push(m2)
      if (m3) memberAddrs.push(m3)

      // Build all box references:
      // gc, gn, ga (keyed by group_id) = 3 boxes
      // gm (group_id * 2^16 + index) for each member = up to 4 boxes
      // ig (concat(group_id, account)) for each member = up to 4 boxes
      // Total worst case: 11 boxes
      const allBoxes: Uint8Array[] = [
        encodeBoxName('gc', nextId),
        encodeBoxName('gn', nextId),
        encodeBoxName('ga', nextId),
      ]

      // gm boxes for each member index
      for (let i = 0; i < memberAddrs.length; i++) {
        allBoxes.push(encodeBoxName('gm', nextId * 65536 + i))
      }

      // ig boxes for each member
      for (const addr of memberAddrs) {
        allBoxes.push(encodeMemberBoxName('ig', nextId, addr))
      }

      // Split across pad() + createGroup() (8 + remainder)
      const padBoxes = allBoxes.slice(0, 8)
      const createBoxes = allBoxes.slice(8)

      // Build MBR payment
      const sp = await algorand.client.algod.getTransactionParams().do()
      const mbrTxn = makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress!,
        receiver: getApplicationAddress(Number(appId)),
        amount: MBR_AMOUNT,
        suggestedParams: sp,
      })

      // On-chain call using composer: pad() + createGroup()
      const res = await client.newGroup()
        .pad({
          args: [],
          sender: activeAddress!,
          boxReferences: padBoxes,
        })
        .createGroup({
          args: {
            member1: m1 || ZERO_ADDR,
            member2: m2 || ZERO_ADDR,
            member3: m3 || ZERO_ADDR,
            mbrPay: { txn: mbrTxn, signer: transactionSigner },
          },
          sender: activeAddress!,
          extraFee: microAlgos(2000),
          boxReferences: createBoxes,
        })
        .send()

      const groupId = Number(res.returns[1])

      // Build member list for backend
      const members = [{ name: myName.trim(), address: activeAddress! }]
      if (member1Addr.trim()) {
        members.push({ name: member1Name.trim() || `Member ${members.length + 1}`, address: member1Addr.trim() })
      }
      if (member2Addr.trim()) {
        members.push({ name: member2Name.trim() || `Member ${members.length + 1}`, address: member2Addr.trim() })
      }
      if (member3Addr.trim()) {
        members.push({ name: member3Name.trim() || `Member ${members.length + 1}`, address: member3Addr.trim() })
      }

      // Save to backend
      const apiRes = await fetch('/api/splitwise/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId,
          appId: Number(appId),
          name: groupName.trim(),
          creator: activeAddress,
          members,
        }),
      })

      if (!apiRes.ok) {
        const errBody = await apiRes.json().catch(() => ({}))
        throw new Error(errBody.error || 'Failed to save group to database')
      }

      enqueueSnackbar(`Group "${groupName.trim()}" created! ID: ${groupId}`, { variant: 'success' })

      // Reset form
      setGroupName('')
      setMyName('')
      setMember1Name('')
      setMember1Addr('')
      setMember2Name('')
      setMember2Addr('')
      setMember3Name('')
      setMember3Addr('')
    } catch (e) {
      enqueueSnackbar(`Create group failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button className="xp-btn text-xs self-start" onClick={onBack}>
        &larr; Back to Splitwise
      </button>

      <XpWindow title="Create New Group" showControls={false}>
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
                <p className="text-xs font-xp-body text-gray-500">
                  Using Splitwise contract: <span className="font-mono font-bold">{appId}</span>
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
                  {deploying ? 'Deploying...' : 'Deploy New'}
                </button>
              </div>
            </div>
          )}

          <input
            className="xp-input"
            placeholder="Group Name *"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />

          {/* Creator (you) */}
          <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '8px' }}>
            <label className="font-xp-body text-xs text-gray-600 block mb-1">Your Name *</label>
            <input
              className="xp-input"
              placeholder="Your name"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
            />
            <div className="text-xs font-xp-body text-gray-400 mt-1">
              Wallet: {activeAddress ? `${activeAddress.slice(0, 8)}...${activeAddress.slice(-4)}` : 'Not connected'}
            </div>
          </div>

          {/* Member 1 */}
          <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '8px' }}>
            <label className="font-xp-body text-xs text-gray-600 block mb-1">Member 2 (optional)</label>
            <div className="flex gap-2">
              <input
                className="xp-input flex-1"
                placeholder="Name"
                value={member1Name}
                onChange={(e) => setMember1Name(e.target.value)}
              />
              <input
                className="xp-input flex-[2]"
                placeholder="Wallet Address"
                value={member1Addr}
                onChange={(e) => setMember1Addr(e.target.value)}
              />
            </div>
          </div>

          {/* Member 2 */}
          <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '8px' }}>
            <label className="font-xp-body text-xs text-gray-600 block mb-1">Member 3 (optional)</label>
            <div className="flex gap-2">
              <input
                className="xp-input flex-1"
                placeholder="Name"
                value={member2Name}
                onChange={(e) => setMember2Name(e.target.value)}
              />
              <input
                className="xp-input flex-[2]"
                placeholder="Wallet Address"
                value={member2Addr}
                onChange={(e) => setMember2Addr(e.target.value)}
              />
            </div>
          </div>

          {/* Member 3 */}
          <div>
            <label className="font-xp-body text-xs text-gray-600 block mb-1">Member 4 (optional)</label>
            <div className="flex gap-2">
              <input
                className="xp-input flex-1"
                placeholder="Name"
                value={member3Name}
                onChange={(e) => setMember3Name(e.target.value)}
              />
              <input
                className="xp-input flex-[2]"
                placeholder="Wallet Address"
                value={member3Addr}
                onChange={(e) => setMember3Addr(e.target.value)}
              />
            </div>
          </div>

          <button
            className="xp-btn"
            disabled={loading || !appId || !activeAddress || !groupName || !myName}
            onClick={createGroup}
          >
            {loading ? 'Creating Group...' : 'Create Group'}
          </button>
        </div>
      </XpWindow>
    </div>
  )
}

export default CreateGroupTab
