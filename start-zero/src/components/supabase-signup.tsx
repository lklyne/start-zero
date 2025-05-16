'use client'

import { Button } from '@/components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { getSupabaseServerClient } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

// Define the form schema
const formSchema = z.object({
	email: z.string().email('Please enter a valid email address'),
	password: z.string().min(2, 'Password must be at least 2 characters'),
})

// Server function for signup
export const signupFn = createServerFn({ method: 'POST' })
	.validator(
		(d: { email: string; password: string; redirectUrl?: string }) => d,
	)
	.handler(async ({ data }) => {
		const supabase = getSupabaseServerClient()
		const { error } = await supabase.auth.signUp({
			email: data.email,
			password: data.password,
		})

		if (error) {
			return {
				error: true,
				message: error.message,
			}
		}

		// Redirect to the prev page stored in the "redirect" search param
		throw redirect({
			href: data.redirectUrl || '/',
		})
	})

export function SupabaseSignupForm({
	className,
	...props
}: React.ComponentPropsWithoutRef<'div'>) {
	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			email: '',
			password: '',
		},
	})

	async function onSubmit(values: z.infer<typeof formSchema>) {
		try {
			await signupFn({
				data: {
					email: values.email,
					password: values.password,
					redirectUrl: window.location.search
						? new URLSearchParams(window.location.search).get('redirect') || '/'
						: '/',
				},
			})
		} catch (error) {
			console.error('Signup error:', error)
			form.setError('root', {
				message: 'An error occurred during signup. Please try again.',
			})
		}
	}

	return (
		<div className={cn('flex w-full flex-col gap-4', className)} {...props}>
			<Card>
				<CardHeader>
					<CardTitle className='text-2xl'>Sign Up</CardTitle>
					<CardDescription>Create an account to get started</CardDescription>
				</CardHeader>
				<CardContent>
					<Form {...form}>
						<form
							onSubmit={form.handleSubmit(onSubmit)}
							className='flex flex-col gap-6'
						>
							<FormField
								control={form.control}
								name='email'
								render={({ field }) => (
									<FormItem>
										<FormLabel>Email</FormLabel>
										<FormControl>
											<Input
												placeholder='m@example.com'
												type='email'
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name='password'
								render={({ field }) => (
									<FormItem>
										<FormLabel>Password</FormLabel>
										<FormControl>
											<Input type='password' {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							{/* Show form-level errors if any */}
							{form.formState.errors.root && (
								<div className='text-sm text-destructive'>
									{form.formState.errors.root.message}
								</div>
							)}

							<Button
								type='submit'
								className='w-full rounded'
								disabled={form.formState.isSubmitting}
							>
								{form.formState.isSubmitting ? 'Signing up...' : 'Sign Up'}
							</Button>
						</form>
					</Form>
					<div className='text-center text-sm pt-6'>
						Already have an account?{' '}
						<Link to='/auth/login' className='underline underline-offset-4'>
							Login
						</Link>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
