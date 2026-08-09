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
    return attachments.filter((att) => att.status === 'pending').length;
}

export function getFailedAttachmentCount(
    attachments: AttachmentLike[] | null | undefined
): number {
    if (!attachments?.length) return 0;
    return attachments.filter((att) => att.status === 'error').length;
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
    const failedCount = getFailedAttachmentCount(attachments);
    if (pendingCount === 0 && failedCount === 0) return true;

    if (failedCount > 0) {
        toast?.add?.({
            title: 'Attachment needs attention',
            description:
                'Remove or retry failed attachments before sending so no files are omitted.',
            color: 'warning',
            duration: options?.duration ?? 2600,
        });
        return false;
    }

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
