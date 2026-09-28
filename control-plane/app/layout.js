export const metadata = {
  title: 'VECTOR Durable Control Plane',
  description: 'Isolated shadow-mode orchestration and proof control plane.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 32 }}>{children}</body>
    </html>
  );
}
