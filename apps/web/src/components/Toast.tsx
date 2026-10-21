import { useEffect } from "react";
import { Icon } from "./Icon.tsx";

/** Всплывающее уведомление; само исчезает через 3 секунды. */
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 3000);
    return () => clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div className="toast toast--floating" role="status">
      <Icon name="check" />
      <p>{message}</p>
    </div>
  );
}
