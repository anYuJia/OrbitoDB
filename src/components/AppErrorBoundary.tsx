import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("OrbitoDB UI crashed", error, info);
  }

  private reload = () => {
    window.location.reload();
  };

  private resetWorkspace = () => {
    try {
      localStorage.removeItem("orbitodb.editors");
      localStorage.removeItem("orbitodb.activeEditor");
      localStorage.removeItem("orbitodb.editor");
    } catch {
      // Reload is still useful when storage is unavailable.
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="odb-crash-screen" role="alert">
        <div className="odb-crash-panel">
          <span className="odb-page-eyebrow">Recovery</span>
          <h1>OrbitoDB hit a UI error</h1>
          <p>
            Your databases and saved connection profiles were not deleted. Reload the app first;
            if the crash was caused by a persisted editor session, reset only the SQL workspace.
          </p>
          <code>{this.state.error.message || this.state.error.name}</code>
          <div className="odb-crash-actions">
            <button className="primary" onClick={this.reload}>Reload OrbitoDB</button>
            <button onClick={this.resetWorkspace}>Reset SQL workspace</button>
          </div>
        </div>
      </main>
    );
  }
}
