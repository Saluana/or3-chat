type AttachmentLike = {
    status?: 'pending' | 'ready' | 'error' | string;
};

type ToastLike = {
    add?: (options: {
        title: string;
        description: string;
        color?:
            | 'error'
            | 'success'
            | 'info'
            | 'warning'
            | 'primary'
            | 'secondary'
            | 'neutral';
        duration?: number;
    }) => unknown;
};

export function getPendingAttachmentCount(
    attachments: AttachmentLike[] | null | undefined
): number {
    if (!attachments?.length) return 0;
    return attachments.filter((att) => att?.status === 'pending').length;
}

export function guardPendingAttachmentSend(
    attachments: AttachmentLike[] | null | undefined,
    toast: ToastLike | null | undefined,
    options?: {
        title?: string;
        description?: string;
        duration?: number;
    }
): boolean {
    const pendingCount = getPendingAttachmentCount(attachments);
    if (pendingCount === 0) return true;

    toast?.add?.({
        title: options?.title ?? 'Files are still uploading',
        description:
            options?.description ??
            'Please wait for attachments to finish before sending.',
        color: 'primary',
        duration: options?.duration ?? 2600,
    });
    return false;
}
