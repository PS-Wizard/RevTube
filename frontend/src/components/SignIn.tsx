import { useState } from 'react';
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth';
import { auth, googleProvider } from '../config/firebase';
import { TUBEKETER_SITE_URL, APP_DISPLAY_VERSION } from '../constants/productUrls';
import { BrandLoader } from './BrandLoader';
import { Button, Form, FormField, Input, Alert, AlertDescription, Box, Divider, Flex, FormControlLabel, IconMedallion, Link, Stack, Typography } from './ui';
import { Package, Download, TrendingUp, Send, Mail, LockKeyhole } from 'lucide-react';

interface SignInProps {
  onSignInSuccess: () => void;
  onSignInError: (error: string) => void;
}

type AuthMode = 'signin' | 'signup' | 'forgot-password';

export function SignIn({ onSignInSuccess, onSignInError }: SignInProps) {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  const [passwordResetSent, setPasswordResetSent] = useState(false);

  const applyPersistence = async () => {
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
    } catch {
      // Fall back gracefully if persistence config fails
    }
  };

  const handleGoogleSignIn = async () => {
    setLocalError(null);
    setIsLoggingIn(true);
    try {
      await applyPersistence();
      await signInWithPopup(auth, googleProvider);
      setTimeout(() => {
        onSignInSuccess();
      }, 500);
    } catch (error) {
      setIsLoggingIn(false);
      console.error('Sign-in error:', error);
      const msg = error instanceof Error ? `Sign-in failed: ${error.message}` : 'Sign-in failed. Please try again.';
      setLocalError(msg);
      onSignInError(msg);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (authMode === 'signup') {
      if (password.length < 6) {
        const msg = 'Password must be at least 6 characters long.';
        setLocalError(msg);
        onSignInError(msg);
        return;
      }
      if (password !== confirmPassword) {
        const msg = 'Passwords do not match.';
        setLocalError(msg);
        onSignInError(msg);
        return;
      }
    }

    setIsLoggingIn(true);
    try {
      await applyPersistence();
      if (authMode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password);
        setTimeout(() => {
          onSignInSuccess();
        }, 500);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        
        // Send verification email with custom action URL
        const actionCodeSettings = {
          url: (import.meta.env.VITE_FRONTEND_URL || window.location.origin) + '/verify-email',
          handleCodeInApp: false,
        };
        
        await sendEmailVerification(userCredential.user, actionCodeSettings);
        setIsLoggingIn(false);
        setVerificationSent(true);
      }
    } catch (error) {
      setIsLoggingIn(false);
      console.error('Email auth error:', error);
      const msg = error instanceof Error ? error.message : 'Authentication failed. Please try again.';
      setLocalError(msg);
      onSignInError(msg);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setIsLoggingIn(true);
    
    try {
      const actionCodeSettings = {
        url: (import.meta.env.VITE_FRONTEND_URL || window.location.origin) + '/reset-password',
        handleCodeInApp: false,
      };
      
      await sendPasswordResetEmail(auth, email, actionCodeSettings);
      setIsLoggingIn(false);
      setPasswordResetSent(true);
    } catch (error) {
      setIsLoggingIn(false);
      console.error('Password reset error:', error);
      const msg = error instanceof Error ? error.message : 'Failed to send password reset email. Please try again.';
      setLocalError(msg);
      onSignInError(msg);
    }
  };

  if (isLoggingIn) {
    const loggingTitle =
      authMode === 'signin'
        ? 'Logging you in…'
        : authMode === 'forgot-password'
          ? 'Sending reset email…'
          : 'Creating your account…';
    return (
      <BrandLoader
        variant="fullscreen"
        message={loggingTitle}
        subMessage="Please wait while we verify your credentials"
      />
    );
  }

  return (
    <Flex
      alignItems="stretch"
      sx={{ flexDirection: { xs: 'column', md: 'row' } }}
      style={{ minHeight: '100vh', backgroundColor: 'var(--rt-color-bg-app)' }}
    >
      <Box
        sx={{ px: { xs: 2.5, md: 4, lg: 5 }, py: { xs: 6, md: 6 } }}
        style={{ flex: 1, background: 'linear-gradient(135deg, var(--rt-color-accent-muted) 0%, var(--rt-color-bg-subtle) 100%)', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRight: '1px solid var(--rt-color-border)', overflowY: 'auto' }}
      >
        <Stack alignItems="center" gap={4} style={{ maxWidth: 500, width: '100%', marginInline: 'auto' }}>
          <Stack alignItems="center" gap={2.5}>
            <Flex alignItems="center" justifyContent="center" gap={2.5}>
              <img
                src="/logo.png"
                alt="TubeKeter"
                style={{ width: 'clamp(3rem, 12vw, 7.5rem)', height: 'auto', maxHeight: '7.5rem', objectFit: 'contain', flexShrink: 0 }}
              />
              <Stack gap={0.5} style={{ textAlign: 'left' }}>
                <Typography component="h1" variant="h1" style={{ color: 'var(--rt-color-youtube)', letterSpacing: '-0.5px', fontSize: 'clamp(1.375rem, 5vw, 2.25rem)', lineHeight: 1.2, margin: 0 }}>TubeKeter Analytics</Typography>
                <Typography variant="body1" style={{ color: 'rgba(0, 0, 0, 0.65)', margin: 0 }}>YouTube analytics for data-driven growth</Typography>
              </Stack>
            </Flex>
          </Stack>

          <Stack gap={1.5} style={{ width: '100%' }}>
            <FeatureRow
              icon={<Package size={24} />}
              title="Fetch Video Metadata"
              text="Extract comprehensive data from playlists and channels"
            />
            <FeatureRow
              icon={<Download size={24} />}
              title="Export to CSV or Copy to Clipboard"
              text="Download your data in spreadsheet-friendly format"
            />
            <FeatureRow
              icon={<TrendingUp size={24} />}
              title="Progressive Loading"
              text="Real-time updates as data loads from YouTube"
            />
          </Stack>

          <Flex alignItems="center" justifyContent="center" gap={1} style={{ paddingTop: 24 }}>
            <img
              src="/logo.png"
              alt="TubeKeter"
              style={{ width: 48, height: 48, objectFit: 'contain' }}
            />
            <Link component="a" href={TUBEKETER_SITE_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0, 0, 0, 0.5)' }}>
              tubeketer.ai
            </Link>
          </Flex>
        </Stack>
      </Box>

      <Box
        sx={{ px: { xs: 2.5, md: 4, lg: 8 }, py: { xs: 3, md: 6, lg: 8 } }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--rt-color-bg-elevated)' }}
      >
        <Stack justifyContent="center" gap={0} style={{ flex: 1, maxWidth: 420, width: '100%', marginInline: 'auto' }}>
          {verificationSent ? (
            <Stack alignItems="center" gap={2} style={{ width: '100%', textAlign: 'center' }}>
              <IconMedallion tone="primary" shape="rounded" size={64}>
                <Send size={32} />
              </IconMedallion>
              <Typography variant="h2" style={{ fontWeight: 700 }}>Check your email</Typography>
              <Typography variant="subtitle1">
                We&apos;ve sent a verification link to <strong>{email}</strong>. Please check your inbox to activate your account.
              </Typography>
              <Button variant="secondary" onClick={() => setVerificationSent(false)}>
                Back to Login
              </Button>
            </Stack>
          ) : passwordResetSent ? (
            <Stack alignItems="center" gap={2} style={{ width: '100%', textAlign: 'center' }}>
              <IconMedallion tone="primary" shape="rounded" size={64}>
                <Mail size={32} />
              </IconMedallion>
              <Typography variant="h2" style={{ fontWeight: 700 }}>Check your email</Typography>
              <Typography variant="subtitle1">
                We&apos;ve sent a password reset link to <strong>{email}</strong>. Please check your inbox and follow the instructions.
              </Typography>
              <Button variant="secondary" onClick={() => { setPasswordResetSent(false); setAuthMode('signin'); }}>
                Back to Login
              </Button>
            </Stack>
          ) : authMode === 'forgot-password' ? (
            <Stack alignItems="center" gap={2} style={{ width: '100%', textAlign: 'center' }}>
              <IconMedallion tone="primary" shape="rounded" size={64}>
                <LockKeyhole size={32} />
              </IconMedallion>
              <Typography variant="h2" style={{ fontWeight: 700 }}>Reset your password</Typography>
              <Typography variant="subtitle1">
                Enter your email address and we&apos;ll send you a link to reset your password.
              </Typography>
              {localError && (
                <Alert severity="error">
                  <AlertDescription>{localError}</AlertDescription>
                </Alert>
              )}
              <Form onSubmit={handleForgotPassword} style={{ width: '100%' }}>
                <FormField label="Email Address" htmlFor="email">
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setLocalError(null); }}
                    required
                  />
                </FormField>
                <Button type="submit" variant="primary">
                  Send Reset Link
                </Button>
              </Form>
              <Typography variant="body2">
                Remember your password? <AuthSwitchButton onClick={() => { setAuthMode('signin'); setLocalError(null); }}>Sign In</AuthSwitchButton>
              </Typography>
            </Stack>
          ) : (
            <Stack gap={2} style={{ width: '100%' }}>
              <Stack gap={0.5}>
                <Typography variant="h2" style={{ fontWeight: 700 }}>
                  {authMode === 'signin' ? 'Welcome Back' : 'Create Account'}
                </Typography>
                <Typography variant="subtitle1">
                  {authMode === 'signin'
                    ? 'Sign in to access your TubeKeter Analytics dashboard'
                    : 'Join TubeKeter Analytics to start tracking your data'}
                </Typography>
              </Stack>

              <Button
                variant="secondary"
                onClick={handleGoogleSignIn}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                {authMode === 'signin' ? 'Sign in with Google' : 'Sign up with Google'}
              </Button>

              <Divider>OR</Divider>

              {localError && (
                <Alert severity="error">
                  <AlertDescription>{localError}</AlertDescription>
                </Alert>
              )}

              <Form onSubmit={handleEmailAuth}>
                <FormField label="Email Address" htmlFor="email">
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setLocalError(null); }}
                    required
                  />
                </FormField>

                <FormField label="Password" htmlFor="password">
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setLocalError(null); }}
                    required
                  />
                </FormField>

                {authMode === 'signup' && (
                  <>
                    <FormField label="Confirm Password" htmlFor="confirmPassword">
                      <Input
                        id="confirmPassword"
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => { setConfirmPassword(e.target.value); setLocalError(null); }}
                        required
                      />
                    </FormField>

                    <Box style={{ backgroundColor: 'var(--rt-color-bg-subtle)', border: '1px solid var(--rt-color-border)', borderRadius: 'var(--rt-radius-md)', padding: '8px 12px' }}>
                      <Stack gap={0.5}>
                        <RequirementRow met={password.length >= 6} label="At least 6 characters" />
                        <RequirementRow met={Boolean(confirmPassword && password === confirmPassword)} label="Passwords match" />
                      </Stack>
                    </Box>
                  </>
                )}

                {authMode === 'signin' && (
                  <Flex justifyContent="space-between" alignItems="center" gap={1.5}>
                    <FormControlLabel
                      control={
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                        />
                      }
                      label="Remember me"
                    />
                    <AuthSwitchButton onClick={() => { setAuthMode('forgot-password'); setLocalError(null); }}>
                      Forgot password?
                    </AuthSwitchButton>
                  </Flex>
                )}

                <Button type="submit" variant="primary">
                  {authMode === 'signin' ? 'Sign In' : 'Sign Up'}
                </Button>
              </Form>

              <Typography variant="body2" style={{ textAlign: 'center' }}>
                {authMode === 'signin' ? (
                  <>Don&apos;t have an account? <AuthSwitchButton onClick={() => { setAuthMode('signup'); setLocalError(null); }}>Sign Up</AuthSwitchButton></>
                ) : (
                  <>Already have an account? <AuthSwitchButton onClick={() => { setAuthMode('signin'); setLocalError(null); }}>Sign In</AuthSwitchButton></>
                )}
              </Typography>
            </Stack>
          )}
        </Stack>
        <Typography variant="caption" style={{ textAlign: 'center', color: 'var(--rt-color-text-tertiary)', paddingTop: 16 }}>
          v{APP_DISPLAY_VERSION}
        </Typography>
      </Box>
    </Flex>
  );
}

