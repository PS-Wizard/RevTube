import React, { useState } from 'react';
import type { OrganizationMember } from '../types/organization';
import { Alert, AlertDescription, Box, FormField, Input, Modal, NativeSelect, Stack, Typography } from './ui';
import { ShieldAlert } from 'lucide-react';

interface TransferOwnershipModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (newOwnerId: string) => Promise<void>;
  members: OrganizationMember[];
  currentUserId: string;
  organizationName: string;
}

const TransferOwnershipModal: React.FC<TransferOwnershipModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  members,
  currentUserId,
  organizationName
}) => {
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const eligibleMembers = members.filter(
    member =>
      member.userId !== currentUserId &&
      (member.role === 'admin' || member.role === 'write')
  );

  const selectedMember = members.find(m => m.userId === selectedMemberId);
  const confirmationText = `Transfer ownership to ${selectedMember?.email}`;

  const handleConfirm = async () => {
    if (!selectedMemberId || confirmText !== confirmationText) return;

    setLoading(true);
    try {
      await onConfirm(selectedMemberId);
      handleClose();
    } catch (error) {
      console.error('Error transferring ownership:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
      setSelectedMemberId('');
      setConfirmText('');
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      title="Transfer Ownership"
      description={`Transfer ownership of ${organizationName} to another eligible team member.`}
      icon={<ShieldAlert size={20} style={{ color: 'var(--rt-color-warning)' }} />}
      maxWidth="md"
      loading={loading}
      primaryAction={{
        label: loading ? 'Sending Invitation...' : 'Send Invitation',
        onClick: handleConfirm,
        loading,
        disabled:
          !selectedMemberId ||
          confirmText !== confirmationText ||
          loading ||
          eligibleMembers.length === 0,
        variant: 'danger',
      }}
      secondaryAction={{
        label: 'Cancel',
        onClick: handleClose,
        variant: 'ghost',
      }}
    >
      <Stack gap={2.5}>
        <Alert severity="warning" title="Ownership Transfer Invitation">
          <AlertDescription>
            You are about to send an ownership transfer invitation for <strong>{organizationName}</strong> to
            another member. The new owner must accept the invitation to complete the transfer.
          </AlertDescription>
        </Alert>

        {eligibleMembers.length === 0 ? (
          <Stack alignItems="center" gap={1} style={{ padding: 32, textAlign: 'center' }}>
            <Typography variant="body2">No eligible members found. Only admin and write members can become owners.</Typography>
          </Stack>
        ) : (
          <>
            <FormField label="Select New Owner" htmlFor="newOwner">
              <NativeSelect
                id="newOwner"
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                disabled={loading}
              >
                <option value="">Choose a member...</option>
                {eligibleMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.email} ({member.role})
                  </option>
                ))}
              </NativeSelect>
            </FormField>

            {selectedMember && (
              <Box sx={{ mt: 1, pt: 3 }} style={{ borderTop: '1px solid var(--border)' }}>
                <Stack gap={2}>
                  <FormField
                    label={<>Type &apos;<strong>{confirmationText}</strong>&apos; to confirm</>}
                    htmlFor="confirmText"
                  >
                    <Input
                      type="text"
                      id="confirmText"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      disabled={loading}
                      placeholder={confirmationText}
                    />
                  </FormField>

                  <Box style={{ backgroundColor: 'var(--rt-color-bg-subtle)', padding: 16, borderRadius: 'var(--rt-radius-md)' }}>
                    <Typography variant="subtitle2" style={{ color: 'var(--foreground)', fontWeight: 600, marginBottom: 8 }}>What will happen:</Typography>
                    <ul style={{ margin: 0, paddingLeft: 20, listStyleType: 'disc' }}>
                      <li style={{ marginBottom: 8, fontSize: 14, color: 'var(--muted-foreground)', lineHeight: 1.4 }}>
                        <strong>{selectedMember.email}</strong> will receive an ownership transfer invitation
                      </li>
                      <li style={{ marginBottom: 8, fontSize: 14, color: 'var(--muted-foreground)', lineHeight: 1.4 }}>They will have 7 days to accept or decline the invitation</li>
                      <li style={{ marginBottom: 8, fontSize: 14, color: 'var(--muted-foreground)', lineHeight: 1.4 }}>If accepted, they will become the organization owner and you will become an admin</li>
                      <li style={{ marginBottom: 0, fontSize: 14, color: 'var(--muted-foreground)', lineHeight: 1.4 }}>If declined or expired, you will remain the owner</li>
                    </ul>
                  </Box>
                </Stack>
              </Box>
            )}
          </>
        )}
      </Stack>
    </Modal>
  );
};

export default TransferOwnershipModal;
