# Supabase Auth Migration Plan

This document outlines the step-by-step process to remove Better Auth and implement Supabase Auth in the application, with proper Zero Sync integration.

## 1. Install Supabase Dependencies

```bash
bun add @supabase/supabase-js
```

## 2. Add Supabase Auth Helpers for SSR

```bash
bun add @supabase/auth-helpers-shared
```

## 3. Set Up Environment Variables

Add to `.env`:

```
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Remove Better Auth variables:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## 4. Create Supabase Client

Create `src/lib/supabase.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Helper to get current session
export async function getSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    console.error('Error getting session:', error)
    return null
  }
  return data.session
}

// Helper to get current user
export async function getUser() {
  const { data, error } = await supabase.auth.getUser()
  if (error) {
    console.error('Error getting user:', error)
    return null
  }
  return data.user
}
```

## 5. Create Server-Side Supabase Client

Create `src/lib/supabase-server.ts`:

```typescript
import { createServerClient } from '@supabase/auth-helpers-shared'
import { cookies } from '@tanstack/react-router'

export function createServerSupabaseClient() {
  return createServerClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(key) {
          return cookies().get(key)?.value
        },
        set(key, value, options) {
          cookies().set(key, value, {
            ...options,
            path: '/',
          })
        },
        remove(key, options) {
          cookies().delete(key, {
            ...options,
            path: '/',
          })
        },
      },
    },
  )
}
```

## 6. Create Auth Hooks

Create `src/lib/auth-hooks.ts`:

```typescript
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { authAtom } from './zero-setup'
import type { Session, User } from '@supabase/supabase-js'

// Hook for accessing session
export function useSupabaseSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)

      // Update authAtom for Zero integration
      if (session) {
        authAtom.value = {
          encoded: session.access_token,
          decoded: {
            sub: session.user.id,
            email: session.user.email,
            name: session.user.user_metadata?.name || '',
          },
        }
      }
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)

      // Update authAtom for Zero integration
      if (session) {
        authAtom.value = {
          encoded: session.access_token,
          decoded: {
            sub: session.user.id,
            email: session.user.email,
            name: session.user.user_metadata?.name || '',
          },
        }
      } else {
        authAtom.value = undefined
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return { session, loading }
}

// Hook for accessing user
export function useSupabaseUser() {
  const { session, loading } = useSupabaseSession()
  return { user: session?.user || null, loading }
}
```

## 7. Update Zero Setup

Update `src/lib/zero-setup.ts`:

```typescript
import { Atom } from '@/lib/atom'
import { type Mutators, createMutators } from '@/mutators/client'
import type { AuthData, ZeroSchema } from '@/server/db/zero-permissions'
import { schema } from '@/server/db/zero-schema.gen'
import { Zero } from '@rocicorp/zero'
import { CACHE_FOREVER } from './query-cache-policy'
import { supabase } from './supabase'

export type LoginState = {
  encoded: string
  decoded: AuthData
}

const zeroAtom = new Atom<Zero<ZeroSchema, Mutators>>()
const authAtom = new Atom<LoginState>()

let didPreload = false
let _prevEncoded: string | undefined

export function preload(z: Zero<ZeroSchema, Mutators>) {
  if (didPreload) return
  didPreload = true
  z.query.users.preload(CACHE_FOREVER)
  z.query.persons.preload(CACHE_FOREVER)
}

// Re-create Zero whenever auth changes
authAtom.onChange((auth) => {
  if (!auth) return

  const newEncoded = auth?.encoded
  if (newEncoded === _prevEncoded) return
  _prevEncoded = newEncoded

  zeroAtom.value?.close()
  console.log('🟪 Creating new Zero instance')

  const server = import.meta.env.VITE_PUBLIC_SERVER
  if (!server) {
    throw new Error(
      'VITE_PUBLIC_SERVER environment variable is not set. Zero cannot connect.',
    )
  }

  const authData = auth?.decoded
  const zero = new Zero<ZeroSchema, Mutators>({
    schema,
    server,
    logLevel: 'error',
    userID: authData?.sub ?? 'anon',
    mutators: createMutators(authData ?? { sub: null }),
    auth: async (error?: 'invalid-token') => {
      if (error === 'invalid-token') {
        // Sign out if token is invalid
        await supabase.auth.signOut()
        authAtom.value = undefined
        return undefined
      }
      return auth?.encoded
    },
  })

  zeroAtom.value = zero
  preload(zero)
})

export { zeroAtom, authAtom }
```

## 8. Create Auth Components

Create `src/components/auth/login-form.tsx`:

```typescript
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { useNavigate } from '@tanstack/react-router'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      navigate({ to: '/app' })
    }
  }

  const handleGoogleLogin = async () => {
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleLogin} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <div className="text-red-500 text-sm">{error}</div>}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">Or</span>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={handleGoogleLogin}
        disabled={loading}
        className="w-full"
      >
        Continue with Google
      </Button>
    </div>
  )
}
```

Create `src/components/auth/signup-form.tsx`:

```typescript
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { useNavigate } from '@tanstack/react-router'

