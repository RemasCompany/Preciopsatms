'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function Login() {
  const [err, setErr] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const r = await signIn('credentials', { email: f.get('email'), password: f.get('password'), redirect: false });
    if (r?.error) setErr('Email or password is incorrect.'); else window.location.href = '/app';
  }
  return (
    <main className="public" style={{ maxWidth: 420 }}>
      <h1>Sign in</h1>
      <form className="card" onSubmit={submit}>
        <label>Email<input name="email" type="email" required autoComplete="email" /></label>
        <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn">Sign in</button>
      </form>
    </main>
  );
}
