"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./AppNav.module.css";

const ITEMS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "Garden", icon: "home" },
  { href: "/instruments/", label: "Instruments", icon: "instruments" },
  { href: "/creations/", label: "Creations", icon: "library" },
  { href: "/settings/", label: "Settings", icon: "settings" },
];

const normalise = (path: string) => (path.endsWith("/") ? path : `${path}/`);

export function AppNav() {
  const pathname = normalise(usePathname() ?? "/");
  return (
    <nav className={styles.nav} aria-label="Main">
      <ul>
        {ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} className={`${styles.link} ${active ? styles.active : ""}`} aria-current={active ? "page" : undefined}>
                <Icon name={item.icon} size={22} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
