const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/

export function parseYouTubeUrl(input) {
  if (typeof input !== 'string' || input.length > 2048 || !/^https?:\/\//i.test(input.trim())) return null
  try {
    const url = new URL(input.trim())
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null

    let id
    if (url.hostname === 'youtu.be') {
      id = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1]
    } else if (youtubeHosts.has(url.hostname)) {
      if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) {
        id = url.searchParams.get('v')
      } else {
        id = /^\/shorts\/([^/]+)\/?$/.exec(url.pathname)?.[1]
      }
    }
    if (!id || !videoIdPattern.test(id)) return null
    return { id, url: `https://www.youtube.com/watch?v=${id}` }
  } catch {
    return null
  }
}
