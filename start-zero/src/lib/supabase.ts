import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { parseCookies, setCookie } from '@tanstack/react-start/server'

export function getSupabaseServerClient() {
	const url = import.meta.env.VITE_SUPABASE_URL
	const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
	if (!url || !anon) throw new Error('Missing Supabase environment variables')

	return createServerClient(url, anon, {
		cookies: {
			get(name: string) {
				const cookies = parseCookies()
				return cookies[name]
			},
			set(name: string, value: string, options: CookieOptions) {
				setCookie(name, value, options)
			},
			remove(name: string, options: CookieOptions) {
				setCookie(name, '', { ...options, maxAge: -1 })
			},
		},
	})
}
