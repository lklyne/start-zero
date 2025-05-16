import { AppSidebar } from '@/components/app-sidebar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { initializeZero, zeroAtom } from '@/lib/zero-setup'
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
	const { user } = Route.useRouteContext()
	console.log('🔐 Root route context:', { user })

	// Initialize Zero with user data
	useEffect(() => {
		if (!user) return
		initializeZero(user)
	}, [user])

	if (!zero) return null

	return (
		<Suspense fallback={null}>
			<ZeroProvider zero={zero}>
				<AppContent />
			</ZeroProvider>
		</Suspense>
	)
}
