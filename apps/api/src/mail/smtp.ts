import { createTransport } from "nodemailer";
import type { MailTransport } from "./transport.ts";

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
  /** Домен для `Message-ID`: берётся из `PUBLIC_URL`. */
  messageIdDomain: string;
}

/** SMTP через nodemailer — на стенде в Mailpit (D-002, D-013). */
export function smtpTransport({ host, port, from, messageIdDomain }: SmtpConfig): MailTransport {
  const transporter = createTransport({ host, port, secure: false });
  return {
    async send(mail) {
      await transporter.sendMail({
        from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        // Повтор строки outbox уходит с тем же Message-ID (D-013).
        messageId: `<outbox-${mail.id}@${messageIdDomain}>`,
        headers: { "X-Mail-Kind": mail.kind },
      });
    },
  };
}
