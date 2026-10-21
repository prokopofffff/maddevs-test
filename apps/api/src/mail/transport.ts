/** Письмо из строки outbox в том виде, в каком его получает транспорт (D-013). */
export interface OutgoingMail {
  /** `id` строки outbox: из него выводится `Message-ID`, повтор уходит с тем же. */
  id: number;
  kind: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Почтовый транспорт: в приложении — SMTP в Mailpit, в тестах — фейковый (D-041). */
export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
}
