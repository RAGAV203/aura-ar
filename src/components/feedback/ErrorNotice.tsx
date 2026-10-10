import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import type { AppError } from "@/lib/errors/appErrors";
import styles from "./feedback.module.css";

interface ErrorNoticeProps {
  error: AppError;
  /** Action buttons (retry, continue without camera…). */
  children?: ReactNode;
  compact?: boolean;
}

/** Human-readable error with an icon, title and next step. Never shows stack traces. */
export function ErrorNotice({ error, children, compact }: ErrorNoticeProps) {
  const { title, message, action } = error.info;
  return (
    <div className={`${styles.notice} ${compact ? styles.noticeCompact : ""}`} role="alert">
      <Icon name="warning" size={22} className={styles.noticeIcon} />
      <div className={styles.noticeBody}>
        <p className={styles.noticeTitle}>{title}</p>
        <p>{message}</p>
        <p className={styles.noticeAction}>{action}</p>
        {children && <div className={styles.noticeButtons}>{children}</div>}
      </div>
    </div>
  );
}
