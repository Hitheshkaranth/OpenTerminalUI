import type { ReactNode } from "react";
import { PanelBody, PanelFooter, PanelFrame, PanelHeader } from "../layout/PanelChrome";

type Props = {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
  footerClassName?: string;
};

export function TerminalPanel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  bodyClassName = "",
  footer,
  footerClassName = "",
}: Props) {
  return (
    <PanelFrame className={className}>
      <PanelHeader title={title} subtitle={subtitle} actions={actions} />
      <PanelBody className={bodyClassName}>{children}</PanelBody>
      {footer ? <PanelFooter className={footerClassName}>{footer}</PanelFooter> : null}
    </PanelFrame>
  );
}
