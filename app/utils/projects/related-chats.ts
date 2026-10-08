/** Toast copy for branches that moved with the chat the user chose; null when none did. */
export function relatedChatsNotice(count: number) {
    if (count < 1) return null;
    return {
        title: 'Related chats moved',
        description: `Also moved ${count} related chat${count === 1 ? '' : 's'} from the same branch family, so their shared history stays readable.`,
        color: 'neutral' as const,
        duration: 4000,
    };
}
