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
  return Boolean(normalized) && (process.env.APPROVED_SIGNUP_EMAILS || '').split(',')
    .some((entry) => entry.trim().toLowerCase() === normalized)
}

async function sendVerificationEmail({ user, url }) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.AUTH_EMAIL_FROM
  if (!apiKey || !from) throw new Error('Verification email delivery is not configured.')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [user.email],
      subject: 'Verify your Atropos email',
      text: `If you requested an Atropos account, verify your email using this link:\n${url}\n\nOtherwise, ignore this email.`,
    }),
  })
  if (!response.ok) throw new Error(`Verification email delivery failed (${response.status}).`)
}

export function createAuth(ctx) {
  return betterAuth({
    appName: 'Atropos',
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: true, requireEmailVerification: true, minPasswordLength: 12 },
    emailVerification: { sendOnSignUp: true, sendOnSignIn: true, sendVerificationEmail },
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
  return Boolean(user?.emailVerified && approvedEmail(user.email))
}

export async function requireWorkspaceAccess(ctx) {
  if (!(await hasWorkspaceAccess(ctx))) throw new ConvexError('An approved Atropos account is required.')
}

export const canUseApp = query({ args: {}, handler: hasWorkspaceAccess })
