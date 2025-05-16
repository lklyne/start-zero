import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed')({
	loader: async ({ location, context }) => {
		// Use existing root context if available during client navigation
		if (context?.user) return { user: context.user }

		// No user in context, redirect to login immediately
		throw redirect({ to: '/auth/login', search: { redirect: location.href } })
	},
	component: AuthWrapper,
})

function AuthWrapper() {
	const { user } = Route.useRouteContext()
	console.log('🔐 _authed route context:', { user })

	return <Outlet />
}
