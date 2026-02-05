"use client";

type SharedShellProps = {
  children: React.ReactNode;
};

export function SharedShell({ children }: SharedShellProps) {
  return <div className="section-stack">{children}</div>;
}
