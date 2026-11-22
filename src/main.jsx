import React, { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexReactClient, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import { anyApi } from 'convex/server'
import { ArrowDownToLine, AudioLines, Check, Clock3, Library, LoaderCircle, Music2, Palette, Plus, Scissors, Search, Trash2, X } from 'lucide-react'
import encoderUrl from 'lamejs/lame.min.js?url&no-inline'
import { parseYouTubeUrl } from '../shared/youtube.js'
import { localAudioOrigin } from '../shared/audio-origin.js'
import { authClient } from './auth-client.js'
import { AuthScreen } from './auth-screen.jsx'
import './style.css'

const convexUrl = import.meta.env.VITE_CONVEX_URL
const client = convexUrl ? new ConvexReactClient(convexUrl, { expectAuth: true }) : null
const api = anyApi

const defaultAccent = '#c6f46a'
const accentStorageKey = 'aria.accentColor'
let encoderPromise

function readAccent() {
  try {
    const saved = localStorage.getItem(accentStorageKey)
    if (/^#[0-9a-f]{6}$/i.test(saved)) return saved
  } catch {
    // The picker still works when browser storage is unavailable.
  }
  return defaultAccent
}

function accentTextColor(color) {
  const [red, green, blue] = color.slice(1).match(/../g).map((hex) => {
    const channel = parseInt(hex, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.179 ? '#000' : '#fff'
}

function loadMp3Encoder() {
  if (!encoderPromise) {
    encoderPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      function failed() {
        script.remove()
        encoderPromise = undefined
        reject(new Error('The MP3 encoder could not load. Try again.'))
      }
      script.src = encoderUrl
      script.onload = () => {
        if (window.lamejs?.Mp3Encoder) resolve(window.lamejs.Mp3Encoder)
        else failed()
      }
      script.onerror = failed
      document.head.append(script)
    })
  }
  return encoderPromise
}

function stamp(value) {
  if (!/^(?:\d+:)?\d+:[0-5]\d$/.test(value.trim())) return NaN
  const parts = value.trim().split(':').map(Number)
  if (parts.length === 3 && parts[1] >= 60) return NaN
  return parts.reduce((seconds, part) => seconds * 60 + part, 0)
}

function formatTime(seconds) {
  const n = Math.max(0, Math.floor(seconds || 0))
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
}

async function uploadBlob(blob, generateUrl) {
  const uploadUrl = await generateUrl({})
  const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob })
  if (!response.ok) throw new Error('File upload failed. Try again.')
  const { storageId } = await response.json()
  return storageId
}

async function extractClip(url, start, end) {
  const { data } = await authClient.convex.token({ fetchOptions: { throw: false } })
  if (!data?.token) throw new Error('Sign in again to create a splice.')
  const isLocalPage = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const endpoint = `${isLocalPage ? '' : localAudioOrigin}/api/audio/extract`
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
      body: JSON.stringify({ url, start, end }),
    })
  } catch {
    throw new Error(isLocalPage
      ? 'Could not reach local audio processing. Restart Atropos and try again.'
      : 'Start the audio helper with npm run audio, then allow local network access in your browser.')
  }
  if (!response.ok || !response.headers.get('Content-Type')?.startsWith('audio/mpeg')) {
    const result = await response.json().catch(() => null)
    if (response.status === 404 && !result?.error) {
      throw new Error('The local audio route was not found. Restart Atropos and try again.')
    }
    throw new Error(result?.error || 'The audio extraction service did not return an MP3.')
  }
  return response.blob()
}

async function makeMp3(file, start, end) {
  const Mp3Encoder = await loadMp3Encoder()
  const context = new AudioContext({ sampleRate: 32000 })
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer())
    if (end > decoded.duration) throw new Error(`The end time is past the audio length (${formatTime(decoded.duration)}).`)
    const left = Math.floor(start * decoded.sampleRate)
    const right = Math.floor(end * decoded.sampleRate)
    const channels = Math.min(decoded.numberOfChannels, 2)
    const encoder = new Mp3Encoder(channels, decoded.sampleRate, 192)
    const chunks = []
    const block = 1152
    for (let i = left; i < right; i += block) {
      const length = Math.min(block, right - i)
      const l = new Int16Array(length)
      const srcL = decoded.getChannelData(0)
      for (let j = 0; j < length; j++) l[j] = Math.max(-32768, Math.min(32767, srcL[i + j] * 32767))
      let encoded
      if (channels === 2) {
        const r = new Int16Array(length)
        const srcR = decoded.getChannelData(1)
        for (let j = 0; j < length; j++) r[j] = Math.max(-32768, Math.min(32767, srcR[i + j] * 32767))
        encoded = encoder.encodeBuffer(l, r)
      } else encoded = encoder.encodeBuffer(l)
      if (encoded.length) chunks.push(new Uint8Array(encoded))
    }
    const tail = encoder.flush()
    if (tail.length) chunks.push(new Uint8Array(tail))
    return new Blob(chunks, { type: 'audio/mpeg' })
  } finally { await context.close() }
}

