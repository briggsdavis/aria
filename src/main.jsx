import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexProvider, ConvexReactClient, useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { ArrowDownToLine, AudioLines, Check, ChevronDown, CircleHelp, Clock3, Disc3, Headphones, Library, LoaderCircle, Music2, Plus, Scissors, Search, Trash2, Upload, X } from 'lucide-react'
import lamejs from 'lamejs'
import './style.css'

const convexUrl = import.meta.env.VITE_CONVEX_URL
const client = convexUrl ? new ConvexReactClient(convexUrl) : null
const api = anyApi

function videoIdFrom(url) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.endsWith('youtu.be')) return parsed.pathname.slice(1).split('/')[0]
    if (parsed.hostname.endsWith('youtube.com')) return parsed.searchParams.get('v') || parsed.pathname.split('/').filter(Boolean).at(-1)
  } catch {}
  return null
}

function stamp(value) {
  const parts = String(value).split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return NaN
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return NaN
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

async function makeMp3(file, start, end) {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer())
    if (end > decoded.duration) throw new Error(`The end time is past the audio length (${formatTime(decoded.duration)}).`)
    const left = Math.floor(start * decoded.sampleRate)
    const right = Math.floor(end * decoded.sampleRate)
    const channels = Math.min(decoded.numberOfChannels, 2)
    const encoder = new lamejs.Mp3Encoder(channels, decoded.sampleRate, 192)
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
  const sources = useQuery(api.splices.list) || []
  const uploadUrl = useMutation(api.splices.generateUploadUrl)
  const addSource = useMutation(api.splices.addSource)
  const addSplice = useMutation(api.splices.addSplice)
  const deleteSplice = useMutation(api.splices.deleteSplice)
  const deleteSource = useMutation(api.splices.deleteSource)
  const [tab, setTab] = useState('splicer')
  const [selectedId, setSelectedId] = useState(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
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
    if (!selected) return setError('Add a video and source audio first.')
    const a = stamp(start), b = stamp(end)
    if (!spliceTitle.trim()) return setError('Give this splice a name.')
    if (!Number.isFinite(a) || !Number.isFinite(b)) return setError('Use MM:SS or HH:MM:SS for both times.')
    if (a < 0 || b <= a) return setError('End time must be after start time.')
    setBusy('splice')
    try {
      const sourceAudio = await fileForSelected(selected)
      const audio = await makeMp3(sourceAudio, a, b)
      const audioStorageId = await uploadBlob(audio, uploadUrl)
      await addSplice({ sourceId: selected._id, title: spliceTitle.trim(), start: a, end: b, audioStorageId })
      setSpliceTitle(''); setNotice('MP3 splice created and saved to your library.')
    } catch (e) { setError(e.message || 'Could not create the splice.') }
    finally { setBusy('') }
  }

  async function fileForSelected(source) {
    const cached = fileCache.get(source?._id)
    if (cached) return cached
    if (!source?.audioUrl) throw new Error('The saved audio could not be loaded. Re-add the source audio.')
    const response = await fetch(source.audioUrl)
    if (!response.ok) throw new Error('The saved audio could not be loaded. Re-add the source audio.')
    const blob = await response.blob()
    return new File([blob], source.audioFileName || 'source-audio', { type: blob.type || 'audio/mpeg' })
  }

  async function addSourceWithCache(event) {
    event.preventDefault(); setError(''); setNotice(''); const videoId = videoIdFrom(url)
    if (!videoId) return setError('Enter a valid YouTube link.')
    if (!file) return setError('Upload the matching audio file you own or have permission to edit.')
    setBusy('source')
    try {
      const thisFile = file; const id = await uploadBlob(thisFile, uploadUrl)
      const sourceId = await addSource({ videoUrl: url, videoId, title: title.trim() || thisFile.name.replace(/\.[^.]+$/, ''), audioStorageId: id, audioFileName: thisFile.name })
      fileCache.set(sourceId, thisFile); setSelectedId(sourceId); setTab('splicer'); setNotice('Source added. You can now create splices.')
      setUrl(''); setTitle(''); setFile(null)
    } catch (e) { setError(e.message || 'Could not add this source.') } finally { setBusy('') }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><AudioLines size={19} strokeWidth={2.2}/></div><span>aria</span><span className="brand-dot">.</span></div>
      <div className="side-caption">WORKSPACE</div>
      <nav className="nav-list">
        <button className={`nav-item ${tab === 'splicer' ? 'active' : ''}`} onClick={() => setTab('splicer')}><Scissors size={17}/><span>Splicer</span></button>
        <button className={`nav-item ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')}><Library size={17}/><span>Library</span><span className="nav-count">{totalSplices}</span></button>
      </nav>
      <div className="sidebar-bottom">
        <div className="storage-card"><div className="storage-icon"><Disc3 size={17}/></div><div><strong>Your sound, shaped.</strong><span>Sources and MP3s live in Convex.</span></div></div>
        <div className="profile"><div className="avatar">A</div><div><strong>My workspace</strong><span>Personal library</span></div><ChevronDown size={15} className="profile-chevron"/></div>
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <b>{tab === 'splicer' ? 'Splicer' : 'Library'}</b></div><button className="help-button"><CircleHelp size={16}/> Help</button></header>
      {tab === 'splicer' ? <section className="page-wrap">
        <div className="page-heading"><div><div className="eyebrow">A LITTLE ROOM FOR SOUND</div><h1>Make a moment <em>yours.</em></h1><p>Bring a video, mark the part you love, and give it a place in your library.</p></div><div className="heading-note"><Headphones size={17}/><span>Good things start<br/>with a good listen.</span></div></div>
        <div className="workspace-grid">
          <section className="editor-panel">
            <div className="panel-top"><div className="step-label"><span>01</span> SOURCE</div>{selected && <button className="text-button" onClick={() => setTab('library')}>Browse library <ArrowDownToLine size={14}/></button>}</div>
            {!selected ? <>
              {sources.length > 0 && <div className="saved-source-picker"><div className="picker-label">PICK A SAVED SOURCE</div>{sources.slice(0, 4).map(source => <button type="button" className="saved-source-option" key={source._id} onClick={() => setSelectedId(source._id)}><div className="source-icon"><Music2 size={15}/></div><span>{source.title}</span><b>Use source ↗</b></button>)}</div>}
              <form onSubmit={addSourceWithCache} className="source-form">
              <label className="field-label" htmlFor="youtube-url">YouTube video link</label>
              <div className="url-input"><span className="youtube-icon">▶</span><input id="youtube-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste a YouTube link"/><button className="round-add" type="button" aria-label="Add a video"><Plus size={17}/></button></div>
              <div className="form-divider"><span>THEN ADD YOUR AUDIO</span></div>
              <label className={`upload-box ${file ? 'has-file' : ''}`}>
                <input type="file" accept="audio/*" onChange={e => setFile(e.target.files?.[0] || null)} />
                {file ? <><div className="upload-symbol success"><Check size={18}/></div><strong>{file.name}</strong><span>Ready to splice · click to replace</span></> : <><div className="upload-symbol"><Upload size={18}/></div><strong>Choose an audio file</strong><span>MP3, WAV, M4A, FLAC or AAC</span></>}
              </label>
              <label className="field-label optional-label" htmlFor="source-title">Name this source <span>OPTIONAL</span></label>
              <input className="standard-input" id="source-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Late night set" />
              <button className="primary-button full" disabled={busy === 'source'}>{busy === 'source' ? <><LoaderCircle className="spin" size={16}/> Saving source…</> : <>Continue to splicer <span>↗</span></>}</button>
              </form></> : <div className="source-selected">
              <div className="video-frame"><iframe src={`https://www.youtube-nocookie.com/embed/${selected.videoId}`} title={selected.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></div>
              <div className="source-summary"><div className="source-thumb"><Music2 size={22}/></div><div className="source-copy"><strong>{selected.title}</strong><span>Audio source · {selected.audioFileName}</span></div><button className="icon-button" onClick={() => setSelectedId(null)} title="Choose another source"><X size={16}/></button></div>
              <div className="change-source"><span>Have another video?</span><button onClick={() => {setSelectedId(null); setFile(null)}}>Add a new source <Plus size={13}/></button></div>
            </div>}
            <div className="panel-separator"/>
            <div className="panel-top"><div className="step-label"><span>02</span> YOUR SPLICE</div><span className="tiny-label">MP3 · 192 KBPS</span></div>
            <form className={`splice-form ${!selected ? 'disabled-form' : ''}`} onSubmit={createSplice}>
              <label className="field-label" htmlFor="splice-name">Give it a name</label><input id="splice-name" className="standard-input" value={spliceTitle} onChange={e => setSpliceTitle(e.target.value)} placeholder="A name that brings you back" disabled={!selected}/>
              <div className="time-row"><div><label className="field-label" htmlFor="time-start">START AT</label><input id="time-start" className="time-input" value={start} onChange={e => setStart(e.target.value)} placeholder="00:00" disabled={!selected}/></div><div className="time-connector"/><div><label className="field-label" htmlFor="time-end">END AT</label><input id="time-end" className="time-input" value={end} onChange={e => setEnd(e.target.value)} placeholder="00:30" disabled={!selected}/></div><div className="duration-chip"><Clock3 size={13}/>{Number.isFinite(stamp(end) - stamp(start)) ? Math.max(0, stamp(end) - stamp(start)) : 0}s</div></div>
              <div className="time-hint">Use <b>MM:SS</b> or <b>HH:MM:SS</b>. Match these times to your uploaded audio.</div>
              <button className="primary-button full create-button" disabled={!selected || busy === 'splice'}>{busy === 'splice' ? <><LoaderCircle className="spin" size={16}/> Making your MP3…</> : <><Scissors size={16}/> Create new splice <span>↗</span></>}</button>
            </form>
          </section>
          <aside className="preview-panel">
            <div className="preview-head"><div><div className="eyebrow">IN YOUR LIBRARY</div><h2>Recent splices</h2></div><button className="round-more" onClick={() => setTab('library')} aria-label="Open library">↗</button></div>
            <div className="recent-list">{sources.flatMap(source => source.splices.map(splice => ({...splice, sourceTitle: source.title}))).slice(0, 4).map((splice, i) => <div className="recent-item" key={splice._id}><div className={`cover cover-${i % 4}`}><AudioLines size={19}/></div><div className="recent-copy"><strong>{splice.title}</strong><span>{splice.sourceTitle}</span></div><span className="recent-duration">{formatTime(splice.end - splice.start)}</span><a className="download-mini" href={splice.audioUrl || '#'} download={`${splice.title}.mp3`} aria-label={`Download ${splice.title}`}><ArrowDownToLine size={15}/></a></div>)}
              {totalSplices === 0 && <div className="empty-recent"><div className="empty-disc"><AudioLines size={22}/></div><strong>Your first splice is waiting.</strong><span>Make a small cut from a long listen<br/>and it’ll show up right here.</span><div className="empty-wave">▂ ▄ ▆ ▃ ▅ ▇ ▄ ▂ ▅ ▃ ▆ ▄ ▂</div></div>}
            </div>
            {selected && <div className="current-source"><span className="pulse-dot"/> <span>WORKING FROM</span><strong>{selected.title}</strong></div>}
            <div className="note-card"><div className="note-icon">✳</div><div><strong>Keep the moment.</strong><p>Clips you create are saved as MP3s in your Convex library.</p></div></div>
            <div className="legal-note"><CircleHelp size={13}/> Upload audio you own or have permission to edit. Aria embeds YouTube for playback; it does not download audio from YouTube.</div>
          </aside>
        </div>
      </section> : <section className="library-page">
        <div className="page-heading library-heading"><div><div className="eyebrow">YOUR KEEPERS</div><h1>The <em>library.</em></h1><p>Every little piece you’ve saved, all in one place.</p></div><button className="primary-button" onClick={() => {setSelectedId(null); setTab('splicer')}}><Plus size={16}/> Create new splice</button></div>
        <div className="library-toolbar"><div><strong>{totalSplices} {totalSplices === 1 ? 'splice' : 'splices'}</strong><span> across {sources.length} {sources.length === 1 ? 'source' : 'sources'}</span></div><div className="search-box"><Search size={15}/><input placeholder="Search your library" value={query} onChange={e => setQuery(e.target.value)}/></div></div>
        {filteredSources.length ? <div className="library-groups">{filteredSources.map(source => <div className="library-group" key={source._id}><div className="group-head"><div className="source-icon"><Music2 size={17}/></div><div className="group-title"><strong>{source.title}</strong><a href={source.videoUrl} target="_blank" rel="noreferrer">youtube.com/watch?v={source.videoId} ↗</a></div><span className="group-count">{source.splices.length} {source.splices.length === 1 ? 'splice' : 'splices'}</span><button className="small-action" onClick={() => {setSelectedId(source._id); setTab('splicer')}}><Plus size={13}/> New splice</button><button className="icon-button delete-source" title="Delete source and its splices" onClick={async () => {if (confirm(`Delete “${source.title}” and all its splices?`)) {await deleteSource({id:source._id}); fileCache.delete(source._id); if (selectedId === source._id) setSelectedId(null)}}}><Trash2 size={15}/></button></div>
            {source.splices.length ? <div className="library-splices">{source.splices.map((splice, i) => <div className="library-row" key={splice._id}><div className={`cover cover-${i%4}`}><AudioLines size={18}/></div><div className="library-song"><strong>{splice.title}</strong><span>{formatTime(splice.start)} — {formatTime(splice.end)}</span></div><span className="song-length">{formatTime(splice.end - splice.start)}</span><audio className="audio-player" controls preload="none" src={splice.audioUrl || undefined}/><a className="download-button" href={splice.audioUrl || '#'} download={`${splice.title}.mp3`}><ArrowDownToLine size={15}/> MP3</a><button className="icon-button" title="Delete splice" onClick={() => deleteSplice({id:splice._id})}><Trash2 size={15}/></button></div>)}</div> : <div className="group-empty">No splices yet. <button onClick={() => {setSelectedId(source._id); setTab('splicer')}}>Create one <span>↗</span></button></div>}</div>)}</div> : <div className="library-empty"><div className="empty-disc"><Library size={21}/></div><h3>{sources.length ? 'No matches found.' : 'Nothing saved here yet.'}</h3><p>{sources.length ? 'Try another title or source.' : 'Add a source in the splicer. Your clips will appear here.'}</p><button className="primary-button" onClick={() => setTab('splicer')}><Plus size={15}/> Go to splicer</button></div>}
      </section>}
      {error && <div className="toast error-toast"><X size={15}/>{error}<button onClick={() => setError('')}><X size={14}/></button></div>}{notice && <div className="toast success-toast"><Check size={15}/>{notice}<button onClick={() => setNotice('')}><X size={14}/></button></div>}
    </main>
  </div>
}

const fileCache = new Map()

function Root() {
  if (!convexUrl) return <div className="setup-screen"><div className="setup-card"><div className="brand"><div className="brand-mark"><AudioLines size={19}/></div><span>aria</span><span className="brand-dot">.</span></div><h1>One quick setup.</h1><p>Connect Aria to a Convex deployment so your sources, splices, and MP3 files are saved in your library.</p><ol><li>Run <code>npm install</code> and <code>npx convex dev</code>.</li><li>Copy the deployment URL into <code>.env.local</code> as <code>VITE_CONVEX_URL</code>.</li><li>Restart <code>npm run dev</code>.</li></ol></div></div>
  return <ConvexProvider client={client}><App/></ConvexProvider>
}

createRoot(document.getElementById('root')).render(<Root/>)
