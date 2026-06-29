export function NightHawkLoadingSkeleton() {
  return (
    <div className="nighthawk-content-canvas" aria-busy="true" aria-label="Loading Night Hawk">
      <div className="nighthawk-layout">
        <section className="nighthawk-playbook nighthawk-playbook-skeleton">
          <div className="nighthawk-skeleton-bar nighthawk-skeleton-bar-lg" />
          <div className="nighthawk-skeleton-bar" />
          <div className="nighthawk-skeleton-rows">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="nighthawk-skeleton-row" />
            ))}
          </div>
        </section>
        <section className="nighthawk-playbook nighthawk-playbook-skeleton">
          <div className="nighthawk-skeleton-bar nighthawk-skeleton-bar-lg" />
          <div className="nighthawk-skeleton-rows">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="nighthawk-skeleton-row nighthawk-skeleton-row-tall" />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
