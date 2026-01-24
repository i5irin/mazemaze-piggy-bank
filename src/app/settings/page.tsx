export const metadata = {
  title: "Settings",
};

const settings = [
  { label: "Sign-in", value: "Not connected" },
  { label: "Data location", value: "/Apps/PiggyBank/" },
  { label: "Offline mode", value: "View-only" },
  { label: "Account type", value: "Microsoft personal only" },
];

export default function SettingsPage() {
  return (
    <div className="section-stack">
      <section className="app-surface">
        <h1>Settings</h1>
        <p className="app-muted">Manage sign-in, storage, and safety notes.</p>
      </section>

      <section className="card-grid">
        {settings.map((item) => (
          <div key={item.label} className="app-surface">
            <div className="app-muted">{item.label}</div>
            <div style={{ fontWeight: 600 }}>{item.value}</div>
          </div>
        ))}
      </section>

      <section className="app-surface">
        <h2>Data safety</h2>
        <p className="app-muted">
          Your OneDrive folder is used by the app. Deleting it resets all data.
        </p>
      </section>
    </div>
  );
}
