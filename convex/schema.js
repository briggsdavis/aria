import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  sources: defineTable({
    videoUrl: v.string(),
    videoId: v.string(),
    title: v.string(),
    audioStorageId: v.id('_storage'),
    audioFileName: v.string(),
    createdAt: v.number(),
  }).index('by_created', ['createdAt']),
  splices: defineTable({
    sourceId: v.id('sources'),
    title: v.string(),
    start: v.number(),
    end: v.number(),
    audioStorageId: v.id('_storage'),
    createdAt: v.number(),
  }).index('by_source', ['sourceId']).index('by_created', ['createdAt']),
})
