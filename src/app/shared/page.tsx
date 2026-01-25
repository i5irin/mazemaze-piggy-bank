export const metadata = {
  title: "Shared",
};

const sharedSpaces = [
  { name: "Family Pool", role: "Owner", members: "3 members" },
  { name: "Trip Fund", role: "Member", members: "2 members" },
];

export default function SharedPage() {
  return (
    <div className="section-stack">
      <section className="app-surface">
        <h1>Shared</h1>
        <p className="app-muted">Access shared pools backed by OneDrive permissions.</p>
      </section>

      <section className="card-grid">
        {sharedSpaces.map((space) => (
          <div key={space.name} className="app-surface">
            <div style={{ fontWeight: 600 }}>{space.name}</div>
            <div className="app-muted">
              Role: {space.role} · {space.members}
            </div>
            <div style={{ marginTop: 8 }}>Editing depends on shared access rights.</div>
          </div>
        ))}
      </section>
    </div>
  );
}
