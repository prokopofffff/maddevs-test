import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Counts } from "./pages/admin/EventStats.tsx";
import { registrationsKey } from "./pages/admin/ParticipantList.tsx";

/** Браузер переподключается сам по `retry: 3000`; закрытый поток (не `200`) открываем заново через столько же. */
const REOPEN_MS = 3000;

/**
 * Live-счётчики события (D-020, D-021, SPEC §7): каждый снимок из `GET …/live` кладётся в кэш запроса события,
 * список участников перезапрашивается. `offline` — поток в ошибке, на экране последние полученные цифры.
 */
export function useLiveCounts(eventId: string) {
  const queryClient = useQueryClient();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let source: EventSource | undefined;
    let reopen: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      source = new EventSource(`/api/organizer/events/${encodeURIComponent(eventId)}/live`);
      source.addEventListener("counts", (message) => {
        const counts = JSON.parse(message.data) as Counts;
        queryClient.setQueryData(["organizer", "event", eventId], (old: { counts: Counts } | undefined) =>
          old ? { ...old, counts } : old,
        );
        // И первый снимок: между загрузкой списка и подключением потока список мог устареть.
        void queryClient.invalidateQueries({ queryKey: registrationsKey(eventId) });
        setOffline(false);
      });
      source.addEventListener("error", () => {
        setOffline(true);
        if (source?.readyState !== EventSource.CLOSED) return;
        source = undefined;
        reopen = setTimeout(open, REOPEN_MS);
      });
    };
    open();

    return () => {
      clearTimeout(reopen);
      source?.close();
    };
  }, [eventId, queryClient]);

  return { offline };
}
