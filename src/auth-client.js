import { createAuthClient } from 'better-auth/react'
import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins'

const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL || import.meta.env.VITE_CONVEX_URL?.replace(/\.convex\.cloud\/?$/, '.convex.site')

export const authClient = createAuthClient({
  baseURL: siteUrl,
  plugins: [convexClient(), crossDomainClient()],
})
