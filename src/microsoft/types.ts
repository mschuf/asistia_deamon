export interface GraphEmailAddress {
  name?: string;
  address?: string;
}

export interface GraphEmailAddressWrapper {
  emailAddress: GraphEmailAddress;
}

export interface GraphMessageBody {
  contentType?: string;
  content?: string;
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  from?: GraphEmailAddressWrapper;
  toRecipients?: GraphEmailAddressWrapper[];
  ccRecipients?: GraphEmailAddressWrapper[];
  isRead?: boolean;
  hasAttachments?: boolean;
  body?: GraphMessageBody;
  parentFolderId?: string;
}

export interface GraphMessagesResponse {
  value: GraphMessage[];
  '@odata.nextLink'?: string;
}

export interface MicrosoftMailboxConfig {
  msTenantId: string;
  msClientId: string;
  msClientSecret: string;
  msMailbox: string;
  msMailFolder: string;
}

export interface EmailParticipant {
  name: string;
  address: string;
}

export interface EmailMessage {
  id: string;
  conversationId: string;
  subject: string;
  from: EmailParticipant;
  to: EmailParticipant[];
  cc: EmailParticipant[];
  receivedDateTime: string;
  bodyPreview: string;
  body: string;
  isRead: boolean;
}

export interface EmailThread {
  conversationId: string;
  subject: string;
  messages: EmailMessage[];
  latestMessage: EmailMessage;
}
