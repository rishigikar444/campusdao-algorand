import mongoose, { Schema, Document } from 'mongoose'

export interface IMember {
  name: string
  address: string
}

export interface ISplitGroup extends Document {
  groupId: number        // on-chain group_id returned by create_group
  appId: number          // Splitwise contract app ID
  name: string           // friendly group name
  creator: string        // wallet address of group creator
  members: IMember[]     // name↔address mappings for all members
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const MemberSchema = new Schema<IMember>(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
  },
  { _id: false },
)

const SplitGroupSchema = new Schema<ISplitGroup>(
  {
    groupId: { type: Number, required: true },
    appId: { type: Number, required: true },
    name: { type: String, required: true },
    creator: { type: String, required: true },
    members: { type: [MemberSchema], required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

SplitGroupSchema.index({ appId: 1, groupId: 1 }, { unique: true })
SplitGroupSchema.index({ 'members.address': 1 })

export default mongoose.model<ISplitGroup>('SplitGroup', SplitGroupSchema)
