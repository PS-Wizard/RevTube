import { useMemo, useState } from 'react';
import { sendPasswordResetEmail, updateProfile, verifyBeforeUpdateEmail } from 'firebase/auth';
import toast from 'react-hot-toast';
import { auth } from '../../config/firebase';
import { useAuth } from '../../hooks/useAuth';
import {
  Avatar,
  AvatarFallback,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Divider,
  Flex,
  FormField,
  Grid,
  Input,
  Stack,
  Typography,
} from '../../components/ui';

const PASSWORD_RESET_PATH = '/reset-password';

const mapAuthError = (error: unknown, fallback: string): string => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return fallback;
  const code = String((error as { code?: unknown }).code ?? '');
  if (code === 'auth/requires-recent-login') return 'For security, please sign out and sign in again before making this change.';
  if (code === 'auth/invalid-email') return 'Please enter a valid email address.';
  if (code === 'auth/email-already-in-use') return 'That email is already in use by another account.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait a moment and try again.';
  return fallback;
};

export const ProfilePage = () => {
  const { user, refreshUserProfile } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [newEmail, setNewEmail] = useState(user?.email ?? '');
  const [savingName, setSavingName] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const normalizedCurrentName = (user?.displayName ?? '').trim();
  const normalizedInputName = displayName.trim();
  const normalizedCurrentEmail = (user?.email ?? '').trim().toLowerCase();
  const normalizedInputEmail = newEmail.trim().toLowerCase();

  const canSaveName = useMemo(
    () => !!user && normalizedInputName.length >= 2 && normalizedInputName !== normalizedCurrentName,
    [user, normalizedInputName, normalizedCurrentName],
  );

  const canSaveEmail = useMemo(
    () => !!user && normalizedInputEmail.length > 3 && normalizedInputEmail !== normalizedCurrentEmail,
    [user, normalizedInputEmail, normalizedCurrentEmail],
  );

  const handleSaveName = async () => {
    if (!user || !canSaveName) return;
    setSavingName(true);
    try {
      await updateProfile(user, { displayName: normalizedInputName });
      await user.reload();
      await refreshUserProfile();
      toast.success('Name updated successfully.');
    } catch (error) {
      toast.error(mapAuthError(error, 'Unable to update your name right now.'));
    } finally {
      setSavingName(false);
    }
  };

  const handleUpdateEmail = async () => {
    if (!user || !canSaveEmail) return;
    setSavingEmail(true);
    try {
      const actionCodeSettings = {
        url: `${import.meta.env.VITE_FRONTEND_URL || window.location.origin}/profile`,
        handleCodeInApp: false,
      };
      await verifyBeforeUpdateEmail(user, normalizedInputEmail, actionCodeSettings);
      toast.success('Verification email sent. Confirm it to finish updating your email.');
    } catch (error) {
      toast.error(mapAuthError(error, 'Unable to update your email right now.'));
    } finally {
      setSavingEmail(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user?.email) { toast.error('No email address found for this account.'); return; }
    setSendingReset(true);
    try {
      const actionCodeSettings = {
        url: `${import.meta.env.VITE_FRONTEND_URL || window.location.origin}${PASSWORD_RESET_PATH}`,
        handleCodeInApp: false,
      };
      await sendPasswordResetEmail(auth, user.email, actionCodeSettings);
      toast.success('Password reset email sent.');
    } catch (error) {
      toast.error(mapAuthError(error, 'Unable to send reset email right now.'));
    } finally {
      setSendingReset(false);
    }
  };

  if (!user) return null;

  const displayLabel = user.displayName?.trim() || 'Unnamed user';
  const avatarLetter = (user.displayName?.trim()?.charAt(0) || user.email?.charAt(0) || 'U').toUpperCase();
  const memberSince = user.metadata.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="page-container profile-page">
      <header className="page-header">
        <h1>Account</h1>
        <p className="page-description">Profile, sign-in email, and security for your RevTube workspace.</p>
      </header>

      {/* Two-column layout */}
      <Grid container spacing={2} sx={{ alignItems: 'start', width: '100%', paddingBottom: 32 }}>

        {/* ── Left rail ── */}
        <Grid item xs={12} lg={3}>
          <Card sx={{ position: 'sticky', top: 16 }}>
            <CardContent>
              <Stack alignItems="center" gap={1.5} sx={{ textAlign: 'center' }}>
                {/* Avatar */}
                <Avatar sx={{ width: 72, height: 72 }} aria-hidden>
                  <AvatarFallback style={{ fontSize: 'var(--rt-text-display)' }}>{avatarLetter}</AvatarFallback>
                </Avatar>

                <Typography variant="h5" sx={{ fontWeight: 600, width: '100%', overflowWrap: 'break-word' }}>{displayLabel}</Typography>
                <Typography variant="body2" sx={{ width: '100%', overflowWrap: 'anywhere' }}>{user.email}</Typography>

                <Badge variant={user.emailVerified ? 'default' : 'secondary'}>
                  {user.emailVerified ? 'Email verified' : 'Verification pending'}
                </Badge>

                <Divider sx={{ width: '100%' }} />
                <Box component="dl" sx={{ width: '100%', textAlign: 'left' }}>
                  <Stack gap={1}>
                    {memberSince && (
                      <Box>
                        <Typography component="dt" variant="overline">Member since</Typography>
                        <Typography component="dd" variant="body2" sx={{ margin: 0 }}>{memberSince}</Typography>
                      </Box>
                    )}
                    <Box>
                      <Typography component="dt" variant="overline">User ID</Typography>
                      <Typography
                        component="dd"
                        variant="caption"
                        title={user.uid}
                        sx={{ margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, monospace', overflowWrap: 'anywhere' }}
                      >
                        {user.uid}
                      </Typography>
                    </Box>
                  </Stack>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* ── Right panels ── */}
        <Grid item xs={12} lg={9}>
          <Stack gap={2}>

            {/* Profile panel */}
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>Information shown in the app header and on shared exports.</CardDescription>
              </CardHeader>
              <Divider />
              <CardContent>
                <FormField
                  label="Display name"
                  htmlFor="profile-display-name"
                  hint="At least 2 characters. Updates apply after you save."
                >
                  <Flex wrap alignItems="center" gap={1.5}>
                    <Box sx={{ flexGrow: 1, minWidth: 200 }}>
                      <Input
                        id="profile-display-name"
                        type="text"
                        placeholder="Your name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        autoComplete="name"
                      />
                    </Box>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void handleSaveName()}
                      disabled={!canSaveName || savingName}
                    >
                      {savingName ? 'Saving…' : 'Save'}
                    </Button>
                  </Flex>
                </FormField>
              </CardContent>
            </Card>

            {/* Sign-in panel */}
            <Card>
              <CardHeader>
                <CardTitle>Sign-in</CardTitle>
                <CardDescription>Email used to log in. Changing it requires verification of the new address.</CardDescription>
              </CardHeader>
              <Divider />
              <CardContent>
                <FormField
                  label="Email address"
                  htmlFor="profile-email"
                  hint="We send a confirmation link before the new email becomes active."
                >
                  <Flex wrap alignItems="center" gap={1.5}>
                    <Box sx={{ flexGrow: 1, minWidth: 200 }}>
                      <Input
                        id="profile-email"
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        autoComplete="email"
                      />
                    </Box>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void handleUpdateEmail()}
                      disabled={!canSaveEmail || savingEmail}
                    >
                      {savingEmail ? 'Sending…' : 'Update email'}
                    </Button>
                  </Flex>
                </FormField>
              </CardContent>
            </Card>

            {/* Security panel */}
            <Card>
              <CardHeader>
                <CardTitle>Security</CardTitle>
                <CardDescription>Password changes are handled through a secure email link.</CardDescription>
              </CardHeader>
              <Divider />
              <CardContent>
                <Flex justifyContent="space-between" alignItems="center" gap={2.5}>
                  <Stack gap={0.5} sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2">Password</Typography>
                    <Typography variant="body2">
                      Reset link sent to <strong>{user.email}</strong>. Link expires after use.
                    </Typography>
                  </Stack>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handlePasswordReset()}
                    disabled={sendingReset}
                  >
                    {sendingReset ? 'Sending…' : 'Send reset link'}
                  </Button>
                </Flex>
              </CardContent>
            </Card>

          </Stack>
        </Grid>
      </Grid>
    </div>
  );
};