function App() {
  const savedSources = useQuery(api.splices.list)
  const sources = savedSources || []
  const uploadUrl = useMutation(api.splices.generateUploadUrl)
  const addSource = useMutation(api.splices.addSource)
  const addSplice = useMutation(api.splices.addSplice)
  const deleteSplice = useMutation(api.splices.deleteSplice)
  const deleteSource = useMutation(api.splices.deleteSource)
  const [tab, setTab] = useState('splicer')
  const [accent, setAccent] = useState(readAccent)
  const [selectedId, setSelectedId] = useState(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const audioPlayer = useRef(null)
  const audioCache = useRef(null)
  const [spliceTitle, setSpliceTitle] = useState('')
  const [start, setStart] = useState('00:00')
  const [end, setEnd] = useState('00:30')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const selected = sources.find((source) => source._id === selectedId)
  const totalSplices = sources.reduce((sum, source) => sum + source.splices.length, 0)
  const filteredSources = useMemo(() => sources.filter((source) => `${source.title} ${source.videoId}`.toLowerCase().includes(query.toLowerCase())), [sources, query])

  async function createSplice(event) {
    event.preventDefault(); setError(''); setNotice('')
    if (busy) return
    if (!selected) return setError('Add a YouTube video first.')
    const a = stamp(start), b = stamp(end)
    if (!spliceTitle.trim()) return setError('Give this splice a name.')
    if (!Number.isFinite(a) || !Number.isFinite(b)) return setError('Use MM:SS or HH:MM:SS for both times.')
    if (a < 0 || b <= a) return setError('End time must be after start time.')
    setBusy('splice')
    try {
      const audio = selected.audioUrl
        ? await makeMp3(await audioForSource(selected), a, b)
        : await extractClip(selected.videoUrl, a, b)
      const audioStorageId = await uploadBlob(audio, uploadUrl)
      await addSplice({ sourceId: selected._id, title: spliceTitle.trim(), start: a, end: b, audioStorageId })
      setSpliceTitle(''); setNotice('MP3 splice created and saved to your library.')
    } catch (e) { setError(e.message || 'Could not create the splice.') }
    finally { setBusy('') }
  }

  async function audioForSource(source) {
    if (audioCache.current?.sourceId === source._id) return audioCache.current.blob
    if (!source.audioUrl) throw new Error('The saved source audio is unavailable.')
    const response = await fetch(source.audioUrl)
    if (!response.ok) throw new Error('The saved source audio could not be loaded.')
    const blob = await response.blob()
    audioCache.current = { sourceId: source._id, blob }
    return blob
  }

  function markTime(setTime) {
    const player = audioPlayer.current
    if (player?.readyState > 0) setTime(formatTime(player.currentTime))
    else setError('Wait for the source audio to load, then mark the playback time.')
  }

  async function addYouTubeSource(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (busy || !savedSources) return
    const video = parseYouTubeUrl(url)
    if (!video) return setError('Enter a valid YouTube watch, Shorts, or youtu.be URL.')
    const existing = sources.find((source) => source.videoId === video.id)
    if (existing) {
      setSelectedId(existing._id)
      setUrl('')
      setTitle('')
      return
    }
    setBusy('source')
    try {
      const sourceId = await addSource({
        videoUrl: video.url,
        videoId: video.id,
        title: title.trim() || `YouTube video ${video.id}`,
      })
      setSelectedId(sourceId)
      setNotice('Source added. Choose a start and end time to create a splice.')
      setUrl('')
      setTitle('')
    } catch (e) {
      setError(e.message || 'Could not add this source.')
    } finally {
      setBusy('')
    }
  }

  function changeAccent(event) {
    const color = event.target.value
    setAccent(color)
    try {
      localStorage.setItem(accentStorageKey, color)
    } catch {
      // The selected color remains active for this visit.
    }
  }

  return <div className="app-shell" style={{ '--accent': accent, '--accent-ink': accentTextColor(accent) }}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><AudioLines size={19} strokeWidth={2.2}/></div><span>Atropos</span></div>
      <div className="side-caption">WORKSPACE</div>
      <nav className="nav-list">
        <button className={`nav-item ${tab === 'splicer' ? 'active' : ''}`} onClick={() => setTab('splicer')}><Scissors size={17}/><span>Splicer</span></button>
        <button className={`nav-item ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')}><Library size={17}/><span>Library</span><span className="nav-count">{totalSplices}</span></button>
      </nav>
      <button className="small-action sign-out" type="button" onClick={async () => {
        const { error } = await authClient.signOut()
        if (error) setError('Could not sign out. Try again.')
      }}>Sign out</button>
      <div className="accent-picker">
        <Palette size={17} aria-hidden="true"/>
        <input type="color" value={accent} onChange={changeAccent} aria-label="Choose accent color" title="Choose accent color"/>
      </div>
    </aside>
    <main className="main-content">
      {tab === 'splicer' ? <section className="page-wrap">
        <div className="page-heading"><h1>Splicer</h1></div>
        <section className="editor-panel">
          <h2 className="step-label">Video source</h2>
          {!selected ? <>
            {sources.length > 0 && <div className="saved-source-picker"><div className="picker-label">PICK A SAVED SOURCE</div>{sources.slice(0, 4).map(source => <button type="button" className="saved-source-option" key={source._id} onClick={() => setSelectedId(source._id)}><div className="source-icon"><Music2 size={15}/></div><span>{source.title}</span><b>Use source ↗</b></button>)}</div>}
            <form onSubmit={addYouTubeSource} className="source-form">
            <label className="field-label" htmlFor="youtube-url">YouTube video link</label>
            <input className="standard-input" id="youtube-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste a YouTube link"/>
            <label className="field-label optional-label" htmlFor="source-title">Source name <span>OPTIONAL</span></label>
            <input className="standard-input" id="source-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Late night set" />
            <button className="primary-button full" disabled={!savedSources || Boolean(busy)}>{busy === 'source' ? <><LoaderCircle className="spin" size={16}/> Adding video…</> : "Add video"}</button>
            </form></> : <div className="source-selected">
            <div className="video-frame"><iframe src={`https://www.youtube-nocookie.com/embed/${selected.videoId}`} title={selected.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></div>
            <div className="source-summary"><div className="source-thumb"><Music2 size={22}/></div><div className="source-copy"><strong>{selected.title}</strong><span>{selected.audioFileName || 'YouTube video'}</span></div><button className="icon-button" onClick={() => setSelectedId(null)} title="Choose another source"><X size={16}/></button></div>
            {selected.audioUrl && <audio key={selected._id} ref={audioPlayer} className="source-player" controls preload="metadata" src={selected.audioUrl} aria-label="Source audio"/>}
          </div>}
          {selected && <>
            <div className="panel-separator"/>
            <h2 className="step-label">Create a splice</h2>
            <form className="splice-form" onSubmit={createSplice}>
              <label className="field-label" htmlFor="splice-name">Splice name</label><input id="splice-name" className="standard-input" value={spliceTitle} onChange={e => setSpliceTitle(e.target.value)} placeholder="e.g. Favorite verse"/>
              <div className="time-row"><div><label className="field-label" htmlFor="time-start">START AT</label><input id="time-start" className="time-input" value={start} onChange={e => setStart(e.target.value)} placeholder="00:00"/></div><div className="time-connector"/><div><label className="field-label" htmlFor="time-end">END AT</label><input id="time-end" className="time-input" value={end} onChange={e => setEnd(e.target.value)} placeholder="00:30"/></div><div className="duration-chip"><Clock3 size={13}/>{Number.isFinite(stamp(end) - stamp(start)) ? Math.max(0, stamp(end) - stamp(start)) : 0}s</div></div>
              {selected.audioUrl && <div className="mark-times">
                <button className="small-action" type="button" disabled={Boolean(busy)} onClick={() => markTime(setStart)}>Mark start</button>
                <button className="small-action" type="button" disabled={Boolean(busy)} onClick={() => markTime(setEnd)}>Mark end</button>
              </div>}
              <button className="primary-button full create-button" disabled={Boolean(busy)}>{busy === 'splice' ? <><LoaderCircle className="spin" size={16}/> Making your MP3…</> : <><Scissors size={16}/> Save MP3</>}</button>
            </form>
          </>}
        </section>
      </section> : <section className="library-page">
        <div className="page-heading library-heading"><h1>The <em>library.</em></h1><button className="primary-button" onClick={() => {setSelectedId(null); setTab('splicer')}}><Plus size={16}/> Create new splice</button></div>
        <div className="library-toolbar"><div><strong>{totalSplices} {totalSplices === 1 ? 'splice' : 'splices'}</strong><span> across {sources.length} {sources.length === 1 ? 'source' : 'sources'}</span></div><div className="search-box"><Search size={15}/><input placeholder="Search your library" value={query} onChange={e => setQuery(e.target.value)}/></div></div>
        {filteredSources.length ? <div className="library-groups">{filteredSources.map(source => <div className="library-group" key={source._id}><div className="group-head"><div className="source-icon"><Music2 size={17}/></div><div className="group-title"><strong>{source.title}</strong><a href={source.videoUrl} target="_blank" rel="noreferrer">youtube.com/watch?v={source.videoId} ↗</a></div><span className="group-count">{source.splices.length} {source.splices.length === 1 ? 'splice' : 'splices'}</span><button className="small-action" onClick={() => {setSelectedId(source._id); setTab('splicer')}}><Plus size={13}/> New splice</button><button className="icon-button delete-source" title="Delete source and its splices" onClick={async () => {if (confirm(`Delete “${source.title}” and all its splices?`)) {await deleteSource({id:source._id}); if (audioCache.current?.sourceId === source._id) audioCache.current = null; if (selectedId === source._id) setSelectedId(null)}}}><Trash2 size={15}/></button></div>
            {source.splices.length ? <div className="library-splices">{source.splices.map((splice, i) => <div className="library-row" key={splice._id}><div className={`cover cover-${i%4}`}><AudioLines size={18}/></div><div className="library-song"><strong>{splice.title}</strong><span>{formatTime(splice.start)} — {formatTime(splice.end)}</span></div><span className="song-length">{formatTime(splice.end - splice.start)}</span><audio className="audio-player" controls preload="none" src={splice.audioUrl || undefined}/><a className="download-button" href={splice.audioUrl || '#'} download={`${splice.title}.mp3`}><ArrowDownToLine size={15}/> MP3</a><button className="icon-button" title="Delete splice" onClick={() => deleteSplice({id:splice._id})}><Trash2 size={15}/></button></div>)}</div> : <div className="group-empty">No splices yet. <button onClick={() => {setSelectedId(source._id); setTab('splicer')}}>Create one <span>↗</span></button></div>}</div>)}</div> : <div className="library-empty"><div className="empty-disc"><Library size={21}/></div><h3>{sources.length ? 'No matches found.' : 'Nothing saved here yet.'}</h3><p>{sources.length ? 'Try another title or source.' : 'Add a source in the splicer. Your clips will appear here.'}</p><button className="primary-button" onClick={() => setTab('splicer')}><Plus size={15}/> Go to splicer</button></div>}
      </section>}
      {error && <div className="toast error-toast"><X size={15}/>{error}<button onClick={() => setError('')}><X size={14}/></button></div>}{notice && <div className="toast success-toast"><Check size={15}/>{notice}<button onClick={() => setNotice('')}><X size={14}/></button></div>}
    </main>
  </div>
}


function Workspace() {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const allowed = useQuery(api.auth.canUseApp, isAuthenticated ? {} : 'skip')
  if (isLoading || (isAuthenticated && allowed === undefined)) return <AuthScreen loading/>
  if (!isAuthenticated || !allowed) return <AuthScreen denied={isAuthenticated}/>
  return <App/>
}

function Root() {
  if (!convexUrl) return <div className="setup-screen"><div className="setup-card"><div className="brand"><div className="brand-mark"><AudioLines size={19}/></div><span>Atropos</span></div><h1>One quick setup.</h1><p>Connect Atropos to a Convex deployment so your sources, splices, and MP3 files are saved in your library.</p><ol><li>Run <code>npm install</code> and <code>npx convex dev</code>.</li><li>Copy the deployment URL into <code>.env.local</code> as <code>VITE_CONVEX_URL</code>.</li><li>Restart <code>npm run dev</code>.</li></ol></div></div>
  return <ConvexBetterAuthProvider client={client} authClient={authClient}><Workspace/></ConvexBetterAuthProvider>
}

createRoot(document.getElementById('root')).render(<Root/>)
