export function truncateAttachmentName(name: string, maxLength = 20): string {
    if (!name || name.length <= maxLength) return name;

    const dotIndex = name.lastIndexOf('.');
    const extension = dotIndex > 0 ? name.slice(dotIndex) : '';
    const baseName = dotIndex > 0 ? name.slice(0, dotIndex) : name;

    const available = maxLength - extension.length - 2;
    if (available <= 1) {
        return `${name.slice(0, Math.max(1, maxLength - 1))}…`;
    }

    return `${baseName.slice(0, available)}…${extension}`;
}
