import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useOrganization } from '../hooks/useOrganization';
import { createOrganization } from '../services/organizationService';
import { Modal, Form, FormField, Input, Alert, AlertDescription } from './ui';
import { Building2 } from 'lucide-react';


interface CreateOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (orgId: string) => void;
}

const CreateOrganizationModal: React.FC<CreateOrganizationModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const { user } = useAuth();
  const { refreshOrganizations } = useOrganization();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!user) return;

    if (!name.trim()) {
      setError('Organization name is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const org = await createOrganization(user.uid, user.email || '', name.trim());
      await refreshOrganizations();
      onSuccess(org.id);
      onClose();
      setName('');
    } catch (err: unknown) {
      setError(err instanceof Error? err.message : 'Failed to create organization');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Create Organization"
      description="Create a new team workspace to share channels and analytics."
      icon={<Building2 size={20} style={{ color: 'var(--rt-color-accent)' }} />}
      maxWidth="sm"
      loading={loading}
      primaryAction={{
        label: loading ? 'Creating...' : 'Create Organization',
        onClick: () => handleSubmit(),
        loading,
        disabled: !name.trim() || loading,
        variant: 'primary',
      }}
      secondaryAction={{
        label: 'Cancel',
        onClick: onClose,
        variant: 'ghost',
      }}
    >
      <Form onSubmit={handleSubmit}>
        <FormField label="Organization Name" htmlFor="orgName">
          <Input
            type="text"
            id="orgName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter organization name"
            disabled={loading}
            autoFocus
          />
        </FormField>

        {error && (
          <Alert severity="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </Form>
    </Modal>
  );
};

export default CreateOrganizationModal;
