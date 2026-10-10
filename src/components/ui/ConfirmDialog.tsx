"use client";

import type { ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export interface ConfirmAction {
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  onSelect: () => void;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  actions: ConfirmAction[];
  onCancel: () => void;
}

/** Explicit confirmation for destructive or work-discarding actions (touch/click only). */
export function ConfirmDialog({ open, title, description, actions, onCancel }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {actions.map((action) => (
            <Button key={action.label} variant={action.variant ?? "secondary"} onClick={action.onSelect}>
              {action.label}
            </Button>
          ))}
        </>
      }
    />
  );
}
