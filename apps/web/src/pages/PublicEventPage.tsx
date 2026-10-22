import type { RegistrationForm as FormData, VerificationRequest } from "@app/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError, client } from "../api.ts";
import { AgeBadge } from "../components/AgeBadge.tsx";
import { ErrorBanner } from "../components/Banner.tsx";
import { PublicHeader } from "../components/PublicHeader.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { errorText } from "../errors.ts";
import { categoryLabel, formatEventTime, fullPlace, seatsLeft } from "../format.ts";
import { CodeStep } from "./event/CodeStep.tsx";
import { LookupForm } from "./event/LookupForm.tsx";
import { RegistrationForm } from "./event/RegistrationForm.tsx";
import { RegistrationResult } from "./event/RegistrationResult.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

type Step =
  | { name: "form" }
  | { name: "code"; verificationId: number; resendAt: number }
  | { name: "result"; result: "confirmed" | "waitlisted" | "existing"; token: string };

const isCode = (error: unknown, code: string): error is ApiError => error instanceof ApiError && error.code === code;

/**
 * Страница события по ссылке: S1-Event (описание, свободные места, форма) → S2-Code (ввод кода) → S3-Result.
 * «Уже регистрировались?» ведёт через тот же ввод кода сразу на `/r/:token` (D-039).
 */
export function PublicEventPage() {
  const { eventId = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const eventKey = ["event", eventId];
  const event = useQuery({
    queryKey: eventKey,
    queryFn: () => api(client.api.events[":id"].$get({ param: { id: eventId } })),
  });
  const [step, setStep] = useState<Step>({ name: "form" });
  const [data, setData] = useState<FormData>();
  const [lookupEmail, setLookupEmail] = useState<string>();
  // Последний отправленный запрос кода: по нему повторная отправка и адрес на экране кода.
  const [sent, setSent] = useState<VerificationRequest>();
  // Код, с которого вернулись «Изменить email»: тот же запрос раньше минуты снова ведёт к нему.
  const [previous, setPrevious] = useState<{ purpose: string; email: string; verificationId: number }>();
  const verificationId = step.name === "code" ? step.verificationId : undefined;

  const toCode = (id: number, resendAt: number) => setStep({ name: "code", verificationId: id, resendAt });
  const onClosed = (error: unknown) => {
    // Событие началось, пока человек заполнял форму: страница переключается на «регистрация закрыта».
    if (isCode(error, "registration_closed")) void queryClient.invalidateQueries({ queryKey: eventKey });
  };

  const requestCode = (input: VerificationRequest) =>
    api(client.api.events[":id"].verifications.$post({ param: { id: eventId }, json: input }));
  const codeRequest = {
    mutationFn: requestCode,
    onSuccess: (res: { verificationId: number; resendAfter: string }, input: VerificationRequest) => {
      setSent(input);
      toCode(res.verificationId, Date.parse(res.resendAfter));
    },
    onError: (error: unknown, input: VerificationRequest) => {
      // Вернулись «Изменить email» и отправили тот же адрес раньше минуты — прежний код ещё действует.
      if (
        isCode(error, "code_resend_too_soon") &&
        previous?.purpose === input.purpose &&
        previous.email === input.email
      ) {
        setSent(input);
        toCode(previous.verificationId, Date.now() + Number(error.details.retryAfter) * 1000);
      }
      onClosed(error);
    },
  };

  const request = useMutation(codeRequest);
  const lookup = useMutation(codeRequest);
  const resend = useMutation({
    mutationFn: () => requestCode(sent!),
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
      // Вход «потерял письмо» ведёт сразу на страницу регистрации.
      if (res.result === "found") return void navigate(`/r/${res.token}`);
      setStep({ name: "result", result: res.result, token: res.token });
      void queryClient.invalidateQueries({ queryKey: eventKey });
    },
    onError: onClosed,
  });

  if (step.name === "result") return <RegistrationResult result={step.result} token={step.token} />;
  if (step.name === "code" && sent) {
    return (
      <CodeStep
        key={`${step.verificationId}:${step.resendAt}`}
        email={sent.email}
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
          setPrevious({ purpose: sent.purpose, email: sent.email, verificationId: step.verificationId });
          if (sent.purpose === "register") {
            const { purpose: _, ...form } = sent;
            setData(form);
          } else setLookupEmail(sent.email);
          confirm.reset();
          resend.reset();
          request.reset();
          lookup.reset();
          setStep({ name: "form" });
        }}
      />
    );
  }

  if (event.isPending) return <PageSkeleton label="Загрузка события" />;
  if (event.error instanceof ApiError && event.error.status === 404) return <NotFoundPage />;

  return (
    <>
      <PublicHeader />
      <div className="page page--split">
        {event.isError ? (
          <ErrorBanner title="Не удалось загрузить событие">{errorText(event.error)}</ErrorBanner>
        ) : (
          <>
            <div className="page__main">
              <header className="event-header">
                <div className="event-header__badges">
                  <AgeBadge minAge={event.data.minAge} />
                </div>
                <h1 className="heading heading--page">{event.data.title}</h1>
                <p className="event-header__time">
                  <Icon name="calendar" />
                  {formatEventTime(event.data.startsAt, event.data.timezone)}
                </p>
                <p className="text-muted">
                  {categoryLabel[event.data.category]} · {fullPlace(event.data)}
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
                      onSubmit={(input) => request.mutate({ purpose: "register", ...input })}
                    />
                  </>
                )}
                <LookupForm
                  initial={lookupEmail}
                  pending={lookup.isPending}
                  error={lookup.error}
                  onSubmit={(email) => lookup.mutate({ purpose: "lookup", email })}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
