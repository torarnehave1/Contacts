import Papa from 'papaparse';
import { Contact } from '../types';

export const parseGoogleContactsCSV = (csvString: string): Contact[] => {
  const results = Papa.parse(csvString, {
    header: true,
    skipEmptyLines: true,
  });

  return results.data.map((row: any, index: number) => {
    const firstName = row['First Name'] || '';
    const middleName = row['Middle Name'] || '';
    const lastName = row['Last Name'] || '';
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');

    const emails: { label: string; value: string }[] = [];
    for (let i = 1; i <= 5; i++) {
      const label = row[`E-mail ${i} - Label`];
      const value = row[`E-mail ${i} - Value`];
      if (value) emails.push({ label: label || 'Other', value });
    }

    const phones: { label: string; value: string }[] = [];
    for (let i = 1; i <= 5; i++) {
      const label = row[`Phone ${i} - Label`];
      const value = row[`Phone ${i} - Value`];
      if (value) {
        // Handle multiple values in one cell (e.g., "Mobile,+47 04800 ::: +47 04801")
        const splitValues = value.split(' ::: ');
        splitValues.forEach((v: string) => {
          phones.push({ label: label || 'Mobile', value: v.trim() });
        });
      }
    }

    const addresses: any[] = [];
    for (let i = 1; i <= 3; i++) {
      const label = row[`Address ${i} - Label`];
      const formatted = row[`Address ${i} - Formatted`];
      if (formatted) {
        addresses.push({
          label: label || 'Home',
          formatted,
          street: row[`Address ${i} - Street`] || '',
          city: row[`Address ${i} - City`] || '',
          region: row[`Address ${i} - Region`] || '',
          postalCode: row[`Address ${i} - Postal Code`] || '',
          country: row[`Address ${i} - Country`] || '',
        });
      }
    }

    const websites: { label: string; value: string }[] = [];
    for (let i = 1; i <= 3; i++) {
      const label = row[`Website ${i} - Label`];
      const value = row[`Website ${i} - Value`];
      if (value) websites.push({ label: label || 'Website', value });
    }

    return {
      id: `contact-${index}-${Date.now()}`,
      firstName,
      middleName,
      lastName,
      fullName: fullName || 'Unnamed Contact',
      nickname: row['Nickname'] || '',
      birthday: row['Birthday'] || '',
      notes: row['Notes'] || '',
      photo: row['Photo'] || '',
      labels: (row['Labels'] || '').split(' ::: ').filter(Boolean),
      emails,
      phones,
      addresses,
      organization: {
        name: row['Organization Name'] || '',
        title: row['Organization Title'] || '',
        department: row['Organization Department'] || '',
      },
      websites,
      meetingQuality: null,
      criticalNote: '',
      reminderSentAt: '',
    };
  });
};

// ─── Kajabi ─────────────────────────────────────────────────────────────────
// Kajabi «Contacts → Bulk Actions → Export» (site export, one row per contact). Verified against the
// export of site 57878 on 2026-10-26: columns Name, First Name, Last Name, Email, Products, Tags, ID,
// Member ID, Created At, …, then the site's own form fields as «Label (field_key)». Tags and Products
// are comma-separated. Tags become labels as they are; Products become labels «Produkt: <name>».

const KAJABI_REQUIRED = ['Name', 'Email', 'Tags', 'Products', 'Created At'];
export const ZAPIER_LABEL = 'Zapier 2024–25';

const splitList = (v: unknown): string[] =>
  String(v || '').split(',').map(s => s.trim()).filter(Boolean);

/** Form field «Label (key)» → value, looked up by key so the label text can change. */
const byKey = (row: Record<string, string>, key: string): string => {
  const col = Object.keys(row).find(k => k.endsWith(`(${key})`));
  return col ? String(row[col] || '').trim() : '';
};

