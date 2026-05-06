/**
 * "Sign in with Kubeez" button — gates AI generation in KubeezCut.
 *
 * Click → bounce to kubeez.com/auth?redirect_to=<here>. After sign-in
 * (email/password or Google OAuth), the kubeez Auth flow validates the
 * redirect target against its `*.kubeez.com` allow-list and sends the
 * user back. The shared `.kubeez.com` cookie means subsequent visits
 * skip the bounce entirely.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { KUBEEZ_BRAND_LOGO_URL } from '@/components/brand/kubeez-cut-logo';
import { useKubeezSession } from '@/shared/state/kubeez-account';
import { cn } from '@/shared/ui/cn';

type ButtonElementProps = React.ComponentProps<typeof Button>;

export interface SignInWithKubeezButtonProps extends Omit<ButtonElementProps, 'onClick' | 'children'> {
  /** Override the default label ("Sign in with Kubeez"). */
  label?: string;
  /** Hide the small Kubeez logo. */
  hideIcon?: boolean;
}

export function SignInWithKubeezButton({
  label = 'Sign in with Kubeez',
  hideIcon = false,
  className,
  ...buttonProps
}: SignInWithKubeezButtonProps) {
  const { signIn, isConfigured, loading } = useKubeezSession();

  if (!isConfigured) return null;

  return (
    <Button
      type="button"
      onClick={signIn}
      disabled={loading || buttonProps.disabled}
      className={cn('gap-2', className)}
      {...buttonProps}
    >
      {!hideIcon && (
        <img
          src={KUBEEZ_BRAND_LOGO_URL}
          alt=""
          aria-hidden="true"
          className="h-4 w-4 object-contain"
        />
      )}
      {label}
    </Button>
  );
}
