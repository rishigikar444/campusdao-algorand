import { useState, useEffect } from 'react'
import { useSnackbar } from 'notistack'
import { getApplicationAddress, makePaymentTxnWithSuggestedParamsFromObject, decodeAddress } from 'algosdk'
import { microAlgos } from '@algorandfoundation/algokit-utils'
import { useAlgorand } from '../hooks/useAlgorand'
import { LaunchpadClient } from '../contracts/Launchpad'
import XpWindow from './XpWindow'

interface ProjectMeta {
  _id: string
  projectId: number
  appId: number
  title: string
  description: string
  creator: string
  goal: number
  deadline: string
}

interface ProjectData {
  projectId: number
  title: string
  description: string
  creator: string
  goal: number
  deadline: number // unix timestamp
  raised: number
  status: number // 0=active, 1=funded, 2=failed
  userPledge: number
}

interface LaunchpadTabProps {
  onNavigateToCreate: () => void
}

// Encode a BoxMap key: prefix bytes + 8-byte big-endian uint64
const encodeBoxName = (prefix: string, projectId: number): Uint8Array => {
  const prefixBytes = new TextEncoder().encode(prefix)
  const idBytes = new Uint8Array(8)
  new DataView(idBytes.buffer).setBigUint64(0, BigInt(projectId))
  const combined = new Uint8Array(prefixBytes.length + 8)
  combined.set(prefixBytes)
  combined.set(idBytes, prefixBytes.length)
  return combined
}

// Encode a composite pledge key: prefix + itob(projectId) + account bytes
const encodePledgeBoxName = (prefix: string, projectId: number, address: string): Uint8Array => {
  const prefixBytes = new TextEncoder().encode(prefix)
  const idBytes = new Uint8Array(8)
  new DataView(idBytes.buffer).setBigUint64(0, BigInt(projectId))
  const addrBytes = decodeAddress(address).publicKey
  const combined = new Uint8Array(prefixBytes.length + 8 + 32)
  combined.set(prefixBytes)
  combined.set(idBytes, prefixBytes.length)
  combined.set(addrBytes, prefixBytes.length + 8)
  return combined
}

// Progress bar component
const FundingBar = ({ raised, goal }: { raised: number; goal: number }) => {
  const pct = goal > 0 ? Math.min((raised / goal) * 100, 100) : 0

  return (
    <svg width="100%" height="28" viewBox="0 0 300 28" preserveAspectRatio="none">
      <rect x="0" y="0" width="300" height="28" fill="#E0E0E0" rx="3" />
      <rect x="0" y="0" width={pct * 3} height="28" fill="#4CAF50" rx="3" />
      <text x="150" y="18" textAnchor="middle" fill={pct > 50 ? 'white' : '#333'} fontSize="11" fontWeight="bold">
        {pct.toFixed(1)}% funded
      </text>
    </svg>
  )
}

