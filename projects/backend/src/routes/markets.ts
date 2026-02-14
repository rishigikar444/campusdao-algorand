import { Router, Request, Response } from 'express'
import Market from '../models/Market.js'

const router = Router()

// GET /api/markets — list markets, optionally filtered by appId
// Pass ?appId=123 to filter by contract, ?all=true to include resolved
router.get('/', async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = {}

    if (req.query.appId) {
      filter.appId = Number(req.query.appId)
    }

    if (req.query.all !== 'true') {
      filter.resolved = false
    }

    const markets = await Market.find(filter).sort({ createdAt: -1 })
    res.json(markets)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// GET /api/markets/:id — get single market by mongo _id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const market = await Market.findById(req.params.id)
    if (!market) {
      res.status(404).json({ error: 'Market not found' })
      return
    }
    res.json(market)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/markets — create a new market record
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      marketId,
      appId,
      question,
      description,
      resolutionDate,
      creator,
      priceScale,
      council1,
      council2,
      council3,
    } = req.body

    if (!marketId || !appId || !question || !creator || !priceScale || !resolutionDate || !council1 || !council2 || !council3) {
      res.status(400).json({ error: 'Missing required fields' })
      return
    }

    const market = await Market.create({
      marketId,
      appId,
      question,
      description: description || '',
      resolutionDate: new Date(resolutionDate),
      creator,
      priceScale,
      council1,
      council2,
      council3,
      resolved: false,
      outcome: 0,
    })

    res.status(201).json(market)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// PATCH /api/markets/:id — update market fields (resolved, outcome, etc.)
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const market = await Market.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!market) {
      res.status(404).json({ error: 'Market not found' })
      return
    }
    res.json(market)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// DELETE /api/markets/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const market = await Market.findByIdAndDelete(req.params.id)
    if (!market) {
      res.status(404).json({ error: 'Market not found' })
      return
    }
    res.json({ message: 'Market deleted' })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
