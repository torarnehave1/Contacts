export interface Contact {
  id: string;
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  nickname: string;
  birthday: string;
  notes: string;
  photo: string;
  labels: string[];
  emails: { label: string; value: string }[];
  phones: { label: string; value: string }[];
  addresses: {
    label: string;
    formatted: string;
    street: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  }[];
  organization: {
    name: string;
    title: string;
    department: string;
  };
  websites: { label: string; value: string }[];
}
