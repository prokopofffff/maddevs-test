import type { MailTransport, OutgoingMail } from "../../src/mail/transport.ts";

/** Фейковый транспорт: собирает отправленные письма, по просьбе теста падает. */
export class Mailbox implements MailTransport {
  readonly sent: OutgoingMail[] = [];
  private failures = 0;

  async send(mail: OutgoingMail) {
    if (this.failures > 0) {
      this.failures--;
      throw new Error("SMTP недоступен");
    }
    this.sent.push(mail);
  }

  /** Следующие `n` отправок падают. */
  failNext(n: number) {
    this.failures = n;
  }

  ofKind(kind: string, to?: string) {
    return this.sent.filter((m) => m.kind === kind && (to === undefined || m.to === to));
  }

  /** Код подтверждения из последнего письма `code` этому адресу. */
  lastCode(to: string) {
    const letter = this.ofKind("code", to).at(-1);
    const code = letter?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`письма с кодом для ${to} нет`);
    return code;
  }
}
