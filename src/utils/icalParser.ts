/**
 * Simple iCal (.ics) parser for extracting calendar events
 * Parses VEVENT blocks and extracts attendees, dates, and meeting info
 */

export interface ParsedEvent {
  summary: string;
  dateStart: Date;
  dateEnd: Date;
  attendees: Array<{
    email: string;
    name: string;
  }>;
  description: string;
  location: string;
  uid: string;
}

/**
 * Parse iCal file content and extract calendar events
 */
export function parseICalFile(content: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  // Split by VEVENT blocks
  const eventBlocks = content.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

  for (const block of eventBlocks) {
    try {
      const event = parseVEvent(block);
      if (event) {
        events.push(event);
      }
    } catch (err) {
      console.warn('Failed to parse event:', err);
    }
  }

  return events;
}

/**
 * Parse a single VEVENT block
 */
function parseVEvent(block: string): ParsedEvent | null {
  const summary = extractField(block, 'SUMMARY');
  if (!summary) return null; // Skip events without summary

  const dtstart = extractField(block, 'DTSTART');
  const dtend = extractField(block, 'DTEND');
  const description = extractField(block, 'DESCRIPTION') || '';
  const location = extractField(block, 'LOCATION') || '';
  const uid = extractField(block, 'UID') || '';

  const dateStart = parseICalDate(dtstart);
  const dateEnd = parseICalDate(dtend);

  if (!dateStart || !dateEnd) return null;

  // Extract attendees
  const attendees = extractAttendees(block);

  return {
    summary,
    dateStart,
    dateEnd,
    attendees,
    description: cleanDescription(description),
    location,
    uid,
  };
}

/**
 * Extract a field value from iCal block (handles line wrapping)
 */
function extractField(block: string, fieldName: string): string | null {
  // Match field, handling RFC 5545 line folding (lines starting with space/tab)
  const regex = new RegExp(`${fieldName}[^:]*:([^\n]*(?:\n[ \t][^\n]*)*)`, 'i');
  const match = block.match(regex);

  if (!match || !match[1]) return null;

  // Remove line folding
  return match[1]
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '')
    .trim();
}

/**
 * Extract all ATTENDEE entries
 */
function extractAttendees(block: string): Array<{ email: string; name: string }> {
  const attendees: Array<{ email: string; name: string }> = [];

  // Match all ATTENDEE lines (with potential line folding)
  const regex = /ATTENDEE[^:]*:([^\n]*(?:\n[ \t][^\n]*)*)/gi;
  let match;

  while ((match = regex.exec(block)) !== null) {
    const attendeeStr = match[1]
      .replace(/\r\n[ \t]/g, '')
      .replace(/\n[ \t]/g, '');

    // Extract CN (Common Name) and email
    const cnMatch = attendeeStr.match(/CN=([^;]+)/i);
    const emailMatch = attendeeStr.match(/mailto:([^\s;]+)/i);

    if (emailMatch) {
      const email = emailMatch[1];
      const name = cnMatch ? cnMatch[1] : email;

      attendees.push({
        email,
        name: decodeICalText(name),
      });
    }
  }

  return attendees;
}

/**
 * Parse iCal date format: YYYYMMDDTHHMMSSZ or with timezone
 */
function parseICalDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;

  // Remove timezone info
  const cleanDate = dateStr.replace(/[ZT]/g, (m) => m === 'Z' ? '' : ' ');

  // Parse YYYYMMDD or YYYYMMDDHHmmss
  const match = cleanDate.match(/(\d{4})(\d{2})(\d{2})(?:\s?(\d{2})(\d{2})(\d{2}))?/);

  if (!match) return null;

  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;

  try {
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    );
  } catch {
    return null;
  }
}

/**
 * Decode iCal escaped text
 */
function decodeICalText(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Clean up description (remove line breaks, excessive whitespace)
 */
function cleanDescription(desc: string): string {
  return desc
    .replace(/\\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500); // Limit to 500 chars
}

/**
 * Match an attendee email to a contact by email
 */
export function findContactByEmail(
  email: string,
  contacts: Array<{ id: string; emails: Array<{ value: string }> }>
): string | null {
  const normalizedEmail = email.toLowerCase().trim();

  for (const contact of contacts) {
    for (const contactEmail of contact.emails) {
      if (contactEmail.value.toLowerCase() === normalizedEmail) {
        return contact.id;
      }
    }
  }

  return null;
}

/**
 * Extract labels from event name by matching against available labels
 * Also checks for "1-1" in the title and adds "1-1 Samtale" label
 */
export function extractLabelsFromEventName(
  eventName: string,
  availableLabels: string[]
): string[] {
  const foundLabels: string[] = [];
  const lowerEventName = eventName.toLowerCase();

  // Check for "1-1" pattern (1-1 conversation)
  if (lowerEventName.includes('1-1')) {
    foundLabels.push('1-1 Samtale');
  }

  for (const label of availableLabels) {
    if (lowerEventName.includes(label.toLowerCase())) {
      foundLabels.push(label);
    }
  }

  return foundLabels;
}

/**
 * Get all matching contact IDs for an event's attendees
 */
export function getMatchingContactIds(
  event: ParsedEvent,
  contacts: Array<{ id: string; emails: Array<{ value: string }> }>
): string[] {
  const contactIds = new Set<string>();

  for (const attendee of event.attendees) {
    const contactId = findContactByEmail(attendee.email, contacts);
    if (contactId) {
      contactIds.add(contactId);
    }
  }

  return Array.from(contactIds);
}
