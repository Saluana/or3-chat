import { describe, it, expect } from 'vitest';
import { statSync } from 'fs';
import { join } from 'path';

describe('Asset size regression tests', () => {
    const publicDir = join(__dirname, '../../public');
    
    it('should keep bg-repeat.v2.webp under 90KB', () => {
        const filePath = join(publicDir, 'bg-repeat.v2.webp');
        const stats = statSync(filePath);
        expect(stats.size).toBeLessThan(90_000);
    });
    
    it('should keep bg-repeat-2.v2.webp under 110KB', () => {
        const filePath = join(publicDir, 'bg-repeat-2.v2.webp');
        const stats = statSync(filePath);
        expect(stats.size).toBeLessThan(110_000);
    });
    
    it('should keep sidebar-repeater.v2.webp under 210KB', () => {
        const filePath = join(publicDir, 'sidebar-repeater.v2.webp');
        const stats = statSync(filePath);
        expect(stats.size).toBeLessThan(210_000);
    });
    
    it('should have total optimized background size under 400KB', () => {
        const bgRepeat = statSync(join(publicDir, 'bg-repeat.v2.webp')).size;
        const bgRepeat2 = statSync(join(publicDir, 'bg-repeat-2.v2.webp')).size;
        const sidebar = statSync(join(publicDir, 'sidebar-repeater.v2.webp')).size;
        
        const total = bgRepeat + bgRepeat2 + sidebar;
        expect(total).toBeLessThan(400_000);
    });
});