const LaunchpadTab = ({ onNavigateToCreate }: LaunchpadTabProps) => {
  const { enqueueSnackbar } = useSnackbar()
  const { algorand, activeAddress, transactionSigner } = useAlgorand()

  const [appId, setAppId] = useState('')
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [loading, setLoading] = useState(true)
  const [fundAmounts, setFundAmounts] = useState<Record<number, string>>({})
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const getClient = (id: string) => {
    return new LaunchpadClient({
      appId: BigInt(id),
      algorand,
      defaultSigner: transactionSigner,
    })
  }

  const loadProjects = async (resolvedAppId?: string) => {
    const currentAppId = resolvedAppId || appId
    try {
      setLoading(true)

      const metaRes = await fetch('/api/projects?all=true')
      if (!metaRes.ok) {
        setProjects([])
        return
      }
      const metaList: ProjectMeta[] = await metaRes.json()

      if (metaList.length === 0) {
        setProjects([])
        return
      }

      const effectiveAppId = currentAppId || String(metaList[0].appId)
      if (!currentAppId) setAppId(effectiveAppId)

      const filteredMeta = metaList.filter((m) => m.appId === Number(effectiveAppId))
      const metaMap = new Map(filteredMeta.map((m) => [m.projectId, m]))

      if (!activeAddress) {
        const loaded: ProjectData[] = Array.from(metaMap.values()).map((meta) => ({
          projectId: meta.projectId,
          title: meta.title,
          description: meta.description,
          creator: meta.creator,
          goal: meta.goal,
          deadline: Math.floor(new Date(meta.deadline).getTime() / 1000),
          raised: 0,
          status: 0,
          userPledge: 0,
        }))
        setProjects(loaded)
        return
      }

      const client = getClient(effectiveAppId)
      const countBig = await client.state.global.projectCount()
      const count = Number(countBig ?? 0)

      if (count === 0) {
        setProjects([])
        return
      }

      const loaded: ProjectData[] = []

      for (let i = 1; i <= count; i++) {
        try {
          const infoRes = await client.send.getProjectInfo({
            args: { projectId: BigInt(i) },
            sender: activeAddress,
            boxReferences: [
              encodeBoxName('pc', i),
              encodeBoxName('pg', i),
              encodeBoxName('pd', i),
              encodeBoxName('pr', i),
              encodeBoxName('ps', i),
            ],
            populateAppCallResources: false,
          })

          const [creator, goal, deadline, raised, status] = infoRes.return!

          let userPledge = 0
          try {
            const pledgeRes = await client.send.getPledge({
              args: { projectId: BigInt(i), account: activeAddress },
              sender: activeAddress,
              boxReferences: [
                encodePledgeBoxName('pl', i, activeAddress),
              ],
              populateAppCallResources: false,
            })
            userPledge = Number(pledgeRes.return!)
          } catch {
            // No pledge yet
          }

          const meta = metaMap.get(i)

          loaded.push({
            projectId: i,
            title: meta?.title || `Project #${i}`,
            description: meta?.description || '',
            creator: String(creator),
            goal: Number(goal),
            deadline: Number(deadline),
            raised: Number(raised),
            status: Number(status),
            userPledge,
          })
        } catch (err) {
          console.warn(`Failed to load project ${i}:`, err)
        }
      }

      setProjects(loaded)
    } catch (e) {
      console.warn('Failed to load projects:', e)
      setProjects([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [activeAddress])

  const fundProject = async (projectId: number) => {
    const amountStr = fundAmounts[projectId]
    const algoAmount = parseFloat(amountStr || '0')
    if (algoAmount <= 0) {
      enqueueSnackbar('Enter a valid ALGO amount', { variant: 'warning' })
      return
    }
    if (!activeAddress) {
      enqueueSnackbar('Connect your wallet first', { variant: 'warning' })
      return
    }

    const key = `fund-${projectId}`
    try {
      setActionLoading(key)
      const client = getClient(appId)

      const microAmount = Math.round(algoAmount * 1_000_000)

      const appAddr = getApplicationAddress(Number(appId))
      const sp = await algorand.client.algod.getTransactionParams().do()
      const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: appAddr,
        amount: microAmount,
        suggestedParams: sp,
      })

      const boxRefs = [
        encodeBoxName('pc', projectId),
        encodeBoxName('ps', projectId),
        encodeBoxName('pd', projectId),
        encodeBoxName('pr', projectId),
        encodePledgeBoxName('pl', projectId, activeAddress),
      ]

      await client.send.fundProject({
        args: { projectId: BigInt(projectId), payTxn: { txn: payTxn, signer: transactionSigner } },
        sender: activeAddress,
        boxReferences: boxRefs,
        populateAppCallResources: false,
      })

      enqueueSnackbar(`Pledged ${algoAmount} ALGO to project!`, { variant: 'success' })
      setFundAmounts((prev) => ({ ...prev, [projectId]: '' }))
      loadProjects()
    } catch (e) {
      enqueueSnackbar(`Fund failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const claimFunds = async (projectId: number) => {
    if (!activeAddress) return
    const key = `claim-${projectId}`
    try {
      setActionLoading(key)
      const client = getClient(appId)

      const boxRefs = [
        encodeBoxName('pc', projectId),
        encodeBoxName('ps', projectId),
        encodeBoxName('pr', projectId),
        encodeBoxName('pg', projectId),
      ]

      const res = await client.send.claimFunds({
        args: { projectId: BigInt(projectId) },
        sender: activeAddress,
        extraFee: microAlgos(1000),
        boxReferences: boxRefs,
        populateAppCallResources: false,
      })

      const payout = Number(res.return ?? 0)
      enqueueSnackbar(`Claimed ${(payout / 1_000_000).toFixed(6)} ALGO!`, { variant: 'success' })
      loadProjects()
    } catch (e) {
      enqueueSnackbar(`Claim failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const claimRefund = async (projectId: number) => {
    if (!activeAddress) return
    const key = `refund-${projectId}`
    try {
      setActionLoading(key)
      const client = getClient(appId)

      const boxRefs = [
        encodeBoxName('pc', projectId),
        encodeBoxName('ps', projectId),
        encodeBoxName('pd', projectId),
        encodeBoxName('pr', projectId),
        encodeBoxName('pg', projectId),
        encodePledgeBoxName('pl', projectId, activeAddress),
      ]

      const res = await client.send.refund({
        args: { projectId: BigInt(projectId) },
        sender: activeAddress,
        extraFee: microAlgos(1000),
        boxReferences: boxRefs,
        populateAppCallResources: false,
      })

      const refundAmt = Number(res.return ?? 0)
      enqueueSnackbar(`Refunded ${(refundAmt / 1_000_000).toFixed(6)} ALGO!`, { variant: 'success' })
      loadProjects()
    } catch (e) {
      enqueueSnackbar(`Refund failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const formatAlgo = (microAlgos: number) => {
    return (microAlgos / 1_000_000).toFixed(6)
  }

  const getStatusLabel = (status: number, raised: number, goal: number, deadline: number) => {
    if (status === 1) return { text: 'Funded', bg: '#E8F5E9', color: '#2E7D32' }
    if (status === 2) return { text: 'Failed', bg: '#FFEBEE', color: '#C62828' }
    const now = Math.floor(Date.now() / 1000)
    if (now > deadline && raised < goal) return { text: 'Expired', bg: '#FFEBEE', color: '#C62828' }
    return { text: 'Active', bg: '#E3F2FD', color: '#1565C0' }
  }

  return (
    <div className="flex flex-col gap-4">
      {loading ? (
        <div className="text-center py-12 font-xp-body text-sm text-gray-500">
          Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 font-xp-body text-sm text-gray-500">
          No projects yet. Launch one to get started!
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {projects.map((project) => {
            const isFunding = actionLoading === `fund-${project.projectId}`
            const isClaiming = actionLoading === `claim-${project.projectId}`
            const isRefunding = actionLoading === `refund-${project.projectId}`
            const statusLabel = getStatusLabel(project.status, project.raised, project.goal, project.deadline)
            const now = Math.floor(Date.now() / 1000)
            const isActive = project.status === 0 && now <= project.deadline
            const isCreator = activeAddress === project.creator
            const goalMet = project.raised >= project.goal
            const canClaim = isCreator && goalMet && project.status === 0
            const canRefund = !isCreator && project.userPledge > 0 && now > project.deadline && !goalMet && (project.status === 0 || project.status === 2)

            return (
              <XpWindow key={project.projectId} title={project.title} showControls={false}>
                <div className="flex flex-col gap-3">
                  {project.description && (
                    <div className="text-xs font-xp-body text-gray-600">{project.description}</div>
                  )}

                  {/* Status Badge + Deadline */}
                  <div className="flex items-center justify-between">
                    <span
                      className="text-xs font-bold px-2 py-1 rounded"
                      style={{ backgroundColor: statusLabel.bg, color: statusLabel.color }}
                    >
                      {statusLabel.text}
                    </span>
                    <span className="text-xs font-xp-body text-gray-500">
                      Deadline: {new Date(project.deadline * 1000).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <FundingBar raised={project.raised} goal={project.goal} />

                  {/* Stats Row */}
                  <div className="flex justify-between text-xs font-xp-body text-gray-600">
                    <span>Raised: {formatAlgo(project.raised)} ALGO</span>
                    <span>Goal: {formatAlgo(project.goal)} ALGO</span>
                  </div>

                  {/* User Pledge */}
                  {project.userPledge > 0 && (
                    <div
                      className="text-xs font-xp-body px-2 py-1 rounded"
                      style={{ backgroundColor: '#FFF3E0', border: '1px solid #FFB74D' }}
                    >
                      Your pledge: <strong>{formatAlgo(project.userPledge)} ALGO</strong>
                    </div>
                  )}

                  {/* Fund Input (active projects) */}
                  {isActive && (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1">
                        <input
                          className="xp-input flex-1"
                          type="number"
                          min="0.001"
                          step="0.001"
                          placeholder="ALGO amount"
                          value={fundAmounts[project.projectId] ?? ''}
                          onChange={(e) => setFundAmounts((prev) => ({ ...prev, [project.projectId]: e.target.value }))}
                        />
                        <button
                          className="xp-btn text-xs px-3"
                          style={{ backgroundColor: '#E8F5E9' }}
                          disabled={isFunding || !activeAddress}
                          onClick={() => fundProject(project.projectId)}
                        >
                          {isFunding ? '...' : 'Fund'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Claim Funds Button (creator, goal met) */}
                  {canClaim && (
                    <button
                      className="xp-btn text-xs"
                      style={{ backgroundColor: '#E8F5E9' }}
                      disabled={isClaiming || !activeAddress}
                      onClick={() => claimFunds(project.projectId)}
                    >
                      {isClaiming ? 'Claiming...' : 'Claim Funds'}
                    </button>
                  )}

                  {/* Refund Button (backer, deadline passed, goal not met) */}
                  {canRefund && (
                    <button
                      className="xp-btn text-xs"
                      style={{ backgroundColor: '#FFEBEE' }}
                      disabled={isRefunding || !activeAddress}
                      onClick={() => claimRefund(project.projectId)}
                    >
                      {isRefunding ? 'Refunding...' : 'Claim Refund'}
                    </button>
                  )}
                </div>
              </XpWindow>
            )
          })}
        </div>
      )}

      {/* Launch Project Button */}
      <div className="flex justify-center pt-2 pb-2">
        <button className="xp-btn text-xs px-4 py-1" onClick={onNavigateToCreate}>
          + Launch Project
        </button>
      </div>
    </div>
  )
}

export default LaunchpadTab
