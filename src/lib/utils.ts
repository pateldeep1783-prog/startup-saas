import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = 'GBP'): string {
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
  return `${symbol}${amount.toFixed(2)}`;
}

export function formatDate(date: string | Date, timezone?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  });
}

export function formatTime(date: string | Date, timezone?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  });
}

export function formatDateTime(date: string | Date, timezone?: string): string {
  return `${formatDate(date, timezone)} at ${formatTime(date, timezone)}`;
}

export function timeAgo(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(d);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const INDUSTRIES = [
  { value: 'dental', label: 'Dental' },
  { value: 'medical', label: 'Medical' },
  { value: 'physiotherapy', label: 'Physiotherapy' },
  { value: 'beauty', label: 'Beauty' },
  { value: 'hair_salon', label: 'Hair Salon' },
  { value: 'med_spa', label: 'Med Spa' },
  { value: 'legal', label: 'Legal' },
  { value: 'accounting', label: 'Accounting' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'roofing', label: 'Roofing' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'automotive', label: 'Automotive' },
  { value: 'other', label: 'Other' },
];

export const COUNTRIES = [
  { value: 'GB', label: 'United Kingdom', currency: 'GBP', timezone: 'Europe/London' },
  { value: 'US', label: 'United States', currency: 'USD', timezone: 'America/New_York' },
];

export const TIMEZONES = [
  'Europe/London',
  'Europe/Dublin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

export const STAFF_COLORS = [
  '#3b82f6', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#10b981', '#f97316', '#06b6d4', '#84cc16',
];
