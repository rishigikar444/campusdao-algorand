import { Router, Request, Response } from 'express'
import Project from '../models/Project.js'

const router = Router()

// GET /api/projects — list projects, optionally filtered by appId
// Pass ?appId=123 to filter by contract, ?all=true to include non-active
router.get('/', async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = {}

    if (req.query.appId) {
      filter.appId = Number(req.query.appId)
    }

    if (req.query.all !== 'true') {
      filter.status = 0
    }

    const projects = await Project.find(filter).sort({ createdAt: -1 })
    res.json(projects)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// GET /api/projects/:id — get single project by mongo _id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const project = await Project.findById(req.params.id)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    res.json(project)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/projects — create a new project record
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      projectId,
      appId,
      title,
      description,
      creator,
      goal,
      deadline,
    } = req.body

    if (!projectId || !appId || !title || !creator || !goal || !deadline) {
      res.status(400).json({ error: 'Missing required fields' })
      return
    }

    const project = await Project.create({
      projectId,
      appId,
      title,
      description: description || '',
      creator,
      goal,
      deadline: new Date(deadline),
      raised: 0,
      status: 0,
    })

    res.status(201).json(project)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// PATCH /api/projects/:id — update project fields (raised, status, etc.)
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    res.json(project)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// DELETE /api/projects/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    res.json({ message: 'Project deleted' })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
