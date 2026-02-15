import { useState, useEffect } from 'react'
import { useSnackbar } from 'notistack'
import { getApplicationAddress, makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk'
import { microAlgos } from '@algorandfoundation/algokit-utils'
import { useAlgorand } from '../hooks/useAlgorand'
import { LaunchpadClient, LaunchpadFactory } from '../contracts/Launchpad'
import XpWindow from './XpWindow'

const MBR_AMOUNT = 400_000

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

interface CreateProjectTabProps {
  onBack: () => void
}

const CreateProjectTab = ({ onBack }: CreateProjectTabProps) => {
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
        const res = await fetch('/api/projects?all=true')
        if (res.ok) {
          const projects = await res.json()
          if (projects.length > 0) {
            setAppId(String(projects[0].appId))
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

  // Form fields
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [goalAlgo, setGoalAlgo] = useState('')
  const [deadline, setDeadline] = useState('')

  const getClient = () => {
    if (!appId || !activeAddress) throw new Error('Set App ID and connect wallet')
    return new LaunchpadClient({
      appId: BigInt(appId),
      algorand,
      defaultSigner: transactionSigner,
    })
  }

  const deploy = async () => {
    try {
      if (!activeAddress) throw new Error('Connect wallet')
      setDeploying(true)
      const factory = new LaunchpadFactory({ defaultSender: activeAddress, algorand })
      const res = await factory.send.create.bare()
      const id = String(res.appClient.appClient.appId)
      setAppId(id)
      enqueueSnackbar(`Launchpad deployed. App ID: ${id}`, { variant: 'success' })
    } catch (e) {
      enqueueSnackbar(`Deploy failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setDeploying(false)
    }
  }

  const createProject = async () => {
    try {
      if (!title.trim()) {
        enqueueSnackbar('Project title is required', { variant: 'warning' })
        return
      }
      if (!goalAlgo || Number(goalAlgo) <= 0) {
        enqueueSnackbar('Goal must be positive', { variant: 'warning' })
        return
      }
      if (!deadline) {
        enqueueSnackbar('Deadline is required', { variant: 'warning' })
        return
      }

      setLoading(true)
      const client = getClient()

      const deadlineTimestamp = Math.floor(new Date(deadline).getTime() / 1000)
      const goalMicro = Math.round(Number(goalAlgo) * 1_000_000)

      // Build MBR payment
      const sp = await algorand.client.algod.getTransactionParams().do()
      const mbrTxn = makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress!,
        receiver: getApplicationAddress(Number(appId)),
        amount: MBR_AMOUNT,
        suggestedParams: sp,
      })

      // Get next project ID
      const countBig = await client.state.global.projectCount()
      const nextId = Number(countBig ?? 0) + 1

      // 5 boxes for create_project: pc, pg, pd, pr, ps
      const allBoxes = ['pc', 'pg', 'pd', 'pr', 'ps'].map((p) => encodeBoxName(p, nextId))

      const res = await client.send.createProject({
        args: {
          goal: BigInt(goalMicro),
          deadline: BigInt(deadlineTimestamp),
          mbrPay: { txn: mbrTxn, signer: transactionSigner },
        },
        sender: activeAddress!,
        extraFee: microAlgos(1000),
        boxReferences: allBoxes,
        populateAppCallResources: false,
      })

      const projectId = Number(res.return!)

      // Save metadata to backend DB
      const apiRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          appId: Number(appId),
          title: title.trim(),
          description: description.trim(),
          creator: activeAddress,
          goal: goalMicro,
          deadline,
        }),
      })

      if (!apiRes.ok) {
        const errBody = await apiRes.json().catch(() => ({}))
        throw new Error(errBody.error || 'Failed to save project to database')
      }

      enqueueSnackbar(`Project #${projectId} created: "${title.trim()}"`, { variant: 'success' })

      // Reset form
      setTitle('')
      setDescription('')
      setGoalAlgo('')
      setDeadline('')
    } catch (e) {
      enqueueSnackbar(`Create project failed: ${(e as Error).message}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button className="xp-btn text-xs self-start" onClick={onBack}>
        &larr; Back to Launchpad
      </button>

      <XpWindow title="Launch New Project" showControls={false}>
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
                  Using Launchpad contract: <span className="font-mono font-bold">{appId}</span>
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
            placeholder="Project Title *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="xp-input"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <input
            className="xp-input"
            placeholder="Funding Goal (ALGO) *"
            type="number"
            step="0.001"
            min="0"
            value={goalAlgo}
            onChange={(e) => setGoalAlgo(e.target.value)}
          />

          <div>
            <label className="font-xp-body text-xs text-gray-600 block mb-1">Funding Deadline *</label>
            <input
              className="xp-input"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>

          <button
            className="xp-btn"
            disabled={loading || !appId || !activeAddress || !title || !goalAlgo || !deadline}
            onClick={createProject}
          >
            {loading ? 'Launching Project...' : 'Launch Project'}
          </button>
        </div>
      </XpWindow>
    </div>
  )
}

export default CreateProjectTab
