import mongoose, { Schema, Document } from 'mongoose'

export interface IEvent extends Document {
  // On-chain references
  eventId: number        // on-chain event_id returned by create_event
  appId: number          // EventManager contract app ID
  ticketAsaId?: number   // ASA ID once tickets are minted

  // Metadata (stored off-chain for UX)
  name: string
  description: string
  imageUrl: string
  eventDate: Date        // date the event takes place

  // Mirrors of on-chain state (synced on create, updated as needed)
  organizer: string      // wallet address
  clubAppId: number
  ticketPrice: number    // in microAlgos
  maxSupply: number
  soldCount: number
  saleActive: boolean

  createdAt: Date
  updatedAt: Date
}

const EventSchema = new Schema<IEvent>(
  {
    eventId: { type: Number, required: true },
    appId: { type: Number, required: true },
    ticketAsaId: { type: Number, default: null },

    name: { type: String, required: true },
    description: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    eventDate: { type: Date, required: true },

    organizer: { type: String, required: true },
    clubAppId: { type: Number, default: 0 },
    ticketPrice: { type: Number, required: true },
    maxSupply: { type: Number, required: true },
    soldCount: { type: Number, default: 0 },
    saleActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

EventSchema.index({ appId: 1, eventId: 1 }, { unique: true })

export default mongoose.model<IEvent>('Event', EventSchema)
