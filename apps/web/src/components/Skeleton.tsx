export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="stack page-loading" aria-busy="true" aria-label={label}>
      <span className="skeleton skeleton--title" style={{ width: "60%" }} />
      <span className="skeleton skeleton--line" style={{ width: "40%" }} />
      <span className="skeleton skeleton--line" style={{ width: "90%" }} />
      <span className="skeleton skeleton--block" />
    </div>
  );
}
