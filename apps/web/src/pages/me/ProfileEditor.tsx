import type { ParticipantData } from "@app/api/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { api, ApiError, client } from "../../api.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { errorText } from "../../errors.ts";
import { formatWallTime } from "../../format.ts";
import { participantKey, participantRegistrationsKey } from "../../participant.ts";
import { ProfileForm } from "./ProfileForm.tsx";

export type SavedProfile = InferResponseType<typeof client.api.participant.profile.$put, 200>;

type ConflictEvent = { id: string; title: string; startsAt: string; timezone: string; minAge: number };
type Conflict = { data: ParticipantData; events: ConflictEvent[] };

const isConflict = (error: unknown): error is ApiError => error instanceof ApiError && error.code === "profile_conflicts";

/**
 * Форма профиля с сохранением (D-065): первое заполнение и правка на `/me`. Если новая дата рождения не проходит
 * по возрасту на уже оформленные регистрации, сервер отвечает `409 profile_conflicts` и ничего не меняет;
 * диалог перечисляет события, и только подтверждение повторяет запрос с `cancelConflicts: true`.
 */
export function ProfileEditor({
  initial,
  submitLabel,
  onSaved,
  onCancel,
}: {
  initial?: ParticipantData;
  submitLabel: string;
  onSaved: (saved: SavedProfile) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<Conflict>();
  const save = useMutation({
    mutationFn: (input: ParticipantData & { cancelConflicts?: boolean }) =>
      api(client.api.participant.profile.$put({ json: input })),
    onSuccess: (saved) => {
      setConflict(undefined);
      // Сначала профиль в кэше: иначе до ответа `/participant/me` страница ещё раз показала бы первую форму.
      queryClient.setQueryData(participantKey, (old: unknown) =>
        old && typeof old === "object" ? { ...old, profile: saved.profile } : old,
      );
      // Перечитываем участника (`lastData` мог измениться), его регистрации и страницы событий (`myRegistration`).
      void queryClient.invalidateQueries({ queryKey: participantKey });
      void queryClient.invalidateQueries({ queryKey: participantRegistrationsKey });
      void queryClient.invalidateQueries({ queryKey: ["event"] });
      onSaved(saved);
    },
    onError: (error, input) => {
      if (isConflict(error)) setConflict({ data: input, events: error.details.events as ConflictEvent[] });
    },
  });

  return (
    <>
      <ProfileForm
        initial={initial}
        submitLabel={submitLabel}
        pendingLabel="Сохраняем…"
        pending={save.isPending && !conflict}
        // Конфликт показывает диалог, а не баннер «что-то пошло не так».
        error={isConflict(save.error) ? undefined : save.error}
        onSubmit={(data) => save.mutate(data)}
        onCancel={onCancel}
      />
      {conflict && (
        <ConfirmDialog
          title="Регистрации будут отменены"
          text="По новой дате рождения вы не проходите по возрасту на эти события. После сохранения регистрации отменятся, а место достанется следующему в листе ожидания."
          confirmLabel="Сохранить и отменить"
          cancelLabel="Не сохранять"
          pending={save.isPending}
          error={save.isError && !isConflict(save.error) ? errorText(save.error) : undefined}
          onConfirm={() => save.mutate({ ...conflict.data, cancelConflicts: true })}
          onCancel={() => {
            setConflict(undefined);
            save.reset();
          }}
        >
          <ul className="dialog__list">
            {conflict.events.map((e) => (
              <li key={e.id}>
                <span className="dialog__list-title">
                  {e.title} — с {e.minAge} лет
                </span>
                <span className="text-muted">{formatWallTime(e.startsAt, e.timezone)}</span>
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </>
  );
}
