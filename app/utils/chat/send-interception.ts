let handledByExtension = false;

export function markChatSendHandled(): void {
    handledByExtension = true;
}

export function consumeChatSendHandled(): boolean {
    const handled = handledByExtension;
    handledByExtension = false;
    return handled;
}
