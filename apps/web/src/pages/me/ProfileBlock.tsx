import { useState } from "react";
import { formatBirthDate } from "../../format.ts";
import { ProfileEditor, type SavedProfile } from "./ProfileEditor.tsx";

type Profile = { firstName: string; lastName: string; birthDate: string };

/**
 * Профиль над вкладками `/me` (D-065): «Анна Иванова · 14 марта 1994» и «Изменить», которая открывает ту же форму
 * из трёх полей на месте строки.
 */
export function ProfileBlock({ profile, onSaved }: { profile: Profile; onSaved: (saved: SavedProfile) => void }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <section className="panel profile" aria-label="Профиль">
        <h2 className="heading heading--section">Ваши данные</h2>
        <ProfileEditor
          initial={profile}
          submitLabel="Сохранить"
          onSaved={(saved) => {
            setEditing(false);
            onSaved(saved);
          }}
          onCancel={() => setEditing(false)}
        />
      </section>
    );
  }
  return (
    <section className="panel profile profile--view" aria-label="Профиль">
      <p className="profile__summary">
        <span className="profile__name">
          {profile.firstName} {profile.lastName}
        </span>
        <span className="profile__birth"> · {formatBirthDate(profile.birthDate)}</span>
      </p>
      <button className="button button--secondary button--sm" type="button" onClick={() => setEditing(true)}>
        Изменить
      </button>
    </section>
  );
}
