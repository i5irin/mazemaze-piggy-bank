export const metadata = {
  title: "Dashboard",
};

const summaryCards = [
  { label: "Total assets", value: "¥2,480,000" },
  { label: "Allocated", value: "¥1,820,000" },
  { label: "Unallocated", value: "¥660,000" },
];

const highlights = [
  { title: "Emergency Fund", detail: "68% of ¥800,000 target" },
  { title: "Travel 2026", detail: "42% of ¥300,000 target" },
];

export default function DashboardPage() {
  return (
    <div className="section-stack">
      <section className="app-surface">
        <h1>Dashboard</h1>
        <p className="app-muted">
          Overview of your latest snapshot and goal progress.
        </p>
      </section>

      <section className="card-grid">
        {summaryCards.map((item) => (
          <div key={item.label} className="app-surface">
            <div className="app-muted">{item.label}</div>
            <div style={{ fontSize: "22px", fontWeight: 600 }}>{item.value}</div>
          </div>
        ))}
      </section>

      <section className="app-surface">
        <h2>Highlights</h2>
        <div className="section-stack">
          {highlights.map((item) => (
            <div key={item.title}>
              <div style={{ fontWeight: 600 }}>{item.title}</div>
              <div className="app-muted">{item.detail}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
