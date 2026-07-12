'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useDebounce } from '@uidotdev/usehooks';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import Image from 'next/image';
import Link from 'next/link';
import { Icon, Spinner } from '@/components/ui/icon';

import { signUpSchema } from '@/schemas/signUpSchema';
import { useAuth } from '@/context/AuthContext';
import { RequireGuest } from '@/components/RouteGuard';
import { ApiError, checkUsername } from '@/lib/chat-api';
import Logo from '@/app/images/Logo.png';
import { Form, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

type UsernameState = 'idle' | 'checking' | 'available' | 'taken';

function SignUpForm() {
  const [username, setUsername] = useState('');
  const [usernameState, setUsernameState] = useState<UsernameState>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const debouncedUsername = useDebounce(username, 500);
  const router = useRouter();
  const { toast } = useToast();
  const { signUp } = useAuth();

  const form = useForm<z.infer<typeof signUpSchema>>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { username: '', email: '', password: '' },
  });

  useEffect(() => {
    // Only ask the server once the value could plausibly be valid — otherwise
    // every keystroke of "ab" fires a request that can only ever 400.
    if (!/^[a-zA-Z0-9]{3,20}$/.test(debouncedUsername)) {
      setUsernameState('idle');
      return;
    }

    let cancelled = false;
    setUsernameState('checking');

    checkUsername(debouncedUsername)
      .then(({ available }) => {
        if (!cancelled) setUsernameState(available ? 'available' : 'taken');
      })
      .catch(() => {
        if (!cancelled) setUsernameState('idle');
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedUsername]);

  const onSubmit = async (data: z.infer<typeof signUpSchema>) => {
    setIsSubmitting(true);

    try {
      // register() signs the user in as well — the server returns a token.
      await signUp(data);
      toast({ title: 'Welcome!', description: 'Your account is ready' });
      router.replace('/chat');
    } catch (error) {
      toast({
        title: 'Sign up failed',
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

        <h1 className="mb-6 text-3xl font-semibold text-foreground">Create account</h1>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              name="username"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-foreground">Username</FormLabel>
                  <div className="relative">
                    <Input
                      {...field}
                      onChange={(event) => {
                        field.onChange(event);
                        setUsername(event.target.value);
                      }}
                      placeholder="Enter username"
                      className="pr-10"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {usernameState === 'checking' && (
                        <Spinner size={16} className="text-muted-foreground" />
                      )}
                      {usernameState === 'available' && (
                        <Icon name="tick" size={16} className="text-foreground" aria-label="Available" />
                      )}
                      {usernameState === 'taken' && (
                        <Icon name="alert" size={16} className="text-foreground" aria-label="Taken" />
                      )}
                    </div>
                  </div>
                  {usernameState === 'taken' && (
                    <p className="text-sm font-medium text-foreground">
                      That username is already taken
                    </p>
                  )}
                  <FormMessage className="font-medium" />
                </FormItem>
              )}
            />

            <FormField
              name="email"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-foreground">Email</FormLabel>
                  <Input {...field} type="email" placeholder="Enter email" />
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
                      placeholder="Enter password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                    >
                      <Icon name={showPassword ? 'hide' : 'show'} size={18} />
                    </button>
                  </div>
                  <FormMessage className="font-medium" />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="h-11 w-full"
              disabled={isSubmitting || usernameState === 'taken'}
            >
              {isSubmitting ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Creating account...
                </>
              ) : (
                'Create account'
              )}
            </Button>
          </form>
        </Form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <RequireGuest>
      <SignUpForm />
    </RequireGuest>
  );
}
