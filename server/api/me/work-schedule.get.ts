import { getWorkSchedule } from './handlers/getWorkSchedule'

// Thin route. The authenticated wrapper enforces the session (401 when missing), the handler does
// the read. Read-only: this bout ships no write endpoint for the schedule.
export default defineAuthenticatedEventHandler((event) => getWorkSchedule(event))
