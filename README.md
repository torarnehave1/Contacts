# Contacts — Contact Management with Calendar Sync & Meeting Tracking

A modern contact management application with integrated calendar synchronization, meeting scheduling, SMS messaging, and comprehensive contact analytics.

## Features

- **Contact Management**: Import contacts from Google Contacts CSV, organize with labels and custom fields
- **Calendar Sync**: Sync Google Calendar events, track meetings with selected contacts
- **Meeting Invitations**: Schedule and send meeting invitations with date, time, and meeting links
- **SMS Messaging**: Send SMS messages directly to contacts
- **Contact Analytics**: Visualize contact relationships and interaction patterns
- **Event Tracking**: Log interactions, track meeting quality, critical notes, and reminders
- **Contact Profiles**: Rich contact information including emails, phones, addresses, organizations, and websites

## Prerequisites

- Node.js 18+
- npm or yarn

## Run Locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set environment variables in `.env.local`:
   ```bash
   GEMINI_API_KEY="your-gemini-api-key"
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:3000`

## Build for Production

```bash
npm run build
```

## Project Structure

- `src/` — React components and application logic
- `src/components/` — Reusable UI components (AnalyticsView, CalendarSyncModal, DayView, Login)
- `src/lib/` — Database and authentication utilities
- `src/utils/` — Parsers for CSV and iCalendar files
- `src/types.ts` — TypeScript type definitions

## Technology Stack

- **Frontend**: React 19, TypeScript, Vite
- **Styling**: Tailwind CSS
- **UI Components**: Lucide React, vegvisr-ui-kit
- **Database**: Drizzle ORM (D1)
- **Visualization**: Cytoscape (graph visualization), Recharts (analytics)
- **Utilities**: date-fns, papaparse
- **Animations**: Motion
