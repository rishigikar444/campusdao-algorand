import mongoose, { Schema, Document } from 'mongoose'

export interface IProject extends Document {
  // On-chain references
  projectId: number       // on-chain project_id returned by create_project
  appId: number           // Launchpad contract app ID

  // Metadata (stored off-chain for UX)
  title: string
  description: string
  creator: string         // wallet address
  goal: number            // goal in microAlgos
  deadline: Date          // project funding deadline

  // Mirrors of on-chain state (synced on create, updated as needed)
  raised: number          // total raised in microAlgos
  status: number          // 0=active, 1=funded/claimed, 2=failed

  createdAt: Date
  updatedAt: Date
}

const ProjectSchema = new Schema<IProject>(
  {
    projectId: { type: Number, required: true },
    appId: { type: Number, required: true },

    title: { type: String, required: true },
    description: { type: String, default: '' },
    creator: { type: String, required: true },
    goal: { type: Number, required: true },
    deadline: { type: Date, required: true },

    raised: { type: Number, default: 0 },
    status: { type: Number, default: 0 },
  },
  { timestamps: true },
)

ProjectSchema.index({ appId: 1, projectId: 1 }, { unique: true })

export default mongoose.model<IProject>('Project', ProjectSchema)
