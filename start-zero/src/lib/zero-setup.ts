import { Atom } from '@/lib/atom'
import { type Mutators, createMutators } from '@/mutators/client'
import type { AuthData, ZeroSchema } from '@/server/db/zero-permissions'
import { schema } from '@/server/db/zero-schema.gen'
import { Zero } from '@rocicorp/zero'
import { CACHE_FOREVER } from './query-cache-policy'

export type User = {
	id: string
	email: string
	name: string
	accessToken: string
}

const zeroAtom = new Atom<Zero<ZeroSchema, Mutators>>()

let didPreload = false

export function preload(z: Zero<ZeroSchema, Mutators>) {
	if (didPreload) {
		return
	}
	didPreload = true

	// Preload all users and persons with CACHE_FOREVER policy
	z.query.users.preload(CACHE_FOREVER)
	z.query.persons.preload(CACHE_FOREVER)
}

export function initializeZero(user: User) {
	// Close existing instance if any
	// removing this doesn't seem to cause issues?
	// zeroAtom.value?.close()

	// Ensure server URL is provided
	const serverURL = import.meta.env.VITE_PUBLIC_SERVER
	if (!serverURL) {
		throw new Error(
			'VITE_PUBLIC_SERVER environment variable is not set. Zero cannot connect.',
		)
	}

	const authData: AuthData = {
		sub: user.id,
		email: user.email,
		name: user.name,
	}

	const zero = new Zero<ZeroSchema, Mutators>({
		schema,
		server: serverURL,
		logLevel: 'error',
		userID: user.id,
		mutators: createMutators(authData),
		auth: () => user.accessToken,
	})

	zeroAtom.value = zero

	// Call preload after zero instance is created
	preload(zero)
	console.log('🟪 Creating new Zero instance')
}

export { zeroAtom }