export function SignUpForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
        },
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      navigate({ to: '/app' })
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSignUp} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <div className="text-red-500 text-sm">{error}</div>}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Signing up...' : 'Sign up'}
        </Button>
      </form>
    </div>
  )
}
```

Create `src/components/auth/logout-button.tsx`:

```typescript
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { useNavigate } from '@tanstack/react-router'

export function LogoutButton() {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate({ to: '/auth/login' })
  }

  return (
    <Button variant="outline" onClick={handleLogout}>
      Sign out
    </Button>
  )
}
```

## 9. Create Auth Callback Handler

Create `src/routes/auth/callback.tsx`:

```typescript
import { supabase } from '@/lib/supabase'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallback,
})

function AuthCallback() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Process the OAuth callback
        const { error } = await supabase.auth.getSession()

        if (error) {
          setError(error.message)
          return
        }

        // Redirect to app on success
        window.location.href = '/app'
      } catch (err) {
        setError('An unexpected error occurred')
        console.error(err)
      }
    }

    handleCallback()
  }, [])

  if (error) {
    return <div className="p-4">Error: {error}</div>
  }

  return <div className="p-4">Processing login...</div>
}
```

## 10. Update Protected Routes

Update `src/routes/_authed.tsx`:

```typescript
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useSupabaseSession } from '@/lib/auth-hooks'

export const Route = createFileRoute('/_authed')({
  ssr: true,
  loader: async ({ location, context }) => {
    // Server-side auth check using server client
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase.auth.getSession()

    if (error || !data.session) {
      throw redirect({
        to: '/auth/login',
        search: { redirect: location.href }
      })
    }

    return { session: data.session }
  },
  component: AuthWrapper,
})

function AuthWrapper() {
  // Client-side auth management
  const { loading } = useSupabaseSession()

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>
  }

  return <Outlet />
}
```

## 11. Update User Sync to Zero

Update `src/routes/_authed/app/route.tsx`:

```typescript
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { zeroAtom } from '@/lib/zero-setup'
import { useSupabaseSession } from '@/lib/auth-hooks'
import { ZeroProvider } from '@rocicorp/zero/react'
import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
import { useEffect } from 'react'
import { Suspense } from 'react'

export const Route = createFileRoute('/_authed/app')({
  component: RouteComponent,
  ssr: false,
})

function AppContent() {
  return (
    <SidebarProvider className='flex h-screen'>
      <AppSidebar variant='inset' />
      <div className='flex-1 p-2'>
        <main className='h-full border border-border bg-background rounded flex flex-col overflow-hidden'>
          <Outlet />
        </main>
      </div>
    </SidebarProvider>
  )
}

function RouteComponent() {
  const zero = useSyncExternalStore(zeroAtom.onChange, () => zeroAtom.value)
  const { session } = useSupabaseSession()

  // upsert user into Zero
  useEffect(() => {
    if (!zero || !session) return
    console.log('🔄 Upserting user into Zero')
    zero.mutate.users.upsert({
      id: session.user.id,
      email: session.user.email ?? '',
      name: session.user.user_metadata.name ?? '',
    })
  }, [zero, session])

  if (!zero) return null

  return (
    <Suspense fallback={null}>
      <ZeroProvider zero={zero}>
        <AppContent />
      </ZeroProvider>
    </Suspense>
  )
}
```

## 12. Update User Deletion Flow

Create `src/lib/delete-user.ts`:

```typescript
import { supabase } from './supabase'
import { deleteUserFromZero } from './delete-user-from-zero'

export async function deleteUser(): Promise<{
  success: boolean
  error?: string
}> {
  try {
    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return { success: false, error: userError?.message || 'User not found' }
    }

    // Delete user data from Zero
    await deleteUserFromZero(user.id)

    // Delete Supabase user
    const { error } = await supabase.auth.admin.deleteUser(user.id)

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error('Error deleting user:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
```

## 13. Configure Zero Cache for Supabase Auth

Update your Zero Cache server configuration:

```bash
# Set environment variable for Zero Cache
ZERO_AUTH_JWKS_URL=https://[YOUR_PROJECT_ID].supabase.co/rest/v1/jwks
```

## 14. Files to Delete

Delete the following files that are no longer needed:

- `src/server/auth/auth.ts`
- `src/server/auth/jwt.ts`
- `src/server/auth/session.ts`
- `src/lib/auth-client.ts`
- `src/routes/api/auth/$.tsx`

## 15. Update Package.json

Remove Better Auth dependencies and add Supabase dependencies:

```diff
"dependencies": {
-  "better-auth": "^x.x.x",
+  "@supabase/supabase-js": "^2.x.x",
+  "@supabase/auth-helpers-shared": "^0.x.x",
   // other dependencies remain
}
```

## 16. Testing Checklist

- [ ] Sign up with email/password
- [ ] Sign in with email/password
- [ ] Sign in with Google
- [ ] Protected routes redirect to login
- [ ] User data syncs to Zero correctly
- [ ] Sign out works properly
- [ ] User deletion flow works properly

## References

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [Zero Sync Auth Documentation](https://zero.rocicorp.dev/docs/auth)
- [TanStack Router Auth Example](https://github.com/tanstack/router/tree/main/examples/react/start-supabase-basic)
