import { Component, type ErrorInfo, type ReactNode } from "react";
import { translate } from "../lib/i18n";

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
          <span className="odb-page-eyebrow">{translate("crash.recovery")}</span>
          <h1>{translate("crash.title")}</h1>
          <p>{translate("crash.description")}</p>
          <code>{this.state.error.message || this.state.error.name}</code>
          <div className="odb-crash-actions">
            <button className="primary" onClick={this.reload}>{translate("crash.reload")}</button>
            <button onClick={this.resetWorkspace}>{translate("crash.reset")}</button>
          </div>
        </div>
      </main>
    );
  }
}
