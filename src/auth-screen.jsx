import React, { useState } from 'react'
import { AudioLines } from 'lucide-react'
import { authClient } from './auth-client.js'

export function AuthScreen({ loading, denied }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const creating = mode === 'signup'

  async function submit(event) {
    event.preventDefault()
    if (pending) return
    const form = new FormData(event.currentTarget)
    const address = email.trim().toLowerCase()
    const credentials = { email: address, password: form.get('password'), callbackURL: window.location.origin }
    setPending(true)
    setError('')
    try {
      const result = creating
        ? await authClient.signUp.email({ ...credentials, name: address.split('@')[0] })
        : await authClient.signIn.email(credentials)
      if (result.error) {
        if (result.error.code === 'EMAIL_NOT_VERIFIED') setMode('verify')
        else setError(result.error.message || 'Could not authenticate. Try again.')
      } else if (creating) {
        setMode('verify')
      }
    } catch {
      setError('Could not reach the sign-in service. Try again.')
    } finally {
      setPending(false)
    }
  }

  function switchMode(next) {
    setMode(next)
    setError('')
  }

  return <main className="setup-screen">
    <section className="setup-card auth-card">
      <div className="brand"><div className="brand-mark"><AudioLines size={19}/></div><span>Atropos</span></div>
      {loading ? <h1 role="status">Checking your session…</h1> : denied ? <>
        <h1>Access unavailable</h1>
        <p>This workspace requires an approved, verified email address.</p>
        <button className="primary-button full" onClick={() => authClient.signOut()}>Sign out</button>
      </> : mode === 'verify' ? <>
        <h1>Check your email</h1>
        <p>Open the verification link sent to {email}. Then sign in.</p>
        <button className="primary-button full" onClick={() => switchMode('signin')}>Back to sign in</button>
      </> : <>
        <h1>{creating ? 'Create account' : 'Sign in'}</h1>
        <form key={mode} onSubmit={submit}>
          <label className="field-label" htmlFor="auth-email">Email</label>
          <input className="standard-input" id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required/>
          <label className="field-label optional-label" htmlFor="auth-password">Password</label>
          <input className="standard-input" id="auth-password" name="password" type="password" autoComplete={creating ? 'new-password' : 'current-password'} minLength={creating ? 12 : undefined} required/>
          {creating && <p>Use at least 12 characters.</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-button full" disabled={pending}>{pending ? 'Please wait…' : creating ? 'Create account' : 'Sign in'}</button>
        </form>
        <button className="auth-switch" type="button" disabled={pending} onClick={() => switchMode(creating ? 'signin' : 'signup')}>{creating ? 'Back to sign in' : 'Create an account'}</button>
      </>}
    </section>
  </main>
}
