import type { SessionChatMessage } from '@jameet/shared';
import type { SignalingClient } from '../media/signaling';

let sessionChatOpen = false;
let unreadChatCount = 0;
let sessionChatMessages: SessionChatMessage[] = [];

const TIME_GAP_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes threshold for grouping

let lastSenderId: string | undefined;
let lastIsOutgoing: boolean | undefined;
let lastMessageTime = 0;
let currentGroupEl: HTMLElement | null = null;

export function formatChatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes} ${ampm}`;
}

export function scrollChatToBottom(): void {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('session-chat-messages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

export function updateChatUnreadBadge(): void {
  if (typeof document === 'undefined') return;
  const badge = document.getElementById('chat-unread-badge');
  if (!badge) return;
  if (unreadChatCount > 0 && !sessionChatOpen) {
    badge.textContent = unreadChatCount > 99 ? '99+' : unreadChatCount.toString();
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

export function appendChatMessageToUi(msg: SessionChatMessage, isOutgoing: boolean): void {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('session-chat-messages');
  if (!container) return;

  const empty = document.getElementById('chat-empty-state');
  if (empty) empty.style.display = 'none';

  const time = msg.timestamp || Date.now();
  const timeSinceLast = time - lastMessageTime;
  const currentSenderKey = isOutgoing ? '__you__' : (msg.senderId || msg.senderName || 'musician');
  const lastSenderKey = lastIsOutgoing === undefined ? null : (lastIsOutgoing ? '__you__' : lastSenderId);
  const isSameSender = lastSenderKey === currentSenderKey;
  const isConsecutive = isSameSender && timeSinceLast < TIME_GAP_THRESHOLD_MS && currentGroupEl !== null;

  // Render centered timestamp divider if > 3 minutes elapsed since previous message or first message
  if (timeSinceLast >= TIME_GAP_THRESHOLD_MS || lastMessageTime === 0) {
    const divider = document.createElement('div');
    divider.className = 'chat-time-divider';
    const timeSpan = document.createElement('span');
    timeSpan.textContent = formatChatTime(time);
    divider.appendChild(timeSpan);
    container.appendChild(divider);
  }

  if (!isConsecutive || !currentGroupEl) {
    currentGroupEl = document.createElement('div');
    currentGroupEl.className = `chat-msg-group ${isOutgoing ? 'outgoing' : 'incoming'}`;

    if (!isOutgoing && msg.senderName) {
      const senderEl = document.createElement('div');
      senderEl.className = 'chat-group-sender';
      senderEl.textContent = msg.senderName;
      currentGroupEl.appendChild(senderEl);
    }

    container.appendChild(currentGroupEl);
  }

  const bubbleEl = document.createElement('div');
  bubbleEl.className = 'chat-msg-bubble';
  bubbleEl.textContent = msg.text;
  bubbleEl.title = formatChatTime(time);

  currentGroupEl.appendChild(bubbleEl);

  lastSenderId = isOutgoing ? '__you__' : (msg.senderId || msg.senderName || 'musician');
  lastIsOutgoing = isOutgoing;
  lastMessageTime = time;

  scrollChatToBottom();
}

let onChatOpenCallback: (() => void) | null = null;

export function setOnChatOpenCallback(cb: () => void): void {
  onChatOpenCallback = cb;
}

export function setSessionChatOpen(open: boolean): void {
  sessionChatOpen = open;
  if (typeof document !== 'undefined') {
    if (open) {
      // Close session workspace drawer if open so they never overlap
      if (onChatOpenCallback) {
        onChatOpenCallback();
      } else {
        const drawer = document.getElementById('session-workspace-drawer');
        if (drawer) drawer.classList.add('hidden');
        document.getElementById('toggle-session-workspace')?.classList.remove('active');
        document.getElementById('call-view')?.classList.remove('has-drawer-open');
      }
    }
    document.getElementById('session-chat-panel')?.classList.toggle('hidden', !open);
    document.getElementById('toggle-session-chat')?.classList.toggle('active', open);
    document.getElementById('call-view')?.classList.toggle('has-chat-open', open);
  }

  if (open) {
    unreadChatCount = 0;
    updateChatUnreadBadge();
    scrollChatToBottom();
    if (typeof document !== 'undefined') {
      const input = document.getElementById('session-chat-input') as HTMLTextAreaElement | null;
      input?.focus();
    }
  }
}

export function isSessionChatOpen(): boolean {
  return sessionChatOpen;
}

export function getUnreadChatCount(): number {
  return unreadChatCount;
}

export function getSessionChatMessages(): SessionChatMessage[] {
  return sessionChatMessages;
}

export function resetChatUi(): void {
  sessionChatOpen = false;
  unreadChatCount = 0;
  sessionChatMessages = [];
  lastSenderId = undefined;
  lastIsOutgoing = undefined;
  lastMessageTime = 0;
  currentGroupEl = null;

  if (typeof document !== 'undefined') {
    document.getElementById('session-chat-panel')?.classList.add('hidden');
    document.getElementById('toggle-session-chat')?.classList.remove('active');
    document.getElementById('call-view')?.classList.remove('has-chat-open');
    updateChatUnreadBadge();

    const container = document.getElementById('session-chat-messages');
    if (container) {
      container.innerHTML = '<div id="chat-empty-state" class="chat-empty-state"><span>No messages yet</span></div>';
    }
    const input = document.getElementById('session-chat-input') as HTMLTextAreaElement | null;
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
  }
}

export interface SessionChatContext {
  getSessionCode: () => string | null;
  signaling: SignalingClient;
}

export function initSessionChat(context: SessionChatContext): void {
  if (typeof document === 'undefined') return;
  const { getSessionCode, signaling } = context;

  async function handleSendChatMessage(): Promise<void> {
    const input = document.getElementById('session-chat-input') as HTMLTextAreaElement | null;
    const currentCode = getSessionCode();
    if (!input || !currentCode) return;
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';

    try {
      const res = await signaling.sendChatMessage(currentCode, text);
      if (res.ok && res.message) {
        sessionChatMessages.push(res.message);
        appendChatMessageToUi(res.message, true);
      }
    } catch (err) {
      console.error('Failed to send chat message:', err);
    }
  }

  document.getElementById('toggle-session-chat')?.addEventListener('click', () => {
    setSessionChatOpen(!sessionChatOpen);
  });

  document.getElementById('btn-close-session-chat')?.addEventListener('click', () => {
    setSessionChatOpen(false);
  });

  document.getElementById('session-chat-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void handleSendChatMessage();
  });

  const sessionChatInputEl = document.getElementById('session-chat-input') as HTMLTextAreaElement | null;
  sessionChatInputEl?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendChatMessage();
    }
  });

  sessionChatInputEl?.addEventListener('input', () => {
    if (!sessionChatInputEl) return;
    sessionChatInputEl.style.height = 'auto';
    sessionChatInputEl.style.height = `${Math.min(sessionChatInputEl.scrollHeight, 72)}px`;
  });

  signaling.on('chat:message', (message: SessionChatMessage) => {
    if (!message || !message.text) return;
    sessionChatMessages.push(message);
    appendChatMessageToUi(message, false);
    if (!sessionChatOpen) {
      unreadChatCount += 1;
      updateChatUnreadBadge();
    }
  });
}
