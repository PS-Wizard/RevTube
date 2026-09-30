import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Users, Info, CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useOrganization } from '../../hooks/useOrganization';
import { acceptInvitation, getInvitationByTokenAndOrg } from '../../services/invitationService';
import { 
  getOrganization, 
  acceptOwnershipTransfer, 
  declineOwnershipTransfer,
  getOwnershipTransferByToken
} from '../../services/organizationService';
import type { OrganizationInvitation, Organization, OwnershipTransferInvitation } from '../../types/organization';
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Badge, Alert, AlertDescription, Box, Divider, Flex, IconMedallion, Spinner, Stack, Typography } from '../../components/ui';

/** Key-value detail row — page-local composition built only from shared primitives. */
const DetailRow: React.FC<{ label: React.ReactNode; value: React.ReactNode }> = ({ label, value }) => (
  <Flex justifyContent="space-between" alignItems="center" style={{ padding: 12 }}>
    <Typography variant="body2">{label}</Typography>
    <Typography variant="body2" style={{ color: 'var(--foreground)', fontWeight: 500 }}>{value}</Typography>
  </Flex>
);

const AcceptInvitePage: React.FC = () => {  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, isCheckingAuth } = useAuth(); // user used for acceptInvitation args
  const { refreshOrganizations, setCurrentOrganization } = useOrganization();

  const [invitation, setInvitation] = useState<OrganizationInvitation | null>(null);
  const [ownershipTransfer, setOwnershipTransfer] = useState<OwnershipTransferInvitation | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const token = searchParams.get('token');
  const orgId = searchParams.get('org');
  const type = searchParams.get('type');

  useEffect(() => {
    if (!isCheckingAuth) {
      if (type === 'transfer') {
        loadOwnershipTransfer();
      } else {
        loadInvitation();
      }
    }
  }, [token, orgId, type, isCheckingAuth]);

  const loadInvitation = async () => {
    if (!token || !orgId) {
      setError('Invalid invitation link');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [invitationData, organizationData] = await Promise.all([
        getInvitationByTokenAndOrg(orgId, token),
        getOrganization(orgId)
      ]);

      if (!invitationData) {
        setError('Invitation not found or has expired');
        return;
      }
      if (!organizationData) {
        setError('Organization not found');
        return;
      }
      if (invitationData.status !== 'pending') {
        setError(`This invitation has already been ${invitationData.status}`);
        return;
      }
      if (Date.now() > invitationData.expiresAt) {
        setError('This invitation has expired');
        return;
      }

      setInvitation(invitationData);
      setOrganization(organizationData);
    } catch (err) {
      console.error('Error loading invitation:', err);
      setError('Failed to load invitation details');
    } finally {
      setLoading(false);
    }
  };

  const loadOwnershipTransfer = async () => {
    if (!token) {
      setError('Invalid transfer link');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const transferData = await getOwnershipTransferByToken(token);

      if (!transferData) {
        setError('Ownership transfer not found or has expired');
        return;
      }
      if (transferData.status !== 'pending') {
        setError(`This ownership transfer has already been ${transferData.status}`);
        return;
      }
      if (Date.now() > transferData.expiresAt) {
        setError('This ownership transfer has expired');
        return;
      }

      setOwnershipTransfer(transferData);

      const organizationData = await getOrganization(transferData.organizationId);
      if (organizationData) {
        setOrganization(organizationData);
      }
    } catch (err) {
      console.error('Error loading ownership transfer:', err);
      setError('Failed to load transfer details');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async () => {
    if (!token) return;

    setAccepting(true);
    setError(null);

    try {
      if (type === 'transfer') {
        if (!ownershipTransfer) return;
        await acceptOwnershipTransfer(ownershipTransfer.id, token);
        await refreshOrganizations();
        setCurrentOrganization(ownershipTransfer.organizationId);
        setSuccess(true);
        setTimeout(() => {
          navigate('/organization');
        }, 2000);
      } else {
        if (!orgId) return;
        await acceptInvitation(orgId, token, user?.uid ?? '', user?.email ?? '');
        await refreshOrganizations();
        setCurrentOrganization(orgId);
        setSuccess(true);
        setTimeout(() => {
          navigate('/dashboard');
        }, 2000);
      }
    } catch (err: unknown) {
      console.error('Error accepting invitation:', err);
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    if (type === 'transfer' && ownershipTransfer && token) {
      setDeclining(true);
      try {
        await declineOwnershipTransfer(ownershipTransfer.id, token);
        navigate('/dashboard');
      } catch (err: unknown) {
        console.error('Error declining transfer:', err);
        setError(err instanceof Error ? err.message : 'Failed to decline ownership transfer');
      } finally {
        setDeclining(false);
      }
      return;
    }
    navigate('/dashboard');
  };

  const renderHeader = () => (
    <Box component="header" sx={{ display: 'flex', width: '100%', justifyContent: 'center', pt: 4 }}>
      <a href="/" style={{ display: 'inline-block' }}>
        <img src="/TubeKeter.svg" alt="TubeKeter Analytics" style={{ height: 36, width: 'auto' }} />
      </a>
    </Box>
  );

  const renderContainer = (content: React.ReactNode) => (
    <Flex
      component="div"
      alignItems="center"
      justifyContent="space-between"
      sx={{ flexDirection: 'column', minHeight: '100vh', p: 2, backgroundColor: 'var(--background)' }}
    >
      {renderHeader()}
      <Box component="main" sx={{ my: 'auto', width: '100%', maxWidth: '28rem', py: 4 }}>{content}</Box>
      <Typography component="footer" variant="caption" align="center" sx={{ pb: 3 }}>
        RevTube Analytics · Organization Management
      </Typography>
    </Flex>
  );

  if (loading || isCheckingAuth) {
    return renderContainer(
      <Card style={{ textAlign: 'center' }}>
        <CardContent>
          <Stack alignItems="center" gap={2} sx={{ py: 4 }}>
            <Spinner size={40} />
            <Typography variant="body2">Loading {type === 'transfer' ? 'transfer' : 'invitation'}…</Typography>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  if (!isAuthenticated) {
    const handleSignIn = () => {
      sessionStorage.setItem('postLoginRedirect', window.location.pathname + window.location.search);
      navigate('/');
    };

    return renderContainer(
      <Card style={{ textAlign: 'center' }}>
        <CardHeader style={{ alignItems: 'center' }}>
          <Box sx={{ mb: 1 }}>
            <IconMedallion tone="primary">
              <Info size={24} />
            </IconMedallion>
          </Box>
          <CardTitle style={{ fontSize: '1.25rem' }}>Sign In Required</CardTitle>
          <CardDescription>Please sign in to accept this organization invitation.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="primary" fullWidth onClick={handleSignIn}>
            Sign In to Continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return renderContainer(
      <Card style={{ textAlign: 'center' }}>
        <CardHeader style={{ alignItems: 'center' }}>
          <Box sx={{ mb: 1 }}>
            <IconMedallion tone="destructive">
              <XCircle size={32} />
            </IconMedallion>
          </Box>
          <CardTitle style={{ fontSize: '1.25rem' }}>{type === 'transfer' ? 'Transfer Error' : 'Invitation Error'}</CardTitle>
          <CardDescription style={{ color: 'var(--destructive)' }}>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" fullWidth onClick={() => navigate('/dashboard')}>
            Go to Dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (success) {
    return renderContainer(
      <Card style={{ textAlign: 'center' }}>
        <CardHeader style={{ alignItems: 'center' }}>
          <Box sx={{ mb: 1 }}>
            <IconMedallion tone="success">
              <CheckCircle2 size={32} />
            </IconMedallion>
          </Box>
          <CardTitle style={{ fontSize: '1.25rem' }}>
            {ownershipTransfer ? `You're now the owner of ${organization?.name}` : `Welcome to ${organization?.name}`}
          </CardTitle>
          <CardDescription>
            {ownershipTransfer
              ? 'Ownership transfer accepted. Redirecting to organization settings…'
              : 'You have successfully joined the organization. Redirecting…'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!invitation && !ownershipTransfer) {
    return renderContainer(
      <Card style={{ textAlign: 'center' }}>
        <CardHeader style={{ alignItems: 'center' }}>
          <Box sx={{ mb: 1 }}>
            <IconMedallion tone="destructive">
              <XCircle size={32} />
            </IconMedallion>
          </Box>
          <CardTitle style={{ fontSize: '1.25rem' }}>{type === 'transfer' ? 'Transfer Not Found' : 'Invitation Not Found'}</CardTitle>
          <CardDescription>This {type === 'transfer' ? 'transfer' : 'invitation'} link is invalid or has expired.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" fullWidth onClick={() => navigate('/dashboard')}>
            Go to Dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  const roleLabel = invitation?.role === 'read' ? 'Read Access'
    : invitation?.role === 'write' ? 'Write Access'
    : invitation?.role === 'admin' ? 'Admin Access'
    : invitation?.role ?? '';

  const roleDescription = invitation?.role === 'read'
    ? 'You can view organization lists and analytics, but cannot make changes.'
    : invitation?.role === 'write'
    ? 'You can create, edit, and delete organization lists and analytics.'
    : invitation?.role === 'admin'
    ? 'You can manage members, channels, and all organization settings.'
    : null;

  return renderContainer(
    <Card>
      <CardHeader style={{ textAlign: 'center', alignItems: 'center' }}>
        <Box sx={{ mb: 1, mx: 'auto' }}>
          <IconMedallion tone="primary">
            <Users size={24} />
          </IconMedallion>
        </Box>
        <CardTitle style={{ fontSize: '1.25rem' }}>
          {ownershipTransfer ? 'Ownership Transfer' : "You're Invited"}
        </CardTitle>
        <CardDescription>
          {ownershipTransfer
            ? `You've been selected to become the owner of `
            : `You've been invited to join `}
          <strong style={{ color: 'var(--foreground)' }}>{organization?.name}</strong>
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Stack gap={2}>
          {/* Details list */}
          <Box style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
            <DetailRow label="Organization" value={organization?.name} />
            {ownershipTransfer ? (
              <>
                <Divider />
                <DetailRow label="Current Owner" value={ownershipTransfer.currentOwnerEmail} />
                <Divider />
                <Flex justifyContent="space-between" alignItems="center" style={{ padding: 12 }}>
                  <Typography variant="body2">Your New Role</Typography>
                  <Badge variant="default">Owner</Badge>
                </Flex>
                <Divider />
                <DetailRow label="Invited Email" value={ownershipTransfer.newOwnerEmail} />
              </>
            ) : invitation ? (
              <>
                <Divider />
                <Flex justifyContent="space-between" alignItems="center" style={{ padding: 12 }}>
                  <Typography variant="body2">Your Role</Typography>
                  <Badge variant={invitation.role === 'admin' ? 'default' : 'secondary'}>{roleLabel}</Badge>
                </Flex>
                <Divider />
                <DetailRow label="Invited Email" value={invitation.email} />
              </>
            ) : null}
          </Box>

          {/* Notice */}
          {ownershipTransfer ? (
            <Alert severity="warning">
              <AlertDescription>
                By accepting, you will become the organization owner with full control. The current owner will become an admin.
              </AlertDescription>
            </Alert>
          ) : roleDescription ? (
            <Alert severity="info">
              <AlertDescription>
                {roleDescription}
              </AlertDescription>
            </Alert>
          ) : null}
        </Stack>
      </CardContent>

      <CardFooter>
        <Flex gap={1.5}>
          <Button
            variant="secondary"
            style={{ flex: 1 }}
            onClick={handleDecline}
            disabled={accepting || declining}
          >
            {declining ? 'Declining…' : 'Decline'}
          </Button>
          <Button
            variant="primary"
            style={{ flex: 1 }}
            onClick={handleAcceptInvitation}
            disabled={accepting || declining}
          >
            {accepting
              ? (ownershipTransfer ? 'Accepting Transfer…' : 'Accepting…')
              : (ownershipTransfer ? 'Accept Ownership' : 'Accept Invitation')}
          </Button>
        </Flex>
      </CardFooter>
    </Card>
  );
};

export default AcceptInvitePage;
