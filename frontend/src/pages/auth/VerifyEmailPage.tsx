import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { applyActionCode } from 'firebase/auth';
import { CheckCircle2, XCircle, ArrowRight, RotateCcw } from 'lucide-react';
import { auth } from '../../config/firebase';
import { Box, Button, CardContent, CardDescription, CardHeader, CardTitle, IconMedallion, Spinner, Stack } from '../../components/ui';
import { AuthShell } from '../../components/shells';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const mode = searchParams.get('mode');
    if (mode === 'resetPassword') {
      navigate(`/reset-password?${searchParams.toString()}`, { replace: true });
      return;
    }

    const verifyEmail = async () => {
      const oobCode = searchParams.get('oobCode');

      if (!oobCode) {
        setStatus('error');
        setErrorMessage('Invalid verification link. No verification code was found in the URL.');
        return;
      }

      try {
        await applyActionCode(auth, oobCode);
        if (auth.currentUser) {
          await auth.currentUser.reload();
        }
        setStatus('success');
        setTimeout(() => navigate('/dashboard'), 3000);
      } catch (error: unknown) {
        setStatus('error');
        const code = typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
        if (code === 'auth/invalid-action-code') {
          setErrorMessage('This verification link is invalid or has already been used.');
        } else if (code === 'auth/expired-action-code') {
          setErrorMessage('This verification link has expired. Please request a new verification email.');
        } else {
          setErrorMessage('Failed to verify email. Please try again or contact support.');
        }
      }
    };

    verifyEmail();
  }, [searchParams, navigate]);

  return (
    <AuthShell>
      {status === 'verifying' && (
        <CardHeader style={{ alignItems: 'center', textAlign: 'center', paddingTop: 48 }}>
          <Box sx={{ mb: 2 }}>
            <IconMedallion tone="primary" shape="rounded" style={{ width: 56, height: 56 }}>
              <Spinner size={28} />
            </IconMedallion>
          </Box>
          <CardTitle style={{ fontSize: '1.25rem', fontWeight: 700 }}>Verifying Your Email</CardTitle>
          <CardDescription style={{ maxWidth: '20rem' }}>
            Please wait while we confirm your email address and update your account…
          </CardDescription>
        </CardHeader>
      )}

      {status === 'success' && (
        <Box sx={{ px: 3, py: 4, textAlign: 'center' }}>
          <Stack alignItems="center" gap={2.5}>
            <IconMedallion tone="success" shape="rounded" style={{ width: 64, height: 64 }}>
              <CheckCircle2 size={36} />
            </IconMedallion>
            <Stack alignItems="center" gap={1}>
              <CardTitle style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                Email Verified!
              </CardTitle>
              <CardDescription style={{ maxWidth: '20rem', marginInline: 'auto' }}>
                Your email has been verified successfully. We are redirecting you to your dashboard now.
              </CardDescription>
            </Stack>
            <CardContent style={{ width: '100%', padding: '8px 0 0' }}>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => navigate('/dashboard')}
              >
                Go to Dashboard Now
                <ArrowRight size={16} />
              </Button>
            </CardContent>
          </Stack>
        </Box>
      )}

      {status === 'error' && (
        <Box sx={{ px: 3, py: 4, textAlign: 'center' }}>
          <Stack alignItems="center" gap={2.5}>
            <IconMedallion tone="destructive" shape="rounded" style={{ width: 64, height: 64 }}>
              <XCircle size={36} />
            </IconMedallion>
            <Stack alignItems="center" gap={1}>
              <CardTitle style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                Verification Failed
              </CardTitle>
              <CardDescription style={{ color: 'var(--destructive)', maxWidth: '20rem', marginInline: 'auto' }}>
                {errorMessage}
              </CardDescription>
            </Stack>
            <CardContent style={{ width: '100%', padding: '8px 0 0' }}>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => navigate('/')}
              >
                <RotateCcw size={16} />
                Back to Sign In
              </Button>
            </CardContent>
          </Stack>
        </Box>
      )}
    </AuthShell>
  );
}
