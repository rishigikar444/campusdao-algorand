import mongoose, { Schema, Document } from 'mongoose'

export interface ISplitExpense extends Document {
  expenseId: number       // on-chain expense_id
  appId: number           // Splitwise contract app ID
  groupId: number         // on-chain group_id
  description: string     // human-readable description
  amount: number          // total amount in microAlgos
  payer: string           // wallet address of who paid
  participants: string[]  // wallet addresses of who owes
  sharePerPerson: number  // amount / participant_count in microAlgos
  settledBy: string[]     // wallet addresses who have settled
  createdAt: Date
  updatedAt: Date
}

const SplitExpenseSchema = new Schema<ISplitExpense>(
  {
    expenseId: { type: Number, required: true },
    appId: { type: Number, required: true },
    groupId: { type: Number, required: true },
    description: { type: String, default: '' },
    amount: { type: Number, required: true },
    payer: { type: String, required: true },
    participants: { type: [String], required: true },
    sharePerPerson: { type: Number, required: true },
    settledBy: { type: [String], default: [] },
  },
  { timestamps: true },
)

SplitExpenseSchema.index({ appId: 1, expenseId: 1 }, { unique: true })
SplitExpenseSchema.index({ appId: 1, groupId: 1 })

export default mongoose.model<ISplitExpense>('SplitExpense', SplitExpenseSchema)
