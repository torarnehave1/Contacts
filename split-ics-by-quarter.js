#!/usr/bin/env node

/**
 * Split an iCalendar (.ics) file by year and quarter
 * Usage: node split-ics-by-quarter.js <input-file.ics> [output-directory]
 */

import fs from 'fs';
import path from 'path';

function splitICalByQuarter(inputFile, outputDir = './ics-quarters') {
  // Read the input file
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    process.exit(1);
  }

  const content = fs.readFileSync(inputFile, 'utf-8');

  // Extract calendar header and footer
  const headerMatch = content.match(/BEGIN:VCALENDAR[\s\S]*?(?=BEGIN:VEVENT)/);
  const footerMatch = content.match(/END:VCALENDAR/);

  if (!headerMatch || !footerMatch) {
    console.error('Error: Invalid iCalendar file format');
    process.exit(1);
  }

  const header = headerMatch[0];
  const footer = footerMatch[0];

  // Extract all VEVENT blocks
  const eventBlocks = content.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

  console.log(`Found ${eventBlocks.length} events in file`);

  // Group events by year and quarter
  const quarterMap = new Map();

  for (const block of eventBlocks) {
    // Extract DTSTART
    const dtStartMatch = block.match(/DTSTART[^:]*:([^\n\r]+)/i);
    if (!dtStartMatch) continue;

    const dateStr = dtStartMatch[1].replace(/[ZT]/g, (m) => (m === 'Z' ? '' : ' '));
    const match = dateStr.match(/(\d{4})(\d{2})(\d{2})/);

    if (!match) continue;

    const [, year, month] = match;
    const monthNum = parseInt(month);
    const quarter = Math.ceil(monthNum / 3);
    const key = `Q${quarter}${year}`;

    if (!quarterMap.has(key)) {
      quarterMap.set(key, []);
    }
    quarterMap.get(key).push(block);
  }

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write files for each quarter
  const files = [];
  for (const [quarter, events] of quarterMap) {
    const filename = `${quarter}.ics`;
    const filepath = path.join(outputDir, filename);

    // Build the iCal file with proper format
    const icalContent = header + events.join('\n') + footer;

    fs.writeFileSync(filepath, icalContent, 'utf-8');
    files.push(filename);

    console.log(`✓ ${filename} (${events.length} events)`);
  }

  console.log(`\n✅ Split complete! Created ${files.length} files in ${outputDir}/`);
  console.log('\nFiles created:');
  files.sort().forEach((f) => console.log(`  - ${f}`));
}

// Get arguments
const inputFile = process.argv[2];
const outputDir = process.argv[3];

if (!inputFile) {
  console.log('Usage: node split-ics-by-quarter.js <input-file.ics> [output-directory]');
  console.log('\nExample:');
  console.log('  node split-ics-by-quarter.js calendar.ics ./quarters');
  console.log('\nThis will create:');
  console.log('  quarters/Q12025.ics');
  console.log('  quarters/Q22025.ics');
  console.log('  quarters/Q32025.ics');
  console.log('  etc.');
  process.exit(1);
}

splitICalByQuarter(inputFile, outputDir);
