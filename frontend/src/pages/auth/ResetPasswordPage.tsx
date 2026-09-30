import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';
import {
  KeyRound,
  CheckCircle2,
  XCircle,
  Check,
  Lock,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { auth } from '../../config/firebase';
import { Alert, AlertDescription, Box, Button, CardContent, CardDescription, CardHeader, CardTitle, Flex, FormField, IconMedallion, Input, Spinner, Stack, Typography } from '../../components/ui';
import { AuthShell } from '../../components/shells';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'verifying' | 'reset' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const oobCode = searchParams.get('oobCode');

  const getErrorCode = (error: unknown): string | undefined => {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    return undefined;
  };

  useEffect(() => {
    const verifyCode = async () => {
      if (!oobCode) {
        setStatus('error');
        setErrorMessage('Invalid password reset link. No reset code was provided in the URL.');
        return;
      }
      try {
        await verifyPasswordResetCode(auth, oobCode);
        setStatus('reset');
      } catch (error: unknown) {
        setStatus('error');
        const errorCode = getErrorCode(error);
        if (errorCode === 'auth/invalid-action-code') {
          setErrorMessage('This password reset link is invalid or has already been used.');
        } else if (errorCode === 'auth/expired-action-code') {
          setErrorMessage('This password reset link has expired. Please request a new one.');
        } else {
          setErrorMessage('Failed to verify reset link. Please check the URL or request a new link.');
        }
      }
    };
    verifyCode();
  }, [oobCode]);

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }
    if (!oobCode) {
      setErrorMessage('Invalid reset code.');
      return;
    }

    setIsSubmitting(true);
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      setStatus('success');
      setTimeout(() => navigate('/', { replace: true }), 3000);
    } catch (error: unknown) {
      setStatus('error');
      const errorCode = getErrorCode(error);
      if (errorCode === 'auth/weak-password') {
        setErrorMessage('Password is too weak. Please use a stronger combination of characters.');
      } else {
        setErrorMessage('Failed to reset password. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Password requirements calculation
  const isMinLengthMet = newPassword.length >= 6;
  const hasLettersAndNumbers = /[a-zA-Z]/.test(newPassword) && /[0-9]/.test(newPassword);
  const isMatchMet = Boolean(confirmPassword && newPassword === confirmPassword);

  // Strength score calculation (0 - 4)
  const strengthScore = useMemo(() => {
    if (!newPassword) return 0;
    let score = 0;
    if (newPassword.length >= 6) score += 1;
    if (newPassword.length >= 10) score += 1;
    if (/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)) score += 1;
    if (/[0-9]/.test(newPassword) && /[^A-Za-z0-9]/.test(newPassword)) score += 1;
    return score;
  }, [newPassword]);

  const strengthLabel = useMemo(() => {
    if (!newPassword) return '';
    if (strengthScore <= 1) return 'Weak';
    if (strengthScore === 2) return 'Fair';
    if (strengthScore === 3) return 'Good';
    return 'Strong';
  }, [newPassword, strengthScore]);

  const strengthColor = useMemo(() => {
    if (strengthScore <= 1) return 'var(--destructive)';
    if (strengthScore === 2) return 'var(--rt-color-warning)';
    if (strengthScore === 3) return 'var(--primary)';
    return 'var(--rt-color-success)';
  }, [strengthScore]);

  const strengthTrackColor = 'var(--muted)';

  return (
    <AuthShell>
      {/* 1. Verifying State */}
      {status === 'verifying' && (
        <CardHeader style={{ alignItems: 'center', textAlign: 'center', paddingTop: 48 }}>
          <Box sx={{ mb: 2 }}>
            <IconMedallion tone="primary" shape="rounded" style={{ width: 56, height: 56 }}>
              <Spinner size={28} />
            </IconMedallion>
          </Box>
          <CardTitle style={{ fontSize: '1.25rem', fontWeight: 700 }}>
            Verifying Reset Link
          </CardTitle>
          <CardDescription style={{ maxWidth: '20rem' }}>
            Please wait while we validate your security token…
          </CardDescription>
        </CardHeader>
      )}

      {/* 2. Reset Form State */}
      {status === 'reset' && (
        <>
          <CardHeader style={{ alignItems: 'center', textAlign: 'center', paddingBottom: 16 }}>
            <Box sx={{ mb: 0.5 }}>
              <IconMedallion tone="primary" shape="rounded" style={{ width: 48, height: 48 }}>
                <KeyRound size={24} />
              </IconMedallion>
            </Box>
            <CardTitle style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              Create New Password
            </CardTitle>
            <CardDescription>
              Choose a strong, unique password to secure your TubeKeter account.
            </CardDescription>
          </CardHeader>

          <CardContent style={{ paddingTop: 8 }}>
            <form onSubmit={handlePasswordReset}>
              <Stack gap={2}>
                {/* New Password Input */}
                <FormField
                  label={
                    <Flex alignItems="center" gap={0.75}>
                      <Lock size={14} style={{ color: 'var(--muted-foreground)' }} />
                      <Typography variant="caption" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground)' }}>
                        New Password
                      </Typography>
                    </Flex>
                  }
                  htmlFor="newPassword"
                >
                  <Input
                    id="newPassword"
                    type="password"
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setErrorMessage('');
                    }}
                    required
                    minLength={6}
                  />
                </FormField>

                {/* Password Strength Meter */}
                {newPassword.length > 0 && (
                  <Stack gap={0.75} style={{ paddingTop: 4 }}>
                    <Flex justifyContent="space-between" alignItems="center">
                      <Typography variant="caption">Security Strength</Typography>
                      <Typography variant="caption" style={{ fontWeight: 600, color: 'var(--foreground)' }}>{strengthLabel}</Typography>
                    </Flex>
                    <Flex gap={0.75}>
                      {[1, 2, 3, 4].map((step) => (
                        <Box
                          key={step}
                          style={{
                            flex: 1,
                            height: 6,
                            borderRadius: 9999,
                            backgroundColor: strengthScore >= step ? strengthColor : strengthTrackColor,
                          }}
                        />
                      ))}
                    </Flex>
                  </Stack>
                )}

                {/* Confirm Password Input */}
                <FormField
                  label={
                    <Flex alignItems="center" gap={0.75}>
                      <ShieldCheck size={14} style={{ color: 'var(--muted-foreground)' }} />
                      <Typography variant="caption" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground)' }}>
                        Confirm Password
                      </Typography>
                    </Flex>
                  }
                  htmlFor="confirmPassword"
                >
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setErrorMessage('');
                    }}
                    required
                    minLength={6}
                  />
                </FormField>

                {/* Requirements Checklist Card */}
                <Box style={{ border: '1px solid var(--border)', borderRadius: 12, backgroundColor: 'color-mix(in srgb, var(--muted) 40%, transparent)', padding: 12 }}>
                  <Stack gap={1}>
                    <RequirementRow met={isMinLengthMet} label="At least 6 characters" />
                    <RequirementRow met={hasLettersAndNumbers} label="Letters and numbers mixed" />
                    <RequirementRow met={isMatchMet} label="Passwords match" />
                  </Stack>
                </Box>

                {/* Error Notification */}
                {errorMessage && (
                  <Alert severity="error">
                    <AlertDescription>{errorMessage}</AlertDescription>
                  </Alert>
                )}

                {/* Submit Button */}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  disabled={isSubmitting || !isMinLengthMet || !isMatchMet}
                >
                  {isSubmitting ? (
                    <>
                      <Spinner size="xs" />
                      Saving Password…
                    </>
                  ) : (
                    <>
                      Reset Password
                      <ArrowRight size={16} />
                    </>
                  )}
                </Button>
              </Stack>
            </form>
          </CardContent>
        </>
      )}

      {/* 3. Success State */}
      {status === 'success' && (
        <Box sx={{ px: 3, py: 4, textAlign: 'center' }}>
          <Stack alignItems="center" gap={2.5}>
            <IconMedallion tone="success" shape="rounded" style={{ width: 64, height: 64 }}>
              <CheckCircle2 size={36} />
            </IconMedallion>
            <Stack alignItems="center" gap={1}>
              <CardTitle style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                Password Updated!
              </CardTitle>
              <CardDescription style={{ maxWidth: '20rem', marginInline: 'auto' }}>
                Your password has been changed securely. You will be redirected to the sign-in page in a few seconds.
              </CardDescription>
            </Stack>
            <Box sx={{ width: '100%', pt: 1 }}>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => navigate('/', { replace: true })}
              >
                Sign In Now
                <ArrowRight size={16} />
              </Button>
            </Box>
          </Stack>
        </Box>
      )}

      {/* 4. Error State */}
      {status === 'error' && (
        <Box sx={{ px: 3, py: 4, textAlign: 'center' }}>
          <Stack alignItems="center" gap={2.5}>
            <IconMedallion tone="destructive" shape="rounded" style={{ width: 64, height: 64 }}>
              <XCircle size={36} />
            </IconMedallion>
            <Stack alignItems="center" gap={1}>
              <CardTitle style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                Invalid Reset Link
              </CardTitle>
              <CardDescription style={{ color: 'var(--destructive)', maxWidth: '20rem', marginInline: 'auto' }}>
                {errorMessage}
              </CardDescription>
            </Stack>
            <Box sx={{ width: '100%', pt: 1 }}>
              <Stack alignItems="center" gap={1.25}>
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  onClick={() => navigate('/')}
                >
                  <RotateCcw size={16} />
                  Return to Sign In
                </Button>
                <Typography variant="caption">
                  Need a new reset email? Please submit another request from the sign in page.
                </Typography>
              </Stack>
            </Box>
          </Stack>
        </Box>
      )}
    </AuthShell>
  );
}

/* ── Helper: RequirementRow ───────────────────────────────────────────────── */
/* Page-local composition built only from shared primitives. */
function RequirementRow({ met, label }: { met: boolean; label: string }) {
  return (
    <Flex alignItems="center" gap={1}>
      <Flex
        alignItems="center"
        justifyContent="center"
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          backgroundColor: met ? 'color-mix(in srgb, var(--rt-color-success) 15%, transparent)' : 'var(--muted)',
          color: met ? 'var(--rt-color-success)' : undefined,
        }}
      >
        <Check size={10} />
      </Flex>
      <Typography variant="caption" style={met ? { fontWeight: 500, color: 'var(--rt-color-success)' } : undefined}>
        {label}
      </Typography>
    </Flex>
  );
}
