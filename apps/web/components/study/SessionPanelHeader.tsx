import { ChevronsRight } from "lucide-react";
import type { ReactNode } from "react";

export function SessionPanelHeader({ title, onCollapse, children }: { title: string; onCollapse: () => void; children?: ReactNode }) {
  return <div className="session-panel-bar"><button className="session-icon-button" type="button" aria-label="Collapse side panel" title="Collapse" onClick={onCollapse}><ChevronsRight aria-hidden="true" /></button><h2 className="session-panel-title">{title}</h2>{children ? <div className="session-panel-bar-actions">{children}</div> : null}</div>;
}
