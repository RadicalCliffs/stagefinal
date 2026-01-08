import type { ReactNode } from "react";

interface ActivityProps {
  mode: "visible" | "hidden";
  children: ReactNode;
}

/**
 * Activity - A conditional visibility wrapper component.
 * Renders children only when mode is "visible".
 */
const Activity: React.FC<ActivityProps> = ({ mode, children }) => {
  if (mode === "hidden") {
    return null;
  }
  return <>{children}</>;
};

export default Activity;
