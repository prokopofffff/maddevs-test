import type { MailTransport, OutgoingMail } from "../../src/mail/transport.ts";

/** Фейковый транспорт: собирает отправленные письма, по просьбе теста падает. */
export class Mailbox implements MailTransport {
  readonly sent: OutgoingMail[] = [];
  private failures = 0;
  private hang: { entered: () => void; released: Promise<void> } | undefined;

  async send(mail: OutgoingMail) {
    if (this.hang) {
      const hang = this.hang;
      this.hang = undefined;
      hang.entered();
      await hang.released;
    }
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

  /**
   * Следующая отправка зависает — «процесс упал посреди SMTP».
   * `entered` разрешается, когда проход дошёл до отправки; `release` отпускает его.
   */
  hangNext() {
    let release!: () => void;
    let entered!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
    this.hang = { entered, released };
    return { entered: enteredPromise, release };
  }

  ofKind(kind: string, to?: string) {
    return this.sent.filter((m) => m.kind === kind && (to === undefined || m.to === to));
  }

  /** Код из последнего письма `kind` (`code` или `login_code`) этому адресу. */
  lastCode(to: string, kind = "code") {
    const letter = this.ofKind(kind, to).at(-1);
    const code = letter?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`письма с кодом для ${to} нет`);
    return code;
  }
}
