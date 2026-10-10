import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./ui.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  size?: "md" | "lg";
  children: ReactNode;
}

export function Button({ variant = "secondary", icon, size = "md", className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={`${styles.button} ${styles[variant]} ${size === "lg" ? styles.large : ""} ${className ?? ""}`} {...rest}>
      {icon && <Icon name={icon} size={20} />}
      <span>{children}</span>
    </button>
  );
}

interface ButtonLinkProps {
  href: string;
  variant?: Variant;
  icon?: IconName;
  size?: "md" | "lg";
  className?: string;
  children: ReactNode;
}

export function ButtonLink({ href, variant = "secondary", icon, size = "md", className, children }: ButtonLinkProps) {
  return (
    <Link href={href} className={`${styles.button} ${styles[variant]} ${size === "lg" ? styles.large : ""} ${className ?? ""}`}>
      {icon && <Icon name={icon} size={20} />}
      <span>{children}</span>
    </Link>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Accessible name — required because the button has no visible text. */
  label: string;
  pressed?: boolean;
  showLabel?: boolean;
  /** Shorter visible text when the accessible label is long (e.g. "Camera" for "Camera on"). */
  visibleLabel?: string;
}

export function IconButton({ icon, label, pressed, showLabel = false, visibleLabel, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={showLabel && !visibleLabel ? undefined : label}
      aria-pressed={pressed}
      title={label}
      className={`${styles.iconButton} ${showLabel ? styles.withLabel : ""} ${pressed ? styles.pressed : ""} ${className ?? ""}`}
      {...rest}
    >
      <Icon name={icon} />
      {showLabel && (
        <span className={styles.iconLabel} aria-hidden={visibleLabel ? true : undefined}>
          {visibleLabel ?? label}
        </span>
      )}
    </button>
  );
}
