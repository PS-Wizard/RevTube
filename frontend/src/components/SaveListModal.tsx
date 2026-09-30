import React, { useState } from 'react';
import { Modal, Form, FormField, Input } from './ui';
import { BookMarked } from 'lucide-react';

interface SaveListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, date: string) => void;
}

export const SaveListModal: React.FC<SaveListModalProps> = ({ isOpen, onClose, onSave }) => {
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (name.trim()) {
      onSave(name.trim(), date);
      setName('');
      onClose();
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Save Video List"
      description="Save your current video list for tracking and annotations."
      icon={<BookMarked size={20} style={{ color: 'var(--rt-color-accent)' }} />}
      maxWidth="sm"
      primaryAction={{
        label: 'Save List',
        onClick: () => handleSubmit(),
        disabled: !name.trim(),
        variant: 'primary',
      }}
      secondaryAction={{
        label: 'Cancel',
        onClick: onClose,
        variant: 'ghost',
      }}
    >
      <Form onSubmit={handleSubmit}>
        <FormField label="List Name" htmlFor="listName">
          <Input
            id="listName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Q1 Optimization"
            autoFocus
            required
          />
        </FormField>
        <FormField
          label="Optimization Date (for Annotation)"
          htmlFor="optDate"
          hint="A vertical line will appear on graphs at this date."
        >
          <Input
            id="optDate"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </FormField>
      </Form>
    </Modal>
  );
};
