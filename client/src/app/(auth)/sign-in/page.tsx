'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import Image from 'next/image';
import Link from 'next/link';
import { Icon, Spinner } from '@/components/ui/icon';

import { signInSchema } from '@/schemas/signInSchema';
import { useAuth } from '@/context/AuthContext';
import { RequireGuest } from '@/components/RouteGuard';
import { ApiError } from '@/lib/chat-api';
import Logo from '@/app/images/Logo.png';
import { Form, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

function SignInForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const { signIn } = useAuth();

  const form = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    defaultValues: { identifier: '', password: '' },
  });

  const onSubmit = async (data: z.infer<typeof signInSchema>) => {
    setIsSubmitting(true);

    try {
      await signIn(data.identifier, data.password);
      toast({ title: 'Welcome back!', description: 'Successfully signed in' });
      router.replace('/chat');
    } catch (error) {
      toast({
        title: 'Login failed',
        description:
          error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <Image src={Logo} alt="" className="h-12 w-12" />
        </div>

        <h1 className="mb-6 text-3xl font-semibold text-foreground">Sign in</h1>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              name="identifier"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-foreground">Email / Username</FormLabel>
                  <Input {...field} placeholder="Enter your email or username" />
                  <FormMessage className="font-medium" />
                </FormItem>
              )}
            />

            <FormField
              name="password"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-foreground">Password</FormLabel>
                  <div className="relative">
                    <Input
                      {...field}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                      onClick={() => setShowPassword((prev) => !prev)}
                    >
                      <Icon name={showPassword ? 'hide' : 'show'} size={18} />
                    </button>
                  </div>
                  <FormMessage className="font-medium" />
                </FormItem>
              )}
            />

            <Button type="submit" className="h-11 w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>
        </Form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/sign-up" className="font-medium text-foreground underline underline-offset-4">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <RequireGuest>
      <SignInForm />
    </RequireGuest>
  );
}
