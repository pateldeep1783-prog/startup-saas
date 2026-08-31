import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type BadgeVariant = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'teal' | 'purple';

const variants: Record<BadgeVariant, string> = {
  gray: 'bg-gray-100 text-gray-700',
  blue: 'bg-primary-50 text-primary-700',
  green: 'bg-success-50 text-success-700',
  yellow: 'bg-warning-50 text-warning-700',
  red: 'bg-error-50 text-error-700',
  teal: 'bg-accent-50 text-accent-700',
  purple: 'bg-purple-50 text-purple-700',
};

export function Badge({
  children,
  variant = 'gray',
  className,
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return <span className={cn('badge', variants[variant], className)}>{children}</span>;
}

export const bookingStatusVariant: Record<string, BadgeVariant> = {
  pending: 'yellow',
  confirmed: 'blue',
  rescheduled: 'teal',
  cancelled: 'red',
  checked_in: 'teal',
  completed: 'green',
  no_show: 'red',
};

export const paymentStatusVariant: Record<string, BadgeVariant> = {
  pending: 'yellow',
  paid: 'green',
  failed: 'red',
  refunded: 'gray',
  partially_refunded: 'yellow',
};

export const customerStatusVariant: Record<string, BadgeVariant> = {
  lead: 'gray',
  new: 'blue',
  active: 'green',
  returning: 'teal',
  inactive: 'gray',
};

export const conversationStatusVariant: Record<string, BadgeVariant> = {
  open: 'blue',
  ai_active: 'teal',
  human_required: 'yellow',
  closed: 'gray',
};
