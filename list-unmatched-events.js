#!/usr/bin/env node

/**
 * List all 1-1 events that couldn't be imported because attendees aren't in contacts
 */

import fs from 'fs';

const DRIZZLE_BASE = 'https://drizzle.vegvisr.org';
const CONTACTS_TABLE_ID = 'bbb8db35-3e48-4b58-a1ca-a6dda1e12f6f';

// ─────────────────────────────────────────────────────────────────────────

function extractField(block, fieldName) {
  const regex = new RegExp(`${fieldName}[^:]*:([^\\n]*(?:\\n[ \\t][^\\n]*)*)`, 'i');
  const match = block.match(regex);
  if (!match || !match[1]) return null;
  return match[1].replace(/\\r\\n[ \\t]/g, '').replace(/\\n[ \\t]/g, '').trim();
}

function extractAttendees(block) {
  const attendees = [];
  const regex = /ATTENDEE[^:]*:([^\n]*(?:\n[ \t][^\n]*)*)/gi;
  let match;

  while ((match = regex.exec(block)) !== null) {
    const attendeeStr = match[1]
      .replace(/\r\n[ \t]/g, '')
      .replace(/\n[ \t]/g, '');

    const cnMatch = attendeeStr.match(/CN=([^;]+)/i);
    const emailMatch = attendeeStr.match(/mailto:([^\s;]+)/i);

    if (emailMatch) {
      const email = emailMatch[1];
      const name = cnMatch ? cnMatch[1] : email;
      attendees.push({ email: email.toLowerCase().trim(), name });
    }
  }

  return attendees;
}

function parseICalDate(dateStr) {
  if (!dateStr) return null;
  const cleanDate = dateStr.replace(/[ZT]/g, (m) => m === 'Z' ? '' : ' ');
  const match = cleanDate.match(/(\d{4})(\d{2})(\d{2})(?:\s?(\d{2})(\d{2})(\d{2}))?/);

  if (!match) return null;

  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;

  try {
    const d = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    );
    return d.toISOString();
  } catch {
    return null;
  }
}

function parseEvents(content) {
  const eventBlocks = content.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  const events = [];

  for (const block of eventBlocks) {
    const summary = extractField(block, 'SUMMARY');
    if (!summary) continue;

    const dtstart = extractField(block, 'DTSTART');
    const uid = extractField(block, 'UID') || '';
    const description = extractField(block, 'DESCRIPTION') || '';

    const dateStart = parseICalDate(dtstart);
    if (!dateStart) continue;

    const attendees = extractAttendees(block);

    if (summary.toLowerCase().includes('1-1')) {
      events.push({
        uid,
        summary,
        dateStart,
        attendees,
        description: description.substring(0, 500),
        isOneOnOne: true,
      });
    }
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────

async function getContactsFromDB() {
  const res = await fetch(`${DRIZZLE_BASE}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-role': 'Superadmin',
    },
    body: JSON.stringify({
      tableId: CONTACTS_TABLE_ID,
      limit: 5000,
    }),
  });
  if (!res.ok) throw new Error('Failed to load contacts');
  const data = await res.json();

  const contacts = (data.records || []).map(row => ({
    id: row._id,
    fullName: row.full_name,
    emails: JSON.parse(row.emails || '[]'),
  }));

  return contacts;
}

function findContactByEmail(email, contacts) {
  const normalized = email.toLowerCase().trim();
  for (const contact of contacts) {
    for (const emailObj of contact.emails) {
      if (emailObj.value.toLowerCase() === normalized) {
        return contact.id;
      }
    }
  }
  return null;
}

async function main() {
  console.log('\n📋 UNMATCHED EVENTS REPORT');
  console.log('═'.repeat(80));

  // Load .ics file
  console.log('\n📂 Loading calendar file...');
  const icsContent = fs.readFileSync('/Users/torarnehave/Downloads/torarne@heinekolltveit.com.ics', 'utf-8');
  const allEvents = parseEvents(icsContent);
  console.log(`✓ Parsed ${allEvents.length} events with "1-1"`);

  // Load contacts
  console.log('\n👥 Loading contacts...');
  const contacts = await getContactsFromDB();
  console.log(`✓ Found ${contacts.length} contacts`);

  // Find unmatched events
  console.log('\n🔍 Finding unmatched events...');
  const unmatched = [];

  for (const event of allEvents) {
    const matchingIds = new Set();
    for (const attendee of event.attendees) {
      const contactId = findContactByEmail(attendee.email, contacts);
      if (contactId) {
        matchingIds.add(contactId);
      }
    }

    if (matchingIds.size === 0) {
      unmatched.push(event);
    }
  }

  console.log(`✓ Found ${unmatched.length} unmatched events\n`);

  if (unmatched.length === 0) {
    console.log('✅ All events have matching contacts!');
    return;
  }

  // Sort by date (newest first)
  unmatched.sort((a, b) => new Date(b.dateStart) - new Date(a.dateStart));

  // Display results
  console.log('UNMATCHED EVENTS (sorted by date, newest first):\n');

  for (let i = 0; i < unmatched.length; i++) {
    const event = unmatched[i];
    const date = new Date(event.dateStart);
    const dateStr = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    console.log(`${i + 1}. ${event.summary}`);
    console.log(`   Date: ${dateStr}`);
    console.log(`   Attendees:`);
    for (const attendee of event.attendees) {
      console.log(`     - ${attendee.name} <${attendee.email}>`);
    }
    console.log();
  }

  console.log(`\n📊 SUMMARY:`);
  console.log(`   Total unmatched: ${unmatched.length}`);
  console.log(`   Unique attendee emails: ${new Set(unmatched.flatMap(e => e.attendees.map(a => a.email))).size}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
