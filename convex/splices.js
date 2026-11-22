import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

export const list = query({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query('sources').withIndex('by_created').order('desc').collect()
    return Promise.all(sources.map(async (source) => {
      const splices = await ctx.db.query('splices').withIndex('by_source', (q) => q.eq('sourceId', source._id)).collect()
      return {
        ...source,
        audioUrl: source.audioStorageId ? await ctx.storage.getUrl(source.audioStorageId) : null,
        splices: await Promise.all(splices.map(async (splice) => ({ ...splice, audioUrl: await ctx.storage.getUrl(splice.audioStorageId) }))),
      }
    }))
  },
})

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
})

export const addSource = mutation({
  args: {
    videoUrl: v.string(), videoId: v.string(), title: v.string(),
    audioStorageId: v.optional(v.id('_storage')), audioFileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.audioStorageId) {
      const existing = await ctx.db.query('sources').withIndex('by_video', (q) => q.eq('videoId', args.videoId)).first()
      if (existing) return existing._id
    }
    return ctx.db.insert('sources', { ...args, createdAt: Date.now() })
  },
})

export const addSplice = mutation({
  args: { sourceId: v.id('sources'), title: v.string(), start: v.number(), end: v.number(), audioStorageId: v.id('_storage') },
  handler: async (ctx, args) => ctx.db.insert('splices', { ...args, createdAt: Date.now() }),
})

export const deleteSplice = mutation({
  args: { id: v.id('splices') },
  handler: async (ctx, { id }) => {
    const splice = await ctx.db.get(id)
    if (!splice) return
    await ctx.storage.delete(splice.audioStorageId)
    await ctx.db.delete(id)
  },
})

export const deleteSource = mutation({
  args: { id: v.id('sources') },
  handler: async (ctx, { id }) => {
    const source = await ctx.db.get(id)
    if (!source) return
    const splices = await ctx.db.query('splices').withIndex('by_source', (q) => q.eq('sourceId', id)).collect()
    for (const splice of splices) {
      await ctx.storage.delete(splice.audioStorageId)
      await ctx.db.delete(splice._id)
    }
    if (source.audioStorageId) await ctx.storage.delete(source.audioStorageId)
    await ctx.db.delete(id)
  },
})
