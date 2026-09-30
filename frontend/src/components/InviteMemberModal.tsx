import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { inviteMember } from '../services/invitationService';
import { useAuth } from '../hooks/useAuth';
import type { OrganizationRole } from '../types/organization';
import { Modal, Form, FormField, Input, NativeSelect, Alert, AlertDescription } from './ui';
import { UserPlus } from 'lucide-react';

interface InviteMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  organizationId: string;
  isOwner: boolean;
}

const InviteMemberModal: React.FC<InviteMemberModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  organizationId,
  isOwner
}) => {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<OrganizationRole, 'owner'>>('read');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!user) return;

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    if (!email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await inviteMember(
        organizationId,
        email.trim().toLowerCase(),
        role,
        user.uid,
        user.email || ''
      );

      toast.success('Invitation sent successfully');
      onSuccess();
      handleClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invitation');
      setError(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
      setEmail('');
      setRole('read');
      setError(null);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      title="Invite Team Member"
      description="Send an email invitation to add a team member to this organization."
      icon={<UserPlus size={20} style={{ color: 'var(--rt-color-accent)' }} />}
      maxWidth="sm"
      loading={loading}
      primaryAction={{
        label: loading ? 'Sending Invitation...' : 'Send Invitation',
        onClick: () => handleSubmit(),
        loading,
        disabled: !email.trim() || loading,
        variant: 'primary',
      }}
      secondaryAction={{
        label: 'Cancel',
        onClick: handleClose,
        variant: 'ghost',
      }}
    >
      <Form onSubmit={handleSubmit}>
        <FormField label="Email Address" htmlFor="inviteEmail">
          <Input
            type="email"
            id="inviteEmail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email address"
            disabled={loading}
            autoFocus
          />
        </FormField>

        <FormField label="Role" htmlFor="inviteRole">
          <NativeSelect
            id="inviteRole"
            value={role}
            onChange={(e) => setRole(e.target.value as Exclude<OrganizationRole, 'owner'>)}
            disabled={loading}
          >
            <option value="read">Read - Can view lists and analytics</option>
            <option value="write">Write - Can edit and create lists</option>
            {isOwner && (
              <option value="admin">Admin - Can manage members and organization</option>
            )}
          </NativeSelect>
        </FormField>

        <Alert severity="info">
          <AlertDescription>
            {role === 'read' && (
              <>Read access allows viewing all organization lists and analytics but cannot make changes.</>
            )}
            {role === 'write' && (
              <>Write access allows creating, editing, and deleting organization lists and analytics.</>
            )}
            {role === 'admin' && (
              <>Admin access allows managing members, channels, and all organization settings.</>
            )}
          </AlertDescription>
        </Alert>

        {error && (
          <Alert severity="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </Form>
    </Modal>
  );
};

export default InviteMemberModal;
