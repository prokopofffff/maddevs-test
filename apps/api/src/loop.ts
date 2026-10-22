/**
 * Фоновый цикл в процессе API: проход сразу при старте, затем по таймеру и по пинку `wake()` (D-014, D-018).
 * Одновременно идёт не больше одного прохода; пинок во время прохода даёт ещё один следом.
 */
export function createLoop(name: string, pass: () => Promise<unknown>, intervalMs: number) {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let again = false;

  const run = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await pass();
        } catch (error) {
          console.error(`Проход «${name}» упал:`, error);
        }
      } while (again);
    })().finally(() => {
      running = undefined;
    });
    return running;
  };

  return {
    start() {
      timer = setInterval(run, intervalMs);
      void run();
    },
    wake() {
      void run();
    },
    /** Останавливает тик и дожидается текущего прохода. */
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
