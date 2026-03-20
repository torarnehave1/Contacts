#!/usr/bin/env node

/**
 * Comprehensive audit and repair script
 * - Parses .ics file
 * - Compares with database
 * - Imports all missing events
 */

import fs from 'fs';
import path from 'path';

const DRIZZLE_BASE = 'https://drizzle.vegvisr.org';
const CONTACTS_TABLE_ID = 'bbb8db35-3e48-4b58-a1ca-a6dda1e12f6f';
const TABLE_ID = '40c3ef20-f14f-41b6-8c0e-cae3b1ff8369';

// ─────────────────────────────────────────────────────────────────────────

function extractField(block, fieldName) {
  const regex = new RegExp(`${fieldName}[^:]*:([^\\n]*(?:\\n[ \\t][^\\n]*)*)`, 'i');
  const match = block.match(regex);
  if (!match || !match[1]) return null;
  return match[1].replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').trim();
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
    const dtend = extractField(block, 'DTEND');
    const uid = extractField(block, 'UID') || '';
    const description = extractField(block, 'DESCRIPTION') || '';

    const dateStart = parseICalDate(dtstart);
    if (!dateStart) continue;

    const attendees = extractAttendees(block);

    events.push({
      uid,
      summary,
      dateStart,
      attendees,
      description: description.substring(0, 500),
      isOneOnOne: summary.toLowerCase().includes('1-1'),
    });
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

async function getExistingLogs() {
  const res = await fetch(`${DRIZZLE_BASE}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-role': 'Superadmin',
    },
    body: JSON.stringify({
      tableId: TABLE_ID,
      limit: 5000,
    }),
  });
  if (!res.ok) throw new Error('Failed to load logs');
  const data = await res.json();
  return (data.records || []).map(row => ({
    id: row._id,
    contactId: row.contact_id,
    eventUid: row.event_uid || '',
  }));
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

async function addLog(contactId, contactName, summary, dateStart, eventUid, isOneOnOne) {
  const res = await fetch(`${DRIZZLE_BASE}/insert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-role': 'Superadmin',
    },
    body: JSON.stringify({
      tableId: TABLE_ID,
      record: {
        contact_id: contactId,
        contact_name: contactName,
        contact_type: isOneOnOne ? 'zoom' : 'Meeting',
        notes: summary,
        logged_at: dateStart,
        event_uid: eventUid,
      },
    }),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to add log: ${error}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍 AUDIT AND REPAIR SCRIPT');
  console.log('═'.repeat(60));
  console.log(`\n📊 Tables:`)
  console.log(`   Contacts: ${CONTACTS_TABLE_ID}`);
  console.log(`   Logs:     ${TABLE_ID}`);

  // Load .ics file
  console.log('\n📂 Loading calendar file...');
  const icsContent = fs.readFileSync('/Users/torarnehave/Downloads/torarne@heinekolltveit.com.ics', 'utf-8');
  const allEvents = parseEvents(icsContent);
  console.log(`✓ Parsed ${allEvents.length} total events`);

  // Filter for 1-1 events
  const oneOnOneEvents = allEvents.filter(e => e.isOneOnOne);
  console.log(`✓ Found ${oneOnOneEvents.length} events with "1-1"`);

  // Load contacts
  console.log('\n👥 Loading contacts...');
  const contacts = await getContactsFromDB();
  console.log(`✓ Found ${contacts.length} contacts`);

  // Load existing logs
  console.log('\n📊 Loading existing logs...');
  const existingLogs = await getExistingLogs();
  const existingUids = new Set(existingLogs.map(l => l.eventUid).filter(u => u));
  console.log(`✓ Found ${existingLogs.length} existing logs (${existingUids.size} with event_uid)`);

  // Identify missing events
  console.log('\n🔎 Analyzing gaps...');
  let toImport = 0;
  let skipped = 0;
  let noMatch = 0;

  for (const event of oneOnOneEvents) {
    if (existingUids.has(event.uid)) {
      continue; // Already imported
    }

    // Find matching contacts
    const matchingIds = new Set();
    for (const attendee of event.attendees) {
      const contactId = findContactByEmail(attendee.email, contacts);
      if (contactId) {
        matchingIds.add(contactId);
      }
    }

    if (matchingIds.size === 0) {
      noMatch++;
    } else {
      toImport++;
    }
  }

  console.log(`✓ Events to import: ${toImport}`);
  console.log(`✓ Events with no matching contacts: ${noMatch}`);
  console.log(`✓ Already imported: ${existingUids.size}`);

  // Import missing events
  if (toImport === 0) {
    console.log('\n✅ Database is up to date!');
    return;
  }

  console.log(`\n⬆️  Importing ${toImport} missing events...`);
  let imported = 0;
  let failed = 0;

  for (let i = 0; i < oneOnOneEvents.length; i++) {
    const event = oneOnOneEvents[i];

    if (existingUids.has(event.uid)) {
      continue;
    }

    // Find matching contacts
    const matchingIds = new Set();
    for (const attendee of event.attendees) {
      const contactId = findContactByEmail(attendee.email, contacts);
      if (contactId) {
        matchingIds.add(contactId);
      }
    }

    if (matchingIds.size === 0) {
      continue;
    }

    // Import for each matching contact
    for (const contactId of matchingIds) {
      try {
        const contact = contacts.find(c => c.id === contactId);
        await addLog(
          contactId,
          contact.fullName,
          event.summary,
          event.dateStart,
          event.uid,
          event.isOneOnOne
        );
        imported++;

        if (imported % 100 === 0) {
          console.log(`  ${imported}/${toImport}...`);
        }
      } catch (err) {
        console.error(`  ❌ Failed to import "${event.summary}": ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n✅ Import complete!`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Failed: ${failed}`);
  console.log(`\n📊 FINAL STATS:`);
  console.log(`   Total 1-1 events in .ics: ${oneOnOneEvents.length}`);
  console.log(`   Now in database: ${existingUids.size + imported}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
