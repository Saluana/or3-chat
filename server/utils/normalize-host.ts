/**
 * Normalize a hostname by lowercasing and removing port.
 * Used for admin access control and allowed hosts validation.
 * 
 * Handles IPv6 addresses in bracket notation (e.g., [::1]:3000 -> [::1]).
 */
export function normalizeHost(host: string): string {
    const lower = host.trim().toLowerCase();
    
    // Handle empty input
    if (!lower) return '';
    
    // Handle IPv6 bracket notation: [::1]:3000 -> [::1]
    if (lower.startsWith('[')) {
        const bracketEnd = lower.indexOf(']');
        if (bracketEnd !== -1) {
            return lower.slice(0, bracketEnd + 1);
        }
        return lower;
    }
    
    // IPv4 or hostname: remove port (everything after first colon)
    const colonIndex = lower.indexOf(':');
    if (colonIndex === -1) return lower;
    
    // Handle edge cases like ":" or ":8080" where there's no host before colon
    if (colonIndex === 0) return '';
    
    return lower.slice(0, colonIndex);
}
