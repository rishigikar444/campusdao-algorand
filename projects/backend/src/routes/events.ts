import { Router, Request, Response } from 'express'
import Event from '../models/Event.js'

const router = Router()

// GET /api/events — list upcoming/today events (soonest first)
// Pass ?all=true to include past events
router.get('/', async (req: Request, res: Response) => {
  try {
    const includePast = req.query.all === 'true'

    const filter: Record<string, unknown> = {}
    if (!includePast) {
      // Start of today in UTC so today's events are included
      const todayStart = new Date()
      todayStart.setUTCHours(0, 0, 0, 0)
      filter.eventDate = { $gte: todayStart }
    }

    const events = await Event.find(filter).sort({ eventDate: 1 })
    res.json(events)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// GET /api/events/:id — get single event by mongo _id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const event = await Event.findById(req.params.id)
    if (!event) {
      res.status(404).json({ error: 'Event not found' })
      return
    }
    res.json(event)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/events — create a new event record
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      eventId,
      appId,
      ticketAsaId,
      name,
      description,
      imageUrl,
      eventDate,
      organizer,
      clubAppId,
      ticketPrice,
      maxSupply,
    } = req.body

    if (!eventId || !appId || !name || !organizer || ticketPrice == null || !maxSupply || !eventDate) {
      res.status(400).json({ error: 'Missing required fields' })
      return
    }

    const event = await Event.create({
      eventId,
      appId,
      ticketAsaId: ticketAsaId || null,
      name,
      description: description || '',
      imageUrl: imageUrl || '',
      eventDate: new Date(eventDate),
      organizer,
      clubAppId: clubAppId || 0,
      ticketPrice,
      maxSupply,
      soldCount: 0,
      saleActive: true,
    })

    res.status(201).json(event)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// PATCH /api/events/:id — update event fields (soldCount, saleActive, ticketAsaId, etc.)
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const event = await Event.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!event) {
      res.status(404).json({ error: 'Event not found' })
      return
    }
    res.json(event)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// DELETE /api/events/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id)
    if (!event) {
      res.status(404).json({ error: 'Event not found' })
      return
    }
    res.json({ message: 'Event deleted' })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
