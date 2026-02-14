import mongoose, { Schema, Document } from 'mongoose'

export interface IMarket extends Document {
  // On-chain references
  marketId: number       // on-chain market_id returned by create_market
  appId: number          // PredictionMarket contract app ID

  // Metadata (stored off-chain for UX)
  question: string       // the prediction question
  description: string
  resolutionDate: Date   // when the market can be resolved

  // Mirrors of on-chain state (synced on create, updated as needed)
  creator: string        // wallet address
  priceScale: number     // price per share in microAlgos
  council1: string       // council member 1 wallet address
  council2: string       // council member 2 wallet address
  council3: string       // council member 3 wallet address
  resolved: boolean
  outcome: number        // 0 = NO, 1 = YES (only meaningful when resolved)

  createdAt: Date
  updatedAt: Date
}

const MarketSchema = new Schema<IMarket>(
  {
    marketId: { type: Number, required: true },
    appId: { type: Number, required: true },

    question: { type: String, required: true },
    description: { type: String, default: '' },
    resolutionDate: { type: Date, required: true },

    creator: { type: String, required: true },
    priceScale: { type: Number, required: true },
    council1: { type: String, required: true },
    council2: { type: String, required: true },
    council3: { type: String, required: true },
    resolved: { type: Boolean, default: false },
    outcome: { type: Number, default: 0 },
  },
  { timestamps: true },
)

MarketSchema.index({ appId: 1, marketId: 1 }, { unique: true })

export default mongoose.model<IMarket>('Market', MarketSchema)
