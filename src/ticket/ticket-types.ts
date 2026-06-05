export type TicketType = 'incident' | 'request';

export const TICKET_TYPES: readonly TicketType[] = ['incident', 'request'] as const;

export function isValidTicketType(value: unknown): value is TicketType {
  return value === 'incident' || value === 'request';
}

export function resolveTicketType(
  candidate: unknown,
  priority?: string,
): TicketType {
  const normalized =
    typeof candidate === 'string' ? candidate.trim().toLowerCase() : '';

  if (isValidTicketType(normalized)) {
    return normalized;
  }

  return priority === 'Alta' ? 'incident' : 'request';
}
