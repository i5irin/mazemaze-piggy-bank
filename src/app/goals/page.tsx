export const metadata = {
  title: "Goals",
};

const goals = [
  {
    name: "Emergency Fund",
    target: "¥800,000",
    progress: "¥540,000 allocated",
    status: "Active",
  },
  {
    name: "Travel 2026",
    target: "¥300,000",
    progress: "¥126,000 allocated",
    status: "Active",
  },
  {
    name: "Home Office Refresh",
    target: "¥200,000",
    progress: "¥200,000 allocated",
    status: "Closed",
  },
];

export default function GoalsPage() {
  return (
    <div className="section-stack">
      <section className="app-surface">
        <h1>Goals</h1>
        <p className="app-muted">Manage targets and reserved allocations.</p>
      </section>

      <section className="card-grid">
        {goals.map((goal) => (
          <div key={goal.name} className="app-surface">
            <div style={{ fontWeight: 600 }}>{goal.name}</div>
            <div className="app-muted">Target {goal.target}</div>
            <div style={{ marginTop: 8 }}>{goal.progress}</div>
            <div className="app-muted">Status: {goal.status}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
