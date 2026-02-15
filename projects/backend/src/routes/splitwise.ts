import { Router, Request, Response } from 'express'
import SplitGroup from '../models/SplitGroup.js'
import SplitExpense from '../models/SplitExpense.js'

const router = Router()

// ─── Groups ───

// GET /api/splitwise/groups — list groups the caller belongs to
// ?address=ADDR to filter by member, ?all=true to skip active filter
router.get('/groups', async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = {}

    if (req.query.address) {
      filter['members.address'] = req.query.address
    }

    if (req.query.all !== 'true') {
      filter.active = true
    }

    const groups = await SplitGroup.find(filter).sort({ createdAt: -1 })
    res.json(groups)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// GET /api/splitwise/groups/:id
router.get('/groups/:id', async (req: Request, res: Response) => {
  try {
    const group = await SplitGroup.findById(req.params.id)
    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }
    res.json(group)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/splitwise/groups — create a new group record
router.post('/groups', async (req: Request, res: Response) => {
  try {
    const { groupId, appId, name, creator, members } = req.body

    if (!groupId || !appId || !name || !creator || !members || !members.length) {
      res.status(400).json({ error: 'Missing required fields' })
      return
    }

    const group = await SplitGroup.create({
      groupId,
      appId,
      name,
      creator,
      members,
      active: true,
    })

    res.status(201).json(group)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// PATCH /api/splitwise/groups/:id — update group (e.g. close)
router.patch('/groups/:id', async (req: Request, res: Response) => {
  try {
    const group = await SplitGroup.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }
    res.json(group)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ─── Expenses ───

// GET /api/splitwise/expenses — list expenses
// ?groupId=X&appId=Y to filter by group
router.get('/expenses', async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = {}

    if (req.query.appId) filter.appId = Number(req.query.appId)
    if (req.query.groupId) filter.groupId = Number(req.query.groupId)

    const expenses = await SplitExpense.find(filter).sort({ createdAt: -1 })
    res.json(expenses)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/splitwise/expenses — record a new expense
router.post('/expenses', async (req: Request, res: Response) => {
  try {
    const { expenseId, appId, groupId, description, amount, payer, participants, sharePerPerson } = req.body

    if (!expenseId || !appId || !groupId || !amount || !payer || !participants || !participants.length || !sharePerPerson) {
      res.status(400).json({ error: 'Missing required fields' })
      return
    }

    const expense = await SplitExpense.create({
      expenseId,
      appId,
      groupId,
      description: description || '',
      amount,
      payer,
      participants,
      sharePerPerson,
      settledBy: [],
    })

    res.status(201).json(expense)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// PATCH /api/splitwise/expenses/:id — update expense (e.g. add settler)
router.patch('/expenses/:id', async (req: Request, res: Response) => {
  try {
    const expense = await SplitExpense.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!expense) {
      res.status(404).json({ error: 'Expense not found' })
      return
    }
    res.json(expense)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/splitwise/expenses/:id/settle — mark a settler address
router.post('/expenses/:id/settle', async (req: Request, res: Response) => {
  try {
    const { address } = req.body
    if (!address) {
      res.status(400).json({ error: 'address is required' })
      return
    }

    const expense = await SplitExpense.findById(req.params.id)
    if (!expense) {
      res.status(404).json({ error: 'Expense not found' })
      return
    }

    if (expense.settledBy.includes(address)) {
      res.status(400).json({ error: 'Already settled' })
      return
    }

    expense.settledBy.push(address)
    await expense.save()

    res.json(expense)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
