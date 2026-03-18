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
    };
  });
};
