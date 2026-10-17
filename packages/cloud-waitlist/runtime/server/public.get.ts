import { defineEventHandler, setResponseHeader } from 'h3';
import { waitlistEnabled } from './store';

export default defineEventHandler(event => {
    setResponseHeader(event, 'Cache-Control', 'no-store');
    return { enabled: waitlistEnabled() };
});
