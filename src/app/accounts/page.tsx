export const metadata = {
  title: "Accounts",
};

const accounts = [
  {
    name: "Everyday Cash",
    scope: "Personal",
    positions: "3 positions",
    balance: "¥420,000",
  },
  {
    name: "Long-Term Savings",
    scope: "Personal",
    positions: "2 positions",
    balance: "¥1,680,000",
  },
  {
    name: "Shared Pool",
    scope: "Shared",
    positions: "1 position",
    balance: "¥380,000",
  },
];

export default function AccountsPage() {
  return (
    <div className="section-stack">
      <section className="app-surface">
        <h1>Accounts</h1>
        <p className="app-muted">Track balances by account and asset position.</p>
      </section>

      <section className="card-grid">
        {accounts.map((account) => (
          <div key={account.name} className="app-surface">
            <div style={{ fontWeight: 600 }}>{account.name}</div>
            <div className="app-muted">
              {account.scope} · {account.positions}
            </div>
            <div style={{ marginTop: 8, fontSize: "20px", fontWeight: 600 }}>{account.balance}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
