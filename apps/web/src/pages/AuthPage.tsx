import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, signupSchema, type LoginInput } from "@app/api/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { api, client } from "../api.ts";
import { ErrorBanner } from "../components/Banner.tsx";
import { Icon } from "../components/Icon.tsx";
import { errorText } from "../errors.ts";
import { homeFor, meKey, useMe } from "../session.ts";

type Mode = "login" | "signup";

const copy = {
  login: { title: "Вход для организаторов", submit: "Войти", pending: "Входим…" },
  signup: { title: "Новый организатор", submit: "Создать аккаунт", pending: "Создаём…" },
};

/** S5-Login: вход и регистрация организатора. */
export function AuthPage({ mode }: { mode: Mode }) {
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const form = useForm<LoginInput>({
    resolver: zodResolver(mode === "login" ? loginSchema : signupSchema),
    defaultValues: { email: "", password: "" },
  });
  const submit = useMutation({
    mutationFn: (input: LoginInput) =>
      mode === "login" ? api(client.api.auth.login.$post({ json: input })) : api(client.api.auth.signup.$post({ json: input })),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(meKey, user);
      const next = params.get("next");
      // `next` — только в свой кабинет: поддержку не ведём на организаторскую страницу и наоборот.
      navigate(next?.startsWith(homeFor(user.role)) ? next : homeFor(user.role));
    },
  });

  if (me.data) return <Navigate to={homeFor(me.data.role)} replace />;

  const { errors } = form.formState;
  const failed = submit.isError;
  const errorId = `${mode}-error`;

  return (
    <div className="auth s5-auth">
      <Link className="back-link" to="/">
        <Icon name="back" />
        Все события
      </Link>
      <h1 className="heading auth__title">{copy[mode].title}</h1>
      <nav className="tabs" aria-label="Вход или регистрация">
        <Link className="tabs__link" to="/login" aria-current={mode === "login" ? "page" : undefined}>
          Вход
        </Link>
        <Link className="tabs__link" to="/signup" aria-current={mode === "signup" ? "page" : undefined}>
          Регистрация
        </Link>
      </nav>
      <form className="form" noValidate onSubmit={form.handleSubmit((input) => submit.mutate(input))}>
        {failed && <ErrorBanner id={errorId}>{errorText(submit.error)}</ErrorBanner>}
        <div className={`field ${errors.email || failed ? "field--error" : ""}`}>
          <label className="field__label" htmlFor={`${mode}-email`}>
            Email
          </label>
          <input
            className="field__control"
            id={`${mode}-email`}
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            aria-invalid={Boolean(errors.email || failed)}
            aria-describedby={failed ? errorId : errors.email ? `${mode}-email-error` : undefined}
            {...form.register("email")}
          />
          {errors.email && (
            <p className="field__error" id={`${mode}-email-error`}>
              Введите email, например name@example.com
            </p>
          )}
        </div>
        <div className={`field ${errors.password || failed ? "field--error" : ""}`}>
          <label className="field__label" htmlFor={`${mode}-password`}>
            Пароль
          </label>
          <input
            className="field__control"
            id={`${mode}-password`}
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            aria-invalid={Boolean(errors.password || failed)}
            aria-describedby={failed ? errorId : `${mode}-password-hint`}
            {...form.register("password")}
          />
          {mode === "signup" && (
            <p className={errors.password ? "field__error" : "field__hint"} id={`${mode}-password-hint`}>
              Пароль — не короче 8 символов
            </p>
          )}
          {mode === "login" && errors.password && (
            <p className="field__error" id={`${mode}-password-hint`}>
              Введите пароль
            </p>
          )}
        </div>
        <button className="button button--primary button--block" type="submit" disabled={submit.isPending}>
          {submit.isPending ? copy[mode].pending : copy[mode].submit}
        </button>
      </form>
    </div>
  );
}
