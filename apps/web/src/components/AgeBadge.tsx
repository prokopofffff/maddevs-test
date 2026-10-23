/** Возрастной бейдж «0+», «12+»: рисуется всегда, и для 0 тоже — «без ограничения» тоже ответ (D-060). */
export function AgeBadge({ minAge }: { minAge: number }) {
  return <span className="badge badge--age">{minAge}+</span>;
}
