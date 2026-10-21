import type { RegistrationForm as FormData } from "@app/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { api, ApiError, client } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { Brand } from "../components/Brand.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { errorText } from "../errors.ts";
import { formatEventTime, seatsLeft } from "../format.ts";
import { CodeStep } from "./event/CodeStep.tsx";
import { RegistrationForm } from "./event/RegistrationForm.tsx";
import { RegistrationResult } from "./event/RegistrationResult.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

type Step =
  | { name: "form" }
  | { name: "code"; verificationId: number; resendAt: number }
  | { name: "result"; result: "confirmed" | "existing"; token: string };

const isCode = (error: unknown, code: string): error is ApiError => error instanceof ApiError && error.code === code;

/**
 * Страница события по ссылке: S1-Event (описание, свободные места, форма) → S2-Code (ввод кода) → S3-Result.
 * «Уже регистрировались?» приходит с тикетом «потерял письмо».
 */
export function PublicEventPage() {
  const { eventId = "" } = useParams();
  const queryClient = useQueryClient();
  const eventKey = ["event", eventId];
  const event = useQuery({
    queryKey: eventKey,
    queryFn: () => api(client.api.events[":id"].$get({ param: { id: eventId } })),
  });
  const [step, setStep] = useState<Step>({ name: "form" });
  const [data, setData] = useState<FormData>();
  // Код, с которого вернулись «Изменить email»: тот же адрес раньше минуты снова ведёт к нему.
  const [previous, setPrevious] = useState<{ email: string; verificationId: number }>();
  const verificationId = step.name === "code" ? step.verificationId : undefined;

  const toCode = (id: number, resendAt: number) => setStep({ name: "code", verificationId: id, resendAt });
  const onClosed = (error: unknown) => {
    // Событие началось, пока человек заполнял форму: страница переключается на «регистрация закрыта».
    if (isCode(error, "registration_closed")) void queryClient.invalidateQueries({ queryKey: eventKey });
  };

  const requestCode = (input: FormData) =>
    api(client.api.events[":id"].verifications.$post({ param: { id: eventId }, json: { purpose: "register", ...input } }));

  const request = useMutation({
    mutationFn: requestCode,
    onSuccess: (res, input) => {
      setData(input);
      toCode(res.verificationId, Date.parse(res.resendAfter));
    },
    onError: (error, input) => {
      // Вернулись «Изменить email» и отправили тот же адрес раньше минуты — прежний код ещё действует.
      if (isCode(error, "code_resend_too_soon") && previous?.email === input.email) {
        setData(input);
        toCode(previous.verificationId, Date.now() + Number(error.details.retryAfter) * 1000);
      }
      onClosed(error);
    },
  });
  const resend = useMutation({
    mutationFn: () => requestCode(data!),
    onSuccess: (res) => toCode(res.verificationId, Date.parse(res.resendAfter)),
    onError: (error) => {
      if (isCode(error, "code_resend_too_soon") && verificationId !== undefined) {
        toCode(verificationId, Date.now() + Number(error.details.retryAfter) * 1000);
      }
      onClosed(error);
    },
  });
  const confirm = useMutation({
    mutationFn: (code: string) =>
      api(client.api.verifications[":id"].confirm.$post({ param: { id: String(verificationId) }, json: { code } })),
    onSuccess: (res) => {
      setStep({ name: "result", result: res.result, token: res.token });
      void queryClient.invalidateQueries({ queryKey: eventKey });
    },
    onError: onClosed,
  });

  if (step.name === "result") return <RegistrationResult result={step.result} token={step.token} />;
  if (step.name === "code" && data) {
    return (
      <CodeStep
        key={`${step.verificationId}:${step.resendAt}`}
        email={data.email}
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
          setPrevious({ email: data.email, verificationId: step.verificationId });
          confirm.reset();
          resend.reset();
          request.reset();
          setStep({ name: "form" });
        }}
      />
    );
  }

  if (event.isPending) return <PageSkeleton label="Загрузка события" />;
  if (event.error instanceof ApiError && event.error.status === 404) return <NotFoundPage />;

  return (
    <div className="page page--split">
      <Brand />
      {event.isError ? (
        <ErrorBanner title="Не удалось загрузить событие">{errorText(event.error)}</ErrorBanner>
      ) : (
        <>
          <div className="page__main">
            <header className="event-header">
              {event.data.minAge && (
                <div className="event-header__badges">
                  <span className="badge badge--age">{event.data.minAge}+</span>
                </div>
              )}
              <h1 className="heading heading--page">{event.data.title}</h1>
              <p className="event-header__time">
                <Icon name="calendar" />
                {formatEventTime(event.data.startsAt, event.data.timezone)}
              </p>
              {event.data.description && <p style={{ whiteSpace: "pre-line" }}>{event.data.description}</p>}
            </header>
          </div>
          <div className="page__side">
            <div className="panel">
              {event.data.started ? (
                <div className="banner" role="status">
                  <Icon name="info" />
                  <div className="banner__body">
                    <p className="banner__title">Событие началось — регистрация закрыта</p>
                  </div>
                </div>
              ) : (
                <>
                  {event.data.freeSeats > 0 ? (
                    <p className="seats seats--available">
                      <Icon name="check" />
                      {seatsLeft(event.data.freeSeats)}
                    </p>
                  ) : (
                    <p className="seats seats--waitlist">
                      <Icon name="clock" />
                      Мест нет — вы встанете в лист ожидания
                    </p>
                  )}
                  <RegistrationForm
                    initial={data}
                    pending={request.isPending}
                    error={request.error}
                    onSubmit={(input) => request.mutate(input)}
                  />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
