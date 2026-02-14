import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import eventsRouter from './routes/events.js'

const PORT = process.env.PORT || 3001
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/campus_superapp'

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/events', eventsRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log(`Connected to MongoDB: ${MONGO_URI}`)
    app.listen(PORT, () => {
      console.log(`Backend running on http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message)
    process.exit(1)
  })