/* ── Helpers (shared-primitive compositions, no page CSS) ─────────────────── */

function FeatureRow({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Flex
      alignItems="flex-start"
      gap={2}
      style={{ padding: 16, backgroundColor: 'rgba(255, 255, 255, 0.6)', borderRadius: 8, border: '1px solid rgba(96, 165, 250, 0.15)' }}
    >
      <span style={{ width: 24, height: 24, color: 'rgba(37, 99, 235, 1)', flexShrink: 0, display: 'inline-flex' }}>{icon}</span>
      <Stack gap={0.5} style={{ flex: 1 }}>
        <Typography variant="h6" style={{ fontWeight: 600, color: 'rgba(0, 0, 0, 0.85)', lineHeight: 1.3, margin: 0 }}>{title}</Typography>
        <Typography variant="body2" style={{ color: 'rgba(0, 0, 0, 0.6)', margin: 0 }}>{text}</Typography>
      </Stack>
    </Flex>
  );
}

function RequirementRow({ met, label }: { met: boolean; label: string }) {
  return (
    <Flex alignItems="center" gap={1}>
      <Box
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          flexShrink: 0,
          backgroundColor: met ? 'var(--rt-color-success)' : 'var(--rt-color-border-strong)',
        }}
      />
      <Typography variant="caption" style={met ? { color: 'var(--rt-color-success)', fontWeight: 500 } : undefined}>
        {label}
      </Typography>
    </Flex>
  );
}

function AuthSwitchButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Link component="button" type="button" underline="always" onClick={onClick} style={{ padding: '0 4px' }}>
      {children}
    </Link>
  );
}

