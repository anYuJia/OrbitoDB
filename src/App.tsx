import { AppShell } from "./components/AppShell";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

export default function App() {
  return (
    <AppErrorBoundary>
      <AppShell />
    </AppErrorBoundary>
  );
}
