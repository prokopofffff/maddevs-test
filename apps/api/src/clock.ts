/** Единственный источник времени сервера: в тестах подставляется (D-041). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
