import { createClient } from '@convex-dev/better-auth'
import { convex, crossDomain } from '@convex-dev/better-auth/plugins'
import { betterAuth } from 'better-auth/minimal'
import { APIError } from 'better-auth/api'
import { ConvexError } from 'convex/values'
import { components } from './_generated/api'
import { query } from './_generated/server'
import authConfig from './auth.config'

export const authComponent = createClient(components.betterAuth)
const siteUrl = process.env.SITE_URL

function approvedEmail(email) {
  const normalized = email.trim().toLowerCase()
  return Boolean(normalized) && (process.env.ADMIN_EMAILS || '').split(',')
    .some((entry) => entry.trim().toLowerCase() === normalized)
}

export function createAuth(ctx) {
  return betterAuth({
    appName: 'Atropos',
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!approvedEmail(user.email)) {
              throw new APIError('FORBIDDEN', { message: 'This email is not approved to create an account.' })
            }
          },
        },
      },
    },
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  })
}

async function hasWorkspaceAccess(ctx) {
  const user = await authComponent.safeGetAuthUser(ctx)
  return Boolean(user && approvedEmail(user.email))
}

export async function requireWorkspaceAccess(ctx) {
  if (!(await hasWorkspaceAccess(ctx))) throw new ConvexError('An approved Atropos account is required.')
}

export const canUseApp = query({ args: {}, handler: hasWorkspaceAccess })