export const parseKajabiContactsCSV = (csvString: string): Contact[] => {
  const results = Papa.parse<Record<string, string>>(csvString, { header: true, skipEmptyLines: true });
  return results.data.map((row, index) => {
    const email = String(row['Email'] || byKey(row, 'email')).trim();
    const firstName = String(row['First Name'] || '').trim();
    const lastName = String(row['Last Name'] || '').trim();
    const fullName = String(row['Name'] || byKey(row, 'name')).trim() || [firstName, lastName].filter(Boolean).join(' ') || email;

    const phones: { label: string; value: string }[] = [];
    const phone = byKey(row, 'phone_number');
    const mobile = byKey(row, 'mobile_phone_number');
    if (mobile) phones.push({ label: 'Mobile', value: mobile });
    if (phone && phone !== mobile) phones.push({ label: 'Phone', value: phone });

    const street = [byKey(row, 'address_line_1'), byKey(row, 'address_line_2')].filter(Boolean).join(', ');
    const city = byKey(row, 'address_city');
    const region = byKey(row, 'address_state');
    const postalCode = byKey(row, 'address_zip');
    const country = byKey(row, 'address_country');
    const addresses = (street || city || postalCode || country)
      ? [{ label: 'Home', formatted: [street, [postalCode, city].filter(Boolean).join(' '), region, country].filter(Boolean).join(', '), street, city, region, postalCode, country }]
      : [];

    const labels = [
      ...splitList(row['Tags']),
      // Kajabi appends « archived <unix time>» to an archived product's name; keep the fact, drop the number.
      ...splitList(row['Products']).map(p => `Produkt: ${p.replace(/\s+archived\s+\d+$/i, ' (archived)')}`),
    ];
    // 947 contacts in site 57878 came from a Zapier feed into «Default Form» (e-mail only, no tags),
    // Nov 2024 – Jun 2025 (checked in Kajabi 2026-10-26). Labelled so the founder can find and review them.
    const created = String(row['Created At'] || '').slice(0, 10);
    if (!String(row['Name'] || '').trim() && !labels.length && created >= '2024-11-01' && created < '2025-07-01') {
      labels.push(ZAPIER_LABEL);
    }

    // What Kajabi knows that has no field of its own goes into the notes, one line each.
    const yes = (v: string) => (v === '1' ? 'ja' : v === '0' ? 'nei' : '');
    const notes = [
      `Kajabi-kontakt ${row['ID'] || ''}, opprettet ${String(row['Created At'] || '').slice(0, 10)}`,
      row['Member ID'] ? `Kajabi-medlem siden ${String(row['Member Created At'] || '').slice(0, 10)}, innlogginger ${row['Sign In Count'] || 0}, sist aktiv ${String(row['Last Activity'] || '').slice(0, 10) || '–'}` : '',
      yes(byKey(row, 'custom_5')) ? `Samtykke til e-post (skjema): ${yes(byKey(row, 'custom_5'))}` : '',
      yes(byKey(row, 'custom_1')) ? `Ønsker nyhetsbrev: ${yes(byKey(row, 'custom_1'))}` : '',
      byKey(row, 'custom_6') ? `Ønsker å melde seg ut av Den lille strikkeskolen: ${byKey(row, 'custom_6')}` : '',
      byKey(row, 'custom_3') ? `Spørsmål: ${byKey(row, 'custom_3')}` : '',
      byKey(row, 'custom_4') ? `Manglende oppskrift: ${byKey(row, 'custom_4')}` : '',
      byKey(row, 'custom_7') ? `Genser: ${byKey(row, 'custom_7')}` : '',
    ].filter(Boolean).join('\n');

    return {
      id: `kajabi-${row['ID'] || index}`,
      firstName,
      middleName: '',
      lastName,
      fullName: fullName || 'Unnamed Contact',
      nickname: '',
      birthday: '',
      notes,
      photo: '',
      labels,
      emails: email ? [{ label: 'Kajabi', value: email }] : [],
      phones,
      addresses,
      organization: { name: '', title: '', department: '' },
      websites: [],
      meetingQuality: null,
      criticalNote: '',
      reminderSentAt: '',
    };
  });
};

export type ContactsFormat = 'google' | 'kajabi';

/** Read a contacts CSV: a Kajabi export when its header has Kajabi's columns, otherwise Google Contacts. */
export const parseContactsCSV = (csvString: string): { format: ContactsFormat; contacts: Contact[] } => {
  const text = csvString.replace(/^﻿/, '');
  const header = (Papa.parse<string[]>(text, { preview: 1 }).data[0] || []).map(h => String(h).trim());
  if (KAJABI_REQUIRED.every(c => header.includes(c))) {
    return { format: 'kajabi', contacts: parseKajabiContactsCSV(text) };
  }
  // Anything else is read as Google Contacts, as the import always did.
  return { format: 'google', contacts: parseGoogleContactsCSV(text) };
};
