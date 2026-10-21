const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Кривой id в пути — тот же `404`, что и несуществующий, а не ошибка приведения типа в Postgres. */
export const isUuid = (value: string) => UUID.test(value);
