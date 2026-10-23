import { emailSchema } from "@app/api/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, ApiError, client } from "../../api.ts";
import { ErrorBanner } from "../../components/Banner.tsx";
import { Icon } from "../../components/Icon.tsx";
import { errorText } from "../../errors.ts";
import { participantKey, participantRegistrationsKey, safeNext } from "../../participant.ts";
import { CodeStep } from "../event/CodeStep.tsx";

type Step = { name: "email" } | { name: "code"; verificationId: number; resendAt: number };

const isCode = (error: unknown, code: string): error is ApiError => error instanceof ApiError && error.code === code;

/**
 * Вход участника на `/me`: email → код из письма → профиль (дизайн §8.3, D-057).
 * Повтор кода и `code_resend_too_soon` — как на странице события; после кода — на `?next=` или остаёмся на `/me`.
 */
export function ParticipantLogin() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>({ name: "email" });
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  // Код, с которого вернулись «Изменить email»: тот же адрес раньше минуты снова ведёт к нему.
  const [previous, setPrevious] = useState<{ email: string; verificationId: number }>();
  const verificationId = step.name === "code" ? step.verificationId : undefined;
  const invalid = touched && !emailSchema.safeParse(email).success;

  const toCode = (id: number, resendAt: number) => setStep({ name: "code", verificationId: id, resendAt });

  const request = useMutation({
    mutationFn: (to: string) => api(client.api.participant.verifications.$post({ json: { email: to } })),
    onSuccess: (res) => toCode(res.verificationId, Date.parse(res.resendAfter)),
    onError: (error, to) => {
      if (isCode(error, "code_resend_too_soon") && previous?.email === to) {
        toCode(previous.verificationId, Date.now() + Number(error.details.retryAfter) * 1000);
      }
    },
  });
  const resend = useMutation({
    mutationFn: () => api(client.api.participant.verifications.$post({ json: { email } })),
    onSuccess: (res) => toCode(res.verificationId, Date.parse(res.resendAfter)),
    onError: (error) => {
      if (isCode(error, "code_resend_too_soon") && verificationId !== undefined) {
        toCode(verificationId, Date.now() + Number(error.details.retryAfter) * 1000);
      }
    },
  });
  const confirm = useMutation({
    mutationFn: (code: string) =>
      api(
        client.api.participant.verifications[":id"].confirm.$post({
          param: { id: String(verificationId) },
          json: { code },
        }),
      ),
    onSuccess: async ({ email: confirmed }) => {
      // Форма регистрации читает `lastData` один раз, при монтировании: переходим по `?next=/e/:id` только
      // с настоящим ответом `/participant/me`, иначе форма смонтируется пустой (дизайн §8.4).
      try {
        queryClient.setQueryData(participantKey, await api(client.api.participant.me.$get()));
      } catch {
        // Не вышло — входим без предзаполнения: профиль подтянет обычный запрос.
        queryClient.setQueryData(participantKey, { email: confirmed, profile: null, lastData: null });
      }
      // Регистрации прежнего пользователя (если был) протухли; сам `participantKey` свежий.
      void queryClient.invalidateQueries({ queryKey: participantRegistrationsKey });
      void navigate(safeNext(params.get("next")), { replace: true });
    },
  });

  if (step.name === "code") {
    return (
      <CodeStep
        key={`${step.verificationId}:${step.resendAt}`}
        email={email}
        resendAt={step.resendAt}
        confirming={confirm.isPending}
        confirmError={confirm.error}
        resending={resend.isPending}
        resendError={resend.error}
        onConfirm={(code) => confirm.mutate(code)}
        onResend={() => {
          confirm.reset();
          resend.mutate();
        }}
        onBack={() => {
          setPrevious({ email, verificationId: step.verificationId });
          confirm.reset();
          resend.reset();
          request.reset();
          setStep({ name: "email" });
        }}
      />
    );
  }

  return (
    <div className="page page--narrow">
      <header className="event-header">
        <h1 className="heading heading--page">Мои регистрации</h1>
        <p>Введите email, на который регистрировались, — пришлём код для входа.</p>
      </header>
      <div className="panel">
        {request.error ? <ErrorBanner>{errorText(request.error)}</ErrorBanner> : null}
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (emailSchema.safeParse(email).success) request.mutate(email);
          }}
        >
          <div className={`field ${invalid ? "field--error" : ""}`}>
            <label className="field__label" htmlFor="participant-email">
              Email
            </label>
            <input
              className="field__control"
              id="participant-email"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={invalid}
              aria-describedby={invalid ? "participant-email-error" : undefined}
            />
            {invalid && (
              <p className="field__error" id="participant-email-error">
                <Icon name="info" />
                Введите email, например name@example.com
              </p>
            )}
          </div>
          <button
            className={`button button--primary button--block ${request.isPending ? "button--loading" : ""}`}
            type="submit"
            aria-busy={request.isPending}
            disabled={request.isPending}
          >
            {request.isPending && <span className="button__spinner" aria-hidden="true" />}
            {request.isPending ? "Отправляем код…" : "Получить код"}
          </button>
        </form>
      </div>
    </div>
  );
}
