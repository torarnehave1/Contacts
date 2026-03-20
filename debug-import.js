#!/usr/bin/env node

/**
 * Debug script: Audit what calendar events should be imported vs what's in the database
 */

import fs from 'fs';

// Read the .ics file
const icsContent = fs.readFileSync('/Users/torarnehave/Downloads/torarne@heinekolltveit.com.ics', 'utf-8');

// Extract all VEVENT blocks
const eventBlocks = icsContent.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

console.log(`\n📋 IMPORT AUDIT REPORT`);
console.log(`${'='.repeat(60)}`);
console.log(`Total events in .ics file: ${eventBlocks.length}`);

// Filter for 1-1 events
const oneOnOneEvents = eventBlocks.filter(block => {
  const summaryMatch = block.match(/SUMMARY:([^\n]+)/i);
  return summaryMatch && summaryMatch[1].includes('1-1');
});

console.log(`Events with "1-1" in title: ${oneOnOneEvents.length}`);

// Analyze 1-1 events
const analysis = {
  hasAttendees: 0,
  noAttendees: 0,
  attendeeEmails: new Set(),
  eventsByYear: {},
  eventsByContact: {},
};

oneOnOneEvents.forEach((block, idx) => {
  // Extract summary
  const summaryMatch = block.match(/SUMMARY:([^\n]+)/i);
  const summary = summaryMatch ? summaryMatch[1] : 'Unknown';

  // Extract date
  const dateMatch = block.match(/DTSTART[^:]*:(\d{8})/);
  const date = dateMatch ? dateMatch[1] : 'Unknown';
  const year = date.substring(0, 4);

  // Extract attendees
  const attendeeMatches = block.matchAll(/ATTENDEE[^:]*:([^\n]*(?:\n[ \t][^\n]*)*)/gi);
  const attendees = [];
  for (const match of attendeeMatches) {
    const attendeeStr = match[1].replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
    const emailMatch = attendeeStr.match(/mailto:([^\s;]+)/i);
    if (emailMatch) {
      const email = emailMatch[1];
      attendees.push(email);
      analysis.attendeeEmails.add(email);
    }
  }

  if (attendees.length > 0) {
    analysis.hasAttendees++;
  } else {
    analysis.noAttendees++;
  }

  analysis.eventsByYear[year] = (analysis.eventsByYear[year] || 0) + 1;

  // Store for later analysis
  const key = `${summary}|${date}`;
  if (!analysis.eventsByContact[key]) {
    analysis.eventsByContact[key] = { summary, date, attendees };
  }
});

console.log(`\n📊 ANALYSIS:`);
console.log(`- Events WITH attendees: ${analysis.hasAttendees}`);
console.log(`- Events WITHOUT attendees: ${analysis.noAttendees}`);
console.log(`- Unique attendee emails: ${analysis.attendeeEmails.size}`);

console.log(`\n📅 BY YEAR:`);
Object.keys(analysis.eventsByYear).sort().forEach(year => {
  console.log(`  ${year}: ${analysis.eventsByYear[year]} events`);
});

console.log(`\n📧 TOP ATTENDEES (sample):`);
Array.from(analysis.attendeeEmails)
  .slice(0, 20)
  .forEach(email => {
    const count = Object.values(analysis.eventsByContact).filter(e =>
      e.attendees.includes(email)
    ).length;
    console.log(`  ${email}: ${count} events`);
  });

console.log(`\n⚠️  POTENTIAL ISSUES TO CHECK:`);
console.log(`1. Are all ${analysis.attendeeEmails.size} attendees in your contacts?`);
console.log(`2. Do they have matching email addresses?`);
console.log(`3. Are you importing ALL quarters (Q1-Q4 for all years)?`);
console.log(`4. Is there a bug in the import matching logic?`);

console.log(`\nSample events (first 5 with attendees):`);
Object.values(analysis.eventsByContact)
  .filter(e => e.attendees.length > 0)
  .slice(0, 5)
  .forEach(e => {
    console.log(`  - ${e.summary} (${e.date})`);
    console.log(`    Attendees: ${e.attendees.join(', ')}`);
  });
